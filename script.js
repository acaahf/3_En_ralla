// ==========================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================
const SUPABASE_URL = 'https://znuqyhkgqpbdmfegudwi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_a_vWpcMgOHNuLFGE5rfbfw_9oQb3R3k';

// Inicialización adaptada para claves Publishable
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: {
    fetch: (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      
      // Si la librería intenta enviar la publishable key como token Bearer, se remueve
      if (headers.get('Authorization')?.includes('sb_publishable_')) {
        headers.delete('Authorization');
      }
      
      return fetch(url, { ...options, headers });
    }
  },
  auth: {
    persistSession: false
  }
});

// Lista de símbolos para partidas de 2 a 6 jugadores
const SIMBOLOS_JUGADORES = ['X', 'O', 'Δ', '□', '☆', '◇'];

// Estado global de la aplicación
let partidaActual = null;
let miNombreJugador = '';
let miSimbolo = '';
let canalRealtime = null;
let canalChat = null;
let intervaloTemporizador = null;
let votosRevancha = new Set();
const TIEMPO_MAXIMO_TURNO = 15;

// ==========================================
// 2. ELEMENTOS DEL DOM Y EVENTOS INICIALES
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Navegación de menú
  document.getElementById('btnCrearSalaMenu')?.addEventListener('click', () => mostrarPantalla('pantallaCrear'));
  document.getElementById('btnUnirseSalaMenu')?.addEventListener('click', () => mostrarPantalla('pantallaUnirse'));
  document.getElementById('btnVerRankingMenu')?.addEventListener('click', () => {
    mostrarPantalla('pantallaRanking');
    cargarRanking();
  });

  document.querySelectorAll('.btn-volver-menu').forEach(btn => {
    btn.addEventListener('click', async () => {
      await abandonarPartidaActual();
      mostrarPantalla('pantallaInicio');
    });
  });

  // Formularios
  document.getElementById('formCrear')?.addEventListener('submit', crearSala);
  document.getElementById('formUnirse')?.addEventListener('submit', unirseASala);
  document.getElementById('formChat')?.addEventListener('submit', enviarMensajeChat);

  // Botones de acción
  document.getElementById('btnIniciarPartida')?.addEventListener('click', iniciarPartidaHost);
  document.getElementById('btnRevancha')?.addEventListener('click', enviarSolicitudRevancha);
  document.getElementById('btnSalirLobby')?.addEventListener('click', async () => {
    await abandonarPartidaActual();
    mostrarPantalla('pantallaInicio');
  });
  document.getElementById('btnSalirPartida')?.addEventListener('click', async () => {
    await abandonarPartidaActual();
    mostrarPantalla('pantallaInicio');
  });
  document.getElementById('btnBorrarRanking')?.addEventListener('click', reiniciarRankingAdmin);
});

// Cambiar visibilidad de las pantallas
function mostrarPantalla(idPantalla) {
  const pantallas = ['pantallaInicio', 'pantallaCrear', 'pantallaUnirse', 'pantallaLobby', 'pantallaJuego', 'pantallaRanking'];
  pantallas.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = (p === idPantalla) ? 'block' : 'none';
  });
}

// Generador de código aleatorio de sala (6 caracteres)
function generarCodigoSala() {
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 6; i++) {
    codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return codigo;
}

// ==========================================
// 3. CREACIÓN Y UNIÓN A SALAS
// ==========================================

async function crearSala(e) {
  e.preventDefault();
  const nombre = document.getElementById('inputNombreCreador').value.trim();
  const maxJugadores = parseInt(document.getElementById('selectMaxJugadores').value);

  if (!nombre) return;

  miNombreJugador = nombre;
  miSimbolo = SIMBOLOS_JUGADORES[0]; // 'X' para el creador
  const codigoSala = generarCodigoSala();

  // Calcular dimensión del tablero según número de jugadores
  const dimension = maxJugadores <= 2 ? 3 : maxJugadores + 1; 

  const nuevaPartida = {
    id: codigoSala,
    max_jugadores: maxJugadores,
    dimension: dimension,
    en_raya_para_ganar: dimension === 3 ? 3 : 4,
    jugadores: [{ nombre: miNombreJugador, simbolo: miSimbolo, creador: true }],
    turno_index: 0,
    tablero: Array(dimension * dimension).fill(''),
    estado: 'esperando',
    ganador: null
  };

  Swal.showLoading();
  const { data, error } = await supabaseClient.from('partidas').insert([nuevaPartida]).select().single();
  Swal.close();

  if (error) {
    Swal.fire('Error', 'No se pudo crear la sala: ' + error.message, 'error');
    return;
  }

  partidaActual = data;
  suscribirAEstadoPartida(codigoSala);
  conectarChatYEventos(codigoSala);
  actualizarVistaLobby();
  mostrarPantalla('pantallaLobby');
}

async function unirseASala(e) {
  e.preventDefault();
  const codigo = document.getElementById('inputCodigoSala').value.trim().toUpperCase();
  const nombre = document.getElementById('inputNombreUnirse').value.trim();

  if (!codigo || !nombre) return;

  Swal.showLoading();
  const { data: partida, error } = await supabaseClient.from('partidas').select('*').eq('id', codigo).single();
  Swal.close();

  if (error || !partida) {
    Swal.fire('Error', 'La sala no existe o el código es incorrecto.', 'error');
    return;
  }

  if (partida.estado !== 'esperando') {
    Swal.fire('Atención', 'La partida ya está en curso, fue cancelada o finalizó.', 'warning');
    return;
  }

  if (partida.jugadores.length >= partida.max_jugadores) {
    Swal.fire('Sala Llena', 'Esta sala ya alcanzó el máximo de jugadores.', 'warning');
    return;
  }

  if (partida.jugadores.some(j => j.nombre.toLowerCase() === nombre.toLowerCase())) {
    Swal.fire('Nombre ocupado', 'Ya hay un jugador con ese nombre en la sala.', 'warning');
    return;
  }

  miNombreJugador = nombre;
  miSimbolo = SIMBOLOS_JUGADORES[partida.jugadores.length];

  const nuevosJugadores = [...partida.jugadores, { nombre: miNombreJugador, simbolo: miSimbolo, creador: false }];

  Swal.showLoading();
  const { data: partidaActualizada, error: errUpdate } = await supabaseClient
    .from('partidas')
    .update({ jugadores: nuevosJugadores })
    .eq('id', codigo)
    .select()
    .single();
  Swal.close();

  if (errUpdate) {
    Swal.fire('Error', 'No se pudo ingresar a la sala.', 'error');
    return;
  }

  partidaActual = partidaActualizada;
  suscribirAEstadoPartida(codigo);
  conectarChatYEventos(codigo);
  actualizarVistaLobby();
  mostrarPantalla('pantallaLobby');
}

// ==========================================
// 4. LOBBY Y REALTIME
// ==========================================

function actualizarVistaLobby() {
  if (!partidaActual) return;

  document.getElementById('lblCodigoSala').textContent = partidaActual.id;
  const lista = document.getElementById('listaJugadoresLobby');
  lista.innerHTML = '';

  partidaActual.jugadores.forEach((j) => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    li.innerHTML = `
      <span><b>${j.nombre}</b> ${j.creador ? '<span class="badge bg-primary ms-1">Anfitrión</span>' : ''}</span>
      <span class="badge bg-secondary">Símbolo: ${j.simbolo}</span>
    `;
    lista.appendChild(li);
  });

  const soyCreador = partidaActual.jugadores[0]?.nombre === miNombreJugador;
  const btnIniciar = document.getElementById('btnIniciarPartida');
  
  if (soyCreador && partidaActual.jugadores.length >= 2) {
    btnIniciar.style.display = 'block';
  } else {
    btnIniciar.style.display = 'none';
  }
}

async function iniciarPartidaHost() {
  if (!partidaActual) return;

  const { error } = await supabaseClient
    .from('partidas')
    .update({ estado: 'jugando', turno_index: 0 })
    .eq('id', partidaActual.id);

  if (error) {
    Swal.fire('Error', 'No se pudo iniciar la partida: ' + error.message, 'error');
  }
}

function suscribirAEstadoPartida(codigoSala) {
  if (canalRealtime) supabaseClient.removeChannel(canalRealtime);

  canalRealtime = supabaseClient
    .channel('partida_' + codigoSala)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'partidas', filter: `id=eq.${codigoSala}` }, (payload) => {
      const estadoAnterior = partidaActual?.estado;
      const turnoAnterior = partidaActual?.turno_index;
      partidaActual = payload.new;

      // DETECCIÓN DE CANCELACIÓN DE PARTIDA
      if (partidaActual.estado === 'cancelado') {
        detenerTemporizador();
        const abandonador = partidaActual.ganador || 'Un jugador';

        Swal.fire({
          title: 'Partida Cancelada 🚫',
          html: `La partida ha sido cancelada porque <b>${abandonador}</b> abandonó el juego.`,
          icon: 'warning',
          confirmButtonText: 'Ir al Menú'
        }).then(() => {
          limpiarEstadoLocal();
          mostrarPantalla('pantallaInicio');
        });
        return;
      }

      if (partidaActual.estado === 'esperando') {
        actualizarVistaLobby();
      } else if (partidaActual.estado === 'jugando') {
        if (estadoAnterior !== 'jugando') {
          mostrarPantalla('pantallaJuego');
          Swal.close();
        }
        
        renderizarJuego();
        
        if (turnoAnterior !== partidaActual.turno_index || estadoAnterior !== 'jugando') {
          iniciarTemporizadorTurno();
        }
      } else if (partidaActual.estado === 'finalizado' && estadoAnterior !== 'finalizado') {
        renderizarJuego();
        detenerTemporizador();
        mostrarFinDeJuego(partidaActual.ganador);

        // Registrar estadísticas según el resultado
        if (partidaActual.ganador === 'Empate') {
          registrarResultadoEstadisticas(miNombreJugador, 'empate');
        } else if (partidaActual.ganador && partidaActual.ganador !== miNombreJugador) {
          registrarResultadoEstadisticas(miNombreJugador, 'perdida');
        }
      }
    })
    .subscribe();
}

// ==========================================
// 5. LÓGICA DEL JUEGO Y TABLERO
// ==========================================

function renderizarJuego() {
  if (!partidaActual) return;

  const dim = partidaActual.dimension;
  const tableroDiv = document.getElementById('tablero');
  
  tableroDiv.style.gridTemplateColumns = `repeat(${dim}, 1fr)`;
  tableroDiv.innerHTML = '';

  const jugadorTurno = partidaActual.jugadores[partidaActual.turno_index];
  const esMiTurno = jugadorTurno && jugadorTurno.nombre === miNombreJugador;

  const btnRevancha = document.getElementById('btnRevancha');
  if (btnRevancha) {
    btnRevancha.style.display = (partidaActual.estado === 'finalizado') ? 'block' : 'none';
    if (partidaActual.estado === 'jugando') {
      btnRevancha.disabled = false;
      btnRevancha.textContent = '🔄 Revancha';
    }
  }

  const lblTurno = document.getElementById('lblTurno');
  if (lblTurno) {
    if (partidaActual.estado === 'finalizado') {
      lblTurno.innerHTML = `<span class="text-secondary fw-bold">Partida Finalizada</span>`;
    } else if (esMiTurno) {
      lblTurno.innerHTML = `<span class="text-success fw-bold">¡Es tu turno! (Tu símbolo: ${miSimbolo})</span>`;
    } else {
      lblTurno.innerHTML = `Turno de: <b>${jugadorTurno ? jugadorTurno.nombre : '...'}</b> (${jugadorTurno ? jugadorTurno.simbolo : ''})`;
    }
  }

  partidaActual.tablero.forEach((valor, index) => {
    const btn = document.createElement('button');
    btn.className = `btn-casilla ${valor ? 'simbolo-' + valor : ''}`;
    btn.textContent = valor;
    btn.disabled = valor !== '' || !esMiTurno || partidaActual.estado !== 'jugando';

    btn.addEventListener('click', () => realizarMovimiento(index));
    tableroDiv.appendChild(btn);
  });
}

async function realizarMovimiento(index) {
  if (!partidaActual || partidaActual.estado !== 'jugando') return;

  const nuevoTablero = [...partidaActual.tablero];
  nuevoTablero[index] = miSimbolo;

  const haGanado = verificarVictoria(nuevoTablero, partidaActual.dimension, partidaActual.en_raya_para_ganar, index, miSimbolo);

  detenerTemporizador();

  const { data, error } = await supabaseClient.rpc('procesar_movimiento', {
    p_partida_id: partidaActual.id,
    p_simbolo: miSimbolo,
    p_casilla_index: index,
    p_nuevo_tablero: nuevoTablero,
    p_ha_ganado: haGanado,
    p_jugador_nombre: miNombreJugador
  });

  if (error) {
    console.error("Error al procesar movimiento:", error);
    iniciarTemporizadorTurno();
  } else if (haGanado) {
    await registrarResultadoEstadisticas(miNombreJugador, 'ganada');
  }
}

function verificarVictoria(tablero, dim, enRaya, ultimoIndex, simbolo) {
  const fila = Math.floor(ultimoIndex / dim);
  const col = ultimoIndex % dim;

  const direcciones = [
    [0, 1],  // Horizontal
    [1, 0],  // Vertical
    [1, 1],  // Diagonal principal
    [1, -1]  // Diagonal secundaria
  ];

  for (const [df, dc] of direcciones) {
    let contador = 1;

    for (let i = 1; i < enRaya; i++) {
      const f = fila + df * i;
      const c = col + dc * i;
      if (f >= 0 && f < dim && c >= 0 && c < dim && tablero[f * dim + c] === simbolo) {
        contador++;
      } else break;
    }

    for (let i = 1; i < enRaya; i++) {
      const f = fila - df * i;
      const c = col - dc * i;
      if (f >= 0 && f < dim && c >= 0 && c < dim && tablero[f * dim + c] === simbolo) {
        contador++;
      } else break;
    }

    if (contador >= enRaya) return true;
  }
  return false;
}

// ==========================================
// 6. SISTEMA DE REVANCHA INTERACTIVA
// ==========================================

function enviarSolicitudRevancha() {
  if (!partidaActual || !canalChat) return;

  const btn = document.getElementById('btnRevancha');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Esperando a los demás...';
  }

  votosRevancha.clear();
  votosRevancha.add(miNombreJugador);

  canalChat.send({
    type: 'broadcast',
    event: 'solicitud_revancha',
    payload: { solicitante: miNombreJugador }
  });

  Swal.fire({
    title: 'Solicitud Enviada',
    text: `Esperando confirmación (${votosRevancha.size}/${partidaActual.jugadores.length})...`,
    icon: 'info',
    showConfirmButton: false,
    allowOutsideClick: false
  });
}

function recibirSolicitudRevancha(solicitante) {
  if (solicitante === miNombreJugador) return;

  votosRevancha.clear();
  votosRevancha.add(solicitante);

  Swal.fire({
    title: '⚡ ¡Propuesta de Revancha!',
    html: `<b>${solicitante}</b> ha propuesto jugar otra vez. ¿Aceptas la revancha?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#198754',
    cancelButtonColor: '#dc3545',
    confirmButtonText: '¡Sí, a jugar!',
    cancelButtonText: 'No, gracias',
    allowOutsideClick: false
  }).then((result) => {
    if (result.isConfirmed) {
      canalChat.send({
        type: 'broadcast',
        event: 'voto_revancha',
        payload: { aceptado: true, respondiente: miNombreJugador }
      });
    } else {
      // Si rechaza, notifica a todos para salir automáticamente
      canalChat.send({
        type: 'broadcast',
        event: 'voto_revancha',
        payload: { aceptado: false, respondiente: miNombreJugador }
      });
    }
  });
}

function recibirVotoRevancha(payload) {
  if (!partidaActual) return;
  const totalJugadores = partidaActual.jugadores.length;

  if (payload.aceptado) {
    votosRevancha.add(payload.respondiente);

    if (votosRevancha.size === totalJugadores) {
      Swal.fire({
        title: '¡Todos Aceptaron!',
        text: 'Iniciando la revancha...',
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
      });

      if (partidaActual.jugadores[0]?.nombre === miNombreJugador) {
        ejecutarReinicioRevancha();
      }
    } else if (votosRevancha.has(miNombreJugador)) {
      Swal.fire({
        title: 'Esperando respuestas...',
        text: `Votos confirmados: ${votosRevancha.size} de ${totalJugadores}`,
        icon: 'info',
        showConfirmButton: false,
        allowOutsideClick: false
      });
    }
  } else {
    // Si alguien rechaza (sea de 2 a 6 jugadores), expulsa a todos al menú principal
    votosRevancha.clear();

    Swal.fire({
      title: 'Revancha Cancelada 🚫',
      html: `<b>${payload.respondiente}</b> no aceptó la revancha. Regresando al menú principal...`,
      icon: 'warning',
      confirmButtonText: 'Entendido',
      allowOutsideClick: false
    }).then(async () => {
      await abandonarPartidaActual();
      mostrarPantalla('pantallaInicio');
    });
  }
}
async function ejecutarReinicioRevancha() {
  if (!partidaActual) return;

  const dim = partidaActual.dimension;
  const tableroVacio = Array(dim * dim).fill('');
  const siguienteTurno = (partidaActual.turno_index + 1) % partidaActual.jugadores.length;

  const { error } = await supabaseClient
    .from('partidas')
    .update({
      tablero: tableroVacio,
      estado: 'jugando',
      ganador: null,
      turno_index: siguienteTurno
    })
    .eq('id', partidaActual.id);

  if (error) {
    console.error("Error al reiniciar la partida para la revancha:", error);
  }
}

// ==========================================
// 7. TEMPORIZADOR SEGURO Y AUDIO BEEP
// ==========================================

function reproducirBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const audioCtx = new AudioCtx();

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  } catch (err) {
    console.warn("Sonido de beep omitido por restricciones del navegador:", err);
  }
}

function detenerTemporizador() {
  if (intervaloTemporizador) {
    clearInterval(intervaloTemporizador);
    intervaloTemporizador = null;
  }
}

function iniciarTemporizadorTurno() {
  detenerTemporizador();

  const contenedor = document.getElementById('contenedorTemporizador');
  if (contenedor) contenedor.style.display = 'block';

  let tiempoRestante = TIEMPO_MAXIMO_TURNO;
  const lblTimer = document.getElementById('lblTimerValue');
  const barra = document.getElementById('barraTemporizador');

  if (lblTimer) lblTimer.textContent = tiempoRestante;
  if (barra) barra.style.width = '100%';

  intervaloTemporizador = setInterval(async () => {
    tiempoRestante--;

    if (lblTimer) lblTimer.textContent = tiempoRestante;
    if (barra) {
      const porcentaje = (tiempoRestante / TIEMPO_MAXIMO_TURNO) * 100;
      barra.style.width = `${porcentaje}%`;
    }

    if (tiempoRestante <= 3 && tiempoRestante > 0) {
      reproducirBeep();
    }

    if (tiempoRestante <= 0) {
      detenerTemporizador();

      if (esMiTurnoActual()) {
        await pasarTurnoPorTiempo();
      }
    }
  }, 1000);
}

function esMiTurnoActual() {
  if (!partidaActual || !partidaActual.jugadores) return false;
  const jugadorActual = partidaActual.jugadores[partidaActual.turno_index];
  return jugadorActual && jugadorActual.nombre === miNombreJugador;
}

async function pasarTurnoPorTiempo() {
  if (!partidaActual) return;

  const totalJugadores = partidaActual.jugadores.length;
  const siguienteIndex = (partidaActual.turno_index + 1) % totalJugadores;

  await supabaseClient
    .from('partidas')
    .update({ turno_index: siguienteIndex })
    .eq('id', partidaActual.id)
    .eq('turno_index', partidaActual.turno_index);
}

// ==========================================
// 8. FIN DE JUEGO Y CHAT EN VIVO
// ==========================================

function mostrarFinDeJuego(ganador) {
  if (ganador === 'Empate') {
    Swal.fire('¡Empate!', 'Nadie ha logrado hacer raya.', 'info');
  } else if (ganador === miNombreJugador) {
    Swal.fire('¡Victoria!', '🎉 ¡Has ganado la partida!', 'success');
  } else {
    Swal.fire('Fin del juego', `El ganador fue <b>${ganador}</b>.`, 'warning');
  }
}

function conectarChatYEventos(codigoSala) {
  if (canalChat) supabaseClient.removeChannel(canalChat);

  canalChat = supabaseClient.channel('chat_' + codigoSala, { config: { broadcast: { self: true } } });

  canalChat
    .on('broadcast', { event: 'mensaje' }, ({ payload }) => {
      agregarMensajeChat(payload.nombre, payload.texto);
    })
    .on('broadcast', { event: 'solicitud_revancha' }, ({ payload }) => {
      recibirSolicitudRevancha(payload.solicitante);
    })
    .on('broadcast', { event: 'voto_revancha' }, ({ payload }) => {
      recibirVotoRevancha(payload);
    })
    .subscribe();
}

function enviarMensajeChat(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const texto = input.value.trim();

  if (texto && canalChat) {
    canalChat.send({
      type: 'broadcast',
      event: 'mensaje',
      payload: { nombre: miNombreJugador, texto: texto }
    });
    input.value = '';
  }
}

function agregarMensajeChat(nombre, texto) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;

  const esPropio = nombre === miNombreJugador;
  const div = document.createElement('div');
  div.className = `mensaje-chat ${esPropio ? 'mensaje-propio' : 'mensaje-ajeno'}`;

  div.innerHTML = `
    <div class="burbuja ${esPropio ? 'burbuja-propia' : 'burbuja-ajena'}">
      <small style="font-size:0.75rem; opacity:0.8; display:block;">${nombre}</small>
      ${texto}
    </div>
  `;

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ==========================================
// 9. RANKING Y CANCELACIÓN/ABANDONO DE SALA
// ==========================================

async function registrarResultadoEstadisticas(nombreJugador, resultado) {
  try {
    const { data } = await supabaseClient.from('jugadores_stats').select('*').eq('nombre', nombreJugador).single();

    if (data) {
      const ganadas = resultado === 'ganada' ? (data.ganadas || 0) + 1 : (data.ganadas || 0);
      const empatadas = resultado === 'empate' ? (data.empatadas || 0) + 1 : (data.empatadas || 0);
      const perdidas = resultado === 'perdida' ? (data.perdidas || 0) + 1 : (data.perdidas || 0);

      await supabaseClient.from('jugadores_stats').update({ ganadas, empatadas, perdidas }).eq('nombre', nombreJugador);
    } else {
      await supabaseClient.from('jugadores_stats').insert([{
        nombre: nombreJugador,
        ganadas: resultado === 'ganada' ? 1 : 0,
        empatadas: resultado === 'empate' ? 1 : 0,
        perdidas: resultado === 'perdida' ? 1 : 0
      }]);
    }
  } catch (e) {
    console.error("Error al guardar estadísticas:", e);
  }
}

async function cargarRanking() {
  const tbody = document.getElementById('tbodyRanking');
  tbody.innerHTML = '<tr><td colspan="5">Cargando ranking...</td></tr>';

  const { data, error } = await supabaseClient
    .from('jugadores_stats')
    .select('*')
    .order('ganadas', { ascending: false })
    .limit(10);

  if (error) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-danger">Error al cargar ranking</td></tr>';
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No hay partidas registradas aún.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  data.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${index + 1}</b></td>
      <td>${item.nombre}</td>
      <td class="text-success fw-bold">${item.ganadas || 0}</td>
      <td class="text-warning fw-bold">${item.empatadas || 0}</td>
      <td class="text-danger">${item.perdidas || 0}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function reiniciarRankingAdmin() {
  const confirmacion = await Swal.fire({
    title: '¿Reiniciar Ranking?',
    text: "Esta acción borrará todas las estadísticas guardadas.",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    confirmButtonText: 'Sí, reiniciar',
    cancelButtonText: 'Cancelar'
  });

  if (confirmacion.isConfirmed) {
    const { error } = await supabaseClient.rpc('reiniciar_ranking_admin');
    if (error) {
      Swal.fire('Error', 'No se pudo reiniciar el ranking.', 'error');
    } else {
      Swal.fire('Reiniciado', 'El ranking se ha vaciado con éxito.', 'success');
      cargarRanking();
    }
  }
}

// Función ejecutada cuando un jugador decide abandonar
async function abandonarPartidaActual() {
  detenerTemporizador();

  if (partidaActual) {
    // Si la partida está en lobby o en curso, se cancela la sala por completo para todos
    if (partidaActual.estado === 'esperando' || partidaActual.estado === 'jugando') {
      await supabaseClient
        .from('partidas')
        .update({ 
          estado: 'cancelado', 
          ganador: miNombreJugador // Guardamos quién la canceló para informar a los demás
        })
        .eq('id', partidaActual.id);
    }
  }

  limpiarEstadoLocal();
}

// Limpia suscripciones y variables locales del navegador
function limpiarEstadoLocal() {
  detenerTemporizador();
  if (canalRealtime) {
    supabaseClient.removeChannel(canalRealtime);
    canalRealtime = null;
  }
  if (canalChat) {
    supabaseClient.removeChannel(canalChat);
    canalChat = null;
  }
  partidaActual = null;
}

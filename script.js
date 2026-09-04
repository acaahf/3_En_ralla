// --- CONFIGURACIÓN DE SUPABASE CON TUS CREDENCIALES ---
const SUPABASE_URL = 'https://mcyfzeksrkgwyulsinqx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rRnMThz7-T684QBNVphi_w_VvtrFPXb';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- SÍMBOLOS DISPONIBLES PARA JUGADORES ---
const SIMBOLOS = ['X', 'O', 'Δ', '□', '☆', '◇'];

// --- VARIABLES DE ESTADO ---
let partidaActual = null;
let miSimbolo = null;
let miNombre = "";
let canalRealtime = null;
let notificacionMostrada = false;

// --- GESTIÓN DE NAVEGACIÓN Y EVENTOS ---
document.getElementById("btnNavCrear").addEventListener("click", () => mostrarSeccion("crear"));
document.getElementById("btnNavUnirse").addEventListener("click", () => mostrarSeccion("unirse"));
document.getElementById("btnNavRanking").addEventListener("click", () => {
  mostrarSeccion("ranking");
  cargarRanking();
});
document.getElementById("btnBorrarRanking").addEventListener("click", borrarRankingGlobal);
document.getElementById("btnReiniciarJuego").addEventListener("click", reiniciarPartida);
document.getElementById("btnSalirSala").addEventListener("click", async () => {
  if (!partidaActual) return;
  
  const confirmacion = await Swal.fire({
    title: '¿Salir de la sala?',
    text: partidaActual.id === miNombre 
      ? 'Si sales siendo el creador, la sala se cerrará para todos.' 
      : 'Saldrás de la partida actual.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, salir',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#e74c3c'
  });

  if (confirmacion.isConfirmed) {
    salirDeSala();
  }
});

function mostrarSeccion(seccion) {
  document.getElementById("seccionCrear").classList.add("hidden");
  document.getElementById("seccionUnirse").classList.add("hidden");
  document.getElementById("seccionJuego").classList.add("hidden");
  document.getElementById("seccionRanking").classList.add("hidden");

  if (seccion === "crear") document.getElementById("seccionCrear").classList.remove("hidden");
  if (seccion === "unirse") document.getElementById("seccionUnirse").classList.remove("hidden");
  if (seccion === "juego") document.getElementById("seccionJuego").classList.remove("hidden");
  if (seccion === "ranking") document.getElementById("seccionRanking").classList.remove("hidden");
}

// --- CREAR SALA ---
document.getElementById("formCrear").addEventListener("submit", async (e) => {
  e.preventDefault();
  const creador = document.getElementById("nombreCreador").value.trim();
  const maxJugadores = parseInt(document.getElementById("selectJugadores").value);

  if (!creador) return;

  miNombre = creador;
  miSimbolo = SIMBOLOS[0];

  let dimension = 3;
  let enRaya = 3;

  if (maxJugadores === 4) {
    dimension = 7;
    enRaya = 4;
  } else if (maxJugadores === 6) {
    dimension = 10;
    enRaya = 5;
  }

  const tableroInicial = Array(dimension * dimension).fill("");

  const nuevaPartida = {
    id: creador,
    max_jugadores: maxJugadores,
    dimension: dimension,
    en_raya_para_ganar: enRaya,
    tablero: tableroInicial,
    turno_index: 0,
    estado: 'esperando',
    ganador: null,
    jugadores: [{ nombre: creador, simbolo: miSimbolo }]
  };

  const { data, error } = await supabaseClient
    .from('partidas')
    .upsert([nuevaPartida])
    .select()
    .single();

  if (error) {
    Swal.fire('Error', 'No se pudo crear la sala. Intenta con otro nombre.', 'error');
    return;
  }

  partidaActual = data;
  iniciarPantallaJuego();
});

// --- UNIRSE A SALA ---
document.getElementById("formUnirse").addEventListener("submit", async (e) => {
  e.preventDefault();
  const jugador = document.getElementById("nombreJugador").value.trim();
  const salaId = document.getElementById("salaIdInput").value.trim();

  if (!jugador || !salaId) return;

  miNombre = jugador;

  const { data: partida, error } = await supabaseClient
    .from('partidas')
    .select('*')
    .eq('id', salaId)
    .single();

  if (error || !partida) {
    Swal.fire('Error', 'La sala no existe o ha caducado.', 'error');
    return;
  }

  const existe = partida.jugadores.find(j => j.nombre === miNombre);

  if (!existe) {
    if (partida.jugadores.length >= partida.max_jugadores) {
      Swal.fire('Sala Llena', 'La partida ya alcanzó el número máximo de jugadores.', 'warning');
      return;
    }

    miSimbolo = SIMBOLOS[partida.jugadores.length];
    partida.jugadores.push({ nombre: miNombre, simbolo: miSimbolo });

    if (partida.jugadores.length === partida.max_jugadores) {
      partida.estado = 'jugando';
    }

    const { data: partidaActualizada, error: errUpdate } = await supabaseClient
      .from('partidas')
      .update({ jugadores: partida.jugadores, estado: partida.estado })
      .eq('id', salaId)
      .select()
      .single();

    if (errUpdate) {
      Swal.fire('Error', 'No se pudo ingresar a la sala.', 'error');
      return;
    }

    partidaActual = partidaActualizada;
  } else {
    miSimbolo = existe.simbolo;
    partidaActual = partida;
  }

  iniciarPantallaJuego();
});

// --- SUSCRIPCIÓN EN TIEMPO REAL ---
function iniciarPantallaJuego() {
  notificacionMostrada = false;
  mostrarSeccion("juego");
  document.getElementById("lblSalaId").innerText = partidaActual.id;
  renderizarEstado();

  if (canalRealtime) {
    supabaseClient.removeChannel(canalRealtime);
  }

  canalRealtime = supabaseClient
    .channel(`sala-${partidaActual.id}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'partidas',
      filter: `id=eq.${partidaActual.id}`
    }, (payload) => {
      const jugadoresAntes = partidaActual ? (partidaActual.jugadores || []) : [];
      partidaActual = payload.new;
      
      if (partidaActual.estado === 'jugando') {
        notificacionMostrada = false;
      }

      const sigoEnSala = partidaActual.jugadores.some(j => j.nombre === miNombre);

      if (!sigoEnSala) {
        const fuiExpulsadoPorCreador = jugadoresAntes.some(j => j.nombre === miNombre) && partidaActual.id !== miNombre;

        if (fuiExpulsadoPorCreador && canalRealtime) {
          Swal.fire('Expulsado', 'Has sido expulsado de la sala por el creador.', 'warning');
        }

        if (canalRealtime) {
          supabaseClient.removeChannel(canalRealtime);
          canalRealtime = null;
        }

        partidaActual = null;
        mostrarSeccion("unirse");
        return;
      }

      renderizarEstado();
    })
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'partidas',
      filter: `id=eq.${partidaActual.id}`
    }, () => {
      if (partidaActual && partidaActual.id !== miNombre) {
        Swal.fire({
          icon: 'warning',
          title: 'Sala cerrada',
          text: 'El creador ha abandonado la partida y la sala se ha cerrado.',
          confirmColor: '#2c3e50'
        });
      }
      partidaActual = null;
      mostrarSeccion("unirse");
    })
    .subscribe();
}

// --- RENDERIZAR PANTALLA Y TABLERO DE JUEGO ---
function renderizarEstado() {
  if (!partidaActual) return;

  const lblInfo = document.getElementById("lblInfoTurno");
  const contenedorTablero = document.getElementById("tablero");
  const listaUI = document.getElementById("listaJugadores");
  const btnReiniciar = document.getElementById("btnReiniciarJuego");

  const soyElCreador = partidaActual.id === miNombre;

  if (partidaActual.estado === 'finalizado') {
    btnReiniciar.classList.remove("hidden");
  } else {
    btnReiniciar.classList.add("hidden");
  }

  listaUI.innerHTML = "";
  partidaActual.jugadores.forEach(j => {
    const li = document.createElement("li");
    li.innerText = `${j.nombre} (${j.simbolo})`;
    
    if (j.nombre === miNombre) {
      li.style.border = "2px solid #3498db";
      li.style.fontWeight = "bold";
    }

    if (soyElCreador && j.nombre !== miNombre) {
      const btnExpulsar = document.createElement("button");
      btnExpulsar.innerHTML = "✕";
      btnExpulsar.className = "btn-expulsar";
      btnExpulsar.title = `Expulsar a ${j.nombre}`;
      btnExpulsar.style.marginLeft = "10px";
      btnExpulsar.style.color = "red";
      btnExpulsar.style.cursor = "pointer";
      btnExpulsar.addEventListener("click", () => expulsarJugador(j.nombre));
      li.appendChild(btnExpulsar);
    }

    listaUI.appendChild(li);
  });

  const jugadorEnTurno = partidaActual.jugadores[partidaActual.turno_index];

  if (partidaActual.estado === 'esperando') {
    lblInfo.innerText = `Esperando jugadores (${partidaActual.jugadores.length}/${partidaActual.max_jugadores}). Eres "${miNombre}" (${miSimbolo})`;
  } else if (partidaActual.estado === 'jugando') {
    lblInfo.innerText = jugadorEnTurno.simbolo === miSimbolo 
      ? `¡Es TU turno, ${miNombre}! (${miSimbolo})` 
      : `Turno de ${jugadorEnTurno.nombre} (${jugadorEnTurno.simbolo})`;
  } else if (partidaActual.estado === 'finalizado') {
    lblInfo.innerText = partidaActual.ganador === 'Empate' 
      ? "¡Partida Finalizada en EMPATE!" 
      : `¡Felicidades! ${partidaActual.ganador} ha ganado la partida 🎉`;

    if (!notificacionMostrada) {
      notificacionMostrada = true;

      if (partidaActual.ganador === 'Empate') {
        Swal.fire({ icon: 'info', title: '¡Empate!', text: 'No quedan más movimientos disponibles.' });
      } else if (partidaActual.ganador === miNombre) {
        Swal.fire({ icon: 'success', title: '¡Felicidades! 🎉', text: '¡Has ganado la partida!' });
      } else {
        Swal.fire({ icon: 'error', title: '¡Has perdido! ❌', text: `${partidaActual.ganador} ha completado la alineación primero.` });
      }
    }
  }

  contenedorTablero.style.gridTemplateColumns = `repeat(${partidaActual.dimension}, 42px)`;
  contenedorTablero.innerHTML = "";

  partidaActual.tablero.forEach((casilla, index) => {
    const btn = document.createElement("button");
    btn.innerText = casilla;
    btn.disabled = partidaActual.estado !== 'jugando' || casilla !== "";
    btn.addEventListener("click", () => efectuarMovimiento(index));
    contenedorTablero.appendChild(btn);
  });
}

// --- FUNCIÓN REINICIAR PARTIDA ---
async function reiniciarPartida() {
  const tableroLimpio = Array(partidaActual.dimension * partidaActual.dimension).fill("");
  const nuevoEstado = partidaActual.jugadores.length === partidaActual.max_jugadores ? 'jugando' : 'esperando';

  const { error } = await supabaseClient
    .from('partidas')
    .update({
      tablero: tableroLimpio,
      turno_index: 0,
      estado: nuevoEstado,
      ganador: null
    })
    .eq('id', partidaActual.id);

  if (error) {
    Swal.fire('Error', 'No se pudo reiniciar la partida.', 'error');
  }
}

// --- SALIR DE LA SALA (VOLUNTARIAMENTE SIN NOTIFICACIÓN) ---
async function salirDeSala() {
  if (!partidaActual) return;

  const soyElCreador = partidaActual.id === miNombre;
  const idSala = partidaActual.id;

  if (canalRealtime) {
    supabaseClient.removeChannel(canalRealtime);
    canalRealtime = null;
  }

  partidaActual = null;

  if (soyElCreador) {
    await supabaseClient
      .from('partidas')
      .delete()
      .eq('id', idSala);
  } else {
    const { data: salaServidor } = await supabaseClient
      .from('partidas')
      .select('*')
      .eq('id', idSala)
      .single();

    if (salaServidor) {
      const nuevosJugadores = salaServidor.jugadores.filter(j => j.nombre !== miNombre);
      const listaReasignada = nuevosJugadores.map((j, idx) => ({
        ...j,
        simbolo: SIMBOLOS[idx]
      }));

      await supabaseClient
        .from('partidas')
        .update({
          jugadores: listaReasignada,
          estado: 'esperando'
        })
        .eq('id', idSala);
    }
  }

  mostrarSeccion("unirse");
}

// --- EXPULSAR JUGADOR (SÓLO CREADOR) ---
async function expulsarJugador(nombreAExpulsar) {
  const confirmacion = await Swal.fire({
    title: '¿Expulsar jugador?',
    text: `¿Estás seguro de que quieres expulsar a "${nombreAExpulsar}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, expulsar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#e74c3c'
  });

  if (!confirmacion.isConfirmed) return;

  const nuevaLista = partidaActual.jugadores.filter(j => j.nombre !== nombreAExpulsar);
  
  const listaReasignada = nuevaLista.map((j, idx) => ({
    ...j,
    simbolo: SIMBOLOS[idx]
  }));

  let nuevoEstado = partidaActual.estado;
  if (listaReasignada.length < partidaActual.max_jugadores && nuevoEstado === 'jugando') {
    nuevoEstado = 'esperando';
  }

  const nuevoTurno = partidaActual.turno_index >= listaReasignada.length ? 0 : partidaActual.turno_index;

  const { error } = await supabaseClient
    .from('partidas')
    .update({
      jugadores: listaReasignada,
      estado: nuevoEstado,
      turno_index: nuevoTurno
    })
    .eq('id', partidaActual.id);

  if (error) {
    Swal.fire('Error', 'No se pudo expulsar al jugador.', 'error');
  } else {
    Swal.fire('Jugador Expulsado', `${nombreAExpulsar} ha sido eliminado de la sala.`, 'success');
  }
}

// --- EJECUTAR MOVIMIENTO ---
async function efectuarMovimiento(index) {
  if (partidaActual.estado !== 'jugando') return;

  const jugadorEnTurno = partidaActual.jugadores[partidaActual.turno_index];
  if (jugadorEnTurno.simbolo !== miSimbolo) {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'warning',
      title: 'Aún no es tu turno',
      showConfirmButton: false,
      timer: 2000
    });
    return;
  }

  if (partidaActual.tablero[index] !== "") return;

  const nuevoTablero = [...partidaActual.tablero];
  nuevoTablero[index] = miSimbolo;

  const haGanado = verificarVictoria(nuevoTablero, index, partidaActual.dimension, partidaActual.en_raya_para_ganar, miSimbolo);
  const hayEmpate = !nuevoTablero.includes("") && !haGanado;

  let nuevoEstado = 'jugando';
  let ganadorFinal = null;

  if (haGanado || hayEmpate) {
    nuevoEstado = 'finalizado';
    ganadorFinal = haGanado ? miNombre : 'Empate';
    await actualizarEstadisticasFinales(partidaActual.jugadores, ganadorFinal);
  }

  const siguienteTurnoIndex = (partidaActual.turno_index + 1) % partidaActual.jugadores.length;

  await supabaseClient
    .from('partidas')
    .update({
      tablero: nuevoTablero,
      turno_index: siguienteTurnoIndex,
      estado: nuevoEstado,
      ganador: ganadorFinal
    })
    .eq('id', partidaActual.id);
}

// --- ALGORITMO COMPLETO DE ALINEACIÓN ---
function verificarVictoria(tablero, index, n, enRaya, simbolo) {
  const fila = Math.floor(index / n);
  const col = index % n;

  const direcciones = [
    [0, 1],  // Horizontal
    [1, 0],  // Vertical
    [1, 1],  // Diagonal \
    [1, -1]  // Diagonal /
  ];

  for (let [df, dc] of direcciones) {
    let contador = 1;

    let r = fila + df;
    let c = col + dc;
    while (r >= 0 && r < n && c >= 0 && c < n && tablero[r * n + c] === simbolo) {
      contador++;
      r += df;
      c += dc;
    }

    r = fila - df;
    c = col - dc;
    while (r >= 0 && r < n && c >= 0 && c < n && tablero[r * n + c] === simbolo) {
      contador++;
      r -= df;
      c -= dc;
    }

    if (contador >= enRaya) return true;
  }

  return false;
}

// --- ACTUALIZAR ESTADÍSTICAS EN LA TABLA DE JUGADORES ---
async function actualizarEstadisticasFinales(jugadores, ganador) {
  for (let j of jugadores) {
    const { data: usuario } = await supabaseClient
      .from('jugadores_stats')
      .select('*')
      .eq('nombre', j.nombre)
      .maybeSingle();

    let ganadas = usuario ? usuario.ganadas : 0;
    let perdidas = usuario ? usuario.perdidas : 0;
    let empatadas = usuario ? usuario.empatadas : 0;

    if (ganador === 'Empate') {
      empatadas++;
    } else if (ganador === j.nombre) {
      ganadas++;
    } else {
      perdidas++;
    }

    await supabaseClient
      .from('jugadores_stats')
      .upsert({
        nombre: j.nombre,
        ganadas: ganadas,
        perdidas: perdidas,
        empatadas: empatadas
      });
  }
}

// --- CARGAR Y BORRAR TABLA DE RANKING ---
async function cargarRanking() {
  const body = document.getElementById("bodyRanking");
  body.innerHTML = '<tr><td colspan="5" style="text-align:center;">Cargando clasificaciones...</td></tr>';

  const { data: ranking, error } = await supabaseClient
    .from('jugadores_stats')
    .select('*')
    .order('ganadas', { ascending: false });

  if (error || !ranking || ranking.length === 0) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;">No hay datos registrados aún.</td></tr>';
    return;
  }

  body.innerHTML = "";
  ranking.forEach((j, index) => {
    let posicion = `#${index + 1}`;
    if (index === 0) posicion = "🥇 1º";
    else if (index === 1) posicion = "🥈 2º";
    else if (index === 2) posicion = "🥉 3º";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${posicion}</strong></td>
      <td>${j.nombre}</td>
      <td style="color: #27ae60; font-weight: bold;">${j.ganadas}</td>
      <td style="color: #e74c3c;">${j.perdidas}</td>
      <td style="color: #f39c12;">${j.empatadas}</td>
    `;
    body.appendChild(tr);
  });
}

async function borrarRankingGlobal() {
  const confirmacion = await Swal.fire({
    title: '¿Borrar Ranking Global?',
    text: 'Esta acción reiniciará las puntuaciones de todos los jugadores a cero.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, borrar todo',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#e74c3c'
  });

  if (!confirmacion.isConfirmed) return;

  const { error } = await supabaseClient
    .from('jugadores_stats')
    .delete()
    .neq('nombre', '');

  if (error) {
    Swal.fire('Error', 'No se pudo eliminar la tabla de ranking.', 'error');
  } else {
    Swal.fire('Éxito', 'El ranking global ha sido reiniciado.', 'success');
    cargarRanking();
  }
}

// --- EXPULSAR SI EL CREADOR CIERRA LA PESTAÑA O NAVEGADOR ---
window.addEventListener('beforeunload', () => {
  if (partidaActual && partidaActual.id === miNombre) {
    supabaseClient.from('partidas').delete().eq('id', partidaActual.id);
  }
});

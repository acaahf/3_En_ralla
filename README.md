# 3_en_ralla
https://acaahf.github.io/3_en_ralla/

🎮 Tres en Raya Multijugador (2 a 6 Jugadores)
Aplicación web interactiva de Tres en Raya (N-en-raya) Multijugador en tiempo real desarrollada con JavaScript vanilla y Supabase. Permite partidas dinámicas desde 2 hasta 6 jugadores con cálculo automático del tamaño del tablero, temporizador por turno, chat en vivo, ranking global persistente y cancelación automática por abandono o rechazo de revancha.

🚀 Características Principales
Soporte Multijugador Escalable (2-6 Jugadores): Salón de espera (lobby) en tiempo real con asignación automática de símbolos (X, O, Δ, □, ☆, ◇).

Tablero y Condición de Victoria Dinámicos:

2 Jugadores: Tablero de $3 \times 3$ con condición de 3 en raya.

3 a 6 Jugadores: Tablero dinámico de $(N + 1) \times (N + 1)$ con condición de 4 en raya.

Mecanismo Anti-Abandono Strict Cancel: Si cualquier jugador sale de la sala durante el lobby o la partida, esta cambia inmediatamente a estado cancelado y redirige a todos los participantes al menú principal.

Sistema de Revancha Interactivo: Votación grupal en tiempo real. Si un solo jugador rechaza la propuesta, la partida finaliza y se redirige a todos automáticamente al menú principal.

Sincronización en Tiempo Real: Actualización de estados del tablero mediante suscripciones PostgreSQL (postgres_changes) y mensajería instantánea (broadcast) a través de Supabase Realtime.

Temporizador por Turno (15s): Barra de progreso interactiva con efecto de sonido de alerta mediante Web Audio API para los últimos 3 segundos. Si el tiempo expira, el turno rota automáticamente.

Ranking Global Persistente: Tabla de posiciones con seguimiento de victorias, empates y derrotas.

Chat en Vivo: Comunicación por texto integrada en la sala de juego.

Soporte para Claves Modernas de Supabase: Implementación de un interceptor fetch personalizado para soportar la autenticación nativa con las nuevas claves Publishable (sb_publishable_...).

🛠️ Tecnologías Utilizadas

Frontend: HTML5, CSS3, JavaScript Vanilla (ES6+).

Diseño y UI: Bootstrap 5, SweetAlert2.

Backend y Base de Datos: Supabase (PostgreSQL, Realtime Channels, PostgREST API, RLS Policies, RPCs).



🎮 Flujo de Juego y Reglas

Creación de Sala: El anfitrión ingresa su nombre y selecciona el límite de jugadores (2 a 6). Se genera un código alfanumérico único de 6 caracteres.

Unirse a la Sala: Los demás jugadores ingresan el código de sala y su nombre.

Inicio de Partida: Cuando la sala se llena (o hay al menos 2 jugadores), el anfitrión inicia la partida.

Desarrollo del Juego:

Cada jugador realiza un movimiento en su turno dentro del límite de 15 segundos.

La validación de victorias en diagonal, horizontal y vertical se procesa de forma atómica en el servidor.

Abandono o Cancelación:

Si un jugador presiona "Abandonar Partida" o sale de la ventana, la sala se marca como cancelado.

Todos los demás jugadores reciben una notificación SweetAlert2 con el nombre del usuario que abandonó y son devueltos a la pantalla de inicio.

Fin de Partida y Revancha:

Al finalizar la partida, las estadísticas individuales se actualizan en jugadores_stats.

Los jugadores pueden proponer una revancha. Si todos aceptan, el tablero se limpia y los turnos se rotan. Si al menos uno rechaza, todos los participantes salen de la sala automáticamente al menú principal.

Mejoras de Experiencia de Usuario (UI/UX)

Animación de Confeti al Ganar: Integrar la librería ligera canvas-confetti vía CDN para disparar confeti en la pantalla únicamente al jugador ganador.

Control de Audio (Botón de Mute): Agregar un interruptor de sonido en la interfaz para permitir a los jugadores silenciar el beep del temporizador si lo prefieren.

Resaltado de Línea Ganadora: Pintar de un color especial (por ejemplo, verde brillante o dorado) las casillas exactas que formaron las 3 o 4 fichas en raya.

Funcionalidades de Juego Avanzadas

Detección Automática de Desconexión (Supabase Presence): Usar channel.track() de Supabase para detectar cuando un jugador pierde conexión a internet o cierra la pestaña sin presionar "Abandonar", ejecutando la cancelación automática de la sala en tiempo real.

Historial de Movimientos (Replay): Guardar en la columna tablero un arreglo con la secuencia de coordenadas de cada jugada, permitiendo ver una animación o "reproducción" paso a paso al terminar la partida.

Modo Espectador: Si una sala ya está llena y la partida está en curso, permitir que nuevos usuarios ingresen únicamente a mirar el tablero y usar el chat en vivo sin poder hacer movimientos.


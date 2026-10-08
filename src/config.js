// --- Config ---
// Constantes globales del proyecto.

import * as THREE from 'three';

// --- Escena / MindAR ---
export const MARKERS_MIND_PATH = '/marcadores.mind';

// --- Ciclo de vida del modelo (invocación → desacople → centrado) ---
export const DECOUPLE_DELAY_MS = 2500;
export const CENTER_DELAY_MS = 1250;
export const CENTER_ANIMATION_MS = 1000;
export const CENTER_POSITION = new THREE.Vector3(0, 437.5, -2500);
export const CENTER_ROTATION = new THREE.Euler(0, 0, 0);

// Salida de la pieza al re-escanear (escala + fade de su sombra).
export const EXIT_DURATION_MS = 250;

// --- Luz de vitrina: la pieza "entra en la luz" al materializarse ---
// Intensidad base de la luz KEY (la dominante, ver sceneSetup.js). Al
// materializar, su intensidad sube desde KEY_LIGHT_RAMP_FROM × base hasta
// la base en KEY_LIGHT_RAMP_MS.
export const KEY_LIGHT_INTENSITY = 3.75;
export const KEY_LIGHT_RAMP_FROM = 0.5;
export const KEY_LIGHT_RAMP_MS = 500;

// La sombra de contacto aparece DESPUÉS de la materialización: la pieza
// primero toma forma y luego se apoya.
export const SHADOW_FADE_DELAY_MS = 250;
export const SHADOW_FADE_MS = 500;

// --- Caché de plantillas GLB ---
export const MODEL_CACHE_MAX_SIZE = 5;

// --- MediaPipe HandLandmarker (self-hosted) ---
// WASM y modelo se sirven desde /public/mediapipe (mismo origen): sin CDNs
// externos que fallen o se bloqueen en la red del museo.
// Al actualizar @mediapipe/tasks-vision hay que RECOPIAR el fileset desde
// node_modules: MediaPipe exige pares JS/WASM de la misma versión.
export const MEDIAPIPE_WASM_URL = '/mediapipe/wasm';
export const HAND_LANDMARKER_MODEL_URL = '/mediapipe/hand_landmarker.task';

// Techo de espera de la carga del HandLandmarker (~18 MB): si la red cuelga,
// el arranque termina en "warn" (sin gestos) en vez de cargar para siempre.
export const HANDS_INIT_TIMEOUT_MS = 45000;

export const HAND_LANDMARK_OPACITY = 0;

// Topología de los 21 puntos de MediaPipe Hands (para dibujar el esqueleto).
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // pulgar
  [0, 5], [5, 6], [6, 7], [7, 8],           // índice
  [5, 9], [9, 10], [10, 11], [11, 12],      // medio
  [9, 13], [13, 14], [14, 15], [15, 16],    // anular
  [13, 17], [17, 18], [18, 19], [19, 20],   // meñique
  [0, 17]                                   // palma
];

// Cada cuántos frames se corre la detección pesada de MediaPipe; la fluidez
// intermedia la da el suavizado de gestureControl.js.
export const HAND_DETECTION_FRAME_INTERVAL = 4;

// Una pose cruda solo se confirma tras repetirse esta cantidad de muestras
// seguidas (evita gestos disparados por una lectura ruidosa aislada).
export const POSE_DEBOUNCE_FRAMES = 2;

// --- Control por gestos: sensibilidad y límites ---
export const SCALE_MULTIPLIER_MIN = 0.5;
export const SCALE_MULTIPLIER_MAX = 2.5;
export const SCALE_SENSITIVITY = 10;

export const ROTATION_MAX_RAD = Math.PI * 2;
export const ROTATION_SENSITIVITY = 15;

export const MOVE_SENSITIVITY = 2500;

// Límite del gesto move (unidades del espacio de CÁMARA, mismas que
// CENTER_POSITION): la pieza puede salir del viewport, pero nunca tan lejos
// que el visitante la pierda sin retorno.
export const MOVE_LIMIT_X = 2000;
export const MOVE_LIMIT_Y = 1500;

// Constante de tiempo τ del suavizado exponencial de velocidad (segundos).
export const GESTURE_TIME_CONSTANT_S = 0.125;

// Si no llega una muestra de mano nueva en más de esto, se apaga la
// velocidad en vez de seguir integrando un valor viejo.
export const GESTURE_VELOCITY_MAX_AGE_S = 0.375;

// --- Inercia al soltar un gesto ---
// Al soltar (o perder la mano) durante rotateX / rotateY / move, la pieza
// sigue un instante y se frena sola: la velocidad suavizada decae con
// τ = INERTIA_TIME_CONSTANT_S. 'scale' no tiene inercia (el número se lee).
// Velocidades en unidades normalizadas de imagen por segundo.
export const INERTIA_GESTURES = ['rotateX', 'rotateY', 'move'];
export const INERTIA_TIME_CONSTANT_S = 0.25;
export const INERTIA_VELOCITY_GAIN = 0.5;   // fracción de la velocidad que se conserva
export const INERTIA_MIN_SPEED = 0.05;      // por debajo, soltar = quedarse quieto
export const INERTIA_STOP_SPEED = 0.0125;     // por debajo, la inercia se da por terminada
export const INERTIA_MAX_FRAME_GAP_S = 0.25; // un hueco mayor (ficha, pose) cancela la inercia

// --- Calibración por usuario (umbrales por defecto, ver handTracking.js) ---
export const DEFAULT_FINGER_EXTENSION_MARGIN = 0.15;
export const DEFAULT_THUMB_ENTER_THRESHOLD = 0.675;
export const DEFAULT_THUMB_EXIT_THRESHOLD = 0.575;

export const CALIBRATION_COUNTDOWN_MS = 3750; // tiempo para acomodar la mano
export const CALIBRATION_SAMPLE_MS = 5000;    // tiempo de captura real
export const CALIBRATION_DONE_MESSAGE_MS = 2500;

// Opacidad del esqueleto de mano solo durante la calibración (más presencia
// que en interacción, ver HAND_LANDMARK_OPACITY).
export const CALIBRATION_LANDMARK_OPACITY = 0.75;

// Si pasan estos ms sin detección en el escaneo, se muestra el chip de ayuda.
export const SCAN_HELP_DELAY_MS = 10000;

// Tiempo sin interacción tras el cual la UI se atenúa.
export const UI_IDLE_DIM_MS = 5000;

// --- Constantes de UI ---
// Todas las duraciones y distancias de la interfaz viven acá: antes había
// valores sueltos dentro de ui.js, handTracking.js, pcmPlayer.js y
// cameraRecovery.js, que es exactamente el tipo de número que se
// desincroniza cuando alguien ajusta una sola copia.

// Aparición del anillo del PTT cuando la ficha guía al botón de voz.
export const PTT_COACH_MS = 700;

// Ventana de la confirmación de rescan: el primer toque la arma, el
// segundo confirma. El CSS la consume con --confirm-ms.
export const RESCAN_CONFIRM_MS = 4000;

// Cascada de las filas de la ficha al abrir.
export const SHEET_ROW_STEP_MS = 40;
export const SHEET_ROW_DELAY_MS = 140;

// Entrada escalonada de los controles de la sección 4 (clase .entering).
export const ENTERING_ANIMATION_MS = 1000;

// Distancias de entrada del chip "Traer al frente" (px).
export const RECENTER_SLIDE_X = 48;
export const RECENTER_SLIDE_Y = 16;

// Por debajo de este ancho, centrar la pregunta del medio en el carrusel
// recorta la primera: se arranca desde el inicio.
export const COMPACT_CONTAINER_WIDTH_PX = 420;

// Sin detección de mano por más que esto, la UI muestra el chip de ayuda
// de la calibración. Antes vivía dentro de handTracking.js.
export const NO_HAND_HINT_MS = 3000;

// Debounce del aviso "terminó de sonar" del reproductor PCM: evita que la
// UI parpadee entre "Respondiendo" e inactivo entre chunks.
export const PLAYBACK_END_DEBOUNCE_MS = 250;

// --- Recuperación de cámara al volver del segundo plano ---
export const CAMERA_RECHECK_DELAY_MS = 250;  // el navegador necesita un instante para des-silenciar
export const CAMERA_FRAME_PROBE_MS = 750;    // ventana para comprobar que el video avanza
export const CAMERA_MAX_ATTEMPTS = 3;
export const CAMERA_RETRY_DELAY_MS = 1250;

// La duración del toggle de la ficha vive en el token --dur-panel de
// styles/tokens.css; el settle 3D usa τ=0.11s en sessionManager.

// --- Pose de la pieza con la ficha abierta (bottom sheet, 62.5% alto) ---
// Con la mitad inferior de la pantalla tapada, la pose de centrado normal
// queda cortada: la pieza se recoloca para el espacio libre. Unidades del
// espacio de cámara, como CENTER_*. Cada entrada del catálogo puede pisarlas
// con sheetPosition / sheetRotation / sheetScaleFactor (ver catalog.js).
export const SHEET_OPEN_POSITION = new THREE.Vector3(0, 525, -2500);
export const SHEET_OPEN_ROTATION = new THREE.Euler(0, 0, 0);
// Multiplicador sobre la escala base de centrado (0.625 = 62.5%).
export const SHEET_OPEN_SCALE_FACTOR = 0.625;

// --- Voz (Gemini Live): techos de espera de las conexiones de red ---
// Sin techo, un corte a mitad del handshake es un CONNECTING eterno sin
// diagnóstico. El fetch del token se aborta de verdad (AbortController);
// la conexión Live solo se acota la espera (ver voiceAgent.js).
export const TOKEN_FETCH_TIMEOUT_MS = 10000;
export const LIVE_CONNECT_TIMEOUT_MS = 15000;

// ============================================================
// UI — orquestador DOM de las 4 secciones
// ============================================================
// Único módulo que toca el DOM. El look vive en style.css; acá solo se
// cambian clases, atributos data-* y textos (vía i18n), y se disparan las
// primitivas de motion.js (reveal / conceal / stagger / pulse / nudge).
// API por sección:
//   Intro:        initIntro, setBootStep, showBootError, hideIntro
//   Calibración:  calibration.show/hide/setStep/setProgress/setHandDetected/showHint/awaitStartOrSkip
//   Escaneo:      scan.show/hide/toSearch/found/modelReady/decouple/error
//   Interacción:  interaction.show/hide/reshow, setVoiceState, setGestureState,
//                 addTranscript, updateObjectOverlay, setSheetOpen, y helpers
//                 (coachPtt, revealKeyboard, holdHintPtt, resetDim, callbacks on*)

import * as THREE from 'three';
import { t, getLang, toggleLang } from './i18n.js';
import { VoiceState, VoiceErrorDetail, getVoiceErrorDetail } from './voiceAgent.js';
import { feedback } from './feedback.js';
import * as motion from './motion.js';
import {
  SCAN_HELP_DELAY_MS,
  UI_IDLE_DIM_MS,
  PTT_COACH_MS,
  RESCAN_CONFIRM_MS,
  SHEET_ROW_STEP_MS,
  SHEET_ROW_DELAY_MS,
  RECENTER_SLIDE_X,
  RECENTER_SLIDE_Y,
  ENTERING_ANIMATION_MS,
  COMPACT_CONTAINER_WIDTH_PX
} from './config.js';

const $ = (sel) => document.querySelector(sel);

// Mapa único de elementos: ningún selector suelto por el módulo.
export const elements = {
  intro: $('#s-intro'),
  introHome: $('#intro-home'),
  introLoading: $('#intro-loading'),
  introError: $('#intro-error'),
  errorIcon: $('#intro-error .err-ico'),
  errorTitle: $('#error-title'),
  errorBody: $('#error-body'),
  errorRetry: $('#error-retry'),
  errorHowto: $('#error-howto'),
  errorHowtoText: $('#error-howto-text'),
  startBtn: $('#start-btn'),
  langBtn: $('#lang-btn'),
  langLabel: $('#lang-label'),
  museumMark: $('#museum-mark'),
  museumName: $('#museum-name'),
  bootRingWrap: $('#intro-loading .ring-big'),
  bootRing: $('#boot-ring'),
  bootPercent: $('#boot-percent'),
  bootNote: $('#boot-note'),
  checkCamera: $('#check-camera'),
  checkHands: $('#check-hands'),
  checkCatalog: $('#check-catalog'),

  calibrateLayer: $('#s-calibrate'),
  calRing: $('#cal-ring'),
  calHandFist: $('#cal-hand-fist'),
  calHandOpen: $('#cal-hand-open'),
  calOk: $('#cal-ok'),
  calPillOk: $('#cal-pill-ok'),
  calPillWarn: $('#cal-pill-warn'),
  calHint: $('#cal-hint'),
  calSeg1: $('#cal-seg1'),
  calSeg2: $('#cal-seg2'),
  calTitle: $('#cal-title'),
  calHelp: $('#cal-help'),
  calStartBtn: $('#calibration-start-btn'),
  calSkipBtn: $('#calibration-skip-btn'),
  calSheet: $('#s-calibrate .sheet-bottom'),

  scanLayer: $('#s-scan'),
  scanSearch: $('#scan-block-search'),
  scanHelp: $('#scan-help'),
  scanLock: $('#scan-block-lock'),
  scanPieceName: $('#scan-piece-name'),
  scanBar: $('#scan-bar'),
  scanDecouple: $('#scan-block-decouple'),
  scanRing: $('#decouple-ring-prog'),
  scanError: $('#scan-error'),
  scanErrorText: $('#scan-error-text'),
  scanErrorRetry: $('#scan-error-retry'),
  scanHelpBtn: $('#scan-help-btn'),
  scanBottom: $('#s-scan .bottom3'),

  interactLayer: $('#s-interact'),
  objOverlay: $('#obj-overlay'),
  scaleChip: $('#scale-chip'),
  pieceName: $('#piece-name'),
  pieceInv: $('#piece-inv'),
  titleChip: $('.title-chip'),
  rail: $('#s-interact .rail'),
  railDot: $('#s-interact .rail .hd'),
  rescanBtn: $('#rescan-btn'),
  rescanConfirm: $('#rescan-confirm'),
  rescanConfirmYes: $('#rescan-confirm-yes'),
  rescanConfirmNo: $('#rescan-confirm-no'),
  recenterBtn: $('#recenter-btn'),
  gestureHelpBtn: $('#gesture-help-btn'),
  helpPanel: $('#help-panel'),
  recalibrateBtn: $('#recalibrate-btn'),
  chips: $('#suggest-chips'),
  caption: $('#caption'),
  captionYou: $('#caption-you'),
  captionAi: $('#caption-ai'),
  voiceError: $('#voice-error'),
  voiceErrorText: $('#voice-error-text'),
  voiceErrorHowto: $('#voice-error-howto'),
  voiceErrorHowtoText: $('#voice-error-howto-text'),
  btnKeyboard: $('#btn-keyboard'),
  kbBar: $('#kb-bar'),
  kbInput: $('#kb-input'),
  kbSend: $('#kb-send'),
  talkBtn: $('#talk-btn'),
  pttIdle: $('#ptt-idle'),
  pttWave: $('#ptt-wave'),
  pttSpin: $('#ptt-spin'),
  pttLabel: $('#ptt-label'),
  sheet: $('#piece-sheet'),
  sheetTitle: $('#sheet-title'),
  sheetClose: $('#sheet-close'),
  sheetAsk: $('#sheet-ask'),
  btnSheet: $('#btn-sheet'),
  sheetFields: {
    culture: $('#sheet-culture'),
    period: $('#sheet-period'),
    material: $('#sheet-material'),
    origin: $('#sheet-origin'),
    inventoryNumber: $('#sheet-inventory')
  }
};

let activeEntry = null;
let onRecalibrateCallback = null;
let onSheetToggleCallback = null;
let onAskCallback = null;
let onRescanCallback = null;
let onRecenterCallback = null;

// --- Navegación entre secciones ---

const LAYERS = ['intro', 'calibrateLayer', 'scanLayer', 'interactLayer'];

// --- Fuera del ciclo de render que lee el DOM ---
// El loop de render y sessionManager necesitan saber estado de la UI. En
// vez de que lean elementos y data-* por su cuenta (lo que acoplaba el
// core al esquema del DOM), se expone la pregunta como API de la sección.

export function isSheetOpen() {
  return elements.interactLayer.dataset.sheet === 'open';
}

export function isInteractionVisible() {
  return !elements.interactLayer.hidden;
}

// --- Fundidos entre secciones / vistas ---
// Saliente: .fade-out y [hidden] recién al terminar (display:none mataría
// la animación). Entrante: se muestra arrancando en fade-out (opacidad 0) y
// la clase se retira en el frame siguiente; la transición base lo lleva a 1.
// La duración de la salida se lee del token --dur-exit: ya no hay una
// constante espejo que mantener a mano en sincronía con el CSS.

// Holgura para que el [hidden] llegue DESPUÉS de que termine la transición.
const FADE_OUT_SLACK_MS = 20;

export function fadeOut(el) {
  if (!el || el.hidden) return;
  el.classList.add('fade-out');
  setTimeout(() => {
    // Solo ocultar si sigue saliendo (pudo haber reingresado).
    if (!el.classList.contains('fade-out')) return;
    el.hidden = true;
    el.classList.remove('fade-out');
  }, motion.tokenMs('--dur-exit', 200) + FADE_OUT_SLACK_MS);
}

export function fadeIn(el) {
  if (!el) return;
  // Ya visible y sin salida en curso: nada que hacer.
  if (!el.hidden && !el.classList.contains('fade-out')) return;
  el.classList.add('fade-out'); // arranca transparente
  el.hidden = false;
  requestAnimationFrame(() => {
    // Al retirar la clase, la transición base funde a opacidad 1 y
    // neutraliza el [hidden] de un fadeOut pendiente.
    requestAnimationFrame(() => el.classList.remove('fade-out'));
  });
}

// Mostrar/ocultar un elemento en flujo con entrada/salida suave; sus
// hermanos se reacomodan deslizando (ver motion.flow).
function setSoft(el, visible) {
  if (visible) motion.reveal(el, { rise: 8 });
  else motion.conceal(el, { rise: 8 });
}

function showLayer(key) {
  LAYERS.forEach((layerKey) => {
    const el = elements[layerKey];
    if (layerKey === key) fadeIn(el);
    else fadeOut(el);
  });
}

// --- 1 · Presentación ---

export function initIntro(museum, { onStart } = {}) {
  elements.museumMark.textContent = museum.mark;
  elements.museumName.textContent = museum.name;
  elements.langLabel.textContent = getLang().toUpperCase();

  elements.langBtn.addEventListener('click', () => {
    // Los textos cambian de largo según el idioma: lo que los rodea se
    // desliza en vez de saltar.
    const view = [elements.introHome, elements.introLoading, elements.introError]
      .find((v) => !v.hidden && !v.classList.contains('fade-out'));
    motion.flow(view ?? elements.introHome, () => {
      toggleLang();
      refreshDynamicTexts();
    });
    motion.swapText(elements.langLabel, getLang().toUpperCase());
  });

  elements.errorHowto.addEventListener('click', () => {
    const text = elements.errorHowtoText;
    if (text.hidden) motion.reveal(text, { rise: 6 });
    else motion.conceal(text);
  });
  elements.errorRetry.addEventListener('click', () => window.location.reload());

  elements.startBtn.addEventListener('click', () => {
    // El botón se contrae mientras la vista se disuelve hacia el loading.
    elements.startBtn.classList.add('launching');
    fadeOut(elements.introHome);
    fadeIn(elements.introLoading);
    setBootStep('camera', 'doing');
    onStart?.();
  });
}

const bootSteps = ['camera', 'hands', 'catalog'];
const bootState = { camera: 'pending', hands: 'pending', catalog: 'pending' };

// state: 'pending' | 'doing' | 'done' | 'warn'. 'warn' cuenta como
// resuelto para el anillo: el hito terminó (con aviso), el arranque no
// puede quedarse en 66% para siempre.
export function setBootStep(step, state) {
  bootState[step] = state;
  const el = { camera: elements.checkCamera, hands: elements.checkHands, catalog: elements.checkCatalog }[step];
  el.classList.remove('done', 'doing', 'warn');
  if (state !== 'pending') el.classList.add(state);

  const resolved = bootSteps.filter((s) => bootState[s] === 'done' || bootState[s] === 'warn').length;
  const percent = Math.round((resolved / bootSteps.length) * 100);
  motion.countTo(elements.bootPercent, percent, { dur: 380 });
  elements.bootRing.style.strokeDashoffset = String(100 - percent);

  // Si un hito terminó con aviso, la nota bajo los checks explica qué
  // pierde el visitante (gestos / precarga).
  if (state === 'warn') {
    motion.swapText(elements.bootNote, t(`loading.${step}Warn`), { durOut: 140, durIn: 200 });
  }
}

// Al salir del loading, el anillo (ya cerrado al 100%) late una vez antes
// del fundido hacia la sección siguiente. Solo si el loading sigue visible.
function flashBootRing() {
  const loading = elements.introLoading;
  if (loading.hidden || loading.classList.contains('fade-out')) return;
  motion.pulse(elements.bootRingWrap, { scale: 1.07, dur: 520 });
}

export function hideIntro() {
  flashBootRing();
  // El fundido se encarga de ocultar: hidden cortaría la animación.
  showLayer(null);
}

export function showBootError(kind = 'camera') {
  fadeOut(elements.introHome);
  fadeOut(elements.introLoading);
  fadeIn(elements.introError);
  elements.errorTitle.textContent = t(`error.${kind}.title`);
  elements.errorBody.textContent = t(`error.${kind}.body`);
  feedback.error();
  // El icono entra con pop-in y, cuando ya está en su sitio, un único nudge.
  setTimeout(() => motion.nudge(elements.errorIcon), 320);
}

// --- 2 · Calibración ---

export const calibration = {
  show() {
    flashBootRing();
    showLayer('calibrateLayer');
    this.setStep('ready');
    this.setProgress(0);
    this.setHandDetected(null);
    elements.calHint.hidden = true;
  },

  hide() {
    fadeOut(elements.calibrateLayer);
  },

  // step: 'ready' | 'fist' | 'open' | 'done' | 'partial' | 'failed' | 'skipped'
  // 'partial' y 'failed' son finales sin check grande: la calibración no
  // fue exitosa y el check diría lo contrario.
  setStep(step) {
    const finished = ['done', 'skipped', 'partial', 'failed'].includes(step);
    const showOk = step === 'done' || step === 'skipped';

    elements.calibrateLayer.dataset.step = step;
    elements.calOk.hidden = !showOk;
    // Los botones están en flujo dentro de la hoja inferior: al entrar o
    // salir, el título y la ayuda se deslizan (motion.reveal/conceal).
    setSoft(elements.calStartBtn, step === 'ready');
    setSoft(elements.calSkipBtn, !finished);
    elements.calPillOk.hidden = !(step === 'fist' || step === 'open');

    elements.calSeg1.classList.toggle('current', step === 'fist');
    elements.calSeg1.classList.toggle('done', step === 'open' || finished);
    elements.calSeg2.classList.toggle('current', step === 'open');
    elements.calSeg2.classList.toggle('done', finished);

    motion.swapTextRise(elements.calTitle, t(`cal.${step}.title`));
    // La ayuda entra 80 ms después del título: aparecen en cascada.
    motion.swapTextRise(elements.calHelp, t(`cal.${step}.help`), { delay: 80 });

    // El check se dibuja (CSS) a la vez que suena el tono.
    if (step === 'done') feedback.calibrationDone();

    // No se pudo sincronizar: un único nudge del título, sin celebración.
    if (step === 'failed') {
      motion.nudge(elements.calTitle);
      feedback.error();
    }
  },

  // Progreso real 0..1 del flujo completo (anillo).
  setProgress(value) {
    elements.calRing.style.setProperty('--off', String(100 - Math.round(value * 100)));
    elements.calRing.style.strokeDashoffset = String(100 - Math.round(value * 100));
  },

  // detected: true/false/null (null = fuera de captura). Puede llegar por
  // frame: reveal/conceal son idempotentes. Las pills NO se animan: su
  // visibilidad cambia por frame de detección.
  setHandDetected(detected, showHint = false) {
    if (detected === null) {
      elements.calPillOk.hidden = true;
      elements.calPillWarn.hidden = true;
      elements.calibrateLayer.dataset.nohand = 'false';
      return;
    }
    elements.calPillOk.hidden = !detected;
    elements.calPillWarn.hidden = detected;
    elements.calibrateLayer.dataset.nohand = String(!detected);
    if (detected || !showHint) motion.conceal(elements.calHint);
    else motion.reveal(elements.calHint, { rise: 8 });
  },

  showHint(show) {
    if (show) motion.reveal(elements.calHint, { rise: 8 });
    else motion.conceal(elements.calHint);
  },

  // Resuelve 'start' | 'skip'. Los listeners se retiran siempre al
  // resolver, así nada queda colgando entre calibraciones.
  awaitStartOrSkip() {
    return new Promise((resolve) => {
      const finish = (choice) => {
        elements.calStartBtn.removeEventListener('click', onStart);
        elements.calSkipBtn.removeEventListener('click', onSkip);
        resolve(choice);
      };
      const onStart = () => finish('start');
      const onSkip = () => finish('skip');

      elements.calStartBtn.addEventListener('click', onStart);
      elements.calSkipBtn.addEventListener('click', onSkip);
    });
  }
};

// --- 3 · Escaneo ---

let scanHelpTimer = null;
let decouplePulseTimer = null;

// --- Barajado de los bloques de la hoja inferior ---
// Los cuatro bloques del escaneo (espera / pieza reconocida / desacople /
// error) son mutuamente excluyentes. Antes cada transición decidía por su
// cuenta qué ocultar, y eso produjo un bug real: toSearch() ocultaba el
// chip de error, así que sessionManager lo mostraba y el mismo tick lo
// escondía. Ahora hay una única función que fija el estado completo, y
// ninguna transición puede pisar a otra.
function showScanBlock(block) {
  motion.flow(elements.scanBottom, () => {
    elements.scanSearch.hidden = block !== 'search';
    elements.scanLock.hidden = block !== 'lock';
    elements.scanDecouple.hidden = block !== 'decouple';
    elements.scanError.hidden = block !== 'error';
    elements.scanHelp.hidden = true;
  });
}

// El error de carga es terminal hasta que el visitante lo cierre o vuelva
// al escaneo: se pregunta antes de dejarlo pisar por un reset.
function isScanErrorVisible() {
  return !elements.scanError.hidden;
}

export const scan = {
  show() {
    showLayer('scanLayer');
    this.toSearch();
  },

  hide() {
    clearTimeout(scanHelpTimer);
    clearTimeout(decouplePulseTimer);
    fadeOut(elements.scanLayer);
  },

  toSearch() {
    clearTimeout(decouplePulseTimer);
    elements.scanLayer.dataset.state = 'search';
    // La barra puede haber quedado en 'done' de la pieza anterior: sin
    // esto, el escaneo siguiente mostraría una barra completa.
    elements.scanBar.classList.remove('done');
    elements.scanBar.classList.add('indeterminate');
    showScanBlock('search');

    // Sin detección por SCAN_HELP_DELAY_MS, aparece el chip de ayuda.
    clearTimeout(scanHelpTimer);
    scanHelpTimer = setTimeout(() => {
      if (elements.scanLayer.dataset.state === 'search') {
        motion.reveal(elements.scanHelp, { rise: 8 });
      }
    }, SCAN_HELP_DELAY_MS);
  },

  // Marcador detectado: estado "lock" (las esquinas se cierran y la
  // retícula late, por CSS) + indicador de carga del modelo. El feedback
  // se dispara en el mismo instante que ese pulso.
  found(entry) {
    clearTimeout(scanHelpTimer);
    clearTimeout(decouplePulseTimer);
    feedback.targetFound();
    elements.scanLayer.dataset.state = 'lock';
    showScanBlock('lock');
    motion.swapText(elements.scanPieceName, localizedName(entry));
    elements.scanBar.classList.remove('done');
    elements.scanBar.classList.add('indeterminate');
  },

  // La barra se completa y un brillo la cruza una vez (CSS, clase .done).
  modelReady() {
    if (isScanErrorVisible()) return;
    elements.scanBar.classList.remove('indeterminate');
    elements.scanBar.classList.add('done');
  },

  // Desacople: anillo que se llena durante durationMs (linear honesto) y
  // late una vez al completarse.
  decouple(durationMs) {
    elements.scanLayer.dataset.state = 'decouple';
    showScanBlock('decouple');

    const ring = elements.scanRing;
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = '100';
    // Reflow explícito para que la transición arranque desde 0.
    void ring.getBoundingClientRect();
    ring.style.transition = `stroke-dashoffset ${durationMs}ms linear`;
    ring.style.strokeDashoffset = '0';

    clearTimeout(decouplePulseTimer);
    decouplePulseTimer = setTimeout(() => {
      if (elements.scanLayer.dataset.state !== 'decouple') return;
      motion.pulse(ring.closest('.decouple-ring'), { scale: 1.12, dur: 420 });
    }, durationMs);
  },

  // Error de carga del modelo: es un estado propio, no un reset. NO llama
  // a toSearch(): si lo hiciera, el reset ocultaría el chip que se acaba
  // de mostrar y el visitante no vería nunca el diagnóstico.
  error(message) {
    elements.scanLayer.dataset.state = 'error';
    elements.scanErrorText.textContent = message;
    feedback.error();
    showScanBlock('error');
    motion.reveal(elements.scanError, { rise: 10 });
    setTimeout(() => motion.nudge(elements.scanError), 140);
  }
};

// El botón cierra el chip y devuelve el escaneo a la espera: el reintento
// real es alejar la cédula y volver a apuntarla (onTargetFound dispara
// solo en la transición false→true).
elements.scanErrorRetry.addEventListener('click', () => {
  scan.toSearch();
});

elements.scanHelpBtn.addEventListener('click', () => {
  if (elements.scanHelp.hidden) motion.reveal(elements.scanHelp, { rise: 8 });
  else motion.conceal(elements.scanHelp);
});

// --- 4 · Interacción ---

// La primera vez que se detecta la mano con esta pieza, el punto del
// riel late una vez (después queda fijo: no es un loop).
let handSeen = false;

export const interaction = {
  show(entry) {
    activeEntry = entry;
    handSeen = false;
    fillPieceData(entry);
    buildChips(entry);
    motion.reveal(elements.chips, { rise: 0, dur: 180 });

    showLayer('interactLayer');
    setVoiceState(VoiceState.IDLE);
    setGestureState({ active: null, detected: false });

    // Entrada coreografiada, una sola tanda por aparición de pieza
    // (el CSS escalona cada control; ver `.entering` en style.css).
    elements.interactLayer.classList.add('entering');
    setTimeout(() => elements.interactLayer.classList.remove('entering'), ENTERING_ANIMATION_MS);

    resetDim();
  },

  hide() {
    // Crossfade hacia el escaneo en paralelo con la salida de la pieza.
    fadeOut(elements.interactLayer);
    setSheetOpen(false);
    clearCaptions();
    // El chip "Traer al frente" pertenece a esta pieza: no puede asomar
    // un frame sobre la siguiente.
    recenterVisible = false;
    elements.recenterBtn.hidden = true;
    hideRescanConfirm();

    // Los popovers y el teclado también pertenecen a esta pieza: si
    // quedaban abiertos, reaparecían abiertos sobre la siguiente. Salen con
    // el mismo fundido que la capa (el [hidden] llega al terminar).
    motion.conceal(elements.helpPanel, { origin: 'trigger' });
    motion.conceal(elements.kbBar, { rise: 16 });
    // Se suelta el foco (baja el teclado del celular) y se descarta una
    // pregunta a medio escribir: era para la pieza anterior.
    elements.kbInput.blur();
    elements.kbInput.value = '';
  },

  // Volver sin repetir la entrada escalonada (regreso de recalibración).
  reshow() {
    fadeIn(elements.interactLayer);
    resetDim();
  }
};

// Rótulo corto del PTT por diagnóstico (la causa completa va en la franja
// de la conversación).
const PTT_ERROR_LABEL = {
  [VoiceErrorDetail.MIC_DENIED]: 'ptt.errMicDenied',
  [VoiceErrorDetail.MIC_MISSING]: 'ptt.errMicMissing',
  [VoiceErrorDetail.NETWORK]: 'ptt.errNetwork',
  [VoiceErrorDetail.RATE_LIMITED]: 'ptt.errRateLimited',
  [VoiceErrorDetail.SESSION_LOST]: 'ptt.errSessionLost',
  [VoiceErrorDetail.UNKNOWN]: 'ptt.errUnknown'
};

export function setVoiceState(state, detail = null) {
  const layer = elements.interactLayer;
  layer.dataset.voice = state;

  const isWave = state === VoiceState.LISTENING || state === VoiceState.SPEAKING;
  const isSpin = state === VoiceState.CONNECTING || state === VoiceState.PROCESSING;

  elements.pttIdle.hidden = isWave || isSpin;
  elements.pttWave.hidden = !isWave;
  elements.pttSpin.hidden = !isSpin;

  const labelKey = {
    [VoiceState.IDLE]: 'ptt.idle',
    [VoiceState.CONNECTING]: 'ptt.thinking',
    [VoiceState.LISTENING]: 'ptt.listening',
    [VoiceState.PROCESSING]: 'ptt.thinking',
    [VoiceState.SPEAKING]: 'ptt.speaking'
  }[state] ?? PTT_ERROR_LABEL[detail ?? VoiceErrorDetail.UNKNOWN];
  motion.swapText(elements.pttLabel, t(labelKey), { durOut: 100, durIn: 150 });

  // El halo y el sonar del PTT los dispara el CSS (data-voice="listening")
  // en este mismo instante, igual que la vibración.
  if (state === VoiceState.LISTENING) feedback.listeningStart();

  // Error de voz: causa + recuperación en la franja de la conversación,
  // con howto expandible para micrófono bloqueado. El PTT nunca se
  // deshabilita: reintentar es volver a sostenerlo.
  if (state === VoiceState.ERROR) {
    const errorDetail = detail ?? VoiceErrorDetail.UNKNOWN;
    motion.flow(elements.voiceError, () => {
      elements.voiceErrorText.textContent = t(`voice.err.${errorDetail}`);
      elements.voiceErrorHowto.hidden = errorDetail !== VoiceErrorDetail.MIC_DENIED;
    }, { box: true });
    if (!elements.voiceErrorHowtoText.hidden) motion.conceal(elements.voiceErrorHowtoText, { dur: 150, box: true });
    motion.conceal(elements.caption);
    motion.reveal(elements.voiceError, { rise: 12 });
    elements.interactLayer.dataset.caption = 'open'; // el chip de escala sube
    motion.conceal(elements.chips, { dur: 160 });
    feedback.error();
    // Matiz, no alarma: un único nudge del botón y de la franja (el tinte
    // del borde lo da el CSS al aparecer).
    motion.nudge(elements.talkBtn);
    setTimeout(() => motion.nudge(elements.voiceError), 200);
  } else {
    motion.conceal(elements.voiceError);
    if (elements.caption.hidden) elements.interactLayer.dataset.caption = 'closed';
    updateCaptionVisibility(state);
  }

  resetDim();
}

export function setGestureState({ active, detected }) {
  elements.interactLayer.dataset.hand = detected ? 'yes' : 'no';
  elements.interactLayer.dataset.gesture = active ?? '';

  // El estado del gesto se comunicaba solo por color: se expone además como
  // estado anunciable (aria-pressed) y el icono activo recibe su nombre.
  elements.interactLayer.querySelectorAll('.rail .g').forEach((g) => {
    const isActive = g.dataset.g === active;
    g.classList.toggle('active', isActive);
    g.setAttribute('aria-pressed', String(isActive));
  });

  elements.scaleChip.hidden = active !== 'scale';
  if (active) resetDim();

  // Primera mano detectada con esta pieza: un único pulso del punto.
  if (detected && !handSeen) {
    handSeen = true;
    motion.pulse(elements.railDot, { scale: 1.9, dur: 520 });
  }
}

// --- Subtítulos en vivo ---
// Comparten franja con las preguntas sugeridas: cuando aparecen, los
// chips ceden el lugar.

// Las transcripciones llegan por tramos (varios por segundo). Correr
// motion.flow() en cada tramo significaba, por delta: medir el panel y sus
// hijos, mutar, volver a medir y animar clip-path + deslizamiento de
// hermanos, para reemplazar todo en el tramo siguiente. Durante el
// streaming los tramos solo AGRANDAN el texto y el panel ya esta abierto,
// asi que el reacomodo no aporta nada hasta que el turno termina: se muta
// directo mientras llega texto y el flow() se corre UNA vez, al cerrarlo.
let streamedTranscript = { user: false, model: false };

export function addTranscript({ role, text, final }) {
  motion.conceal(elements.chips, { dur: 160 });

  const wasVisible = !elements.caption.hidden;
  const alreadyStreamed = streamedTranscript[role];

  const mutate = () => {
    if (role === 'user') {
      elements.captionYou.textContent = final
        ? `${t('caption.you')} ${text}`
        : `${t('caption.typing')} ${text}`;
    } else {
      elements.captionAi.classList.remove('thinking');
      elements.captionAi.textContent = text;
      // Auto-scroll durante el streaming.
      elements.captionAi.scrollTop = elements.captionAi.scrollHeight;
    }
  };

  if (final || !wasVisible || !alreadyStreamed) {
    // Primera aparición del panel, o cierre del turno: el alto puede
    // cambiar y lo que lo rodea debe deslizarse, no saltar.
    motion.flow(elements.caption, mutate, { box: true });
    streamedTranscript[role] = !final;
  } else {
    // Tramo intermedio con el panel ya abierto: mutación directa, sin
    // medir layout ni animar clip-path.
    mutate();
  }

  motion.reveal(elements.caption, { rise: 12 });
  elements.interactLayer.dataset.caption = 'open';
}

// Al cerrar los subtítulos (cambio de pieza, error de voz) el estado de
// streaming se reinicia: el próximo intercambio vuelve a medir.
function resetTranscriptStreaming() {
  streamedTranscript = { user: false, model: false };
}

function updateCaptionVisibility(state) {
  if (state === VoiceState.IDLE) return; // queda el último intercambio visible
  // Primero el contenido (con el panel ya visible se desliza; oculto, no
  // mide nada) y luego la aparición.
  motion.flow(elements.caption, () => {
    if (state === VoiceState.PROCESSING) {
      // Tres puntos sin innerHTML: es el único sink de HTML del proyecto y
      // ya no existe (antes: captionAi.innerHTML = '<span class="dots">…').
      // El texto es además el que anuncia un lector de pantalla.
      elements.captionAi.textContent = t('caption.thinking');
      elements.captionAi.classList.add('thinking');
    }
    if (state === VoiceState.LISTENING) {
      elements.captionAi.classList.remove('thinking');
      elements.captionYou.textContent = t('caption.typing');
      elements.captionAi.textContent = '';
    }
  }, { box: true });
  motion.reveal(elements.caption, { rise: 12 });
  elements.interactLayer.dataset.caption = 'open';
  motion.conceal(elements.chips, { dur: 160 });
}

function clearCaptions() {
  resetTranscriptStreaming();
  motion.conceal(elements.caption);
  elements.interactLayer.dataset.caption = 'closed';
}

elements.voiceErrorHowto.addEventListener('click', () => {
  const text = elements.voiceErrorHowtoText;
  if (text.hidden) motion.reveal(text, { rise: 6, box: true });
  else motion.conceal(text, { box: true });
});

// --- Guía del CTA de la ficha ---
// El anillo del PTT late una sola vez (clase .coach): señala el botón
// sin animarlo, así no pelea con la presión :active.
let coachTimer = null;

export function coachPtt() {
  elements.talkBtn.classList.add('coach');
  clearTimeout(coachTimer);
  coachTimer = setTimeout(() => elements.talkBtn.classList.remove('coach'), PTT_COACH_MS);
  resetDim();
}

// Teclado alternativo: lo abre el botón del riel y el CTA de la ficha
// cuando el micrófono no sirve (main.js decide).
export function revealKeyboard() {
  motion.reveal(elements.kbBar, { rise: 16 });
  elements.kbInput.focus();
  resetDim();
}

// Soltó el PTT antes de que la sesión abriera: el rótulo lo avisa una vez
// (el estado sigue IDLE; el próximo intento lo reemplaza).
export function holdHintPtt() {
  motion.swapText(elements.pttLabel, t('ptt.holdHint'), { durOut: 100, durIn: 150 });
}

// --- Confirmación de rescan ---
// Rescan cierra la conversación de la pieza: primer toque arma el popover
// (ventana de RESCAN_CONFIRM_MS), el segundo confirma. Una línea de latón
// se consume en esa ventana: el CSS la anima con --confirm-ms, la misma
// constante que desarma el timer.

let rescanConfirmTimer = null;

function hideRescanConfirm() {
  clearTimeout(rescanConfirmTimer);
  rescanConfirmTimer = null;
  motion.conceal(elements.rescanConfirm, { origin: 'trigger' });
  elements.rescanConfirm.classList.remove('armed');
}

function armRescanConfirm() {
  const pop = elements.rescanConfirm;
  pop.style.setProperty('--confirm-ms', `${RESCAN_CONFIRM_MS}ms`);
  // Reinicio explícito: quitar la clase, forzar reflow y volver a ponerla.
  pop.classList.remove('armed');
  void pop.offsetWidth;
  pop.classList.add('armed');

  clearTimeout(rescanConfirmTimer);
  rescanConfirmTimer = setTimeout(hideRescanConfirm, RESCAN_CONFIRM_MS);
}

elements.rescanBtn.addEventListener('click', () => {
  if (elements.rescanConfirm.hidden) {
    // Un popover a la vez: si la ayuda está abierta, se cierra antes.
    if (!elements.helpPanel.hidden) motion.conceal(elements.helpPanel, { origin: 'trigger' });
    // Nace de su gatillo (esquina superior derecha).
    motion.reveal(elements.rescanConfirm, { origin: 'trigger', dur: 260 });
    armRescanConfirm();
  } else {
    hideRescanConfirm();
  }
  resetDim();
});

elements.rescanConfirmYes.addEventListener('click', () => {
  hideRescanConfirm();
  onRescanCallback?.();
});

elements.rescanConfirmNo.addEventListener('click', hideRescanConfirm);

// --- "Traer al frente": rescate de la pieza fuera de cuadro ---

elements.recenterBtn.addEventListener('click', () => {
  onRecenterCallback?.();
  resetDim();
});

// --- Overlay del objeto (brackets de escala) ---

const projectVec = new THREE.Vector3();

// El chip solo cambia al CRUZAR el borde del viewport, no por frame.
let recenterVisible = false;

// Se llama por frame con la sesión activa: posiciona los brackets sobre
// la proyección 2D del modelo y decide si mostrar el rescate.
export function updateObjectOverlay(session, camera) {
  if (!session?.model || elements.interactLayer.hidden) return;

  session.model.getWorldPosition(projectVec);
  projectVec.project(camera);

  const x = (projectVec.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-projectVec.y * 0.5 + 0.5) * window.innerHeight;

  elements.objOverlay.style.left = `${x}px`;
  elements.objOverlay.style.top = `${y}px`;

  // Rescate cuando el centro sale del viewport (margen 1.1 en NDC). Con
  // la ficha o la ayuda abiertas, esos paneles tienen prioridad.
  const sheetOpen = isSheetOpen();
  const helpOpen = !elements.helpPanel.hidden;
  const offscreen = Math.abs(projectVec.x) > 1.1 || Math.abs(projectVec.y) > 1.1;
  const shouldShow = offscreen && !sheetOpen && !helpOpen && session.centeringComplete;

  if (shouldShow !== recenterVisible) {
    recenterVisible = shouldShow;
    if (shouldShow) {
      // Entra desde el borde por el que se perdió la pieza: de costado si
      // se fue por un lado, de arriba/abajo si se fue en vertical.
      const lostSideways = Math.abs(projectVec.x) > Math.abs(projectVec.y);
      motion.reveal(elements.recenterBtn, lostSideways
        ? { rise: 0, dx: Math.sign(projectVec.x) * RECENTER_SLIDE_X }
        : { rise: projectVec.y > 0 ? -RECENTER_SLIDE_Y : RECENTER_SLIDE_Y });
    } else {
      motion.conceal(elements.recenterBtn, { rise: 8, dur: 200 });
    }
  }

  // Multiplicador de escala por frame: es dato, no decoración.
  if (elements.interactLayer.dataset.gesture === 'scale' && session.baseModelScale > 0) {
    const multiplier = session.model.scale.x / session.baseModelScale;
    elements.scaleChip.textContent = `${multiplier.toFixed(1)}×`;
  }
}

// --- Atenuación por inactividad ---

let dimTimer = null;

export function resetDim() {
  elements.interactLayer.classList.remove('dim');
  clearTimeout(dimTimer);
  dimTimer = setTimeout(() => {
    if (!elements.interactLayer.hidden) elements.interactLayer.classList.add('dim');
  }, UI_IDLE_DIM_MS);
}

elements.interactLayer.addEventListener('pointerdown', resetDim);

// --- Ficha de la obra (bottom sheet) ---

// Filas visibles de la ficha como grupos [dt, dd], para la cascada.
function visibleSheetRows() {
  return Object.values(elements.sheetFields)
    .filter((dd) => !dd.hidden)
    .map((dd) => [dd.previousElementSibling, dd]);
}

// Cascada de las filas de datos al abrir: SHEET_ROW_STEP_MS por fila, tras
// la hoja.

export function setSheetOpen(open) {
  elements.interactLayer.dataset.sheet = open ? 'open' : 'closed';
  if (open) {
    // display:flex !important en .sheet[hidden] permite animar la entrada.
    elements.sheet.removeAttribute('hidden');
    // Dialog real: sale del inert (sus controles son focuseables) y recibe
    // el foco.
    elements.sheet.removeAttribute('inert');
    elements.sheetClose.focus();
    motion.stagger(visibleSheetRows(), {
      step: SHEET_ROW_STEP_MS,
      delay: SHEET_ROW_DELAY_MS,
      rise: 10
    });
  } else {
    elements.sheet.hidden = true;
    // Cerrada, sale del árbol de accesibilidad y del tab order.
    elements.sheet.setAttribute('inert', '');
    // El foco vuelve al gatillo que la abrió.
    if (document.activeElement instanceof Node && elements.sheet.contains(document.activeElement)) {
      elements.btnSheet.focus();
    }
  }
  onSheetToggleCallback?.(open);
  resetDim();
}

// Escape cierra la ficha (convención de dialog).
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && elements.interactLayer.dataset.sheet === 'open') {
    setSheetOpen(false);
  }
});

export function onSheetToggle(cb) { onSheetToggleCallback = cb; }
export function onRecalibrate(cb) { onRecalibrateCallback = cb; }
export function onAsk(cb) { onAskCallback = cb; }
export function onRescan(cb) { onRescanCallback = cb; }
export function onRecenter(cb) { onRecenterCallback = cb; }

elements.sheetClose.addEventListener('click', () => setSheetOpen(false));
elements.sheetAsk.addEventListener('click', () => {
  setSheetOpen(false);
  onAskCallback?.();
});

// --- Chips de preguntas sugeridas + campo de texto ---

let onAskQuestionCallback = null;
export function onAskQuestion(cb) { onAskQuestionCallback = cb; }

function localizedName(entry) {
  const lang = getLang();
  return (lang !== 'es' && entry.translations?.[lang]?.name) || entry.name;
}
// La usa sessionManager para el mensaje de error de carga.
export { localizedName };

function localizedQuestions(entry) {
  const lang = getLang();
  return (lang !== 'es' && entry.translations?.[lang]?.suggestedQuestions) || entry.suggestedQuestions || [];
}

function fillPieceData(entry) {
  elements.pieceName.textContent = localizedName(entry);
  // Prefijo de inventario localizado (ES "Inv.", EN "No.").
  elements.pieceInv.textContent = entry.inventoryNumber
    ? `${t('sheet.invPrefix')} ${entry.inventoryNumber}`
    : '';

  elements.sheetTitle.textContent = localizedName(entry);
  for (const [field, el] of Object.entries(elements.sheetFields)) {
    const value = entry[field];
    // Campo vacío: la fila completa (dt + dd) desaparece, no un guion suelto.
    const empty = value === undefined || value === null || value === '' || value === '—';
    el.textContent = empty ? '' : String(value);
    el.hidden = empty;
    const dt = el.previousElementSibling;
    if (dt && dt.tagName === 'DT') dt.hidden = empty;
  }
}

function buildChips(entry) {
  elements.chips.innerHTML = '';
  localizedQuestions(entry).forEach((question) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = question;
    chip.addEventListener('click', () => {
      resetDim();
      onAskQuestionCallback?.(question);
    });
    elements.chips.appendChild(chip);
  });

  // Posición inicial con la pregunta del medio centrada (se espera un
  // frame para tener medidas de layout). En contenedores angostos el
  // centrado deja recortada la primera pregunta: se arranca desde 0.
  const chips = Array.from(elements.chips.children);
  if (chips.length >= 2) {
    const middle = chips[Math.floor(chips.length / 2)];
    requestAnimationFrame(() => {
      const containerWidth = elements.chips.clientWidth;
      const centered = middle.offsetLeft + middle.offsetWidth / 2 - containerWidth / 2;
      elements.chips.scrollLeft = containerWidth < COMPACT_CONTAINER_WIDTH_PX
        ? 0
        : Math.max(0, centered);
    });
  }

  // Abanico de entrada: 55ms por chip, con un pequeño retardo para que
  // lleguen después del resto de la coreografía de la sección.
  motion.stagger(chips, { step: 55, delay: 380, rise: 10, dur: 360 });
}

// Teclado alternativo
elements.gestureHelpBtn.addEventListener('click', () => {
  if (elements.helpPanel.hidden) {
    // Un popover a la vez: si la confirmación de rescan está abierta, se
    // cierra antes (y se desarma su timer).
    if (!elements.rescanConfirm.hidden) hideRescanConfirm();
    // Nace de su gatillo (esquina superior derecha).
    motion.reveal(elements.helpPanel, { origin: 'trigger', dur: 260 });
  } else {
    motion.conceal(elements.helpPanel, { origin: 'trigger' });
  }
  resetDim();
});

elements.recalibrateBtn.addEventListener('click', () => {
  motion.conceal(elements.helpPanel, { origin: 'trigger' });
  onRecalibrateCallback?.();
});

// "Recalibrar la mano" solo se ofrece con HandLandmarker vivo; main.js
// pasa el estado como boolean (ui.js no importa módulos de lógica).
export function setRecalibrateAvailable(available) {
  elements.recalibrateBtn.hidden = !available;
}

let kbHandlersWired = false;
export function wireControls() {
  if (kbHandlersWired) return;
  kbHandlersWired = true;

  elements.btnKeyboard.addEventListener('click', () => {
    if (elements.kbBar.hidden) {
      revealKeyboard();
    } else {
      motion.conceal(elements.kbBar, { rise: 16 });
      resetDim();
    }
  });

  const send = () => {
    const text = elements.kbInput.value.trim();
    if (!text) return;
    elements.kbInput.value = '';
    onAskQuestionCallback?.(text);
    resetDim();
  };

  elements.kbSend.addEventListener('click', send);
  elements.kbInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });

  elements.btnSheet.addEventListener('click', () => {
    // La ficha solo tiene sentido con una pieza centrada: abrirla antes
    // dejaba el botón de preguntar apuntando a un objeto inexistente.
    if (!activeEntry) return;
    setSheetOpen(!isSheetOpen());
  });
}

// El botón walkie-talkie se cablea acá, no en main.js: es UI pura y así
// main.js deja de necesitar los elementos del DOM (ver isSheetOpen).
export function wireTalkButton({ onPressStart, onPressEnd }) {
  const btn = elements.talkBtn;

  // pointerdown/up (no click) para distinguir apretado de soltado y
  // preparar el audio dentro del gesto (iOS).
  btn.addEventListener('pointerdown', (event) => {
    btn.setPointerCapture(event.pointerId);
    onPressStart();
  });

  ['pointerup', 'pointercancel'].forEach((eventName) => {
    btn.addEventListener(eventName, onPressEnd);
  });
}

// Al cambiar de idioma con la pieza activa, refrescar los textos dinámicos.
function refreshDynamicTexts() {
  if (activeEntry && !elements.interactLayer.hidden) {
    motion.flow(elements.titleChip, () => fillPieceData(activeEntry), { box: true });
    buildChips(activeEntry);
  }
  const voiceState = elements.interactLayer.dataset.voice || VoiceState.IDLE;
  if (voiceState === VoiceState.ERROR) {
    // Con un error en pantalla, solo se re-rotula (sin re-correr efectos).
    const detail = getVoiceErrorDetail() ?? VoiceErrorDetail.UNKNOWN;
    motion.flow(elements.voiceError, () => {
      elements.voiceErrorText.textContent = t(`voice.err.${detail}`);
    }, { box: true });
    motion.swapText(elements.pttLabel, t(PTT_ERROR_LABEL[detail]), { durOut: 100, durIn: 150 });
  } else {
    setVoiceState(voiceState);
  }

  // El rótulo del riel de gestos también es texto traducible.
  elements.interactLayer.querySelectorAll('.rail .g').forEach((g) => {
    g.setAttribute('aria-label', t(`gesture.${g.dataset.g}`));
  });
  elements.rail.setAttribute('aria-label', t('gesture.rail'));
}

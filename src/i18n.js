// --- i18n: textos de la interfaz, multi-idioma ---
// Toda cadena visible vive acá. El idioma se elige con el pill de la sección 1
// o con ?lang=; el atributo lang y los elementos data-i18n se actualizan solos.
//
// Registro de voz: primera persona del plural ("No vemos su mano") y trato de
// usted, formal e impersonal, sin regionalismos; botones en infinitivo.
//
// Uso en JS:  import { t } from './i18n.js';  t('scan.title')
//             t('scan.errorLoad', { name: 'Vasija' })  → interpolación {clave}
// Uso en HTML: <span data-i18n="scan.title"></span>
// Placeholder de inputs: data-i18n-attr="placeholder:keyboard.placeholder"

export const LOCALES = {
  es: {
    'intro.step1': 'Apunte a la cédula de la pieza',
    'intro.step2': 'La pieza aparece frente a usted',
    'intro.step3': 'Muévala con las manos y pregúntele',
    'intro.title': 'Cada pieza tiene una historia. Pregúntele.',
    'intro.start': 'Comenzar',
    'intro.privacy': 'Usamos su cámara para la visita y su micrófono solo mientras mantiene el botón de voz. No guardamos imágenes ni grabaciones; sus preguntas se envían al servicio de guía para que pueda responderlas.',

    'loading.title': 'Preparando la experiencia',
    'loading.camera': 'Cámara',
    'loading.hands': 'Reconocimiento de manos',
    'loading.catalog': 'Piezas de la sala',
    'loading.note': 'Con Wi-Fi lento puede tardar unos segundos.',
    // Reemplaza a loading.note cuando un hito termina con aviso (warn).
    'loading.handsWarn': 'Gestos no disponibles. Puede continuar con voz.',
    'loading.catalogWarn': 'Algunas piezas se descargarán al escanearlas.',

    'error.camera.title': 'No podemos usar la cámara',
    'error.camera.body': 'Permita el acceso a la cámara en su navegador y vuelva a intentar.',
    'error.generic.title': 'Algo salió mal',
    'error.generic.body': 'No pudimos iniciar la experiencia. Reintente en un momento.',
    'error.retry': 'Reintentar',
    'error.howto': 'Cómo permitir la cámara',
    'error.howtoText': 'En la barra de direcciones, toque el icono de candado o de ajustes y active la cámara para este sitio. Luego toque Reintentar.',

    'cal.ready.title': 'Sincronicemos su mano',
    'cal.ready.help': 'Son dos gestos breves. Así la pieza responde a su mano y no a la de otra persona.',
    'cal.ready.start': 'Iniciar calibración',
    'cal.fist.title': 'Cierre el puño',
    'cal.fist.help': 'Manténgalo frente a la cámara, a unos 30 cm.',
    'cal.open.title': 'Abra la mano',
    'cal.open.help': 'Extienda los cinco dedos y no se mueva.',
    'cal.done.title': 'Mano sincronizada',
    'cal.done.help': 'Ya puede escanear la cédula de una pieza.',
    'cal.skipped.title': 'Ajustes estándar',
    'cal.skipped.help': 'Ya puede escanear la cédula de una pieza.',
    // Estados reales de calibración parcial o fallida (no un "done" falso).
    'cal.partial.title': 'Sincronización parcial',
    'cal.partial.help': 'Los gestos pueden fallar. Puede recalibrar desde Ayuda.',
    'cal.failed.title': 'No pudimos sincronizar',
    'cal.failed.help': 'Seguimos con los ajustes estándar. Puede recalibrar desde Ayuda.',
    'cal.skip': 'Usar ajustes estándar',
    'cal.seg1': 'Puño',
    'cal.seg2': 'Mano abierta',
    'cal.detected': 'Vemos su mano',
    'cal.notDetected': 'No vemos su mano',
    'cal.hint': 'Aleje un poco la mano o busque más luz.',

    'scan.title': 'Apunte a la cédula',
    'scan.sub': 'Encuádrela dentro de las esquinas.',
    'scan.help': '¿No la detectamos? Acérquese a unos 25 cm, evite los reflejos y espere un momento.',
    'scan.found.tag': 'Pieza reconocida',
    'scan.preparing': 'Preparando la pieza',
    'scan.appear': 'La pieza aparece',
    'scan.removeCedula': 'Puede retirar la cédula',
    // Reintento real: alejar la cédula y volver a apuntarla; el botón solo
    // devuelve a la vista de escaneo.
    'scan.errorLoad': 'No pudimos cargar "{name}". Aleje la cédula un momento y vuelva a apuntarla.',
    'scan.errorRetry': 'Escanear de nuevo',

    'ui.rescan': 'Escanear otra pieza',
    'ui.rescanConfirm': 'Se cerrará la conversación con esta pieza.',
    'ui.cancel': 'Cancelar',
    'ui.recenter': 'Traer al frente',
    'ui.help': 'Ayuda',
    'ui.helpGestures': 'Ayuda con los gestos',
    'ui.keyboard': 'Escribir una pregunta',
    'ui.sheet': 'Ver la ficha de la pieza',
    'ui.closeSheet': 'Cerrar ficha',
    'ui.ask': 'Preguntar sobre esta pieza',
    'ui.recalibrate': 'Recalibrar la mano',
    'caption.aria': 'Subtítulos de la conversación',

    'help.title': 'Guía rápida',
    'help.gestures': 'Puño: mover · Índice: girar · Índice y medio: inclinar · Índice y pulgar: escalar.',
    'help.recalibrate': 'Si los gestos no responden bien:',

    'ptt.idle': 'Mantenga para hablar',
    'ptt.listening': 'Escuchando',
    'ptt.thinking': 'Pensando',
    'ptt.speaking': 'Respondiendo',
    'ptt.aria': 'Mantenga presionado para hablar',
    // Soltó el botón antes de que la sesión abriera: el rótulo lo indica.
    'ptt.holdHint': 'Sostenga hasta ver Escuchando',

    // Rótulos por diagnóstico de error de voz (taxonomía en voiceAgent.js).
    'ptt.errMicDenied': 'Micrófono bloqueado',
    'ptt.errMicMissing': 'Sin micrófono',
    'ptt.errNetwork': 'Sin conexión',
    'ptt.errRateLimited': 'Espere un momento',
    'ptt.errSessionLost': 'Conexión cortada',
    'ptt.errUnknown': 'Error. Reintente.',

    // Mensaje completo (causa + recuperación) que se muestra en la franja
    // de la conversación. Cada fuente de error tiene su texto.
    'voice.err.micDenied': 'El micrófono está bloqueado para este sitio. Habilítelo y vuelva a intentar.',
    'voice.err.micMissing': 'No detectamos un micrófono. Puede escribir su pregunta con el teclado.',
    'voice.err.network': 'Sin conexión con la guía. Verifique el Wi-Fi del museo y vuelva a intentar.',
    'voice.err.rateLimited': 'Demasiadas consultas en poco tiempo. Espere un momento y vuelva a intentar.',
    'voice.err.sessionLost': 'La conversación se cortó. Mantenga presionado el botón de voz para continuar.',
    'voice.err.unknown': 'Algo falló en la conversación. Vuelva a intentar.',
    'mic.howto': 'Cómo permitir el micrófono',
    'mic.howtoText': 'En la barra de direcciones, toque el icono de candado o de ajustes y active el micrófono para este sitio. Luego mantenga presionado el botón de voz.',

    'caption.you': 'Usted:',
    'caption.typing': 'Está diciendo…',
    'caption.thinking': 'Pensando…',

    'keyboard.placeholder': 'Escriba su pregunta…',
    'keyboard.send': 'Enviar',

    'sheet.culture': 'Cultura',
    'sheet.period': 'Periodo',
    'sheet.material': 'Material',
    'sheet.origin': 'Procedencia',
    'sheet.inventory': 'Inventario',
    'sheet.invPrefix': 'Inv.',

    'gesture.move': 'Mover',
    'gesture.rotateY': 'Girar',
    'gesture.rotateX': 'Inclinar',
    'gesture.scale': 'Escalar',
    'gesture.rail': 'Gestos disponibles. El gesto en uso se anuncia como presionado.',

    'lang.label': 'Idioma',

    // --- Persona del guía de IA (la lee api/token.js, no se muestra) ---
    // {name} y {description} se interpolan server-side con el catálogo
    // curado. Al agregar un idioma a LOCALES, agregar su persona acá:
    // es lo único que hace falta para que el guía hable ese idioma.
    'guide.persona': [
      'Usted es el guía conversacional de una experiencia de Realidad Aumentada en un museo.',
      'En este momento el visitante tiene frente a su cámara el objeto "{name}".',
      'Contexto sobre este objeto (úselo como fuente de verdad): {description}',
      'Tiene acceso a búsqueda en internet: úselo cuando le pregunten algo sobre este objeto (o temas relacionados) que no esté cubierto en el contexto de arriba, o que requiera información actualizada.',
      'Esto es una conversación por VOZ: responda corto, claro y natural, sin listas ni formato de texto.',
      'Trate al visitante de usted, con un tono cordial y neutro, sin regionalismos.',
      'Si le preguntan algo sin relación con este objeto, responda brevemente y lleve la charla de vuelta al objeto.',
      'Responda siempre en español, salvo que el visitante le hable en otro idioma.'
    ].join(' ')
  },

  en: {
    'intro.step1': 'Point at the piece label',
    'intro.step2': 'The piece appears in front of you',
    'intro.step3': 'Move it with your hands and ask it',
    'intro.title': 'Every piece has a story. Ask it.',
    'intro.start': 'Start',
    'intro.privacy': 'We use your camera during the visit and your microphone only while you hold the voice button. We store no images or recordings; your questions are sent to the guide service so it can answer them.',

    'loading.title': 'Preparing the experience',
    'loading.camera': 'Camera',
    'loading.hands': 'Hand recognition',
    'loading.catalog': 'Gallery pieces',
    'loading.note': 'On slow Wi-Fi this can take a few seconds.',
    'loading.handsWarn': 'Gestures unavailable. You can continue with voice.',
    'loading.catalogWarn': 'Some pieces will download when you scan them.',

    'error.camera.title': 'We cannot use the camera',
    'error.camera.body': 'Allow camera access in your browser and try again.',
    'error.generic.title': 'Something went wrong',
    'error.generic.body': 'We could not start the experience. Try again in a moment.',
    'error.retry': 'Try again',
    'error.howto': 'How to allow the camera',
    'error.howtoText': 'In the address bar, tap the lock or settings icon and enable the camera for this site. Then tap Try again.',

    'cal.ready.title': 'Let’s sync your hand',
    'cal.ready.help': 'Two quick gestures, so the piece responds to your hand and no one else’s.',
    'cal.ready.start': 'Start calibration',
    'cal.fist.title': 'Close your fist',
    'cal.fist.help': 'Hold it in front of the camera, about 30 cm away.',
    'cal.open.title': 'Open your hand',
    'cal.open.help': 'Spread all five fingers and keep still.',
    'cal.done.title': 'Hand synced',
    'cal.done.help': 'You can now scan an object label.',
    'cal.skipped.title': 'Standard settings',
    'cal.skipped.help': 'You can now scan an object label.',
    'cal.partial.title': 'Partial sync',
    'cal.partial.help': 'Gestures may misread. You can recalibrate from Help.',
    'cal.failed.title': 'We could not sync',
    'cal.failed.help': 'Standard settings are in use. You can recalibrate from Help.',
    'cal.skip': 'Use standard settings',
    'cal.seg1': 'Fist',
    'cal.seg2': 'Open hand',
    'cal.detected': 'We can see your hand',
    'cal.notDetected': 'We can’t see your hand',
    'cal.hint': 'Move your hand a bit farther or find more light.',

    'scan.title': 'Point at the label',
    'scan.sub': 'Frame it inside the corners.',
    'scan.help': 'Not detecting it? Move closer, to about 25 cm, avoid glare and wait a moment.',
    'scan.found.tag': 'Piece recognized',
    'scan.preparing': 'Preparing the piece',
    'scan.appear': 'The piece appears',
    'scan.removeCedula': 'You can set the label aside',
    'scan.errorLoad': 'We could not load "{name}". Move the label away for a moment and point at it again.',
    'scan.errorRetry': 'Scan again',

    'ui.rescan': 'Scan another piece',
    'ui.rescanConfirm': 'The conversation with this piece will close.',
    'ui.cancel': 'Cancel',
    'ui.recenter': 'Bring it back',
    'ui.help': 'Help',
    'ui.helpGestures': 'Help with gestures',
    'ui.keyboard': 'Type a question',
    'ui.sheet': 'View the piece card',
    'ui.closeSheet': 'Close card',
    'ui.ask': 'Ask about this piece',
    'ui.recalibrate': 'Recalibrate hand',
    'caption.aria': 'Conversation captions',

    'help.title': 'Quick guide',
    'help.gestures': 'Fist: move · Index: rotate · Index + middle: tilt · Index + thumb: scale.',
    'help.recalibrate': 'If gestures feel off:',

    'ptt.idle': 'Hold to talk',
    'ptt.listening': 'Listening',
    'ptt.thinking': 'Thinking',
    'ptt.speaking': 'Answering',
    'ptt.aria': 'Press and hold to talk',
    // Released the button before the session opened: the label says so.
    'ptt.holdHint': 'Hold until you see Listening',

    'ptt.errMicDenied': 'Mic blocked',
    'ptt.errMicMissing': 'No microphone',
    'ptt.errNetwork': 'No connection',
    'ptt.errRateLimited': 'Wait a moment',
    'ptt.errSessionLost': 'Connection lost',
    'ptt.errUnknown': 'Error. Try again.',

    'voice.err.micDenied': 'The microphone is blocked for this site. Enable it and try again.',
    'voice.err.micMissing': 'We cannot find a microphone. You can type your question with the keyboard.',
    'voice.err.network': 'No connection to the guide. Check the museum Wi-Fi and try again.',
    'voice.err.rateLimited': 'Too many requests in a short time. Wait a moment and try again.',
    'voice.err.sessionLost': 'The conversation dropped. Hold the voice button to continue.',
    'voice.err.unknown': 'Something went wrong in the conversation. Try again.',
    'mic.howto': 'How to allow the microphone',
    'mic.howtoText': 'In the address bar, tap the lock or settings icon and enable the microphone for this site. Then hold the voice button again.',

    'caption.you': 'You:',
    'caption.typing': 'You are saying…',
    'caption.thinking': 'Thinking…',

    'keyboard.placeholder': 'Type your question…',
    'keyboard.send': 'Send',

    'sheet.culture': 'Culture',
    'sheet.period': 'Period',
    'sheet.material': 'Material',
    'sheet.origin': 'Origin',
    'sheet.inventory': 'Inventory',
    'sheet.invPrefix': 'No.',

    'gesture.move': 'Move',
    'gesture.rotateY': 'Rotate',
    'gesture.rotateX': 'Tilt',
    'gesture.scale': 'Scale',
    'gesture.rail': 'Available gestures. The gesture in use is announced as pressed.',

    'lang.label': 'Language',

    // --- AI guide persona (read by api/token.js, never displayed) ---
    'guide.persona': [
      'You are the conversational guide of an Augmented Reality museum experience.',
      'The visitor currently has the object "{name}" in front of their camera.',
      'Context about this object (use it as your source of truth): {description}',
      'You have access to internet search: use it when asked something about this object (or related topics) not covered in the context above, or that requires up-to-date information.',
      'This is a VOICE conversation: answer short, clear and natural, without lists or text formatting.',
      'Address the visitor courteously and professionally.',
      'If asked about something unrelated to this object, answer briefly and steer the conversation back to the object.',
      'Always respond in English, unless the visitor speaks to you in another language.'
    ].join(' ')
  }
};

// Idiomas soportados: única fuente de verdad. i18n.js y api/token.js
// derivan de acá (antes había una copia local `SUPPORTED` que podía
// desincronizarse de LOCALES).
export const SUPPORTED_LOCALES = Object.keys(LOCALES);

const SUPPORTED = SUPPORTED_LOCALES;
let current = 'es';

export function getLang() {
  return current;
}

// Interpolación: {clave} se reemplaza solo si existe en params; un marcador
// sin parámetro queda literal (fácil de detectar en revisión).
export function t(key, params) {
  const str = LOCALES[current]?.[key] ?? LOCALES.es[key] ?? key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (marker, name) =>
    params[name] !== undefined ? String(params[name]) : marker
  );
}

function detectInitialLang() {
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  if (urlLang && SUPPORTED.includes(urlLang)) return urlLang;
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return SUPPORTED.includes(nav) ? nav : 'es';
}

// Aplica el idioma al DOM estático marcado con data-i18n / data-i18n-attr.
function applyToDom() {
  document.documentElement.lang = current;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    });
  });
}

export function setLang(lang) {
  if (!SUPPORTED.includes(lang) || lang === current) {
    if (lang === current) applyToDom();
    return;
  }
  current = lang;
  applyToDom();
}

export function toggleLang() {
  setLang(current === 'es' ? 'en' : 'es');
}

export function initI18n() {
  current = detectInitialLang();
  applyToDom();
}

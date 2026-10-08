// ============================================================
// MOTION — sistema de animación "Luz de vitrina"
// ============================================================
// Cuatro capas:
//   1. Tokens CSS (tokens.css), leídos por JS con tokenMs/tokenEase:
//      una sola fuente de verdad para duraciones y curvas.
//   2. Primitivas DOM (WAAPI): reveal / conceal / stagger / swapText /
//      countTo / pulse / nudge / flow.
//   3. Tweens escalares (tween): valores sueltos (intensidad de una luz,
//      opacidad de un material) integrados al loop de render.
//   4. Poses 3D (settle / glide / exit), también integradas al loop
//      mediante updatePoses().
// Ley de rendimiento: solo transform y opacity (con la excepción de
// clip-path en flow({box:true}), solo en cambios de estado).
// La inercia de los gestos vive en gestureControl.js (necesita los
// límites y la semántica de cada gesto).

import * as THREE from 'three';

// --- Accesibilidad ---

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

export function prefersReducedMotion() {
  return REDUCED_MOTION.matches;
}

// --- Tokens leídos desde CSS ---
// Se leen perezosamente (la hoja de estilos se inyecta después de evaluar
// los módulos) y solo se cachean si el valor es válido.

const tokenCache = new Map();

function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// '480ms' | '0.48s' → milisegundos. Sin token válido, el fallback.
export function tokenMs(name, fallback) {
  if (tokenCache.has(name)) return tokenCache.get(name);

  const raw = readToken(name);
  let ms = Number.NaN;
  if (raw.endsWith('ms')) ms = Number.parseFloat(raw);
  else if (raw.endsWith('s')) ms = Number.parseFloat(raw) * 1000;

  if (Number.isNaN(ms)) return fallback;
  tokenCache.set(name, ms);
  return ms;
}

export function tokenEase(name, fallback) {
  if (tokenCache.has(name)) return tokenCache.get(name);

  const raw = readToken(name);
  if (!raw) return fallback;
  tokenCache.set(name, raw);
  return raw;
}

// Fallbacks idénticos a tokens.css (solo se usan si el token no resuelve).
const EASE_REVEAL = 'cubic-bezier(.22, 1, .36, 1)';
const EASE_EXIT = 'cubic-bezier(.55, 0, .7, .4)';

const easeReveal = () => tokenEase('--ease-reveal', EASE_REVEAL);
const easeExit = () => tokenEase('--ease-exit', EASE_EXIT);

// --- Primitivas DOM (WAAPI) ---
// Registro por elemento: una primitiva nueva cancela a la anterior y los
// callbacks vencidos no aplican efectos. [hidden] se aplica recién al
// terminar las salidas.

const domAnims = new WeakMap();

function supersede(el, anim) {
  domAnims.get(el)?.cancel();
  domAnims.set(el, anim);
  return anim;
}

// --- Reacomodo fluido del layout (FLIP) ---
// Cuando un texto o panel EN FLUJO aparece, desaparece o cambia de alto,
// sus hermanos saltarían a su nuevo lugar en un frame. flow() mide a los
// hijos directos del contenedor antes y después del cambio y los desliza
// desde donde estaban. Solo transform, con composite 'add': se suma a
// cualquier otra animación o transform propio, sin pisarlos.
//   box: además "crece" el propio contenedor (paneles con fondo, anclados
//   abajo o arriba) con un clip-path que se abre. Es la única animación
//   fuera de transform/opacity, y solo corre en cambios de estado.

const flowAnims = new WeakMap();
const boxAnims = new WeakMap();

export function flow(container, mutate, { dur = 340, box = false } = {}) {
  if (!container || prefersReducedMotion() || container.getClientRects().length === 0) {
    mutate();
    return;
  }

  const children = Array.from(container.children);
  const before = new Map();
  children.forEach((child) => {
    if (child.getClientRects().length) before.set(child, child.getBoundingClientRect());
  });
  const boxBefore = box ? container.getBoundingClientRect() : null;

  // Se mide antes de cancelar: la posición "visual" incluye un deslizamiento
  // en curso, y el nuevo arranca desde ahí (sin saltos al encadenar).
  children.forEach((child) => {
    flowAnims.get(child)?.cancel();
    flowAnims.delete(child);
  });
  if (box) {
    boxAnims.get(container)?.cancel();
    boxAnims.delete(container);
  }

  mutate();

  const easing = easeReveal();

  before.forEach((rectBefore, child) => {
    if (!child.isConnected || child.getClientRects().length === 0) return;

    const rectAfter = child.getBoundingClientRect();
    const dx = rectBefore.left - rectAfter.left;
    const dy = rectBefore.top - rectAfter.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    const anim = child.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
      { duration: dur, easing, composite: 'add' }
    );
    flowAnims.set(child, anim);
    anim.onfinish = () => {
      if (flowAnims.get(child) === anim) flowAnims.delete(child);
    };
  });

  if (box) {
    const boxAfter = container.getBoundingClientRect();
    const clipTop = Math.max(0, boxBefore.top - boxAfter.top);
    const clipBottom = Math.max(0, boxAfter.bottom - boxBefore.bottom);

    if (clipTop > 0.5 || clipBottom > 0.5) {
      const anim = container.animate(
        [
          { clipPath: `inset(${clipTop}px 0px ${clipBottom}px 0px round 16px)` },
          { clipPath: 'inset(0px 0px 0px 0px round 16px)' }
        ],
        { duration: dur, easing }
      );
      boxAnims.set(container, anim);
      anim.onfinish = () => {
        if (boxAnims.get(container) === anim) boxAnims.delete(container);
      };
    }
  }
}

// Solo los elementos en flujo desplazan a sus hermanos: uno absolute/fixed
// no mueve a nadie y se salta la medición.
function flowAround(el, mutate, opts) {
  const position = getComputedStyle(el).position;
  if (el.parentElement && position !== 'absolute' && position !== 'fixed') {
    flow(el.parentElement, mutate, opts);
  } else {
    mutate();
  }
}

// --- reveal / conceal ---
// Todo nace de su origen. `origin` elige el punto de partida:
//   'trigger' → popover que nace de su botón: escala .96 → 1, sin viaje.
//   'bottom'  → sube desde abajo (rise 12).
//   'top'     → baja desde arriba (rise -12).
// Se puede afinar con rise / dx (px) / scale; lo explícito gana al preset.

const ORIGINS = {
  trigger: { rise: 0, scale: 0.96 },
  bottom: { rise: 12, scale: 1 },
  top: { rise: -12, scale: 1 }
};

function resolveOffset(opts, defaultRise) {
  const preset = ORIGINS[opts.origin] ?? {};
  return {
    rise: opts.rise ?? preset.rise ?? defaultRise,
    dx: opts.dx ?? 0,
    scale: opts.scale ?? preset.scale ?? 1
  };
}

const offsetTransform = ({ rise, dx, scale }) =>
  `translate(${dx}px, ${rise}px) scale(${scale})`;

// Aparición. Idempotente: segura ante llamadas repetidas o por frame. Si
// el elemento está en flujo, sus hermanos se deslizan a su nuevo lugar
// (box: el panel contenedor también crece).
export function reveal(el, opts = {}) {
  if (!el) return;

  const { delay = 0, box = false } = opts;
  const dur = opts.dur ?? tokenMs('--dur-base', 320);
  const offset = resolveOffset(opts, 12);

  const pending = domAnims.get(el);
  if (pending) {
    if (!el.hidden && pending.__kind === 'reveal') return; // ya entrando
    pending.cancel();
  }

  const wasHidden = el.hidden;
  if (wasHidden) {
    flowAround(el, () => { el.hidden = false; }, { box });
  } else {
    el.hidden = false;
  }
  if (prefersReducedMotion() || !wasHidden) return; // visible: sin movimiento

  const anim = el.animate(
    [{ opacity: 0, transform: offsetTransform(offset) }, { opacity: 1, transform: 'none' }],
    { duration: dur, delay, easing: easeReveal() }
  );
  anim.__kind = 'reveal';
  domAnims.set(el, anim);
}

// Salida: más corta y acelerando; [hidden] recién al terminar. Si algo la
// cancela, el elemento queda visible (nunca un ocultado zombie).
export function conceal(el, opts = {}) {
  if (!el || el.hidden) return;

  const { delay = 0, box = false } = opts;
  const dur = opts.dur ?? tokenMs('--dur-quick', 180);
  const offset = resolveOffset(opts, 8);

  const pending = domAnims.get(el);
  if (pending) {
    if (pending.__kind === 'conceal') return; // ya saliendo
    pending.cancel();
  }

  if (prefersReducedMotion()) {
    el.hidden = true;
    return;
  }

  const anim = el.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: offsetTransform(offset) }],
    { duration: dur, delay, easing: easeExit(), fill: 'forwards' }
  );
  anim.__kind = 'conceal';
  domAnims.set(el, anim);

  anim.onfinish = () => {
    if (domAnims.get(el) !== anim) return; // reemplazada mientras salía
    // El [hidden] libera el espacio: los hermanos se deslizan a su lugar
    // en vez de saltar.
    flowAround(el, () => { el.hidden = true; }, { box });
    anim.cancel();
  };
}

// --- stagger ---
// Cascada declarativa sobre elementos YA visibles (chips, filas de la
// ficha). Cada item puede ser un elemento o un grupo [dt, dd] que entra
// junto. Con reduced motion solo conserva el fundido de opacidad.
// No usa el registro de domAnims: no compite con reveal/conceal.

export function stagger(items, { step, delay = 0, rise = 10, dx = 0, dur } = {}) {
  if (!items?.length) return;

  const stepMs = step ?? tokenMs('--stagger', 60);
  const duration = dur ?? tokenMs('--dur-base', 320);
  const easing = easeReveal();
  const reduced = prefersReducedMotion();

  items.forEach((item, index) => {
    const group = Array.isArray(item) ? item : [item];
    group.forEach((el) => {
      if (!el || el.hidden) return;
      const from = reduced
        ? { opacity: 0 }
        : { opacity: 0, transform: `translate(${dx}px, ${rise}px)` };
      const to = reduced ? { opacity: 1 } : { opacity: 1, transform: 'none' };
      el.animate([from, to], {
        duration,
        delay: delay + index * stepMs,
        easing,
        fill: 'backwards'
      });
    });
  });
}

// Cambio de texto con micro fundido (rótulos de estado, idioma).
export function swapText(el, text, { durOut = 110, durIn = 170 } = {}) {
  if (!el || el.textContent === text) return;
  domAnims.get(el)?.cancel();

  if (prefersReducedMotion()) {
    el.textContent = text;
    return;
  }

  const out = el.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: durOut, easing: easeExit(), fill: 'forwards' }
  );
  supersede(el, out);

  out.onfinish = () => {
    // Si el texto nuevo ocupa otro alto, lo que lo rodea se desliza.
    flowAround(el, () => { el.textContent = text; });
    const inn = el.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: durIn, easing: easeReveal(), fill: 'forwards' }
    );
    supersede(el, inn);
  };
}

// Cambio de texto con fundido y aparición de abajo hacia arriba.
// Sale con fade-out (opacidad) y el texto nuevo entra con fade-in subiendo
// desde `rise` px más abajo. A diferencia de swapText, NO usa flow(): los
// hermanos no se deslizan al cambiar el alto del texto.
// Si el elemento está vacío u oculto no hay nada que despedir: solo entra.
export function swapTextRise(el, text, { durOut = 140, durIn = 420, rise = 14, delay = 0 } = {}) {
  if (!el || el.textContent === text) return;
  domAnims.get(el)?.cancel();

  const reduced = prefersReducedMotion();

  const enter = () => {
    el.textContent = text;
    const from = reduced
      ? { opacity: 0 }
      : { opacity: 0, transform: `translateY(${rise}px)` };
    const to = reduced
      ? { opacity: 1 }
      : { opacity: 1, transform: 'translateY(0)' };
    // fill 'backwards': oculto durante el delay, y al terminar se libera.
    const inn = el.animate([from, to], {
      duration: durIn,
      delay,
      easing: easeReveal(),
      fill: 'backwards'
    });
    supersede(el, inn);
  };

  // Primera aparición (vacío) o sin layout: solo entrada.
  if (!el.textContent || el.getClientRects().length === 0) {
    enter();
    return;
  }

  const out = el.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: durOut, easing: easeExit(), fill: 'forwards' }
  );
  supersede(el, out);

  out.onfinish = () => {
    if (domAnims.get(el) !== out) return; // reemplazada mientras salía
    enter();
  };
}

// Conteo numérico con asentado (porcentaje del arranque). Un conteo nuevo
// congela el anterior y arranca desde donde quedó.
export function countTo(el, target, { dur = 380, suffix = '%' } = {}) {
  if (!el) return;
  const from = Number.parseInt(el.textContent, 10) || 0;

  if (prefersReducedMotion() || from === target) {
    el.textContent = target + suffix;
    return;
  }

  const start = performance.now();
  let cancelled = false;
  const token = { __kind: 'count', cancel: () => { cancelled = true; } };
  supersede(el, token);

  const step = () => {
    if (cancelled || domAnims.get(el) !== token) return;
    const p = Math.min((performance.now() - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cúbico
    el.textContent = Math.round(from + (target - from) * eased) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

// Un único latido de escala (confirmaciones: anillo completo, primera
// mano detectada). Composite 'add': se suma al transform propio del
// elemento (p. ej. la presión :active) sin pisarlo.
const pulseAnims = new WeakMap();

export function pulse(el, { scale = 1.08, dur = 420 } = {}) {
  if (!el || prefersReducedMotion()) return;
  pulseAnims.get(el)?.cancel();

  const anim = el.animate(
    [
      { transform: 'scale(1)' },
      { transform: `scale(${scale})`, offset: 0.4 },
      { transform: 'scale(1)' }
    ],
    { duration: dur, easing: easeReveal(), composite: 'add' }
  );
  pulseAnims.set(el, anim);
  anim.onfinish = () => {
    if (pulseAnims.get(el) === anim) pulseAnims.delete(el);
  };
}

// Sacudida contenida para errores. Registro propio: puede latir sobre un
// reveal en curso sin matarlo (solo toma el canal transform, en 'add').
const nudgeAnims = new WeakMap();

export function nudge(el, { dur = 340, distance = 3 } = {}) {
  if (!el || prefersReducedMotion()) return;
  nudgeAnims.get(el)?.cancel();

  const anim = el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: `translateX(${-distance}px)` },
      { transform: `translateX(${distance}px)` },
      { transform: 'translateX(-1px)' },
      { transform: 'translateX(0)' }
    ],
    { duration: dur, easing: 'ease-out', composite: 'add' }
  );
  nudgeAnims.set(el, anim);
}

// --- Tweens escalares ---
// Para valores sueltos que no son transform de un Object3D: la intensidad
// de una luz, la opacidad del material de una sombra. Se integran en
// updatePoses() con el mismo dt (con techo) que las poses. Un tween nuevo
// con la misma `key` reemplaza al anterior.
//   tween(key, { from, to, dur, delay, ease: 'out'|'in'|'inOut', apply, onDone })

const tweens = new Map(); // key -> estado

const TWEEN_EASE = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
};

export function tween(key, { from, to, dur = 400, delay = 0, ease = 'out', apply, onDone = null }) {
  if (!key || typeof apply !== 'function') return;

  if (prefersReducedMotion()) {
    tweens.delete(key);
    apply(to);
    onDone?.();
    return;
  }

  // Se aplica el valor inicial de inmediato: sin destello durante el delay.
  apply(from);
  tweens.set(key, {
    from,
    to,
    dur: dur / 1000,
    delay: delay / 1000,
    ease: TWEEN_EASE[ease] ?? TWEEN_EASE.out,
    apply,
    onDone,
    elapsed: 0
  });
}

function stepTween(key, state, dt) {
  state.elapsed += dt;
  if (state.elapsed < state.delay) return;

  const t = Math.min((state.elapsed - state.delay) / state.dur, 1);
  state.apply(state.from + (state.to - state.from) * state.ease(t));

  if (t >= 1) {
    tweens.delete(key);
    state.onDone?.();
  }
}

// --- Poses 3D ---
// Tres modos:
//   settle: asentado exponencial (k = 1 - exp(-dt/tau)), sin duración
//     fija; snap cuando lo que queda es sub-píxel. Materialización, ficha.
//   glide: duración fija con ease-in-out cúbico. Centrado: su final
//     coordina la coreografía de la sección 4.
//   exit: salida acelerando (ease-in cuadrático). Retiro al re-escanear.
// Una pose nueva reemplaza a la anterior retomando desde el estado actual.

const EPS_REL = 0.01;  // queda menos del 1% del viaje: snap y listo
const EPS_POS_ABS = 0.5; // unidades de cámara: sub-píxel a esa distancia
const EPS_SCALE_ABS = 0.0005;
const EPS_QUAT_ANGLE = 0.002; // radianes

const poses = new Map(); // Object3D -> estado de la pose activa

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInQuad(t) {
  return t * t;
}

// target: { position?: Vector3, quaternion?: Quaternion, scale?: number }
// opts:   { mode?: 'settle'|'glide'|'exit', tau?, duration?, onArrive? }
export function pose(object, target, opts = {}) {
  if (!object) return;

  const {
    mode = 'settle',
    tau = 0.16,
    duration = 300,
    onArrive = null
  } = opts;

  const state = {
    mode,
    tau,
    duration: duration / 1000,
    onArrive,
    // Objetivos clonados: nada del catálogo debe mutarse.
    position: target.position ? target.position.clone() : null,
    quaternion: target.quaternion ? target.quaternion.clone() : null,
    scale: typeof target.scale === 'number' ? target.scale : null,
    startPosition: object.position.clone(),
    startQuaternion: object.quaternion.clone(),
    startScale: object.scale.x,
    // Distancias iniciales por canal (umbral relativo de llegada).
    posDist: target.position ? object.position.distanceTo(target.position) : 0,
    quatAngle: target.quaternion
      ? 2 * Math.acos(Math.min(1, Math.abs(object.quaternion.dot(target.quaternion))))
      : 0,
    scaleDist: typeof target.scale === 'number' ? Math.abs(object.scale.x - target.scale) : 0,
    progress: 0
  };

  if (prefersReducedMotion()) {
    // Sin movimiento: aplicar y avisar de inmediato.
    arrive(object, state);
    return;
  }

  poses.set(object, state);
}

export function cancelPose(object) {
  poses.delete(object);
}

export function isPosing(object) {
  return object ? poses.has(object) : false;
}

function snapToTarget(object, state) {
  if (state.position) object.position.copy(state.position);
  if (state.quaternion) {
    object.quaternion.copy(state.quaternion);
    // Sin esto, la descomposición quaternión→Euler deja una representación
    // equivalente pero distinta a la de destino.
    object.rotation.setFromQuaternion(state.quaternion);
  }
  if (typeof state.scale === 'number') object.scale.setScalar(state.scale);
}

function arrive(object, state) {
  poses.delete(object);
  snapToTarget(object, state);
  if (state.onArrive) state.onArrive();
}

function settleStep(object, state, dt) {
  const k = 1 - Math.exp(-dt / state.tau);

  if (state.position) object.position.lerp(state.position, k);
  if (state.quaternion) object.quaternion.slerp(state.quaternion, k);
  if (typeof state.scale === 'number') {
    object.scale.setScalar(THREE.MathUtils.lerp(object.scale.x, state.scale, k));
  }

  // Umbral por canal: el mayor entre el sub-píxel absoluto y el 1% del viaje.
  if (state.position) {
    const threshold = Math.max(EPS_POS_ABS, EPS_REL * state.posDist);
    if (object.position.distanceTo(state.position) > threshold) return;
  }

  if (state.quaternion) {
    const angle = 2 * Math.acos(Math.min(1, Math.abs(object.quaternion.dot(state.quaternion))));
    if (angle > Math.max(EPS_QUAT_ANGLE, EPS_REL * state.quatAngle)) return;
  }

  if (typeof state.scale === 'number') {
    const threshold = Math.max(EPS_SCALE_ABS, EPS_REL * state.scaleDist);
    if (Math.abs(object.scale.x - state.scale) > threshold) return;
  }

  arrive(object, state);
}

function timedStep(object, state, dt) {
  state.progress = Math.min(state.progress + dt / state.duration, 1);
  const eased = state.mode === 'exit' ? easeInQuad(state.progress) : easeInOutCubic(state.progress);

  if (state.position) {
    object.position.lerpVectors(state.startPosition, state.position, eased);
  }
  if (state.quaternion) {
    object.quaternion.slerpQuaternions(state.startQuaternion, state.quaternion, eased);
  }
  if (typeof state.scale === 'number') {
    object.scale.setScalar(
      THREE.MathUtils.lerp(state.startScale, state.scale, eased)
    );
  }

  if (state.progress >= 1) arrive(object, state);
}

// Una vez por frame desde el loop de render (main.js). dt con techo de
// 50ms para no saltar tras un tab en segundo plano. Integra poses y
// tweens con el mismo dt.
let lastFrameTime = null;

export function updatePoses() {
  const now = performance.now();

  if (poses.size === 0 && tweens.size === 0) {
    lastFrameTime = now;
    return;
  }

  const dt = lastFrameTime === null ? 0.016 : Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  for (const [object, state] of poses) {
    if (state.mode === 'settle') settleStep(object, state, dt);
    else timedStep(object, state, dt); // glide / exit
  }

  for (const [key, state] of tweens) {
    stepTween(key, state, dt);
  }
}

// ============================================================
// VOICE AGENT — IA conversacional (Gemini Live API)
// ============================================================
// Flujo:
//   1. sessionManager llama a setActiveObject/clearActiveObject según el
//      ciclo de vida de la pieza.
//   2. startTalking (pointerdown): prepara audio y micrófono SÍNCRONO
//      dentro del gesto (iOS/Safari) y abre la sesión Live si hace falta.
//   3. stopTalking (pointerup): corta el micrófono y manda activityEnd;
//      la respuesta se reproduce en streaming.
// Claves de robustez: isHolding/talkSequence evitan micrófonos huérfanos
// al soltar durante la conexión; intentionallyClosed evita que el
// onclose/onerror de una sesión vieja pise la sesión nueva.

import { GoogleGenAI, Modality } from '@google/genai';
import { PCMPlayer } from './audio/pcmPlayer.js';
import { getLang } from './i18n.js';
import { TOKEN_FETCH_TIMEOUT_MS, LIVE_CONNECT_TIMEOUT_MS } from './config.js';

// El modelo lo define api/token.js y viaja en la respuesta (el token
// bloquea ese modelo server-side).

// El worklet se sirve desde /public por path fijo: un new URL(...)
// puede ser convertido por Vite en data: URL, y addModule() falla con eso.
const RECORDER_WORKLET_URL = '/pcm-recorder-worklet.js';

export const VoiceState = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  ERROR: 'error'
};

// Diagnóstico del error de voz: cada fuente tiene causa y recuperación
// propias en la UI (claves voice.err.* de i18n).
export const VoiceErrorDetail = {
  MIC_DENIED: 'micDenied',
  MIC_MISSING: 'micMissing',
  NETWORK: 'network',
  RATE_LIMITED: 'rateLimited',
  SESSION_LOST: 'sessionLost',
  UNKNOWN: 'unknown'
};

// classifyError lo mapea a NETWORK en vez del genérico.
class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

// Carrera contra un techo de espera. La promesa no se cancela; el caller
// decide qué hacer con una resolución tardía (ver openSession).
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Clasifica cualquier error del camino de voz a la taxonomía de arriba:
// el visitante no abre DevTools, necesita causa + recuperación.
function classifyError(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return VoiceErrorDetail.MIC_DENIED;
  if (
    err?.name === 'NotFoundError' ||
    err?.name === 'NotReadableError' ||
    err?.name === 'OverconstrainedError' ||
    // AudioContext con sampleRate no soportado: sin micrófono útil → teclado.
    err?.name === 'NotSupportedError'
  ) {
    return VoiceErrorDetail.MIC_MISSING;
  }
  if (err?.status === 429) return VoiceErrorDetail.RATE_LIMITED;
  // fetch() falla de red con TypeError; el endpoint marca status en el Error.
  if (err instanceof TypeError) return VoiceErrorDetail.NETWORK;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return VoiceErrorDetail.NETWORK;
  if (typeof err?.status === 'number' && err.status >= 500) return VoiceErrorDetail.NETWORK;
  return VoiceErrorDetail.UNKNOWN;
}

let state = VoiceState.IDLE;
let stateDetail = null; // diagnóstico; solo vive en ERROR
let onStateChange = null;
let onTranscript = null;
let onHoldHint = null;

function setState(next, detail = null) {
  state = next;
  stateDetail = next === VoiceState.ERROR ? detail ?? VoiceErrorDetail.UNKNOWN : null;
  if (onStateChange) onStateChange(state, stateDetail);
}

function emitTranscript(payload) {
  if (onTranscript) onTranscript(payload);
}

// Objeto actualmente invocado (según catalog.js).
let activeEntry = null;

// Sesión Live + a qué objeto corresponde.
let liveSession = null;
let liveSessionObjectId = null;

// Sesiones cerradas a propósito: su onclose/onerror tardío se ignora.
const intentionallyClosed = new WeakSet();

// ¿El usuario sigue apretando? + contador que invalida startTalking viejos.
let isHolding = false;
let talkSequence = 0;

// Grabación a 16 kHz: contexto y stream se crean una vez y se reusan.
let recordContext = null;
let workletLoaded = false;
let recorderNode = null;
let micStream = null;
let micSourceNode = null;

const player = new PCMPlayer();

player.onPlaybackEnd = () => {
  if (state === VoiceState.SPEAKING) setState(VoiceState.IDLE);
};

// --- API pública ---

export function initVoiceAgent({ onStateChange: stateCallback, onTranscript: transcriptCallback, onHoldHint: holdHintCallback } = {}) {
  onStateChange = stateCallback ?? null;
  onTranscript = transcriptCallback ?? null;
  onHoldHint = holdHintCallback ?? null;

  // Reflejar el estado inicial (IDLE) en la UI.
  if (onStateChange) onStateChange(state);
}

// Precalienta el AudioContext de reproducción dentro del gesto inicial
// ("Comenzar"), para que la primera respuesta no arranque suspendido (iOS).
export function warmUpAudio() {
  player.unlock();
}

// Al volver del segundo plano los AudioContext quedan suspendidos (o
// "interrupted" en iOS). Sin gesto el navegador puede negarse; en ese caso
// el próximo PTT los reactiva (startTalking llama a unlock/prepareMic).
export function resumeAudio() {
  player.unlock();
  if (recordContext && recordContext.state !== 'running' && recordContext.state !== 'closed') {
    recordContext.resume().catch(() => {});
  }
}

export function getVoiceState() {
  return state;
}

export function getVoiceErrorDetail() {
  return stateDetail;
}

export function setActiveObject(entry) {
  if (activeEntry?.id === entry.id) return;

  activeEntry = entry;

  // Sesión de OTRO objeto: se cierra; la próxima charla abre una nueva
  // con el contexto correcto.
  if (liveSession && liveSessionObjectId !== entry.id) {
    closeSession();
  }
}

export function clearActiveObject() {
  activeEntry = null;
  isHolding = false;
  talkSequence++; // invalida startTalking pendientes
  stopMicCapture();
  // Se cierra el micrófono de verdad: no queda capturando audio durante el
  // resto de la visita (indicador de grabación encendido, dispositivo
  // tomado). La próxima charla lo vuelve a pedir dentro del gesto.
  releaseMic();
  flushTranscript('user');
  flushTranscript('model');
  closeSession();
  setState(VoiceState.IDLE);
}

// Pointerdown del walkie-talkie.
export async function startTalking() {
  if (!activeEntry) {
    console.warn('No hay objeto activo: no se puede hablar todavía.');
    return;
  }

  if (state === VoiceState.LISTENING) return;

  isHolding = true;

  // Si ya estaba conectando, solo registra que sigue apretando.
  if (state === VoiceState.CONNECTING) return;

  const sequence = ++talkSequence;
  const entry = activeEntry;

  // Barge-in: cortar a la IA si estaba hablando.
  if (player.isPlaying) player.stopAndClear();

  // Hasta el primer await corre dentro del gesto del usuario (iOS).
  player.unlock();
  const micReady = prepareMic();

  setState(VoiceState.CONNECTING);

  try {
    const needsSession = !liveSession || liveSessionObjectId !== entry.id;
    const sessionReady = needsSession ? openSession(entry) : Promise.resolve();

    await Promise.all([sessionReady, micReady]);
  } catch (err) {
    console.error('Error iniciando la escucha:', err);
    if (sequence === talkSequence) {
      stopMicCapture();
      setState(VoiceState.ERROR, classifyError(err));
    }
    return;
  }

  // Un intento más nuevo (o clearActiveObject) tomó el control.
  if (sequence !== talkSequence) return;

  // Soltó el botón mientras conectaba, o cambió de objeto: no abrir el mic.
  if (!isHolding || activeEntry?.id !== entry.id) {
    setState(VoiceState.IDLE);
    // La pregunta se esfumó sin señal: el rótulo lo avisa una vez.
    if (!isHolding && onHoldHint) onHoldHint();
    return;
  }

  // Sin sesión no hay nada que capturar: se informa la causa real
  // (sesión perdida) en vez de un error genérico.
  attachRecorderIfSessionAlive();
}

// Arranca la captura solo si hay una sesión usable. liveSession puede
// haber quedado en null durante el await de la conexión, o haberse
// cerrado por onclose justo antes. Capturar audio sin sesión es un fallo
// silencioso (el visitante habla y no pasa nada): se reporta como error
// explícito en vez de ignorarlo.
function attachRecorderIfSessionAlive() {
  if (!liveSession) {
    setState(VoiceState.ERROR, VoiceErrorDetail.SESSION_LOST);
    return;
  }

  attachRecorder();
  safeSend({ activityStart: {} });
  setState(VoiceState.LISTENING);
}

// Entrada de texto: misma sesión Live, sin micrófono ni presión sostenida.
export async function sendText(text) {
  if (!activeEntry) {
    console.warn('[voiceAgent] sendText sin objeto activo.');
    return false;
  }
  if (!text?.trim()) return false;
  if (player.isPlaying) player.stopAndClear();

  try {
    if (!liveSession || liveSessionObjectId !== activeEntry.id) {
      setState(VoiceState.CONNECTING);
      await openSession(activeEntry);
    }
  } catch (err) {
    console.error('[voiceAgent] No se pudo abrir la sesión para texto:', err);
    setState(VoiceState.ERROR, classifyError(err));
    return false;
  }

  emitTranscript({ role: 'user', text: text.trim(), final: true });

  // La sesión pudo cerrarse durante el await de openSession (onclose la
  // deja en null). Sin esta guarda, un TypeError acá se clasificaría como
  // NETWORK y la UI culparía al Wi-Fi del museo.
  if (!liveSession) {
    setState(VoiceState.ERROR, VoiceErrorDetail.SESSION_LOST);
    return false;
  }

  try {
    liveSession.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: text.trim() }] }],
      turnComplete: true
    });
  } catch (err) {
    console.error('[voiceAgent] No se pudo enviar el texto:', err);
    setState(VoiceState.ERROR, classifyError(err));
    return false;
  }

  setState(VoiceState.PROCESSING);
  return true;
}

// Pointerup/pointercancel del walkie-talkie.
export function stopTalking() {
  isHolding = false;

  // Si sigue CONNECTING, startTalking() lo detecta vía isHolding.
  if (state !== VoiceState.LISTENING) return;

  stopMicCapture();

  if (liveSession) safeSend({ activityEnd: {} });

  setState(VoiceState.PROCESSING);
}

// --- Sesión de Live API ---

async function fetchEphemeralToken(objectId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // El idioma viaja con el pedido: el systemInstruction se arma
      // server-side en ese idioma.
      body: JSON.stringify({ objectId, locale: getLang() }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      // El status viaja en el Error para classifyError.
      const err = new Error(body.error || `Token request failed: ${response.status}`);
      err.status = response.status;
      throw err;
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function openSession(entry) {
  // Nunca dos sesiones vivas a la vez.
  if (liveSession) closeSession();

  const { token, model } = await fetchEphemeralToken(entry.id);

  if (!token || !model) {
    throw new Error('Respuesta de /api/token incompleta (falta token o model).');
  }

  // Los tokens efímeros solo funcionan con v1alpha.
  const ai = new GoogleGenAI({
    apiKey: token,
    httpOptions: { apiVersion: 'v1alpha' }
  });

  let thisSession = null;

  const isStale = () =>
    thisSession !== null && (intentionallyClosed.has(thisSession) || liveSession !== thisSession);

  // Techo de conexión: un WebSocket que no abre dejaría CONNECTING eterno.
  // Si abre tarde, se cierra y se marca intencional para que sus callbacks
  // no pisen el estado ya recuperado.
  const connectPromise = ai.live.connect({
    model,
    config: {
      // El resto (systemInstruction, VAD manual, transcripciones, tools)
      // viene bloqueado dentro del token, server-side.
      responseModalities: [Modality.AUDIO]
    },
    callbacks: {
      onopen: () => console.log('[voiceAgent] Sesión Live abierta.'),
      onmessage: (message) => {
        if (isStale()) return;
        handleServerMessage(message);
      },
      onerror: (e) => {
        if (isStale()) return;
        console.error('[voiceAgent] Error de Live API:', e?.message ?? e);
        stopMicCapture();
        setState(VoiceState.ERROR, VoiceErrorDetail.SESSION_LOST);
      },
      onclose: (e) => {
        if (isStale()) return;

        console.log('[voiceAgent] Sesión Live cerrada:', e?.reason ?? '');

        const wasMidConversation = state !== VoiceState.IDLE;

        liveSession = null;
        liveSessionObjectId = null;
        stopMicCapture();

        if (wasMidConversation) setState(VoiceState.ERROR, VoiceErrorDetail.SESSION_LOST);
      }
    }
  });

  try {
    thisSession = await withTimeout(
      connectPromise,
      LIVE_CONNECT_TIMEOUT_MS,
      'Live API tardó demasiado en conectar'
    );
  } catch (err) {
    // La conexión puede abrir después del timeout: cerrarla en el acto.
    connectPromise
      .then((lateSession) => {
        thisSession = lateSession;
        intentionallyClosed.add(lateSession);
        try {
          lateSession.close();
        } catch {
          // ya puede estar cerrada
        }
      })
      .catch(() => {});

    // CRÍTICO: no dejar una sesión muerta publicada como viva.
    // En este punto liveSession solo puede estar poblada por la resolución
    // tardía de arriba (openSession ya cerró cualquier sesión previa al
    // entrar). Su onclose llega con la sesión dentro de intentionallyClosed,
    // así que isStale() lo descarta y NADIE limpia liveSession: el cliente
    // reutilizaría un WebSocket cerrado y el micrófono grabaría al vacío
    // mientras la UI dice "Escuchando". Se limpia acá, en el origen.
    liveSession = null;
    liveSessionObjectId = null;

    throw err;
  }

  liveSession = thisSession;
  liveSessionObjectId = entry.id;
}

function closeSession() {
  const session = liveSession;

  // Desreferenciar y marcar intencional antes de cerrar: el onclose
  // asíncrono no pisa a una sesión nueva ni dispara ERROR.
  liveSession = null;
  liveSessionObjectId = null;

  if (session) {
    intentionallyClosed.add(session);
    try {
      session.close();
    } catch {
      // ya puede estar cerrada
    }
  }

  player.stopAndClear();
}

function safeSend(payload) {
  if (!liveSession) return;
  try {
    liveSession.sendRealtimeInput(payload);
  } catch (err) {
    console.warn('[voiceAgent] No se pudo enviar (¿sesión ya cerrada?):', err);
  }
}

// Transcripciones en vivo: llegan por tramos; se acumulan por rol y se
// confirman al completarse el turno.
let inputTranscriptBuffer = '';
let outputTranscriptBuffer = '';

function flushTranscript(role) {
  if (role === 'user' && inputTranscriptBuffer) {
    emitTranscript({ role: 'user', text: inputTranscriptBuffer, final: true });
    inputTranscriptBuffer = '';
  }
  if (role === 'model' && outputTranscriptBuffer) {
    emitTranscript({ role: 'model', text: outputTranscriptBuffer, final: true });
    outputTranscriptBuffer = '';
  }
}

function handleServerMessage(message) {
  const content = message.serverContent;
  if (!content) return;

  if (content.interrupted) {
    player.stopAndClear();
    flushTranscript('model');
    return;
  }

  if (content.inputTranscription?.text) {
    inputTranscriptBuffer += content.inputTranscription.text;
    emitTranscript({ role: 'user', text: inputTranscriptBuffer, final: false });
  }

  if (content.outputTranscription?.text) {
    outputTranscriptBuffer += content.outputTranscription.text;
    emitTranscript({ role: 'model', text: outputTranscriptBuffer, final: false });
  }

  // Si el usuario ya apretó de nuevo, se descarta el audio viejo en camino.
  const userIsTalking = state === VoiceState.LISTENING || state === VoiceState.CONNECTING;

  if (content.modelTurn?.parts && !userIsTalking) {
    for (const part of content.modelTurn.parts) {
      if (part.inlineData?.data) {
        if (state !== VoiceState.SPEAKING) setState(VoiceState.SPEAKING);
        player.enqueue(part.inlineData.data);
      }
    }
  }

  if (content.turnComplete && !userIsTalking) {
    flushTranscript('user');
    flushTranscript('model');
    if (!player.isPlaying) setState(VoiceState.IDLE);
  }
}

// --- Micrófono ---

// Contexto, worklet y permiso: se disparan SÍNCRONOS dentro del gesto
// (crear/resume AudioContext y getUserMedia requieren gesto en iOS).
async function prepareMic() {
  if (!recordContext || recordContext.state === 'closed') {
    recordContext = new AudioContext({ sampleRate: 16000 });
    workletLoaded = false; // el worklet vive en el contexto: hay que cargarlo de nuevo
  }

  const resumePromise =
    recordContext.state !== 'running' ? recordContext.resume() : Promise.resolve();

  // Tras minutos en segundo plano el navegador corta el track del micrófono:
  // reusar ese stream muerto grabaría silencio. Se descarta y se pide uno nuevo.
  if (micStream && !micStream.getAudioTracks().some((track) => track.readyState === 'live')) {
    micStream = null;
  }

  const streamPromise = micStream
    ? Promise.resolve(micStream)
    : navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

  const workletPromise = workletLoaded
    ? Promise.resolve()
    : recordContext.audioWorklet.addModule(RECORDER_WORKLET_URL).then(() => {
        workletLoaded = true;
      });

  const [stream] = await Promise.all([streamPromise, resumePromise, workletPromise]);
  micStream = stream;
}

// Conecta el micrófono al worklet y empieza a mandar audio. Solo con
// sesión lista y el usuario todavía apretando.
function attachRecorder() {
  // Por si quedó algo de un intento anterior.
  stopMicCapture();

  micSourceNode = recordContext.createMediaStreamSource(micStream);
  recorderNode = new AudioWorkletNode(recordContext, 'pcm-recorder');

  recorderNode.port.onmessage = (event) => {
    if (!liveSession) return;
    safeSend({
      audio: {
        data: arrayBufferToBase64(event.data),
        mimeType: 'audio/pcm;rate=16000'
      }
    });
  };

  micSourceNode.connect(recorderNode);
  // No se conecta a destination: no queremos oír el propio micrófono.
}

function stopMicCapture() {
  if (recorderNode) {
    recorderNode.port.onmessage = null;
    recorderNode.disconnect();
    recorderNode = null;
  }
  if (micSourceNode) {
    micSourceNode.disconnect();
    micSourceNode = null;
  }
  // micStream (el permiso) queda abierto a propósito entre presiones
  // seguidas del PTT: re-pedir getUserMedia en iOS cuesta un gesto y una
  // demora perceptible. Se cierra al salir de la pieza (clearActiveObject
  // → releaseMic), no en cada pointerup.
}

// Libera el micrófono por completo: al salir de la experiencia (rescan,
// cambio de pieza, fin de visita). Sin esto el stream y el indicador de
// grabación del navegador quedan activos durante toda la sesión.
export function releaseMic() {
  stopMicCapture();
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

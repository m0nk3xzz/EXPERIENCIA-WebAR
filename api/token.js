// ============================================================
// /api/token — función serverless (Vercel)
// ============================================================
// Único lugar del proyecto con la API key real de Google AI Studio
// (GEMINI_API_KEY en el entorno de Vercel; nunca en el bundle).
// Flujo: valida método/origin/rate limit → busca el objectId en
// MARKER_CATALOG (no se confía en datos del cliente) → genera un token
// efímero con modelo, systemInstruction, VAD manual y tools BLOQUEADOS
// dentro del token (liveConnectConstraints). El navegador recibe solo el
// token, de un solo uso y vida corta.

import { GoogleGenAI } from '@google/genai';
import { MARKER_CATALOG } from '../src/catalog.js';
import { LOCALES, SUPPORTED_LOCALES } from '../src/i18n.js';

// El cliente recibe este modelo en la respuesta y se conecta con él.
// Para migrar: definir GEMINI_LIVE_MODEL en Vercel y redesplegar.
const LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';

// --- Orígenes permitidos ---
// ALLOWED_ORIGINS con esquema (https://...), separados por coma. El
// dominio de producción de Vercel se auto-permite. La comparación es
// sobre el origen PARSEADO (new URL), no sobre texto crudo.
//
// ALCANCE REAL DE ESTE CONTROL: es defensa en profundidad, NO
// autorización. La política CORS del navegador impide falsificar Origin
// desde una página web, pero un cliente que no es un navegador (curl,
// script, backend) elige el valor que quiera. Por eso el rate limit de
// abajo es la única barrera efectiva de coste y debe tratarse como tal:
// es por instancia, no distribuido, y se puede evadir rotando IP.
function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  configuredOrigins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
}

const ALLOWED_ORIGINS = configuredOrigins
  .map((origin) => {
    const normalized = normalizeOrigin(origin);
    if (!normalized) {
      console.warn(`ALLOWED_ORIGINS: entrada inválida ignorada ("${origin}"). Recordá incluir https://`);
    }
    return normalized;
  })
  .filter(Boolean);

// localhost solo en desarrollo local real (VERCEL_ENV === 'development'
// bajo `vercel dev`). Las previews son URLs públicas: aceptar localhost
// ahí dejaría pasar a cualquier script con Origin falsificado.
const IS_DEVELOPMENT = process.env.VERCEL_ENV === 'development';

function isLocalOrigin(url) {
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

function isOriginAllowed(origin) {
  if (!origin) return false;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (IS_DEVELOPMENT && isLocalOrigin(url)) return true;

  return ALLOWED_ORIGINS.includes(url.origin);
}

// --- Rate limiting (en memoria) ---
// Limitación: serverless puede correr varias instancias, cada una con su
// Map — el límite es por instancia, no global. El tope (20/min) asume que
// varios visitantes comparten la IP del Wi-Fi del museo (NAT); con 5/min
// se bloqueaban legítimos. Si aparece abuso real, el paso siguiente es un
// store compartido (Upstash Redis), no bajar el tope.

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // ventana de 1 minuto
const RATE_LIMIT_MAX_REQUESTS = 20;     // máximo de tokens por IP en esa ventana

// Techo de entradas del Map: sin esto, cada IP nueva deja una clave
// permanente (una entrada por IP que pasó alguna vez) y la memoria de la
// instancia crece sin fin. Al superarlo se barren las claves sin
// actividad dentro de la ventana.
const RATE_LIMIT_MAX_TRACKED_IPS = 5000;

// IP -> timestamps (ms) de sus requests dentro de la ventana actual.
const requestTimestampsByIp = new Map();

// Elimina las claves sin ningún timestamp vigente. Se llama solo cuando el
// Map supera el techo: el coste es O(n) y amortizado, no por request.
function sweepExpiredEntries(windowStart) {
  for (const [key, timestamps] of requestTimestampsByIp) {
    if (!timestamps.some((ts) => ts > windowStart)) requestTimestampsByIp.delete(key);
  }
}

// true si la IP superó el límite. Registra el request actual (si no está
// limitada) y limpia timestamps viejos de esa IP.
function isRateLimited(ip) {

  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (requestTimestampsByIp.size > RATE_LIMIT_MAX_TRACKED_IPS) {
    sweepExpiredEntries(windowStart);
  }

  const existingTimestamps = requestTimestampsByIp.get(ip) ?? [];

  const recentTimestamps = existingTimestamps.filter((ts) => ts > windowStart);

  if (recentTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    // No registrar el intento bloqueado: el límite se libera al expirar
    // su última request VÁLIDA, no se extiende por insistir.
    requestTimestampsByIp.set(ip, recentTimestamps);
    return true;
  }

  recentTimestamps.push(now);
  requestTimestampsByIp.set(ip, recentTimestamps);

  return false;
}

// Una IP solo sirve como clave de rate limit si tiene forma de IP. Un
// valor con caracteres de control, comas o basura no es una IP: usarlo
// como clave permitiría a un cliente inventarse una clave nueva por
// request y anular el límite. Con la clave "desconocida" compartida, en
// cambio, todos los clientes irresolubles caerían en el mismo cubo de 20/min
// y se bloquearían entre sí; por eso un valor inválido se rechaza (400).
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

function isUsableIp(value) {
  if (typeof value !== 'string') return false;
  const ip = value.trim();
  if (!ip || ip.length > 45) return false;         // 45 = IPv6 con scope
  if (!IPV4_RE.test(ip) && !(ip.includes(':') && IPV6_RE.test(ip))) return false;
  // Octetos de IPv4 fuera de rango: la plataforma nunca los emite.
  if (IPV4_RE.test(ip) && ip.split('.').some((part) => Number(part) > 255)) return false;
  return true;
}

// La IP real la fija la plataforma en x-real-ip. En XFF, el primer hop es
// controlable por el cliente (serviría para rotar IPs falsas y evadir el
// límite): se usa el ÚLTIMO hop, el que agregó la plataforma. Ambas se
// validan con isUsableIp antes de usarse como clave.
function getClientIp(req) {
  const candidates = [
    req.headers['x-real-ip'],
    typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',').pop()
      : null,
    req.socket?.remoteAddress
  ];

  for (const candidate of candidates) {
    if (isUsableIp(candidate)) return candidate.trim();
  }

  return null;
}

// Idiomas de la guía, derivados de la fuente única (i18n.js). i18n.js es
// seguro de importar serverless: su nivel superior son solo datos (no
// toca window/document hasta que se llama a initI18n).

// Persona de guía + contexto del objeto, en el idioma del visitante.
// El nombre y la descripción salen del catálogo curado (fuente de verdad),
// nunca del body del request.
//
// Las líneas de persona viven en LOCALES (i18n.js) bajo la clave
// `guide.persona`, que es la MISMA fuente única de los textos de la
// interfaz: agregar un idioma a LOCALES lo habilita acá sin tocar este
// archivo. Fallback a español si el idioma pedido no define persona.
function buildSystemInstruction(entry, locale = 'es') {
  const lang = SUPPORTED_LOCALES.includes(locale) ? locale : 'es';
  const translation = entry.translations?.[lang] ?? {};

  const objectName = translation.name ?? entry.name;
  const objectDescription = translation.description ?? entry.description;

  const persona = LOCALES[lang]?.['guide.persona'] ?? LOCALES.es['guide.persona'];

  return persona
    .replace(/\{name\}/g, objectName)
    .replace(/\{description\}/g, objectDescription);
}

export default async function handler(req, res) {

  // Un token efímero no se cachea nunca, en ningún intermediario.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const origin = req.headers.origin || '';

  if (!isOriginAllowed(origin)) {
    res.status(403).json({ error: 'Origen no permitido' });
    return;
  }

  // Rate limit antes de tocar catálogo o generar tokens. Si la plataforma
  // no expone una IP usable, se rechaza en lugar de agrupar a todos los
  // clientes irresolubles bajo una misma clave (se bloquearían entre sí).
  const clientIp = getClientIp(req);

  if (!clientIp) {
    console.warn('No se pudo determinar una IP de cliente usable para el rate limit.');
    res.status(400).json({ error: 'Solicitud no válida' });
    return;
  }

  if (isRateLimited(clientIp)) {
    console.warn(`Rate limit alcanzado para IP ${clientIp}.`);
    res.status(429).json({ error: 'Demasiadas solicitudes. Espere un momento y vuelva a intentar.' });
    return;
  }

  // El body puede llegar como objeto ya parseado (Vercel) o como string
  // crudo (otro runtime/proxy): se normaliza antes de desestructurar.
  // Un body que no es un objeto JSON plano se rechaza sin lanzar.
  let body = req.body;

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }

  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) body = null;

  const { objectId, locale } = body ?? {};

  if (typeof objectId !== 'string' || !objectId) {
    res.status(400).json({ error: 'Falta objectId' });
    return;
  }

  const entry = MARKER_CATALOG.find((item) => item.id === objectId);

  if (!entry) {
    // No se refleja el valor recibido: no aporta y confirma la forma del
    // identificador esperado. El valor real queda en el log del servidor.
    console.warn(`objectId desconocido solicitado: ${JSON.stringify(objectId).slice(0, 80)}`);
    res.status(400).json({ error: 'objectId desconocido' });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('Falta la variable de entorno GEMINI_API_KEY en el servidor.');
    res.status(500).json({ error: 'Configuración del servidor incompleta' });
    return;
  }

  try {

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const now = Date.now();

    // expireTime: hasta cuándo se puede hablar en la sesión abierta.
    // newSessionExpireTime: cuánto tiene el cliente para ABRIR la sesión.
    const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(now + 5 * 60 * 1000).toISOString();

    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: ['AUDIO'],
            systemInstruction: {
              parts: [{ text: buildSystemInstruction(entry, locale) }]
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // VAD manual: sin esto, Gemini espera detección automática de
            // actividad y cierra la sesión al mandar activityStart/
            // activityEnd a mano (modo walkie-talkie).
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: true
              }
            },
            // Grounding con búsqueda web, bloqueado acá igual que el resto.
            tools: [{ googleSearch: {} }]
          }
        }
      }
    });

    res.status(200).json({
      token: token.name,
      model: LIVE_MODEL,
      expireTime
    });

  } catch (err) {
    console.error('Error generando token efímero:', err);
    res.status(500).json({ error: 'No se pudo generar el token' });
  }
}

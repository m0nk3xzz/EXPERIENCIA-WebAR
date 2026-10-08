// Verificacion del handler /api/token refactorizado.
// Intercepta @google/genai para no hacer red: solo se comprueba la logica
// propia (metodo, origin, rate limit, validacion de body, catalog, token).
//
// Uso: node tools/check-token-handler.mjs   (o: npm test)
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const stubSource = `
  export class GoogleGenAI {
    constructor(opts) { globalThis.__genaiOpts = opts; }
    get authTokens() {
      return {
        create: async (req) => {
          globalThis.__genaiReq = req;
          if (globalThis.__genaiFail) throw new Error('boom');
          return { name: 'test-token-abc' };
        }
      };
    }
  }
`;

const loader = `
export async function resolve(specifier, context, next) {
  if (specifier === '@google/genai') {
    return {
      url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stubSource)}),
      shortCircuit: true,
      format: 'module'
    };
  }
  return next(specifier, context);
}
`;

// Registro del loader via data URL (sin escribir archivos en el repo).
const { register } = await import('node:module');
register(`data:text/javascript,${encodeURIComponent(loader)}`);

process.env.GEMINI_API_KEY = 'test-key';
process.env.ALLOWED_ORIGINS = 'https://museo.example';

const { default: handler } = await import(pathToFileURL(join(ROOT, 'api', 'token.js')).href);

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
  return res;
}

async function call({ method = 'POST', origin = 'https://museo.example', body = { objectId: 'objeto-1', locale: 'es' }, headers = {} } = {}) {
  const res = makeRes();
  const req = {
    method,
    headers: { origin, ...headers },
    body,
    socket: { remoteAddress: '203.0.113.7' }
  };
  await handler(req, res);
  return res;
}

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (!cond) failures++;
}

// 1. Caso feliz
let r = await call();
check('POST valido -> 200', r.statusCode === 200, JSON.stringify(r.body));
check('devuelve token y modelo', r.body?.token === 'test-token-abc' && !!r.body?.model);
check('Cache-Control no-store', r.headers['Cache-Control'] === 'no-store');

// 2. Metodo
r = await call({ method: 'GET' });
check('GET -> 405', r.statusCode === 405);

// 3. Origen
r = await call({ origin: 'https://malicioso.example' });
check('origen ajeno -> 403', r.statusCode === 403);
r = await call({ origin: '' });
check('sin origin -> 403', r.statusCode === 403);

// 4. Validacion de body (el bug del TypeError)
r = await call({ body: 'esto no es json' });
check('body string basura -> 400 (no 500)', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ body: null });
check('body null -> 400', r.statusCode === 400);
r = await call({ body: [1, 2, 3] });
check('body array -> 400', r.statusCode === 400);
r = await call({ body: {} });
check('sin objectId -> 400', r.statusCode === 400);
r = await call({ body: { objectId: 12345 } });
check('objectId no-string -> 400', r.statusCode === 400);

// 5. No refleja el objectId recibido
r = await call({ body: { objectId: '<script>alert(1)</script>' } });
check('no refleja el objectId en el error',
  r.statusCode === 400 && !JSON.stringify(r.body).includes('script'),
  JSON.stringify(r.body));

// 6. Idioma desconocido cae a es
r = await call({ body: { objectId: 'objeto-1', locale: 'xx' } });
check('locale desconocido -> 200 con fallback', r.statusCode === 200);

// 7. El systemInstruction se construye con el catalogo (fuente de verdad)
const reqCaptured = globalThis.__genaiReq;
const instruction = reqCaptured?.config?.liveConnectConstraints?.config?.systemInstruction?.parts?.[0]?.text;
check('systemInstruction generado', typeof instruction === 'string' && instruction.length > 100);
check('systemInstruction contiene el contexto del catalogo',
  instruction?.includes('Descripción breve del objeto 1'));
check('sin marcadores {name} sin sustituir', !instruction?.includes('{name}') && !instruction?.includes('{description}'));
check('tools googleSearch bloqueados en el token',
  Array.isArray(reqCaptured?.config?.liveConnectConstraints?.config?.tools));
check('uses: 1 y expiraciones presentes',
  reqCaptured?.config?.uses === 1 && !!reqCaptured?.config?.expireTime && !!reqCaptured?.config?.newSessionExpireTime);

// 8. Version en ingles de la persona
r = await call({ body: { objectId: 'objeto-2', locale: 'en' } });
const enInstruction = globalThis.__genaiReq?.config?.liveConnectConstraints?.config?.systemInstruction?.parts?.[0]?.text;
check('locale en -> persona en ingles', enInstruction?.startsWith('You are the conversational guide'));

// 9. Fallo del proveedor -> 500 generico sin filtrar detalle
globalThis.__genaiFail = true;
r = await call();
check('fallo del proveedor -> 500 generico',
  r.statusCode === 500 && !JSON.stringify(r.body).includes('boom'),
  JSON.stringify(r.body));
globalThis.__genaiFail = false;

// 10. Rate limit: 20 permitidos, el 21 bloqueado (misma IP)
let limited = null;
for (let i = 0; i < 21; i++) {
  const rr = await call({ headers: { 'x-real-ip': '198.51.100.9' } });
  if (rr.statusCode === 429) { limited = i + 1; break; }
}
check('rate limit corta en la request 21', limited === 21, `corto en ${limited}`);

// 11. IP invalida -> 400 (no agrupa a todos bajo una clave compartida)
r = await call({ headers: { 'x-real-ip': 'no-es-una-ip' }, origin: 'https://museo.example' });
// x-real-ip invalido cae a XFF/remoteAddress, que si es usable -> 200
check('x-real-ip invalido cae al siguiente candidato', r.statusCode === 200, `status ${r.statusCode}`);

// 12. Sin ninguna IP usable -> 400
r = makeRes();
await handler({ method: 'POST', headers: { origin: 'https://museo.example' }, body: { objectId: 'objeto-1' }, socket: {} }, r);
check('sin IP usable -> 400', r.statusCode === 400, JSON.stringify(r.body));

console.log(`\n${failures === 0 ? 'TODOS LOS CHECKS PASARON' : failures + ' CHECK(S) FALLARON'}`);
process.exit(failures === 0 ? 0 : 1);

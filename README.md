# EXPERIENCIA-WebAR

> Experiencia WebAR para museos con modelos 3D interactivos, seguimiento de
> manos e IA conversacional.

Experiencia de realidad aumentada para sala de museo: el visitante apunta la
cámara a la cédula de una pieza, la pieza aparece en 3D frente a él, la
manipula con gestos de la mano y le hace preguntas en voz alta a una guía de
IA que conoce el contexto de esa pieza.

Es *white-label*: el nombre, el isotipo, los colores y las piezas de la sala
salen de la configuración, no del código.

---

## Cómo funciona

```
Comenzar (gesto del usuario)
  ├─ MindAR: imagen de la cédula → ancla 3D            (marcadores.mind)
  ├─ Three.js: pieza GLB, luces de vitrina, sombra     (modelos .glb)
  ├─ MediaPipe: 21 puntos de la mano → gestos          (se espera en el arranque)
  └─ Gemini Live: voz + texto → respuesta hablada      (token efímero)
```

El navegador **nunca** ve la API key de Google. Pide un token efímero a
`/api/token`, que es una función serverless: busca la pieza en el catálogo
curado, arma el *system instruction* en el idioma del visitante y devuelve un
token de un solo uso con el modelo, el contexto y las herramientas
**bloqueados dentro del token**. El cliente se conecta a Gemini Live con ese
token y nada más.

### Módulos

| Módulo | Responsabilidad |
|---|---|
| `src/main.js` | Orquestador: arranque, loop de render, cableado de eventos |
| `src/sessionManager.js` | Ciclo de vida de la pieza invocada (invocación → desacople → ficha) |
| `src/sceneSetup.js` | MindAR + renderer + esquema de luces |
| `src/modelCache.js` | Carga, caché LRU e instanciación de modelos GLB |
| `src/handTracking.js` | MediaPipe HandLandmarker, clasificación de pose, calibración |
| `src/gestureControl.js` | Velocidad de gesto, inercia, aplicación del movimiento |
| `src/motion.js` | Sistema de animación: primitivas DOM (WAAPI), tweens y poses 3D |
| `src/voiceAgent.js` | Sesión Gemini Live, micrófono, transcripciones |
| `src/audio/pcmPlayer.js` | Reproducción de los chunks PCM16 de 24 kHz |
| `src/ui.js` | Único módulo que toca el DOM (las 4 secciones) |
| `src/cameraRecovery.js` | Recuperación del video de cámara al volver del segundo plano |
| `src/catalog.js` | **Fuente de verdad** de las piezas (la usa también el backend) |
| `src/config.js` | Todas las constantes ajustables |
| `src/i18n.js` | **Fuente de verdad** de los idiomas y los textos |
| `src/theme.js` | Identidad por museo (colores, nombre, háptica, sonido) |
| `api/token.js` | Función serverless que acuña el token efímero |

---

## Requisitos

- **Node.js ≥ 20.19** (Vite 8 lo exige; también en `.nvmrc` y `engines`).
- Un navegador móvil con cámara. Probado el flujo de iOS/Safari y Chrome
  Android (gesto del usuario para cámara, audio y micrófono).

> **Nota sobre el arranque.** La experiencia espera al *hand tracking* antes
> de mostrar la pantalla de escaneo: son ~19,5 MB (WASM de MediaPipe + modelo
> de manos), la descarga más pesada del proyecto. Si supera
> `HANDS_INIT_TIMEOUT_MS` (45 s), el hito se marca con aviso y la visita
> continúa **sin gestos** —la voz sigue funcionando—, pero **no se entra al
> escaneo antes**. Es una decisión deliberada: nadie debería empezar a
> interactuar con una experiencia a la que todavía le faltan los gestos y la
> calibración. En una red lenta esto es una espera real.

## Puesta en marcha

```bash
npm install
cp .env.example .env      # y completá GEMINI_API_KEY
npm run dev
```

`npm run dev` levanta solo el front. Para probar `/api/token` en local hace
falta el runtime de Vercel (`vercel dev`), que es el que lee `.env` y expone
la función.

### Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `GEMINI_API_KEY` | Sí | API key de Google AI Studio. **Solo server-side.** Sin ella, `/api/token` responde 500. |
| `ALLOWED_ORIGINS` | Recomendada | Orígenes autorizados, separados por coma y **con esquema** (`https://…`). El dominio de producción de Vercel se permite solo. |
| `GEMINI_LIVE_MODEL` | No | Modelo de Gemini Live. Vacío = el valor por defecto de `api/token.js`. |

> En producción, en Vercel, estas variables se configuran **en el panel del
> proyecto**. El archivo `.env` no se carga en el runtime serverless: solo lo
> leen `vercel dev` y el servidor de desarrollo.

## Despliegue

El proyecto está pensado para Vercel (ver `vercel.json`). El build es estático
y `/api/token` es una función serverless.

1. Importá el repositorio en Vercel.
2. Configurá `GEMINI_API_KEY` y `ALLOWED_ORIGINS` en el panel.
3. Desplegá. `vercel.json` ya trae `buildCommand`, `outputDirectory` e
   `installCommand` (`npm install --ignore-scripts`).

Los headers de seguridad (CSP, `Permissions-Policy`, HSTS, etc.) se aplican
desde `index.html` (meta) y `vercel.json`.

---

## Mantenimiento del contenido

### Agregar una pieza

1. Recompilá **todas** las imágenes de marcador juntas (las viejas + la nueva)
   en un único `.mind` con el
   [compilador de MindAR](https://hiukim.github.io/mind-ar-js-doc/tools/compile/).
   No se puede agregar un target a un `.mind` ya compilado sin rehacerlo
   completo: el índice de cada imagen depende del **orden de subida**.
2. Reemplazá `public/marcadores.mind`.
3. Agregá la entrada en `src/catalog.js` con ese `markerIndex` y su
   `modelPath`. Poné el nombre y la descripción reales: `description` es la
   fuente de verdad que recibe la guía de IA.
4. Si la pieza debe traducirse, completá `translations.<idioma>`.

`validateMarkerCatalog()` avisa en consola si hay ids duplicados,
`markerIndex` repetidos o huecos en los índices.

### Agregar un idioma

1. Agregá el idioma a `LOCALES` en `src/i18n.js`, con **todos** sus textos y
   su clave `guide.persona` (la persona del guía, con `{name}` y
   `{description}`).
2. Nada más: la interfaz, el selector de idioma y el *system instruction* del
   backend derivan de `LOCALES`.

### Agregar un museo

Agregá un objeto en `MUSEUMS` (`src/theme.js`) con sus 7 colores, nombre,
isotipo y flags de háptica/sonido. Se elige por URL: `?museo=<id>`.

### Actualizar MediaPipe

Al subir la versión de `@mediapipe/tasks-vision` hay que **recopiar el fileset
completo** desde `node_modules/@mediapipe/tasks-vision/wasm/` a
`public/mediapipe/wasm/`. MediaPipe exige pares JS/WASM de la misma versión;
un desajuste produce un fallo opaco al inicializar.

---

## Verificación

```bash
npm run build     # build de producción
npm test          # integridad de imports + chequeo del handler /api/token
```

`npm test` corre dos verificaciones sin red y sin navegador:

- `tools/check-imports.mjs` — imports rotos, exports inexistentes e imports
  sin usar entre los módulos del proyecto.
- `tools/check-token-handler.mjs` — el handler `/api/token` con
  `@google/genai` interceptado: método, origen, validación del body, catálogo,
  rate limit, idioma, construcción del *system instruction* y no filtración de
  errores internos.

**Lo que no está cubierto por tests automáticos** (requiere prueba en
dispositivo): detección de marcador, gestos, calibración, audio, sesión Live
real y la CSP en el navegador.

## Versionado

El proyecto sigue [Versionado Semántico](https://semver.org/lang/es/)
(`MAYOR.MENOR.PARCHE`). La versión actual está en `package.json` y el historial
de cambios en [`CHANGELOG.md`](CHANGELOG.md).

```bash
npm run bump patch     # 1.0.0 -> 1.0.1  (correcciones)
npm run bump minor     # 1.0.1 -> 1.1.0  (funcionalidad nueva)
npm run bump major     # 1.1.0 -> 2.0.0  (cambios incompatibles)
```

El comando actualiza `package.json`, `package-lock.json` y el CHANGELOG, y
crea el commit y el tag `vX.Y.Z`. **No hace push**: eso es siempre una decisión
aparte (`git push origin main --follow-tags`).

El procedimiento completo —qué número subir, cómo anotar los cambios y cómo
publicar una release— está en [`RELEASING.md`](RELEASING.md).

---

## Privacidad

- La cámara se usa durante la visita; no se guarda ninguna imagen.
- El micrófono se captura **solo mientras se mantiene presionado el botón de
  voz**, y se libera al salir de la pieza.
- Las preguntas (texto o audio) se envían al servicio de guía de Google para
  poder responderlas.

---

## Licencia

El **material propio** de este repositorio (código fuente, documentación,
modelos 3D, marcadores y sistema de diseño) se publica bajo la
**PolyForm Noncommercial License 1.0.0**: se puede usar, modificar y
redistribuir con atribución, pero **no con fines comerciales**. Ver
[`LICENSE`](LICENSE).

**Qué significa "no comercial" acá.** La licencia permite explícitamente el uso
por *instituciones educativas y organizaciones sin fines de lucro, con
independencia de su fuente de financiamiento*. En la práctica: **un museo
público, una universidad o una escuela pueden usar este software** aunque
cobren entrada o reciban fondos estatales. Lo que no está permitido es el uso
comercial por parte de una empresa sin una licencia adicional.

**Las dependencias mantienen sus propias licencias** y no quedan cubiertas por
la anterior:

| Componente | Licencia |
|---|---|
| `three` | MIT |
| `mind-ar` | MIT |
| `@mediapipe/tasks-vision` | Apache-2.0 |
| `@google/genai` | Apache-2.0 |
| `@tensorflow/tfjs` (indirecta de `mind-ar`) | Apache-2.0 |
| Tipografías en `public/fonts/` | SIL Open Font License 1.1 ([texto](public/fonts/OFL.txt)) |

Como el bundle de `dist/` mezcla código propio con código de terceros, quien
reutilice el proyecto debe cumplir **ambas cosas**: esta licencia para el
material propio y las licencias originales para las dependencias. El detalle
está en la sección *Alcance de esta licencia* de [`LICENSE`](LICENSE).

El titular del copyright se reserva el derecho de otorgar licencias
comerciales alternativas sobre el material propio a quien lo solicite.


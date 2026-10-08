# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el
proyecto se adhiere a [Versionado Semántico](https://semver.org/lang/es/):
`MAYOR.MENOR.PARCHE`.

- **MAYOR** — cambios incompatibles (por ejemplo, recompilar `marcadores.mind`
  con otro orden de imágenes, o cambiar el contrato de `/api/token`).
- **MENOR** — funcionalidad nueva compatible (una pieza, un idioma, un museo).
- **PARCHE** — correcciones compatibles (bugs, seguridad, textos).

---

## [Unreleased]

Nada todavía. Antes de publicar una versión, escribí acá los cambios bajo
`### Agregado`, `### Cambiado`, `### Corregido` o `### Seguridad`. El comando
`npm run bump` convierte esta sección en la versión que corresponda.

---

## [1.0.0] — 2025-10-08

Primera versión completa y funcional. No hubo una release pública anterior con
los defectos listados abajo: se corrigieron antes de la primera publicación y
quedan documentados porque explican decisiones del código actual.

### Funcionalidad

- **Realidad aumentada por marcadores (MindAR):** el visitante apunta a la
  cédula de una pieza y la pieza aparece anclada a ella.
- **Pieza 3D interactiva (Three.js):** materialización con rampa de luz,
  sombra de contacto, desacople del marcador conservando la transformación
  mundial, y centrado frente a cámara.
- **Control por gestos (MediaPipe HandLandmarker):** puño para mover, índice
  para girar, índice + medio para inclinar, índice + pulgar para escalar.
  Suavizado exponencial independiente del framerate, inercia al soltar y
  calibración por usuario de los umbrales de cada dedo.
- **Guía conversacional por voz (Gemini Live API):** walkie-talkie con
  entrada de texto alternativa, transcripciones en vivo y diagnóstico de
  error con causa y recuperación por cada fuente de fallo.
- **Ficha de la obra:** bottom sheet con los datos de la pieza y preguntas
  sugeridas.
- **Multi-idioma (ES/EN)** y **multi-museo** (colores, nombre, isotipo y
  flags de háptica/sonido por URL).
- **Recuperación de cámara** al volver del segundo plano, verificando el
  estado real del track y la llegada de frames.

### Seguridad

- El navegador nunca recibe `GEMINI_API_KEY`: pide un token efímero a
  `/api/token`, que acuña el token con el modelo, el *system instruction*, el
  VAD manual y las herramientas (`googleSearch`) **bloqueados dentro del
  token**. Un solo uso, 5 minutos para abrirlo y 30 de vida.
- Validación del `objectId` contra el catálogo curado en el servidor (nunca
  se confía en datos del cliente).
- Rate limit por IP con barrido de entradas vencidas; validación de forma de
  la IP antes de usarla como clave (una cabecera inventada permitía crear una
  clave nueva por petición y anular el límite).
- Normalización del cuerpo del request: un body que no fuera un objeto JSON
  producía un `TypeError` y un `500`.
- Los errores del servidor no filtran el detalle interno ni reflejan la
  entrada del cliente.
- `Content-Security-Policy`, `Permissions-Policy`, COOP, CORP y HSTS.
- `.gitignore` endurecido para copias de seguridad del `.env`.

### Privacidad

- El micrófono se libera al salir de la pieza (antes quedaba capturando
  durante toda la visita).
- El aviso de privacidad declara el uso del micrófono y el envío de las
  preguntas al servicio de guía.

### Corregido

- **Sesión de voz envenenada tras un timeout de conexión:** `liveSession`
  quedaba apuntando a una sesión cerrada y marcada como intencional, así que
  nadie la limpiaba. El cliente reutilizaba un WebSocket muerto: la interfaz
  decía "Escuchando" y el visitante no recibía respuesta, sin ningún error
  visible.
- **El error de carga de un modelo nunca se veía:** `ui.scan.toSearch()`
  ocultaba el chip de error en el mismo instante en que se mostraba. Se
  reemplazó por una función única que fija el estado completo del escaneo.
- **Carrera sobre `HandLandmarker`:** `detectForVideo` podía ejecutarse desde
  el loop de render y desde la calibración a la vez (MediaPipe no lo soporta).
  Ahora la calibración pausa la detección por frame.
- **Landmarker tardío sin botón:** si la carga superaba el techo de 45 s, el
  botón "Recalibrar" ya se había evaluado como no disponible y la carga
  abandonada no se recuperaba.
- **Caché LRU fuera de su cota:** `evictOldest` podía no evictar nada y dejar
  la caché por encima del máximo declarado.
- **Fuga de memoria en el rate limiter:** las claves de IP nunca se
  eliminaban.
- **Funda de errores en el reproductor y en el envío:** la captura de audio se
  iniciaba contra una sesión cerrada y los envíos fallidos se silenciaban.
- **`innerHTML` en los subtítulos** reemplazado por un pseudo-elemento CSS
  (era el único sink de HTML del proyecto).
- Ficha abrible sin pieza activa; barra de progreso del escaneo que quedaba
  completa tras cambiar de pieza.

### Rendimiento

- Se dejó de dibujar el esqueleto de la mano cuando su opacidad es 0.
- Los subtítulos dejaron de forzar medición de layout y animar `clip-path` en
  cada fragmento de transcripción.

### Documentación

- README con arquitectura, requisitos, puesta en marcha, despliegue y los
  procedimientos de mantenimiento (agregar pieza, idioma o museo; actualizar
  MediaPipe).
- LICENSE (PolyForm Noncommercial 1.0.0) con la nota de alcance y las
  licencias de terceros.
- `CHANGELOG.md` y `RELEASING.md`: historial de cambios y procedimiento de
  versionado. `npm run bump` sube la versión, actualiza los tres archivos y
  crea el commit y el tag.
- `npm test` con dos verificaciones sin red: integridad de imports entre
  módulos y comportamiento del handler `/api/token`.

---

<!--
Plantilla para la próxima release. Copiar al agregar cambios y borrar los
encabezados que queden vacíos.

## [X.Y.Z] — AAAA-MM-DD

### Agregado
### Cambiado
### Corregido
### Eliminado
### Seguridad
-->

[Unreleased]: https://github.com/m0nk3xzz/EXPERIENCIA-WebAR/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/m0nk3xzz/EXPERIENCIA-WebAR/releases/tag/v1.0.0

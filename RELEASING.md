# Guía de versionado y publicación

El proyecto usa [Versionado Semántico](https://semver.org/lang/es/):
`MAYOR.MENOR.PARCHE`. La versión vive en `package.json` y el historial de
cambios en [`CHANGELOG.md`](CHANGELOG.md).

## Qué número subir

| Cambio | Subida | Ejemplo |
|---|---|---|
| Corrección de un bug, un texto o un problema de seguridad | **PARCHE** | `1.0.0` → `1.0.1` |
| Funcionalidad nueva compatible: una pieza, un idioma, un museo | **MENOR** | `1.0.1` → `1.1.0` |
| Algo que rompe compatibilidad: recompilar `marcadores.mind` con otro orden, cambiar el contrato de `/api/token`, subir a una versión de Three.js que altere la iluminación calibrada | **MAYOR** | `1.1.0` → `2.0.0` |

Regla práctica: si alguien que ya tiene el proyecto desplegado puede
actualizar sin tocar sus archivos ni su configuración, **no** es MAYOR.

## Ciclo de una release

### 1. Trabajar sobre `main` y mantener el CHANGELOG al día

A medida que hacés cambios, anotalos en la sección `## [Unreleased]` de
`CHANGELOG.md`, bajo el encabezado que corresponda (`### Agregado`,
`### Cambiado`, `### Corregido`, `### Seguridad`, `### Eliminado`).

Esto se escribe **mientras** trabajás, no después: al final de una sesión
nadie recuerda qué se tocó.

```bash
git add .
git commit -m "feat: ficha de la obra con datos traducidos"
```

Convención de mensajes (opcional, pero ayuda a leer el historial):

| Prefijo | Para qué |
|---|---|
| `feat:` | funcionalidad nueva |
| `fix:` | corrección de un bug |
| `security:` | corrección de seguridad |
| `perf:` | mejora de rendimiento |
| `docs:` | documentación |
| `chore:` | tareas de mantenimiento |

### 2. Verificar antes de publicar

```bash
npm test          # integridad de imports + handler /api/token
npm run build     # que el build de producción no rompa
```

Y lo que **no** cubren los tests automáticos: probar en un dispositivo real
que el marcador se detecta, que los gestos responden y que la voz funciona.
Ver la sección "Verificación" del [README](README.md).

### 3. Subir la versión

```bash
npm run bump patch     # o: minor | major | 2.0.0
```

Esto, en un solo paso:

1. actualiza `version` en `package.json` y `package-lock.json`;
2. convierte la sección `## [Unreleased]` del CHANGELOG en
   `## [x.y.z] - fecha` y deja un `## [Unreleased]` vacío arriba;
3. crea el commit `chore(release): x.y.z`;
4. crea el tag anotado `vx.y.z`.

Si solo querés revisar los archivos sin commitear:

```bash
npm run bump patch -- --no-commit
```

### 4. Publicar

```bash
git push origin main --follow-tags
```

`--follow-tags` empuja el tag junto con el commit. Si te olvidás, se puede
empujar aparte: `git push origin v1.0.1`.

### 5. Release en GitHub

Entrá a **Releases → Draft a new release**, elegí el tag que acabás de subir y
pegá como descripción la sección del CHANGELOG de esa versión. No es
obligatorio, pero deja un historial legible para cualquiera que llegue al
repositorio.

---

## Consultar y navegar versiones

```bash
git tag -l                      # listar todas las versiones
git show v1.0.0                 # ver qué entró en una versión
git log --oneline v1.0.0..HEAD  # qué cambió desde entonces
git diff v1.0.0 v1.0.1          # diferencia entre dos versiones
```

Para volver a una versión anterior y mirarla (sin perder nada):

```bash
git switch --detach v1.0.0      # quedarse en esa versión
git switch main                 # volver
```

> **Nunca** uses `git reset --hard` ni `git push --force` sobre `main` para
> "deshacer" una versión publicada. Si una versión salió mal, se corrige con
> una versión nueva (`parche`), que es justamente para lo que existe.

---

## Notas de este repositorio

- **Tamaño de los binarios.** `public/mediapipe/` (~34 MB de WASM) y
  `public/marcadores.mind` se versionan directamente, sin Git LFS: son
  necesarios para que el proyecto funcione al clonarlo, y 43 MB en total
  están dentro de lo que GitHub acepta sin problemas. Si algún día el
  repositorio se acerca a 1 GB, la conversación es Git LFS.
- **`.env` no se versiona.** `.env.example` sí. Si clonás el proyecto de
  cero, hay que copiarlo y completar `GEMINI_API_KEY` (ver README).
- **`.vercel` y `dist` están ignorados.** El build se genera en cada
  despliegue; no va al repositorio.
- **La primera versión publicada es `v1.0.0`.** No existen releases anteriores:
  los defectos corregidos antes de publicar están documentados dentro de la
  entrada `1.0.0` del CHANGELOG, porque explican decisiones del código actual.

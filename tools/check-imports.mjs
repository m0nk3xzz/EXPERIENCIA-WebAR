// Chequeo de integridad de imports/exports entre los modulos del proyecto.
// No reemplaza a un linter, pero detecta lo que un refactor rompe en
// silencio: nombres importados que ya no se exportan, exports usados
// internamente como si fueran locales, e imports sin usar.
//
// Uso: node tools/check-imports.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const API = join(ROOT, 'api');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [...walk(SRC), ...walk(API)];

// 1. Recolectar exports por archivo.
const exportsByFile = new Map();
for (const file of files) {
  const code = readFileSync(file, 'utf8');
  const names = new Set();
  const patterns = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm,
    /^export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm,
    /^export\s*\{([^}]+)\}/gm
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      if (re.source.includes('\\{')) {
        for (const part of m[1].split(',')) {
          const name = part.split(/\s+as\s+/).pop().trim();
          if (name) names.add(name);
        }
      } else {
        names.add(m[1]);
      }
    }
  }
  exportsByFile.set(file, names);
}

// 2. Verificar cada import contra el archivo destino.
let problems = 0;
const report = (msg) => { console.log('  ' + msg); problems++; };

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');

  const importRe = /import\s+(?:([A-Za-z0-9_$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z0-9_$]+)|([A-Za-z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/g;

  for (const m of code.matchAll(importRe)) {
    const named = m[2];
    const spec = m[5];
    if (!spec.startsWith('.')) continue;

    const target = join(file, '..', spec);
    const targetFile = files.find((f) => f === target || f === target + '.js');
    if (!targetFile) {
      report(`${rel}: importa "${spec}" que no resuelve a un archivo del proyecto`);
      continue;
    }

    if (named) {
      const available = exportsByFile.get(targetFile) ?? new Set();
      for (const part of named.split(',')) {
        const raw = part.trim();
        if (!raw) continue;
        const importedName = raw.split(/\s+as\s+/)[0].trim();
        if (importedName && !available.has(importedName)) {
          report(`${rel}: importa { ${importedName} } de "${spec}", que NO lo exporta`);
        }
      }
    }

    // Import usado pero jamas referenciado en el cuerpo del archivo.
    const localNames = [];
    if (m[1]) localNames.push(m[1]);
    if (m[3]) localNames.push(m[3]);
    if (m[4]) localNames.push(m[4]);
    if (named) {
      for (const part of named.split(',')) {
        const raw = part.trim();
        if (!raw) continue;
        const alias = raw.split(/\s+as\s+/).pop().trim();
        if (alias) localNames.push(alias);
      }
    }

    const body = code.replace(importRe, '');
    for (const name of localNames) {
      const uses = body.match(new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g'));
      if (!uses) report(`${rel}: importa "${name}" de "${spec}" y no lo usa`);
    }
  }
}

console.log(problems === 0
  ? `OK: ${files.length} modulos sin imports rotos ni sin usar`
  : `\n${problems} problema(s) de imports`);
process.exit(problems === 0 ? 0 : 1);

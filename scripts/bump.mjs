#!/usr/bin/env node
// ============================================================
// bump — sube la version, actualiza el CHANGELOG y crea commit + tag
// ============================================================
// Uso:
//   npm run bump patch          # 1.0.0 -> 1.0.1
//   npm run bump minor          # 1.0.0 -> 1.1.0
//   npm run bump major          # 1.0.0 -> 2.0.0
//   npm run bump 2.1.3          # version explicita
//   npm run bump patch -- --no-commit   # solo edita los archivos
//
// Que hace, en orden:
//   1. Calcula la version nueva (semver).
//   2. La escribe en package.json y package-lock.json.
//   3. Renombra "## [Unreleased]" del CHANGELOG a "## [x.y.z] - fecha" y
//      deja un "## [Unreleased]" vacio arriba.
//   4. git add + commit "chore(release): x.y.z" + tag anotado "vx.y.z".
//
// NO hace push: eso es siempre una decision explicita (ver RELEASING.md).

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const noCommit = args.includes('--no-commit');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('Falta el tipo de subida. Ejemplos: npm run bump patch');
  console.error('                                   npm run bump minor');
  console.error('                                   npm run bump 2.0.0');
  process.exit(1);
}

const pkgPath = join(ROOT, 'package.json');
const lockPath = join(ROOT, 'package-lock.json');
const changelogPath = join(ROOT, 'CHANGELOG.md');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

function nextVersion(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;

  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) throw new Error(`La version actual ("${current}") no es semver x.y.z`);

  const [major, minor, patch] = match.slice(1).map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;

  throw new Error(`Tipo de subida desconocido: "${kind}" (usar major | minor | patch | x.y.z)`);
}

const newVersion = nextVersion(currentVersion, target);

if (newVersion === currentVersion) {
  console.error(`La version ${newVersion} ya es la actual.`);
  process.exit(1);
}

// --- 1. package.json ---
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`package.json        ${currentVersion} -> ${newVersion}`);

// --- 2. package-lock.json (la raiz y el paquete propio) ---
try {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.version) lock.version = newVersion;
  if (lock.packages?.['']?.version) lock.packages[''].version = newVersion;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  console.log(`package-lock.json   ${currentVersion} -> ${newVersion}`);
} catch (err) {
  console.warn(`No se pudo actualizar package-lock.json: ${err.message}`);
}

// --- 3. CHANGELOG ---
const date = new Date().toISOString().slice(0, 10);
let changelog = readFileSync(changelogPath, 'utf8');

const unreleasedRe = /^## \[Unreleased\]\s*$/m;
if (!unreleasedRe.test(changelog)) {
  console.warn('CHANGELOG.md no tiene una seccion "## [Unreleased]": no se toco.');
  console.warn(`Agregá a mano el encabezado "## [${newVersion}] - ${date}" antes de taguear.`);
} else {
  changelog = changelog.replace(
    unreleasedRe,
    `## [Unreleased]\n\n## [${newVersion}] - ${date}`
  );

  // Enlace de comparacion al pie, si el bloque de enlaces existe.
  const linkRe = /^\[Unreleased\]:.*$/m;
  if (linkRe.test(changelog)) {
    changelog = changelog.replace(
      linkRe,
      `[Unreleased]: https://github.com/m0nk3xzz/EXPERIENCIA-WebAR/compare/v${newVersion}...HEAD\n` +
      `[${newVersion}]: https://github.com/m0nk3xzz/EXPERIENCIA-WebAR/releases/tag/v${newVersion}`
    );
  }

  writeFileSync(changelogPath, changelog, 'utf8');
  console.log(`CHANGELOG.md        seccion [${newVersion}] - ${date}`);
}

// --- 4. commit + tag ---
if (noCommit) {
  console.log('\n--no-commit: quedan los archivos listos para revisar y commitear a mano.');
  process.exit(0);
}

const git = (...argv) =>
  execFileSync('git', argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();

try {
  git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md');
  git('commit', '-m', `chore(release): ${newVersion}`);
  git('tag', '-a', `v${newVersion}`, '-m', `Version ${newVersion}`);
  console.log(`\ncommit + tag v${newVersion} creados.`);
  console.log('Falta el push (intencional que sea aparte):');
  console.log('  git push origin main --follow-tags');
} catch (err) {
  const detail = err.stderr?.toString() || err.message;
  console.error(`\nNo se pudo completar el commit/tag: ${detail.trim()}`);
  console.error('Los archivos ya estan modificados: revisalos y commiteá a mano.');
  process.exit(1);
}

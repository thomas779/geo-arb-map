#!/usr/bin/env bun
/** Materialize a D1 export and apply the exact generated canonical import locally. */
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCanonicalHeadIds } from './lib/data-build';

const root = fileURLToPath(new URL('..', import.meta.url));
const generatedRoot = path.join(root, '.generated/data-canonical');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`);
  return path.isAbsolute(value) ? value : path.join(root, value);
}

const base = arg('--base');
if (!base) throw new Error('Usage: bun run data:stage -- --base <D1 export.sql|database.sqlite>');
if (!fs.existsSync(base)) throw new Error(`Base database does not exist: ${base}`);

const importPath = arg('--import') ?? path.join(generatedRoot, 'canonical-import.sql');
if (!fs.existsSync(importPath)) {
  throw new Error(`Canonical import does not exist: ${importPath}. Run data:db -- --base first.`);
}

const output = arg('--output') ?? path.join(generatedRoot, 'staged.sqlite');
if (path.resolve(output) === path.resolve(base)) {
  throw new Error('The staged output must not overwrite the base export');
}
fs.mkdirSync(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp`;
fs.rmSync(temporary, { force: true });

if (path.extname(base).toLowerCase() === '.sql') {
  const database = new Database(temporary, { create: true, strict: true });
  try {
    database.exec(fs.readFileSync(base, 'utf8'));
  } finally {
    database.close();
  }
} else {
  fs.copyFileSync(base, temporary);
}

const beforeHeads = readCanonicalHeadIds(temporary, root);
const database = new Database(temporary, { strict: true });
try {
  database.transaction(() => {
    database.exec(fs.readFileSync(importPath, 'utf8'));
  })();
  database.exec('PRAGMA optimize');
} catch (error) {
  database.close();
  fs.rmSync(temporary, { force: true });
  throw error;
}
database.close();

const afterHeads = readCanonicalHeadIds(temporary, root);
const changed = Object.keys(afterHeads).filter(id => beforeHeads[id] !== afterHeads[id]).sort();
if (changed.length === 0) {
  fs.rmSync(temporary, { force: true });
  throw new Error('Applying the canonical import did not create or supersede any draft heads');
}

fs.rmSync(output, { force: true });
fs.renameSync(temporary, output);
console.log(
  `staged canonical database: ${Object.keys(beforeHeads).length} -> `
  + `${Object.keys(afterHeads).length} heads; ${changed.length} changed`,
);
console.log(output);

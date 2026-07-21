#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalPilot } from './lib/canonical-pilot';
import { readCanonicalHeadIds } from './lib/data-build';
import { readCanonicalMigrations } from './lib/d1-migrations';
import {
  applyCanonicalMutations,
  buildCanonicalImportPlan,
  readCanonicalProjections,
  renderCanonicalSql,
} from './lib/canonical-store';

const root = fileURLToPath(new URL('..', import.meta.url));
const generatedRoot = path.join(root, '.generated/data-canonical');
const output = path.join(generatedRoot, 'canonical.sqlite');
const temporary = `${output}.tmp`;
const migration = readCanonicalMigrations(root);
const baseIndex = process.argv.indexOf('--base');
const basePath = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;
if (baseIndex >= 0 && (!basePath || basePath.startsWith('--'))) {
  throw new Error('--base requires a SQLite database or D1 export path');
}

fs.mkdirSync(generatedRoot, { recursive: true });
fs.rmSync(temporary, { force: true });

const pilot = buildCanonicalPilot();
const database = new Database(temporary, { create: true, strict: true });
database.exec(migration);
const plan = buildCanonicalImportPlan(pilot);
applyCanonicalMutations(database, plan.mutations);
const { mutations: _mutations, ...imported } = plan;
const projections = readCanonicalProjections(
  database,
  Object.values(imported.revision_by_entity),
);
database.exec('PRAGMA optimize');
database.close();

fs.rmSync(output, { force: true });
fs.renameSync(temporary, output);
fs.writeFileSync(
  path.join(generatedRoot, 'canonical-projections.json'),
  `${JSON.stringify({
    candidate_release_id: pilot.release_id,
    imported,
    projections,
  }, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(generatedRoot, 'canonical-import.sql'),
  renderCanonicalSql(
    buildCanonicalImportPlan(
      pilot,
      basePath ? readCanonicalHeadIds(basePath, root) : {},
    ).mutations,
  ),
);

console.log(
  `canonical database ${pilot.release_id}: `
  + `${imported.counts.entities} entities, `
  + `${imported.counts.routes} routes, `
  + `${projections.edges.length} candidate edges`,
);
console.log(output);

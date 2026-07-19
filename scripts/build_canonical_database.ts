#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalPilot } from './lib/canonical-pilot';
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
const migration = fs.readFileSync(
  path.join(root, 'data/d1/migrations/0001_canonical_data.sql'),
  'utf8',
);

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
  renderCanonicalSql(plan.mutations),
);

console.log(
  `canonical database ${pilot.release_id}: `
  + `${imported.counts.entities} entities, `
  + `${imported.counts.routes} routes, `
  + `${projections.edges.length} candidate edges`,
);
console.log(output);

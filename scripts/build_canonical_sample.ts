#!/usr/bin/env bun
// Regenerate the public sample dataset from the private master canonical.
//
// The real dataset (scripts/lib/canonical-pilot.ts) is gitignored and present
// only in the maintainer's environment. Forks and public CI fall back to the
// committed sample so the app, build, and pipeline tests still run. Run this
// locally whenever the sample should be refreshed:
//
//   bun scripts/build_canonical_sample.ts
//
// It writes a small, referentially-complete subset to
// scripts/lib/canonical-pilot.sample.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalPilot } from './lib/canonical-source';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_SIZE = 6;

const pilot = buildCanonicalPilot();
const jurisdictions = pilot.jurisdictions.slice(0, SAMPLE_SIZE);
const arrangements: typeof pilot.arrangements = [];

// Referential completeness: keep every source whose id is referenced anywhere in
// the selected jurisdiction records (source_refs, evidence, etc.).
const selectedJson = JSON.stringify(jurisdictions);
const sources = pilot.sources.filter(source => selectedJson.includes(source.id));

const out = {
  shadow_release_id: pilot.shadow_release_id,
  sources,
  jurisdictions,
  arrangements,
};
const target = path.join(ROOT, 'scripts/lib/canonical-pilot.sample.json');
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `wrote ${path.relative(ROOT, target)}: `
  + `${jurisdictions.length} jurisdictions, ${sources.length} sources, `
  + `${arrangements.length} arrangements, `
  + `${jurisdictions.reduce((n, j) => n + j.routes.length, 0)} routes`,
);

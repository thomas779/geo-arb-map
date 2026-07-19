#!/usr/bin/env bun
/**
 * `bun run data:build` — the single deterministic release compiler.
 *
 * Reads the canonical revision scope from local SQLite, combines the migrated
 * canonical pilot with the read-only legacy remainder, compiles the public
 * release artifact set, runs the parity gates, and writes a draft release
 * bundle under `.generated/data-canonical/releases/<release_id>/`.
 *
 * It does not approve D1 revisions, publish a release, replace `public/*.json`,
 * or deploy the website. It fails non-zero when any parity gate fails so CI can
 * gate cutover on a clean build.
 */
import { compileDataRelease, writeDataRelease } from './lib/data-build';

const release = compileDataRelease();
const output = writeDataRelease(release);
release.database.close();

const gateFailures = release.parity.gates.filter(gate => gate.status === 'fail');
if (gateFailures.length > 0 || !release.parity.passed) {
  for (const gate of gateFailures) {
    console.error(`parity gate ${gate.gate} FAILED:`);
    console.error(JSON.stringify(gate.detail, null, 2));
  }
  console.error(
    `\ndata:build ${release.manifest.release_id} wrote ${output} but parity FAILED — `
    + 'do not cutover or deploy.',
  );
  process.exit(1);
}

const sanctioned = release.compatibility_diff.mobility
  .concat(release.compatibility_diff.citizenship);
console.log(
  `data:build ${release.manifest.release_id}: `
  + `${release.manifest.counts.canonical_entities} canonical entities, `
  + `${release.manifest.counts.routes} routes, `
  + `${release.manifest.counts.edges} edges, `
  + `${sanctioned.length} sanctioned compatibility diff(s)`,
);
console.log(output);

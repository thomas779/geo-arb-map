#!/usr/bin/env bun
/**
 * `bun run data:build` — the single deterministic release compiler.
 *
 * Reads reviewed canonical records from a persistent SQLite database (the local
 * mirror produced by `bun run data:db`, or a `wrangler d1 export` passed via
 * --db), reconstructs the public shapes, derives the complete graph, runs the
 * parity gates, and writes a draft release bundle under
 * `.generated/data-canonical/releases/<release_id>/`.
 *
 * It does not approve D1 revisions, publish a release, replace `public/*.json`,
 * or deploy the website. It fails non-zero when any parity gate fails so CI can
 * gate cutover on a clean build.
 *
 * Usage:
 *   bun run data:build [--db <path>] [--mode draft|approved]
 *   bun run data:build -- --db <path> --mode release --release <release_id>
 *   bun run data:build -- --baseline <prior_release_id>
 */
import {
  compileDataRelease,
  writeDataRelease,
  type CompileSelectionMode,
} from './lib/data-build';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const dbPath = arg('--db');
const baselineReleaseId = arg('--baseline');
const modeValue = arg('--mode') ?? 'draft';
if (!['draft', 'approved', 'release'].includes(modeValue)) {
  throw new Error(`Unsupported --mode ${modeValue}; expected draft, approved, or release`);
}
const selectionMode = modeValue as CompileSelectionMode;
const releaseId = arg('--release');

const release = compileDataRelease({
  dbPath,
  baselineReleaseId,
  selectionMode,
  releaseId,
});
const output = writeDataRelease(release);

const failed = release.parity.gates.filter(gate => gate.status === 'fail');
if (failed.length > 0 || !release.parity.passed) {
  for (const gate of failed) {
    console.error(`parity gate ${gate.gate} FAILED:`);
    console.error(JSON.stringify(gate.detail, null, 2));
  }
  console.error(
    `\ndata:build ${release.manifest.release_id} wrote ${output} but parity FAILED — `
    + 'do not cutover or deploy.',
  );
  process.exit(1);
}

const sanctionedGraph = release.compatibility_diff.graph.filter(d =>
  d.kind === 'added').length;
console.log(
  `data:build ${release.manifest.release_id} `
  + `(db: ${release.input.database_path}, mode: ${release.manifest.database.selection_mode}): `
  + `${release.manifest.counts.canonical_entities} canonical entities, `
  + `${release.manifest.counts.routes} routes, `
  + `${release.manifest.counts.graph_edges} graph edges, `
  + `${release.compatibility_diff.mobility.length} mobility diff(s), `
  + `${sanctionedGraph} sanctioned graph diff(s)`,
);
console.log(output);

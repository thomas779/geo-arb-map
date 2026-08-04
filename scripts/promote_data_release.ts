#!/usr/bin/env bun
/** Promote one parity-clean canonical release into the static Atlas artifact. */
import fs from 'node:fs';
import path from 'node:path';
import {
  compileDataRelease,
  REPO_ROOT,
  writeDataRelease,
  type CompileSelectionMode,
} from './lib/data-build';
import {
  assertPromotionPreservesHead,
  readHeadPromotionArtifact,
} from './lib/promotion-guard';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const allowDraft = process.argv.includes('--allow-draft');
const selectionMode = (arg('--mode') ?? (allowDraft ? 'draft' : 'approved')) as CompileSelectionMode;
if (!['draft', 'approved', 'release'].includes(selectionMode)) {
  throw new Error(`Unsupported --mode ${selectionMode}`);
}
if (selectionMode === 'draft' && !allowDraft) {
  throw new Error('Draft promotion requires the explicit --allow-draft flag');
}

const release = compileDataRelease({
  dbPath: arg('--db'),
  selectionMode,
  releaseId: arg('--release'),
});
if (!release.parity.passed) throw new Error('Cannot promote a release with failed parity gates');

// A parity-clean candidate can still be stale relative to work already
// published (flag-paths-data / last local promote). Compare against that
// baseline before writing so a promotion cannot silently erase reviewed
// routes merely because the private canonical authoring file was not
// reconciled first. Git HEAD no longer carries the corpus (gitignored).
assertPromotionPreservesHead(
  readHeadPromotionArtifact(REPO_ROOT),
  release.frontend.citizenship,
);

writeDataRelease(release);
fs.writeFileSync(
  path.join(REPO_ROOT, 'data/compiled/citizenship_routes.json'),
  `${JSON.stringify(release.frontend.citizenship, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(REPO_ROOT, 'public/data_release.json'),
  `${JSON.stringify({
    release_id: release.manifest.release_id,
    selection_mode: release.manifest.database.selection_mode,
    generated_at: release.manifest.created_at,
  }, null, 2)}\n`,
);

console.log(
  `promoted ${release.manifest.release_id} (${selectionMode}) to data/compiled/citizenship_routes.json`,
);

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

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const selectionMode = (arg('--mode') ?? 'approved') as CompileSelectionMode;
if (!['draft', 'approved', 'release'].includes(selectionMode)) {
  throw new Error(`Unsupported --mode ${selectionMode}`);
}
if (selectionMode === 'draft' && !process.argv.includes('--allow-draft')) {
  throw new Error('Draft promotion requires the explicit --allow-draft flag');
}

const release = compileDataRelease({
  dbPath: arg('--db'),
  selectionMode,
  releaseId: arg('--release'),
});
if (!release.parity.passed) throw new Error('Cannot promote a release with failed parity gates');

writeDataRelease(release);
fs.writeFileSync(
  path.join(REPO_ROOT, 'public/citizenship_routes.json'),
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
  `promoted ${release.manifest.release_id} (${selectionMode}) to public/citizenship_routes.json`,
);

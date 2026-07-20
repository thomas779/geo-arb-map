#!/usr/bin/env bun
import { compileDataRelease, writeDataRelease } from './lib/data-build';
import { writeDataReview } from './lib/data-review';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const release = compileDataRelease({
  dbPath: arg('--db'),
  selectionMode: 'draft',
});

if (!release.parity.passed) {
  throw new Error('Cannot create a review packet from a release that failed parity');
}
if (release.api_release_rows.some(row => row.review_status !== 'draft')) {
  throw new Error('Review packets require an all-draft revision scope');
}

writeDataRelease(release);
const output = writeDataReview(release);
console.log(
  `data:review ${release.manifest.release_id}: `
    + `${release.api_release_rows.length} draft revisions, `
    + `${release.manifest.counts.routes} routes`,
);
console.log(output);

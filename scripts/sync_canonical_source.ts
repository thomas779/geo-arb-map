#!/usr/bin/env bun
/**
 * Keep the master dataset in sync with the private `flag-paths-data` repo.
 *
 * `scripts/lib/canonical-pilot.ts` (1.5MB) and `data/citizenship_routes.json` are
 * gitignored here, because they are not public data. Until 17 August 2026 they were
 * version-controlled NOWHERE — loose files inside whichever working copy you happened
 * to be in. That lost a day of work: two sessions edited separate copies, both
 * published, and the second publish rolled the corpus back from 41 ancestry facet
 * countries to 10 with the `origin_based` bucket gone entirely. Nothing failed,
 * because `data:publish` overwrites `compiled/` and commits over the top, and git had
 * no view of the source to compare against.
 *
 * WHY THIS IS A COPY AND NOT A LINK, since that looks like the obvious fix:
 *   - A SYMLINK breaks the build. Bun resolves the link to its real path and then
 *     resolves `./canonical-schema` relative to THAT, so the pilot's imports fail.
 *   - A HARD LINK is worse: it works, until an editor writes via temp-file-plus-rename,
 *     which silently allocates a new inode. Measured on this repo — one Edit and the
 *     two paths had different inodes with no error and no warning. A link that looks
 *     connected and is not is the same accident with better camouflage.
 *
 * So: real files, explicit sync, and a guard that makes staleness loud.
 *
 *   bun run data:source pull     copy repo -> working copy (refuses to clobber local edits)
 *   bun run data:source push     copy working copy -> repo, commit, push
 *   bun run data:source check    exit 1 if working copy and repo differ (used as a preflight)
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const repo = process.env.FLAG_PATHS_DATA
  ?? path.resolve(root, '..', 'flag-paths-data');

/** Master files, as [path inside this checkout, path inside the data repo]. */
const FILES: Array<[string, string]> = [
  ['scripts/lib/canonical-pilot.ts', 'source/canonical-pilot.ts'],
  ['data/citizenship_routes.json', 'source/citizenship_routes.json'],
];

const sha = (file: string) =>
  fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;

const short = (digest: string | null) => (digest ? digest.slice(0, 12) : 'ABSENT');

function requireRepo(): void {
  if (fs.existsSync(path.join(repo, 'source'))) return;
  console.error(
    `flag-paths-data not found at ${repo}\n`
    + '  git clone git@github.com:thomas779/flag-paths-data.git, beside this checkout,\n'
    + '  or set FLAG_PATHS_DATA to where it lives.',
  );
  process.exit(2);
}

function compare() {
  return FILES.map(([local, remote]) => {
    const a = sha(path.join(root, local));
    const b = sha(path.join(repo, remote));
    return { local, remote, a, b, same: a !== null && a === b };
  });
}

const mode = process.argv[2] ?? 'check';
requireRepo();
const rows = compare();

for (const row of rows) {
  console.log(`${row.same ? ' ok ' : 'DIFF'}  ${row.local}\n        working ${short(row.a)}  repo ${short(row.b)}`);
}

if (mode === 'check') {
  const drifted = rows.filter(row => !row.same);
  if (drifted.length) {
    console.error(
      `\n${drifted.length} master file(s) differ from flag-paths-data.\n`
      + '  `bun run data:source pull` to take the repo version,\n'
      + '  `bun run data:source push` to publish yours.\n'
      + 'Do not promote from here until they agree — that is how a corpus gets rolled back.',
    );
    process.exit(1);
  }
  console.log('\nmaster files agree with flag-paths-data.');
  process.exit(0);
}

if (mode === 'pull') {
  for (const row of rows) {
    if (row.same) continue;
    // Refuse to silently discard local work. The whole point is that a divergence is
    // a decision, not a default.
    if (row.a !== null && row.b !== null && process.argv[3] !== '--force') {
      console.error(
        `\n${row.local} differs and would be overwritten.\n`
        + '  Inspect it, then re-run with --force if the repo version is the one you want.',
      );
      process.exit(1);
    }
    fs.copyFileSync(path.join(repo, row.remote), path.join(root, row.local));
    console.log(`pulled ${row.local}`);
  }
  process.exit(0);
}

if (mode === 'push') {
  for (const row of rows) {
    if (row.same) continue;
    fs.copyFileSync(path.join(root, row.local), path.join(repo, row.remote));
    console.log(`staged ${row.remote}`);
  }
  console.log(
    '\nStaged into flag-paths-data. Commit and push there — a concurrent session then\n'
    + 'gets a non-fast-forward rejection instead of silently overwriting your corpus.',
  );
  process.exit(0);
}

console.error(`unknown mode: ${mode} (expected pull, push or check)`);
process.exit(2);

#!/usr/bin/env bun
/**
 * Publish the promoted dataset to the private flag-paths-data repo.
 *
 * The compiled corpus is a build input rather than a committed artifact here, so
 * CI and the deploy read it from flag-paths-data. That makes a forgotten push a
 * silent staleness bug: the atlas would deploy yesterday's data while the local
 * checkout looks correct. This script closes that gap, and refuses to publish
 * anything the local pipeline has not already validated.
 *
 * Usage (maintainer checkout, after data:promote):
 *   bun run data:publish              # commit + push
 *   bun run data:publish -- --dry-run # show the diff, change nothing
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const workdir = path.join(root, '.generated/flag-paths-data');
const remote = 'git@github.com:thomas779/flag-paths-data.git';
const dryRun = process.argv.includes('--dry-run');

function run(command: string, args: string[], cwd = workdir): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

const compiled = path.join(root, 'data/compiled/citizenship_routes.json');
const legacy = path.join(root, 'data/citizenship_routes.json');
for (const file of [compiled, legacy]) {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing; run bun run data:promote first`);
}

// Never publish a corpus the pipeline would reject: a truncated or sample-built
// release must not reach the source the deploy reads.
const routes = (JSON.parse(fs.readFileSync(compiled, 'utf8')) as { routes: unknown[] }).routes.length;
if (routes < 500) {
  throw new Error(`refusing to publish a ${routes}-route corpus; expected a full release`);
}

if (!fs.existsSync(workdir)) {
  fs.mkdirSync(path.dirname(workdir), { recursive: true });
  run('git', ['clone', '--quiet', remote, workdir], root);
} else {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  run('git', ['reset', '--hard', '--quiet', 'origin/main']);
}

fs.mkdirSync(path.join(workdir, 'compiled'), { recursive: true });
fs.copyFileSync(compiled, path.join(workdir, 'compiled/citizenship_routes.json'));
fs.copyFileSync(legacy, path.join(workdir, 'compiled/citizenship_routes.legacy.json'));

const status = run('git', ['status', '--porcelain']);
if (!status) {
  console.log('flag-paths-data is already current; nothing to publish.');
  process.exit(0);
}

const release = (() => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(root, 'public/data_release.json'), 'utf8')) as
      { release_id?: string }).release_id ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

const diff = run('git', ['diff', '--stat', '--', 'compiled']);
console.log(`release ${release}, ${routes} routes`);
console.log(diff || status);

if (dryRun) {
  console.log('\nDry run only; pass no flag to publish.');
  process.exit(0);
}

run('git', ['add', 'compiled']);
run('git', ['commit', '--quiet', '-m', `data: release ${release} (${routes} routes)`]);
run('git', ['push', '--quiet', 'origin', 'main']);
console.log(`published release ${release} to flag-paths-data`);

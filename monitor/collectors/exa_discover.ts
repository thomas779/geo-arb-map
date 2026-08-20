#!/usr/bin/env bun
/**
 * Backward-compatible Exa-only entrypoint.
 * Prefer `bun run monitor:web-discover` for Exa + Tavily + Firecrawl.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type { DiscoverLead as ExaLead } from './web_providers/shared';
export { annotateAlreadyHeld } from './web_providers/shared';

if (import.meta.main) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const child = path.join(root, 'monitor', 'collectors', 'web_discover.ts');
  const args = ['run', child, '--', '--providers', 'exa', ...process.argv.slice(2)];
  const result = spawnSync('bun', args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

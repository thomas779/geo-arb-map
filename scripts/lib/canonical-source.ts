// Resolver for the canonical dataset source.
//
// The master dataset (canonical-pilot.ts) is gitignored and present only in the
// maintainer's environment. When it is absent (forks / public CI), fall back to
// the committed sample so the app, build, and pipeline tests still run. Content
// tests that assert on the full reviewed dataset gate themselves on
// CANONICAL_SOURCE_IS_SAMPLE.
//
// Node/Bun-side only (build scripts + tests) — never imported by the browser app.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CanonicalPilot } from './canonical-pilot-types';

const require = createRequire(import.meta.url);
const realPath = fileURLToPath(new URL('./canonical-pilot.ts', import.meta.url));

export const CANONICAL_SOURCE_IS_SAMPLE = !existsSync(realPath);

const mod = require(
  CANONICAL_SOURCE_IS_SAMPLE ? './canonical-pilot.sample' : './canonical-pilot',
) as { buildCanonicalPilot: (shadow?: unknown) => CanonicalPilot };

export function buildCanonicalPilot(shadow?: unknown): CanonicalPilot {
  return mod.buildCanonicalPilot(shadow);
}

export type { CanonicalPilot } from './canonical-pilot-types';

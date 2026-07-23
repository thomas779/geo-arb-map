// Public fallback dataset, used when the private master canonical-pilot.ts is
// absent (forks / public CI). It is a small, referentially-complete subset of
// the real data (regenerate with `bun scripts/build_canonical_sample.ts`).
//
// This mirrors the assembly tail of the real buildCanonicalPilot so that
// release_id and manifest are computed identically — the build/parity pipeline
// treats it exactly like the real thing, just with fewer jurisdictions.

import { createHash } from 'node:crypto';
import type { SourceRecord, JurisdictionRecord, ArrangementRecord } from './canonical-schema';
import type { CanonicalPilot } from './canonical-pilot-types';
import sample from './canonical-pilot.sample.json';

function hash(value: unknown, length = 64): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

export function buildCanonicalPilot(): CanonicalPilot {
  const content = {
    sources: sample.sources as unknown as SourceRecord[],
    jurisdictions: sample.jurisdictions as unknown as JurisdictionRecord[],
    arrangements: sample.arrangements as unknown as ArrangementRecord[],
    shadow_release_id: sample.shadow_release_id as string,
  };
  const releaseId = hash(content, 16);
  return {
    ...content,
    release_id: releaseId,
    manifest: {
      schema_version: 1,
      mode: 'canonical_candidate',
      release_id: releaseId,
      shadow_release_id: content.shadow_release_id,
      counts: {
        sources: content.sources.length,
        jurisdictions: content.jurisdictions.length,
        arrangements: content.arrangements.length,
        routes: content.jurisdictions.reduce((n, j) => n + j.routes.length, 0),
      },
    },
  };
}

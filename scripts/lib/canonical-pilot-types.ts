// Public type surface for the canonical pilot, split out so that consumers can
// depend on the shape without importing the (gitignored, maintainer-only)
// canonical-pilot.ts data module. Keep this in sync with the CanonicalPilot
// interface in canonical-pilot.ts.

import type { SourceRecord, JurisdictionRecord, ArrangementRecord } from './canonical-schema';

export interface CanonicalPilot {
  shadow_release_id: string;
  release_id: string;
  sources: SourceRecord[];
  jurisdictions: JurisdictionRecord[];
  arrangements: ArrangementRecord[];
  manifest: {
    schema_version: 1;
    mode: 'canonical_candidate';
    release_id: string;
    shadow_release_id: string;
    counts: {
      sources: number;
      jurisdictions: number;
      arrangements: number;
      routes: number;
    };
  };
}

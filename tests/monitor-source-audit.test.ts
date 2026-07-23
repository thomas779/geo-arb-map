import { describe, expect, test } from 'bun:test';
import registry from '../data/registry.json';
import manifest from '../monitor/sources/manifest.json';
import {
  buildMonitoringCoverageAudit,
  type JurisdictionRegistry,
  type SourceManifest,
} from '../monitor/sources/audit';
import { buildCanonicalPilot, CANONICAL_SOURCE_IS_SAMPLE } from '../scripts/lib/canonical-source';

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('monitoring source coverage audit', () => {
  const canonical = buildCanonicalPilot();
  const audit = buildMonitoringCoverageAudit(
    registry as JurisdictionRegistry,
    manifest as SourceManifest,
    canonical,
  );

  test('covers the registry without maintaining a second country list', () => {
    expect(audit.summary.sovereigns).toBe(200);
    expect(audit.summary.registry_jurisdictions).toBe(240);
    expect(audit.jurisdictions).toHaveLength(240);
  });

  test('keeps canonical monitoring references aligned with the source manifest', () => {
    expect(audit.structural_errors).toEqual([]);
  });

  test('does not confuse global discovery with active official verification', () => {
    expect(audit.global_discovery_sources.some(source => source.id === 'globalcit-rss')).toBe(true);
    expect(audit.summary.jurisdictions_with_active_verification).toBeGreaterThanOrEqual(22);
    for (const jurisdiction of canonical.jurisdictions) {
      expect(audit.jurisdictions.find(
        item => item.iso_n3 === jurisdiction.jurisdiction.iso_n3,
      )?.gaps).not.toContain('no_active_verification_source');
    }
  });
});

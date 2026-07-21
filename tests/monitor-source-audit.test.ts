import { describe, expect, test } from 'bun:test';
import registry from '../data/registry.json';
import manifest from '../monitor/sources/manifest.json';
import {
  buildMonitoringCoverageAudit,
  type JurisdictionRegistry,
  type SourceManifest,
} from '../monitor/sources/audit';
import { buildCanonicalPilot } from '../scripts/lib/canonical-pilot';

describe('monitoring source coverage audit', () => {
  const canonical = buildCanonicalPilot();
  const audit = buildMonitoringCoverageAudit(
    registry as JurisdictionRegistry,
    manifest as SourceManifest,
    canonical,
  );

  test('covers the registry without maintaining a second country list', () => {
    expect(audit.summary.sovereigns).toBe(200);
    expect(audit.summary.registry_jurisdictions).toBe(239);
    expect(audit.jurisdictions).toHaveLength(239);
  });

  test('keeps canonical monitoring references aligned with the source manifest', () => {
    expect(audit.structural_errors).toEqual([]);
  });

  test('does not confuse global discovery with active official verification', () => {
    expect(audit.global_discovery_sources.some(source => source.id === 'globalcit-rss')).toBe(true);
    expect(audit.summary.jurisdictions_with_active_verification).toBeGreaterThanOrEqual(1);
    expect(audit.jurisdictions.find(item => item.iso_n3 === '724')?.gaps)
      .toContain('no_active_verification_source');
  });
});

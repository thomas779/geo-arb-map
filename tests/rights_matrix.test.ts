import { describe, test, expect } from 'bun:test';
import { buildCanonicalPilot, CANONICAL_SOURCE_IS_SAMPLE } from '../scripts/lib/canonical-source';

const pilot = buildCanonicalPilot() as unknown as {
  arrangements: Array<{
    id: string;
    rights_matrix?: {
      citizenship: { reside: string; work: string; conditions: string[]; detail: string };
      temporary_residence: { reside: string; work: string };
      permanent_residence: { reside: string; work: string };
      source_refs: unknown[];
    };
  }>;
};
const withMatrix = pilot.arrangements.filter(a => a.rights_matrix);
const byId = new Map(pilot.arrangements.map(a => [a.id, a]));

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('structured rights (#154)', () => {
  test('every sourced bloc carries a matrix', () => {
    expect(withMatrix.length).toBe(12);
  });

  test('residence and work are separate measures, not one flag', () => {
    // The whole reason A2 was impossible: a residence-only right used to score as
    // labour-market access. ECOWAS is the live proof they now diverge — its entry
    // right is recorded while its work right is unknown.
    const ecowas = byId.get('ecowas')!.rights_matrix!;
    expect(ecowas.citizenship.reside).not.toBe('unknown');
    expect(ecowas.citizenship.work).toBe('unknown');
  });

  test('ECOWAS records entry, not bloc-wide residence', () => {
    // Verified against Protocol A/P.1/5/79 art. 2: the right of entry, residence and
    // establishment is "progressively established" across three phases, and this
    // Protocol implements Phase I only. The recorded prose said "entry + residency
    // rights bloc-wide", which overstates the instrument.
    const ecowas = byId.get('ecowas')!.rights_matrix!;
    expect(ecowas.citizenship.reside).toBe('conditional');
    expect(ecowas.citizenship.conditions).toContain('phase_ii_not_sourced');
  });

  test('a conditional grant names its gate', () => {
    // An unexplained "conditional" is barely better than prose. CSME's gate is the
    // CARICOM Skills Certificate.
    for (const arrangement of withMatrix) {
      const grant = arrangement.rights_matrix!.citizenship;
      if (grant.reside === 'conditional' || grant.work === 'conditional') {
        expect(
          grant.conditions.length,
          `${arrangement.id} is conditional but names no condition`,
        ).toBeGreaterThan(0);
      }
    }
    expect(byId.get('csme')!.rights_matrix!.citizenship.conditions).toContain('skills_certificate');
  });

  test('TR and PR are unknown rather than guessed', () => {
    // The recorded prose describes what CITIZENSHIP confers and says almost nothing
    // about what a temporary or permanent resident of one member gets in another.
    // Inferring it would be the guess this project keeps getting caught by.
    for (const arrangement of withMatrix) {
      expect(arrangement.rights_matrix!.temporary_residence.reside).toBe('unknown');
      expect(arrangement.rights_matrix!.permanent_residence.reside).toBe('unknown');
    }
  });

  test('every matrix cites the arrangement it came from', () => {
    for (const arrangement of withMatrix) {
      expect(
        arrangement.rights_matrix!.source_refs.length,
        `${arrangement.id} matrix has no source_refs`,
      ).toBeGreaterThan(0);
    }
  });
});

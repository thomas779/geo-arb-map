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

  test('the five corrections from reading instruments are pinned', () => {
    // Reading 9 instruments corrected 5 rows, every one in the same direction: the
    // prose overstated what the instrument confers. Each is pinned so a later edit
    // cannot quietly restore the prose reading.

    // ECOWAS Protocol A/P.1/5/79 art. 2: entry is Phase I, residence is Phase II.
    expect(byId.get('ecowas')!.rights_matrix!.citizenship.conditions)
      .toContain('phase_ii_not_sourced');

    // EAEU art. 97(5): stay "shall depend on the duration of an employment contract",
    // so this is a work right, not a settle-by-right bloc.
    expect(byId.get('eaeu')!.rights_matrix!.citizenship.conditions)
      .toContain('employment_contract');

    // OECS art. 12.5 lets a Protocol Member State regulate movement, and art. 12.1
    // binds Protocol members rather than all seven OECS members.
    const oecs = byId.get('oecs')!.rights_matrix!.citizenship;
    expect(oecs.reside).toBe('conditional');
    expect(oecs.conditions).toContain('member_may_regulate_movement');

    // The big one. Directive 2004/38/EC art. 6 gives three months unconditionally;
    // art. 7(1) makes anything longer conditional on being a worker, self-sufficient
    // or a student; only art. 16 permanent residence, after five years, is
    // unconditional. The row previously said `indefinite` with no conditions, which
    // is the single assumption the settle-by-right counts leaned on hardest.
    const eu = byId.get('eu_eea')!.rights_matrix!.citizenship;
    expect(eu.reside).toBe('conditional');
    expect(eu.conditions).toContain('economic_activity_or_self_sufficiency');
    expect(eu.conditions).toContain('unconditional_after_five_years');

    // Union State art. 14(5) grants equal rights "unless otherwise provided by the
    // legislative acts of the participating states", and art. 14(6) leaves the legal
    // position to national law entirely. An equal-treatment clause subordinated to
    // national law is not a right to reside.
    const union = byId.get('union_state')!.rights_matrix!.citizenship;
    expect(union.reside).toBe('conditional');
    expect(union.work).toBe('conditional');
    expect(union.conditions).toContain('subject_to_national_law');
  });

  test('a cited instrument that governs something else does not count as verified', () => {
    // The CTA row cited Immigration Act 1971 s.1(3) for mutual settlement. Reading it
    // showed it removes control from arrivals "on a local journey" and defines the
    // common travel area: a provision keyed to the JOURNEY, not to nationality, and
    // conferring no settlement. Reading a citation and finding it misfits is a
    // verification failure, not a verification, so the row stays prose-derived.
    const cta = byId.get('cta')!.rights_matrix!.citizenship;
    expect(cta.detail).toStartWith('UNVERIFIED');
    expect(cta.detail).toContain('local journey');
  });

  test('prose-derived rows are labelled UNVERIFIED, instrument-read ones are not', () => {
    // Populated is not verified. Without this marker "A1 12/24" reads as though all
    // twelve were checked, when five were.
    const verified = withMatrix.filter(a => !a.rights_matrix!.citizenship.detail.startsWith('UNVERIFIED'));
    expect(verified.length).toBe(8);
    expect(verified.map(a => a.id).sort())
      .toEqual(['can', 'eaeu', 'ecowas', 'eu_eea', 'mercosur', 'oecs', 'ttta', 'union_state']);
    // Three cannot be read by automation at all: CARICOM and the EAC 403 every
    // fetch, and the Nordic 1982 agreement returns an empty body. They must stay
    // marked rather than inherit the confidence of the eight that were read.
    for (const id of ['csme', 'eac', 'npu']) {
      expect(byId.get(id)!.rights_matrix!.citizenship.detail).toStartWith('UNVERIFIED');
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

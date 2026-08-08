import { describe, test, expect } from 'bun:test';
import {
  classifyJusSoli,
  FAMILY_OPENNESS,
  JUS_SOLI_FAMILIES,
  type JusSoliFamily,
} from '../scripts/lib/jus-soli';

const family = (jusSoli: string | undefined, condition: string | undefined, summary = '') =>
  classifyJusSoli(jusSoli, condition, summary).family;

describe('the four mislabels this exists to catch', () => {
  test('Chile is unconditional with an exception, not a settled-parent rule', () => {
    // Recorded as parent_condition 'settled', which put it beside Germany. Its own
    // summary says birthright applies except to children of transient foreigners,
    // which belongs with Argentina.
    expect(family('conditional', 'settled',
      'Persons born in Chilean territory are Chilean by birth, except children of transient '
      + 'foreigners or of foreigners who are in Chile in the service of their government.'))
      .toBe('unconditional_with_exceptions');
  });

  test('a citizen-parent requirement is descent, not territorial birthright', () => {
    // Bahamas, Nauru, Vanuatu. Birth in the territory adds nothing over descent,
    // so openness is 0 rather than a middling "conditional" score.
    expect(family('conditional', 'parent_citizen',
      'A person born in Nauru is a citizen at birth if either parent is a citizen.'))
      .toBe('parent_citizen');
    // Mauritius reaches the same place through a date cutoff.
    expect(family('conditional', 'date_and_parent',
      'Birth in Mauritius before 1 October 1995 generally conferred citizenship regardless of '
      + 'parentage; after that date, at least one parent must be a Mauritian citizen.'))
      .toBe('parent_citizen');
    expect(FAMILY_OPENNESS.parent_citizen).toBe(0);
  });

  test('an entitlement to acquire at 13, 16 or 18 is not birthright', () => {
    // France and Italy. At birth these are statelessness safeguards; the residence
    // route is a later acquisition with its own clock.
    expect(family('conditional', 'residence',
      'Birth in France alone is not generally enough. Limited parentage or statelessness cases '
      + 'confer citizenship at birth; otherwise a child of foreign parents can acquire it from '
      + 'age 13, 16, or automatically at 18.'))
      .toBe('later_acquisition_not_birth');
  });

  test('a safeguard is recognised even when the word "stateless" is absent', () => {
    // Bulgaria and Türkiye describe the substance without the word, and matching
    // only the literal term left both unclassified.
    expect(family('conditional', 'stateless_or_unknown',
      'A person born in Bulgaria is a citizen by place of birth if they do not acquire another '
      + 'citizenship by origin.')).toBe('stateless_safeguard');
    expect(family('conditional', 'stateless_or_unknown',
      'A child born in Türkiye who cannot acquire any nationality from the parents becomes '
      + 'Turkish from birth.')).toBe('stateless_safeguard');
  });
});

describe('dependent territories defer rather than score', () => {
  test('a metropole pointer wins over any condition label', () => {
    const finding = classifyJusSoli('conditional', 'parent_or_settled',
      'Citizenship at birth in Bermuda follows British Overseas Territories Citizenship rules.');
    expect(finding.family).toBe('follows_metropole');
    expect(finding.defers_to).toBe('United Kingdom');
  });

  test('the pointer beats a statelessness mention in the same summary', () => {
    // Order matters: a territory's summary may mention statelessness because the
    // metropole's rule does. Deferring is the stronger signal, since the route has
    // no rule of its own to classify.
    expect(family('conditional', 'double_jus_soli',
      'Citizenship at birth in Aruba follows Dutch nationality rules, including stateless cases.'))
      .toBe('follows_metropole');
  });

  test('deferring routes are unscoreable rather than zero', () => {
    // Scoring them on their own would double-count the metropole's rule; scoring
    // them zero would say the territory has no birthright at all.
    expect(FAMILY_OPENNESS.follows_metropole).toBeNull();
    expect(FAMILY_OPENNESS.needs_review).toBeNull();
  });
});

describe('what it refuses to decide', () => {
  test('a terse condition it cannot read returns needs_review, not a guess', () => {
    // Costa Rica's `registration`. Guessing here is what produced the mislabels
    // this module exists to find.
    const finding = classifyJusSoli('conditional', 'registration',
      'Article 13 nationality by birth rules: Costa Rican parentage, birth in Costa Rica with '
      + 'registration for foreign parents, birth abroad with registration, and foundlings.');
    expect(finding.family).toBe('needs_review');
    expect(finding.basis).toContain('registration');
  });

  test('the tri-state is trusted where it is not contradicted', () => {
    expect(family('none', 'none', 'No jus soli.')).toBe('none');
    expect(family('unconditional', 'none', 'Anyone born here is a citizen.')).toBe('unconditional');
  });

  test('a missing tri-state is reviewed, never defaulted to none', () => {
    // Defaulting to `none` would silently assert a sourced negative finding.
    expect(family(undefined, undefined, '')).toBe('needs_review');
  });
});

describe('the openness scale', () => {
  test('every family has an entry, so a new one cannot score undefined', () => {
    for (const f of JUS_SOLI_FAMILIES) {
      expect(FAMILY_OPENNESS).toHaveProperty(f);
    }
  });

  test('a statelessness safeguard scores far below a settled-parent rule', () => {
    // The flat `conditional` label scored them identically, which materially
    // overstated Georgia, Serbia and Türkiye against Germany.
    expect(FAMILY_OPENNESS.stateless_safeguard!).toBeLessThan(FAMILY_OPENNESS.parent_settled!);
  });

  test('the scale is ordered from unconditional down to none', () => {
    const ordered: JusSoliFamily[] = [
      'unconditional', 'unconditional_with_exceptions', 'parent_lawful_residence',
      'double_jus_soli', 'residence_plus_integration', 'parent_settled',
      'stateless_safeguard', 'none',
    ];
    const scores = ordered.map(f => FAMILY_OPENNESS[f]!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

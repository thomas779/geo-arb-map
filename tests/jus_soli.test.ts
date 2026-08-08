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

describe('limbs are alternatives, so the most open one decides', () => {
  // A first-match-wins classifier scored each route by whichever regex it reached
  // first. Running it over the live corpus mislabelled six routes in BOTH
  // directions, which is why this now collects limbs instead of returning one.

  test('a statelessness exception does not demote a real residence rule', () => {
    // Colombia. The rule is parental domicile; statelessness is "a separate
    // exception" in its own clause. Matching the word first scored it 5 instead of
    // 55, understating it by 50 points.
    const finding = classifyJusSoli('conditional', 'domicile',
      'A child born in Colombia to foreign parents is Colombian by birth when at least one parent '
      + 'was domiciled in Colombia at the time of birth; a separate exception protects a child whom '
      + 'no state recognizes as a national.');
    expect(finding.family).toBe('parent_lawful_residence');
    expect(finding.families).toContain('stateless_safeguard');
    expect(finding.openness).toBe(FAMILY_OPENNESS.parent_lawful_residence);
  });

  test('three alternative limbs score as the widest, not the narrowest', () => {
    // São Tomé: citizen parent OR stateless parents OR resident foreign parents.
    // A child qualifies under any one, so the residence limb is what the score
    // should reflect.
    const finding = classifyJusSoli('conditional', 'parent_or_stateless',
      'A person born in São Tomé and Príncipe is of origin nationality when a parent is '
      + 'São-tomense, when the parents are stateless or of unknown nationality, or when foreign '
      + 'parents reside in the territory and are not in the service of another state.');
    expect(finding.family).toBe('parent_lawful_residence');
    expect(finding.openness).toBe(55);
  });

  test('two birth limbs are not a later-acquisition route', () => {
    // Belgium. Article 10 is a safeguard and article 11 is double jus soli, and BOTH
    // operate at birth. Firing on "No unconditional jus soli" alone labelled it a
    // later acquisition, which is a claim about a route it does not have.
    const finding = classifyJusSoli('conditional', 'born_in_country',
      'No unconditional jus soli, but two statutory birth-in-Belgium routes exist: a child born in '
      + 'Belgium who would otherwise be stateless before eighteen is Belgian (article 10), and the '
      + 'second-generation double jus soli of article 11 makes a child Belgian where a parent was '
      + 'also born in Belgium and resided five of the ten years before the birth.');
    expect(finding.family).toBe('double_jus_soli');
    expect(finding.families).not.toContain('later_acquisition_not_birth');
  });

  test('residence as a precondition of a stateless grant is not a residence limb', () => {
    // Ukraine. Article 7 grants to a child of permanently resident foreigners only
    // "where the child acquires no other citizenship at birth". Both facts describe
    // ONE grant, so a child of resident foreigners who inherits a nationality gets
    // nothing. Reading the recorded `lawful_residence` as its own limb scored a
    // 5-point rule at 55.
    const finding = classifyJusSoli('conditional', 'lawful_residence',
      'No unconditional jus soli, but article 7 makes a child born to permanently resident '
      + 'foreigners a Ukrainian citizen where the child acquires no other citizenship at birth.');
    expect(finding.family).toBe('stateless_safeguard');
    expect(finding.families).not.toContain('parent_lawful_residence');
  });

  test('a child-residence clock is not parental residence', () => {
    // Australia. "or when the CHILD is ordinarily resident for the first ten years"
    // is a different rule from a parent's lawful residence, and reading it as one
    // overstated Australia by 25 points. It is acquisition on the tenth birthday,
    // so it belongs beside France.
    const finding = classifyJusSoli('conditional', 'settled',
      'A child born in Australia is a citizen when a parent is a citizen or permanent resident, or '
      + 'when the child is ordinarily resident in Australia for the first ten years of life.');
    expect(finding.family).toBe('parent_settled');
    expect(finding.families).toContain('later_acquisition_not_birth');
    expect(finding.families).not.toContain('parent_lawful_residence');
  });

  test('the widest limb wins even when it is the exception', () => {
    // Chile carries three limbs once statelessness and the `settled` label are read
    // alongside its own text. The birthright-with-exceptions limb is the widest and
    // must not be dragged down by the other two.
    const finding = classifyJusSoli('conditional', 'settled',
      'Persons born in Chilean territory are Chilean by birth, except children of transient '
      + 'foreigners or of foreigners who are in Chile in the service of their government. '
      + 'Statelessness safeguards and later option routes may apply to some excluded children.');
    expect(finding.family).toBe('unconditional_with_exceptions');
    expect(finding.openness).toBe(90);
    expect(finding.families.length).toBeGreaterThan(1);
  });

  test('the Crown Dependencies resolve their metropole', () => {
    // Guernsey, Jersey and the Isle of Man say "British citizenship rules", not
    // "British Overseas Territories". Matching only the latter left three routes
    // deferring to nobody.
    const finding = classifyJusSoli('conditional', 'parent_or_settled',
      'Citizenship at birth in Jersey follows British citizenship rules.');
    expect(finding.family).toBe('follows_metropole');
    expect(finding.defers_to).toBe('United Kingdom');
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

/**
 * Classify what a birth route's "conditional jus soli" flag actually means.
 *
 * `facts.jus_soli` is a tri-state (none / conditional / unconditional) sitting in
 * an untyped bag, and `facts.parent_condition` carries 16 free-text values with no
 * schema. The tri-state is broadly sound. The conditional third is not: reading
 * each route's own summary against its label, 39 of 59 disagree with themselves,
 * in ways that all push the same direction — they make a jurisdiction look more
 * open to territorial birthright than it is.
 *
 * Four failure modes, all present in the live data:
 *
 *  - **29 dependent territories** whose entire summary is "follows British Overseas
 *    Territories / New Zealand / Dutch rules". Their condition restates the
 *    metropole's rule, so scoring them individually double-counts one rule.
 *  - **Later acquisition sold as birthright.** France, Italy, Belgium and Ukraine
 *    say birth alone is not enough; the residence route is acquisition at 13, 16
 *    or 18. At birth these are statelessness safeguards.
 *  - **Citizen-parent rules mislabelled.** Bahamas, Nauru, Vanuatu and Mauritius
 *    require a citizen parent. That is jus sanguinis: birth in the territory adds
 *    nothing.
 *  - **Chile in the wrong bucket**, recorded as `settled` beside Germany while its
 *    own summary reads "Chilean by birth except children of transient foreigners",
 *    which is unconditional with a narrow exception and belongs with Argentina.
 *
 * This module is a re-encoding of what the corpus already records, exactly like
 * `descent-relations.ts`. It never upgrades a route on evidence the corpus does not
 * hold: anything the recorded text does not settle returns `needs_review`, which is
 * a finding in its own right and not a gap to be filled with a guess.
 */

export const JUS_SOLI_FAMILIES = [
  'unconditional',
  'unconditional_with_exceptions',
  'double_jus_soli',
  'parent_lawful_residence',
  'residence_plus_integration',
  'parent_settled',
  'stateless_safeguard',
  'later_acquisition_not_birth',
  'parent_citizen',
  'follows_metropole',
  'none',
  'needs_review',
] as const;

export type JusSoliFamily = (typeof JUS_SOLI_FAMILIES)[number];

/**
 * How open the family is to a child born in the territory to foreign parents,
 * 0 (no territorial birthright) to 100 (birth alone suffices).
 *
 * `null` means deliberately unscoreable, not zero. `follows_metropole` must score
 * from the parent jurisdiction rather than on its own, and `needs_review` has not
 * been established. Per the index spec, unrecorded is never zero and never a
 * favourable default.
 */
export const FAMILY_OPENNESS: Record<JusSoliFamily, number | null> = {
  unconditional: 100,
  unconditional_with_exceptions: 90,
  // Parent must also have been born there: a generational bar, not a status bar.
  double_jus_soli: 45,
  parent_lawful_residence: 55,
  residence_plus_integration: 35,
  parent_settled: 30,
  // Applies only to a child who would otherwise be stateless, so for almost every
  // family it confers nothing. Scoring it near a settled-parent rule, as the flat
  // `conditional` label does today, materially overstates these jurisdictions.
  stateless_safeguard: 5,
  // Citizenship exists at birth only by descent; the entitlement to acquire later
  // is a different route with its own clock.
  later_acquisition_not_birth: 5,
  // Birth in the territory adds nothing over descent.
  parent_citizen: 0,
  none: 0,
  follows_metropole: null,
  needs_review: null,
};

export interface JusSoliFinding {
  family: JusSoliFamily;
  /** 0..100, or null when the family is deliberately unscoreable. */
  openness: number | null;
  /** Which recorded field or phrase decided it, so a reviewer can check the call. */
  basis: string;
  /** Set when the route defers to another jurisdiction's rule. */
  defers_to?: string;
}

/** Metropole pointers, read off the summary's own wording. */
const METROPOLE: Array<[RegExp, string]> = [
  [/British Overseas Territories/i, 'United Kingdom'],
  [/New Zealand citizenship rules/i, 'New Zealand'],
  [/Dutch nationality rules/i, 'Netherlands'],
  [/Danish nationality/i, 'Denmark'],
  [/French nationality/i, 'France'],
  [/United States nationality|US nationality/i, 'United States'],
  [/Australian citizenship rules/i, 'Australia'],
  [/Finnish nationality/i, 'Finland'],
  [/Norwegian nationality/i, 'Norway'],
];

/**
 * @param jusSoli the recorded tri-state.
 * @param parentCondition the recorded free-text condition.
 * @param summary the route's own summary, which is what contradicts the label.
 */
export function classifyJusSoli(
  jusSoli: string | undefined,
  parentCondition: string | undefined,
  summary: string,
): JusSoliFinding {
  const family = (f: JusSoliFamily, basis: string, defersTo?: string): JusSoliFinding => ({
    family: f,
    openness: FAMILY_OPENNESS[f],
    basis,
    ...(defersTo ? { defers_to: defersTo } : {}),
  });

  if (jusSoli === 'none') return family('none', 'recorded jus_soli: none');
  if (jusSoli === 'unconditional') return family('unconditional', 'recorded jus_soli: unconditional');
  if (jusSoli !== 'conditional') return family('needs_review', 'no recorded jus_soli value');

  // Order matters. A dependent territory's summary may also mention statelessness
  // because the metropole's rule does, and the metropole pointer is the stronger
  // signal: it says this route has no rule of its own to classify.
  for (const [pattern, parent] of METROPOLE) {
    if (pattern.test(summary)) {
      return family('follows_metropole', 'summary defers to another jurisdiction', parent);
    }
  }
  if (/follows .*(rules|law)/i.test(summary)) {
    return family('follows_metropole', 'summary defers to another jurisdiction');
  }

  // Chile: "Chilean by birth ... except children of transient foreigners".
  if (/except children of transient foreigners|transient foreigner/i.test(summary)) {
    return family('unconditional_with_exceptions', 'summary: birthright except transient foreigners');
  }

  // A citizen parent is descent. Mauritius reaches the same place via a date cutoff
  // ("before 1 October 1995 ... after that date, at least one parent must be a citizen").
  if (parentCondition === 'parent_citizen' || parentCondition === 'date_and_parent') {
    return family('parent_citizen', `parent_condition: ${parentCondition}`);
  }

  // "Birth in X alone is not generally enough" plus an entitlement at 13/16/18.
  if (/alone is not|not generally enough|No unconditional jus soli/i.test(summary)) {
    return family('later_acquisition_not_birth', 'summary: birth alone is not sufficient');
  }

  // Several statutes describe the safeguard without using the word. Bulgaria reads
  // "citizen by place of birth if they do not acquire another citizenship by
  // origin"; Türkiye "who cannot acquire any nationality from the parents". Both
  // are statelessness safeguards in substance, and matching only the literal word
  // left them unclassified.
  if (/stateless|cannot acquire any nationality|do(es)? not acquire another citizenship|no state recognize/i.test(summary)) {
    return family('stateless_safeguard', 'summary describes a statelessness safeguard only');
  }

  switch (parentCondition) {
    case 'double_jus_soli':
      return family('double_jus_soli', 'parent_condition: double_jus_soli');
    case 'settled':
    case 'parent_or_settled':
      return family('parent_settled', `parent_condition: ${parentCondition}`);
    case 'lawful_residence':
    case 'residence':
    case 'domicile':
      return family('parent_lawful_residence', `parent_condition: ${parentCondition}`);
    case 'residence_and_school':
      return family('residence_plus_integration', 'parent_condition: residence_and_school');
    default:
      // Deliberate. `registration`, `born_in_country`, `parentage_or_stateless` and
      // the other singletons are too terse to classify without reading the statute,
      // and guessing here is what produced the mislabels this module exists to find.
      return family('needs_review', `unclassified parent_condition: ${parentCondition ?? 'none'}`);
  }
}

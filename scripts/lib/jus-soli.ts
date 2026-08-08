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
  /** The most open limb. What the route is best described as. */
  family: JusSoliFamily;
  /**
   * Every limb the recorded text describes, most open first.
   *
   * A nationality law states alternatives: São Tomé confers origin nationality
   * where a parent is São-tomense, OR the parents are stateless, OR foreign
   * parents reside in the territory. A child qualifies under any one of them, so
   * collapsing the three into a single label loses the limb that matters most.
   */
  families: JusSoliFamily[];
  /**
   * 0..100, or null when every limb is deliberately unscoreable.
   *
   * The MAXIMUM across limbs, because limbs are alternatives rather than
   * cumulative requirements. Taking a minimum or a mean would say a jurisdiction
   * is less open because it ALSO protects stateless children.
   */
  openness: number | null;
  /** Which recorded field or phrase decided it, so a reviewer can check the call. */
  basis: string;
  /** Set when the route defers to another jurisdiction's rule. */
  defers_to?: string;
}

/**
 * Tie-break when two limbs score the same. Only consulted on equal openness, so
 * it never overrides the max rule; it just makes the primary label deterministic.
 * A route that both safeguards stateless children and offers acquisition at 18 is
 * better described by the acquisition route, which is the wider of the two.
 */
const FAMILY_PRECEDENCE: JusSoliFamily[] = [
  'unconditional', 'unconditional_with_exceptions', 'parent_lawful_residence',
  'double_jus_soli', 'residence_plus_integration', 'parent_settled',
  'later_acquisition_not_birth', 'stateless_safeguard', 'parent_citizen',
  'none', 'follows_metropole', 'needs_review',
];

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
  // The Crown Dependencies say "British citizenship rules", not "British Overseas
  // Territories". Matching only the latter left Guernsey, Jersey and the Isle of Man
  // deferring to nobody, which reads as an unresolved pointer rather than a resolved
  // one. Kept last so the BOT pattern above still wins where both could match.
  [/British citizenship rules/i, 'United Kingdom'],
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
  const single = (f: JusSoliFamily, basis: string, defersTo?: string): JusSoliFinding => ({
    family: f,
    families: [f],
    openness: FAMILY_OPENNESS[f],
    basis,
    ...(defersTo ? { defers_to: defersTo } : {}),
  });

  if (jusSoli === 'none') return single('none', 'recorded jus_soli: none');
  if (jusSoli === 'unconditional') return single('unconditional', 'recorded jus_soli: unconditional');
  if (jusSoli !== 'conditional') return single('needs_review', 'no recorded jus_soli value');

  // A deferral is not a limb, so it short-circuits everything. A dependent
  // territory's summary may also mention statelessness because the metropole's rule
  // does, and the pointer is the stronger signal: it says this route has no rule of
  // its own to classify.
  for (const [pattern, parent] of METROPOLE) {
    if (pattern.test(summary)) {
      return single('follows_metropole', 'summary defers to another jurisdiction', parent);
    }
  }
  if (/follows .*(rules|law)/i.test(summary)) {
    return single('follows_metropole', 'summary defers to another jurisdiction');
  }

  // Everything below is a LIMB, collected rather than returned. Nationality statutes
  // state alternatives, and first-match-wins scored a route by whichever limb the
  // regexes happened to reach first. That understated Colombia by 50 points: its rule
  // is parent domicile, with statelessness as a separate exception, and the
  // statelessness check ran first.
  const limbs: Array<{ family: JusSoliFamily; basis: string }> = [];
  const add = (family: JusSoliFamily, basis: string) => {
    if (!limbs.some(limb => limb.family === family)) limbs.push({ family, basis });
  };

  // Chile: "Chilean by birth ... except children of transient foreigners".
  if (/except children of transient foreigners|transient foreigner/i.test(summary)) {
    add('unconditional_with_exceptions', 'summary: birthright except transient foreigners');
  }

  // A citizen parent is descent. Mauritius reaches the same place via a date cutoff
  // ("before 1 October 1995 ... after that date, at least one parent must be a citizen").
  if (parentCondition === 'parent_citizen' || parentCondition === 'date_and_parent') {
    add('parent_citizen', `parent_condition: ${parentCondition}`);
  }

  // Second-generation rules often live only in the summary. Belgium's article 11 is
  // stated in prose while its parent_condition is the uninformative `born_in_country`.
  if (parentCondition === 'double_jus_soli' || /double jus soli|parent was also born in/i.test(summary)) {
    add('double_jus_soli', parentCondition === 'double_jus_soli'
      ? 'parent_condition: double_jus_soli'
      : 'summary describes a second-generation rule');
  }

  // A later entitlement needs an actual later-acquisition signal, not merely the
  // words "no unconditional jus soli". Requiring only the negation mislabelled
  // Belgium, whose two limbs both operate AT birth, and Ukraine, whose article 7
  // grant is a statelessness safeguard with no later route at all.
  if (/alone is not|alone does not|not generally enough|No unconditional jus soli/i.test(summary)
    && /age \d|after reaching adulthood|declare citizenship|may later apply|automatically at \d/i.test(summary)) {
    add('later_acquisition_not_birth', 'summary: birth alone is insufficient, with acquisition later');
  }

  // A childhood-residence clock is acquisition too, even without the negation
  // phrasing. Australia confers citizenship on a child ordinarily resident for the
  // first ten years of life, which vests on the tenth birthday and not at birth,
  // so it belongs beside France and Italy rather than being dropped.
  if (/first ten years of life|ordinarily resident[^.]{0,60}first ten years|tenth birthday/i.test(summary)) {
    add('later_acquisition_not_birth', 'summary: childhood-residence clock vesting after birth');
  }

  // Several statutes describe the safeguard without using the word. Bulgaria reads
  // "citizen by place of birth if they do not acquire another citizenship by
  // origin"; Türkiye "who cannot acquire any nationality from the parents".
  if (/stateless|cannot acquire any nationality|do(es)? not acquire another citizenship|no state recognize|acquires no other citizenship/i.test(summary)) {
    add('stateless_safeguard', 'summary describes a statelessness safeguard');
  }

  // A PARENTAL residence limb offered as an ALTERNATIVE, which is how São Tomé
  // states it ("or when foreign parents reside in the territory"). Deliberately
  // narrow on both counts. It names the parent, because Australia's "or when the
  // CHILD is ordinarily resident for the first ten years" is a different rule
  // entirely and scoring it as parental residence overstated Australia by 25
  // points. And it requires the disjunction, because a residence test can equally
  // be a precondition of a narrower grant (see below).
  if (/\bor (?:when|where|if)[^.]{0,60}(?:parents?|foreigners?)[^.]{0,40}(?:reside|domicil)/i.test(summary)) {
    add('parent_lawful_residence', 'summary offers parental residence as an alternative limb');
  }

  /**
   * Residence stated as a PRECONDITION of a statelessness grant, not as an
   * alternative to it. Ukraine's article 7 makes a child born to permanently
   * resident foreigners a citizen "where the child acquires no other citizenship at
   * birth". Both facts are true of that one grant, so a child of resident foreigners
   * who inherits a nationality gets nothing. Reading the recorded
   * `parent_condition: lawful_residence` as an independent limb scored it 55 for a
   * rule that is worth 5.
   */
  const residenceQualifiedByStatelessness =
    /resident[^.]{0,90}(?:where|if|unless)[^.]{0,70}(?:acquires no other citizenship|would otherwise be stateless|no other nationality|does not acquire another)/i
      .test(summary);

  switch (parentCondition) {
    case 'settled':
    case 'parent_or_settled':
      add('parent_settled', `parent_condition: ${parentCondition}`);
      break;
    case 'lawful_residence':
    case 'residence':
    case 'domicile':
      // Only when the route grants AT birth. France and Italy both record
      // `residence`, but their summaries say the residence test conditions the
      // acquisition at 13, 16 or 18, not a birthright limb. Reading that label as a
      // birth limb is the exact conflation this module was written to catch, and
      // adding it here would have scored France 55 for a route that confers nothing
      // at birth beyond a statelessness safeguard.
      if (!limbs.some(limb => limb.family === 'later_acquisition_not_birth')
        && !residenceQualifiedByStatelessness) {
        add('parent_lawful_residence', `parent_condition: ${parentCondition}`);
      }
      break;
    case 'residence_and_school':
      add('residence_plus_integration', 'parent_condition: residence_and_school');
      break;
    default:
      break;
  }

  if (limbs.length === 0) {
    // Deliberate. `registration` and the other terse singletons are too thin to
    // classify without reading the statute, and guessing here is what produced the
    // mislabels this module exists to find.
    return single('needs_review', `unclassified parent_condition: ${parentCondition ?? 'none'}`);
  }

  // Alternatives, so the most open limb decides. Ties fall to FAMILY_PRECEDENCE.
  const rank = (f: JusSoliFamily) => FAMILY_OPENNESS[f] ?? -1;
  const ordered = [...limbs].sort((a, b) =>
    rank(b.family) - rank(a.family)
    || FAMILY_PRECEDENCE.indexOf(a.family) - FAMILY_PRECEDENCE.indexOf(b.family));
  const scoreable = ordered.map(limb => FAMILY_OPENNESS[limb.family]).filter((v): v is number => v !== null);
  return {
    family: ordered[0]!.family,
    families: ordered.map(limb => limb.family),
    openness: scoreable.length ? Math.max(...scoreable) : null,
    basis: ordered.length === 1
      ? ordered[0]!.basis
      : `${ordered.length} limbs: ${ordered.map(limb => `${limb.family} (${limb.basis})`).join('; ')}`,
  };
}

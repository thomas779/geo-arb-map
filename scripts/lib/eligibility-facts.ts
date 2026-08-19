/**
 * Derive planner-facing facts out of `variant.eligibility[]` before the build
 * throws it away.
 *
 * Background, and it is the same background as `descent-relations.ts`: a route's
 * conditions are the only place the corpus writes down what a route actually
 * asks of you, and `data-build` projects variants through a five-key allow-list
 * (`{id, label, allocation, eligibility_months, note}`) that drops every one of
 * them. 1,306 authored conditions never reach a consumer. Ancestry escaped that
 * because somebody noticed; these three are the next ones worth rescuing.
 *
 * Each derivation is a RE-ENCODING, not new research: every published value
 * traces to a condition an author wrote from an instrument, or to the variant
 * timeline that sits beside it.
 *
 * THE RULE THAT GOVERNS ALL THREE, from `canonical-schema.ts`: omission means
 * NOT RECORDED and must never be read as a negative finding. A route with no
 * marriage condition is not a route with no spouse requirement. A CBI programme
 * with no recorded threshold is not a free one. A naturalisation route with no
 * presence condition is not one you can satisfy from abroad. So every field
 * here is positive-only, `null` is a first-class answer, and a route that
 * records nothing gets `null` for the whole finding rather than a zeroed shell.
 */

export interface Condition {
  field: string;
  operator: string;
  value: unknown;
  unit?: string;
  note?: string;
}

/** The slice of a route variant these derivations read. */
export interface VariantFacts {
  id: string;
  eligibility?: Condition[];
  timeline: { eligibility_minimum_months: number | null };
}

function numeric(condition: Condition): number | null {
  return typeof condition.value === 'number' ? condition.value : null;
}

/** Smallest of the recorded values, ignoring nulls. null when nothing was recorded. */
function least(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.min(...present) : null;
}

// --- 1. Marriage ---------------------------------------------------------

/**
 * What a marriage route asks of the couple.
 *
 * 139 routes record a spouse limb and not one of them published it: the
 * generator at `canonical-pilot.ts` emits `spouse.citizenship.iso_n3`,
 * `residence.years` and `marriage.duration_months`, and all three are dropped a
 * few lines later. The published route said "naturalisation as the spouse of a
 * citizen" and nothing else — not whose spouse, not for how long.
 */
export interface MarriageRequirement {
  /**
   * ISO n3 codes a condition records as a qualifying spouse nationality.
   * Positive-only, sorted, and legitimately EMPTY: the UK records
   * `partner.british_citizenship` as a boolean, which proves the limb exists
   * without ever naming a code. Empty therefore means "a spouse limb is
   * recorded, its nationality is not", never "any nationality qualifies".
   */
  qualifying_spouse_iso_n3: string[];
  /**
   * Months the marriage (or registered partnership) must have run. null = NOT
   * RECORDED, never "no minimum" — 68 of the 139 routes record one.
   */
  marriage_minimum_months: number | null;
  /**
   * Months of residence the marriage limb requires.
   *
   * Read from `variant.timeline.eligibility_minimum_months`, NOT from the
   * `residence.years` condition beside it, and only for a variant that records a
   * residence condition at all. Both halves of that matter:
   *
   * - The generator rounds to whole years (`Math.round(spec.months / 12)`), so
   *   the Dominican Republic's six-month rule is authored as `residence.years
   *   gte 1` and Israel's 54 months as `gte 5`. The timeline keeps 6 and 54.
   *   Deriving from the condition would publish the rounding as fact.
   * - The timeline is a time-to-eligibility clock, not a residence clock. On
   *   Oman it holds 96 months, which is the MARRIAGE duration; Oman records no
   *   residence condition, so reading the timeline there would invent a
   *   residence requirement out of a marriage one. Requiring a `residence.*`
   *   condition to be present is what keeps the two apart.
   */
  residence_minimum_months: number | null;
  /**
   * One clock where the instrument runs marriage and residence together and the
   * corpus records them as a single `marriage_and_residence.continuous_months`
   * predicate. Nauru is the only case. It gets its own slot because splitting it
   * across the two fields above would assert two requirements where the
   * instrument states one, and collapsing it into either would understate it.
   */
  combined_minimum_months: number | null;
  /** Variant ids carrying a spouse limb, so a consumer can trace the finding. */
  variants: string[];
}

/**
 * A variant is a marriage limb when it names the spouse side of the couple.
 *
 * Deliberately prefix-anchored. `family.colombian_spouse_partner_or_child` is
 * the case that sets the boundary: it is one boolean covering a spouse OR a
 * partner OR a child, so it proves no marriage requirement and names no
 * nationality, and Colombia records nothing else. It stays out.
 */
const MARRIAGE_LIMB = /^(?:spouse|partner|marriage|marriage_and_residence)\./;

/** `spouse.citizenship.iso_n3`, `partner.citizenship.iso_n3`, and Honduras's by-birth variant. */
const SPOUSE_NATIONALITY = /^(?:spouse|partner)\.(?:citizenship|nationality)(?:\.by_birth)?\.iso_n3$/;

/**
 * How long the couple must have been together. `relationship.duration_months` is
 * Germany's — a registered partnership counts there exactly as a marriage does,
 * and the field sits on a variant that already names `partner.citizenship`, so
 * it is the same predicate under a different noun.
 */
const MARRIAGE_DURATION = new Set([
  'marriage.duration_months',
  'marriage.months',
  'relationship.duration_months',
]);

const COMBINED_DURATION = 'marriage_and_residence.continuous_months';

export function deriveMarriageRequirement(variants: VariantFacts[]): MarriageRequirement | null {
  const spouseIsos = new Set<string>();
  const limbs: string[] = [];
  const marriageMonths: Array<number | null> = [];
  const residenceMonths: Array<number | null> = [];
  const combinedMonths: Array<number | null> = [];

  for (const variant of variants) {
    const conditions = variant.eligibility ?? [];
    if (!conditions.some(condition => MARRIAGE_LIMB.test(condition.field))) continue;
    limbs.push(variant.id);

    for (const condition of conditions) {
      if (
        SPOUSE_NATIONALITY.test(condition.field)
        && condition.operator === 'eq'
        && typeof condition.value === 'string'
      ) {
        spouseIsos.add(condition.value);
      }
      if (MARRIAGE_DURATION.has(condition.field) && condition.operator === 'gte') {
        marriageMonths.push(numeric(condition));
      }
      if (condition.field === COMBINED_DURATION && condition.operator === 'gte') {
        combinedMonths.push(numeric(condition));
      }
    }

    // See `residence_minimum_months`: the timeline carries the unrounded figure,
    // but only a variant that records a residence condition has a residence
    // requirement for it to be the figure OF.
    if (conditions.some(condition => condition.field.startsWith('residence.'))) {
      residenceMonths.push(variant.timeline.eligibility_minimum_months);
    }
  }

  if (limbs.length === 0) return null;
  return {
    qualifying_spouse_iso_n3: [...spouseIsos].sort(),
    // The shortest recorded limb, because these are alternatives: Oman records
    // 96 months for a foreign wife and 120 for a foreign husband, and the
    // question a planner is asking is what the route can cost, not what it can
    // cost at worst. The asymmetry itself stays in the route summary.
    marriage_minimum_months: least(marriageMonths),
    residence_minimum_months: least(residenceMonths),
    combined_minimum_months: least(combinedMonths),
    variants: limbs,
  };
}

// --- 2. Money on citizenship by investment --------------------------------

/**
 * The threshold a route's conditions price it at.
 *
 * `RouteSchema` has no money field, so the 27 investment-mode citizenship routes
 * were unpriced end to end: the only figures anybody had recorded lived in
 * `investment.minimum_usd` and its siblings, inside the array the build drops.
 * Shaped to match `ResidenceRouteSchema.min_investment` (`{amount, currency}`)
 * so a country page rendering "what this costs" does not branch on route family.
 *
 * NO FX. The corpus spans 29 currencies with no rate layer, so the amount and
 * the currency ship exactly as recorded and any comparison across currencies is
 * the consumer's problem, not a number invented here.
 */
export interface InvestmentPrice {
  amount: number;
  /** ISO 4217, as recorded. Never converted. */
  currency: string;
  /** The eligibility field the figure was read from — a donation and a property
   *  purchase are both "the price" and are not the same commitment. */
  basis: string;
  /**
   * The author's own caveat on that condition, carried verbatim. Two routes
   * record a figure and then disclaim it ("Threshold is indicative; no verified
   * statutory figure is asserted"), and a price that ships without its hedge
   * reads as firmer than the corpus ever claimed.
   */
  note: string | null;
}

/**
 * Currency codes recognised as the tail of a money field name.
 *
 * An allowlist rather than "any three letters", because `investment.holding_months`
 * would otherwise price a route in THS. Extend it when a new currency is
 * authored; an unrecognised tail derives nothing, which is the safe direction.
 */
const CURRENCY_TOKENS = new Set([
  'usd', 'eur', 'gbp', 'chf', 'jpy', 'cny', 'aud', 'nzd', 'cad', 'sgd', 'hkd',
  'aed', 'sar', 'qar', 'kwd', 'bhd', 'omr', 'jod', 'ils', 'try', 'egp', 'zar',
  'inr', 'pkr', 'bdt', 'lkr', 'idr', 'myr', 'thb', 'php', 'vnd', 'krw',
  'brl', 'mxn', 'ars', 'clp', 'cop', 'pen', 'uyu', 'dop', 'xcd', 'ttd', 'bbd',
  'sek', 'nok', 'dkk', 'isk', 'pln', 'czk', 'huf', 'ron', 'bgn', 'rsd', 'mkd',
]);

/** `investment.minimum_usd`, `investment.property_usd`, `investment.amount_pkr`. */
const MONEY_FIELD = /^(?:investment|contribution|donation)\.(?:[a-z0-9_]+_)?([a-z]{3})$/;

export function deriveInvestmentPrice(variants: VariantFacts[]): InvestmentPrice | null {
  const priced: InvestmentPrice[] = [];
  for (const variant of variants) {
    for (const condition of variant.eligibility ?? []) {
      if (condition.operator !== 'gte') continue;
      const match = MONEY_FIELD.exec(condition.field);
      if (!match || !CURRENCY_TOKENS.has(match[1]!)) continue;
      const amount = numeric(condition);
      if (amount === null || amount <= 0) continue;
      priced.push({
        amount,
        currency: match[1]!.toUpperCase(),
        basis: condition.field,
        note: condition.note ?? null,
      });
    }
  }
  if (priced.length === 0) return null;
  // Several limbs in ONE currency are alternatives, so the cheapest is the
  // route's entry price. Several limbs in DIFFERENT currencies cannot be ranked
  // without a rate, and inventing one is the failure this field exists to
  // avoid — so the route publishes no price rather than an arbitrary limb.
  const currencies = new Set(priced.map(entry => entry.currency));
  if (currencies.size > 1) return null;
  return priced.reduce((cheapest, entry) => (entry.amount < cheapest.amount ? entry : cheapest));
}

// --- 3. Physical presence -------------------------------------------------

/**
 * Days you must actually be in the country, as opposed to years you must be
 * resident in it.
 *
 * These are different predicates and the corpus has always treated them as
 * such — `ResidenceRouteSchema` carries `physical_presence_days_per_year`
 * separately from every timeline — but on the citizenship side the distinction
 * lived only in `eligibility`, so a published route recording "5 years of
 * residence" gave no hint that Canada wants 1,095 days inside them and Antigua
 * wants 5. That gap is the whole point of the field: a residence clock you can
 * run from abroad and one you cannot are not the same route.
 *
 * Applicant-side only. `parent.canada_physical_presence_days_before_birth` and
 * the two US `parent.us_physical_presence_*` fields are presence tests too, but
 * they are tests on an ANCESTOR for a descent claim, and folding them in here
 * would tell a planner to spend 1,095 days somewhere on their parent's behalf.
 */
export interface PhysicalPresenceRequirement {
  /** Days of presence across the whole window. null = not recorded in days. */
  minimum_days: number | null;
  /**
   * Months of presence across the whole window, where the instrument counts in
   * months (the US: 30 of the previous 60). Kept apart from `minimum_days`
   * rather than multiplied out, because a month is not a fixed number of days
   * and the corpus has no rule for making it one.
   */
  minimum_months: number | null;
  /** The window the minimum is measured over. */
  window_months: number | null;
  /**
   * Days required in EACH year of the window, not just in total. New Zealand
   * wants 240 a year on top of 1,350 across five, and Taiwan's whole test is
   * 183 days in each of five years — a per-year floor is what makes a route
   * impossible to satisfy by one long stay, so it cannot collapse into a total.
   */
  days_per_year: number | null;
  /** Eligibility fields the figures were read from. Sorted. */
  basis: string[];
}

/** Numerals the corpus spells out in a field name (`residence.first_five_years_days`). */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Presence shapes, anchored to `residence.` so ancestor-side presence tests
 * cannot match. Each returns the slots the field name and value together state.
 *
 * The window is read out of the FIELD NAME, exactly as descent degree is: an
 * author who writes `physical_presence_days_previous_5_years` has recorded both
 * the requirement and the window it runs over, and only the requirement
 * survived into `value`.
 */
const PRESENCE_PATTERNS: Array<{
  pattern: RegExp;
  read: (match: RegExpExecArray, value: number, unit?: string) => Partial<PhysicalPresenceRequirement> | null;
}> = [
  {
    // residence.physical_presence_days_previous_5_years, residence.nz_presence_days_previous_5_years
    pattern: /^residence\.(?:[a-z0-9_]+_)?presence_days_previous_(\d+)_years$/,
    read: (match, value) => ({ minimum_days: value, window_months: Number(match[1]) * 12 }),
  },
  {
    // residence.physical_presence_months_previous_60
    pattern: /^residence\.(?:[a-z0-9_]+_)?presence_months_previous_(\d+)$/,
    read: (match, value) => ({ minimum_months: value, window_months: Number(match[1]) }),
  },
  {
    // residence.nz_presence_days_each_year
    pattern: /^residence\.(?:[a-z0-9_]+_)?presence_days_each_year$/,
    read: (_match, value) => ({ days_per_year: value }),
  },
  {
    // residence.consecutive_years_183_days gte 5 years — the per-year floor is in
    // the name, the number of years is the value.
    pattern: /^residence\.consecutive_years_(\d+)_days$/,
    read: (match, value, unit) =>
      unit === 'years' ? { days_per_year: Number(match[1]), window_months: value * 12 } : null,
  },
  {
    // residence.first_five_years_days gte 5 days — Antigua's CBI presence test.
    pattern: /^residence\.first_([a-z]+)_years_days$/,
    read: (match, value) => {
      const years = WORD_NUMBERS[match[1]!];
      return years === undefined ? null : { minimum_days: value, window_months: years * 12 };
    },
  },
];

export function derivePhysicalPresence(
  variants: VariantFacts[],
): PhysicalPresenceRequirement | null {
  const minimumDays: Array<number | null> = [];
  const minimumMonths: Array<number | null> = [];
  const windowMonths: Array<number | null> = [];
  const daysPerYear: Array<number | null> = [];
  const basis = new Set<string>();

  for (const variant of variants) {
    for (const condition of variant.eligibility ?? []) {
      if (condition.operator !== 'gte') continue;
      const value = numeric(condition);
      if (value === null) continue;
      for (const { pattern, read } of PRESENCE_PATTERNS) {
        const match = pattern.exec(condition.field);
        if (!match) continue;
        const slots = read(match, value, condition.unit);
        if (!slots) break;
        basis.add(condition.field);
        minimumDays.push(slots.minimum_days ?? null);
        minimumMonths.push(slots.minimum_months ?? null);
        windowMonths.push(slots.window_months ?? null);
        daysPerYear.push(slots.days_per_year ?? null);
        break;
      }
    }
  }

  if (basis.size === 0) return null;
  // Merged across the route's variants with the lightest recorded value per
  // slot, on the same reasoning as the marriage limbs: variants are alternative
  // ways to qualify, so the route's presence cost is the cheapest one recorded.
  return {
    minimum_days: least(minimumDays),
    minimum_months: least(minimumMonths),
    window_months: least(windowMonths),
    days_per_year: least(daysPerYear),
    basis: [...basis].sort(),
  };
}

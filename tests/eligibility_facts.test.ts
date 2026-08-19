import { describe, test, expect } from 'bun:test';
import {
  deriveInvestmentPrice,
  deriveMarriageRequirement,
  derivePhysicalPresence,
  type Condition,
  type VariantFacts,
} from '../scripts/lib/eligibility-facts';
import type { CitizenshipRoutesData } from '../src/types';

const cond = (field: string, operator: string, value: unknown, extra: Partial<Condition> = {}):
Condition => ({ field, operator, value, ...extra });

const variant = (
  id: string,
  eligibility: Condition[],
  eligibilityMinimumMonths: number | null = null,
): VariantFacts => ({
  id,
  eligibility,
  timeline: { eligibility_minimum_months: eligibilityMinimumMonths },
});

const compiled = (await Bun.file(
  new URL('../data/compiled/citizenship_routes.json', import.meta.url),
).json()) as CitizenshipRoutesData;

const route = (id: string) => {
  const found = compiled.routes.find(item => item.id === id);
  if (!found) throw new Error(`route ${id} is missing from the compiled corpus`);
  return found;
};

describe('marriage requirement derivation', () => {
  test('reads the spouse nationality, the marriage clock and the residence clock', () => {
    expect(deriveMarriageRequirement([
      variant('switzerland-principal', [
        cond('spouse.citizenship.iso_n3', 'eq', '756'),
        cond('residence.years', 'gte', 5, { unit: 'years' }),
        cond('marriage.duration_months', 'gte', 36, { unit: 'months' }),
      ], 60),
    ])).toEqual({
      qualifying_spouse_iso_n3: ['756'],
      marriage_minimum_months: 36,
      residence_minimum_months: 60,
      combined_minimum_months: null,
      variants: ['switzerland-principal'],
    });
  });

  test('the residence clock comes from the timeline, not the rounded condition', () => {
    // THE defect this field exists to route around. `withMarriageRoutes` stores
    // months as Math.round(months / 12) years, so the Dominican Republic's
    // six-month rule is authored as `residence.years gte 1` and Israel's 54
    // months as `gte 5`. Deriving from the condition would publish the rounding.
    const dominicanRepublic = deriveMarriageRequirement([
      variant('dr-principal', [
        cond('spouse.citizenship.iso_n3', 'eq', '214'),
        cond('residence.years', 'gte', 1, { unit: 'years' }),
      ], 6),
    ]);
    expect(dominicanRepublic?.residence_minimum_months).toBe(6);
    expect(route('dominican-republic-citizenship-by-marriage').marriage?.residence_minimum_months)
      .toBe(6);
    expect(route('israel-citizenship-by-marriage').marriage?.residence_minimum_months).toBe(54);
  });

  test('a timeline with no residence condition beside it is not a residence requirement', () => {
    // Oman's timeline holds 96 months, which is the MARRIAGE duration: the route
    // records no residence condition at all. Reading the timeline unconditionally
    // would invent an eight-year residence requirement out of a marriage one.
    const oman = deriveMarriageRequirement([
      variant('oman-wife', [
        cond('spouse.citizenship.iso_n3', 'eq', '512'),
        cond('marriage.duration_months', 'gte', 96, { unit: 'months' }),
      ], 96),
      variant('oman-husband', [
        cond('spouse.citizenship.iso_n3', 'eq', '512'),
        cond('marriage.duration_months', 'gte', 120, { unit: 'months' }),
      ], 120),
    ]);
    expect(oman?.residence_minimum_months).toBeNull();
    // Alternative limbs, so the route's cost is the shortest recorded one.
    expect(oman?.marriage_minimum_months).toBe(96);
    expect(oman?.variants).toEqual(['oman-wife', 'oman-husband']);
    expect(route('oman-citizenship-by-marriage').marriage?.residence_minimum_months).toBeNull();
  });

  test('a combined marriage-and-residence clock keeps its own slot', () => {
    // Nauru runs both clocks together in one predicate. Splitting 84 months
    // across marriage and residence would assert two requirements where the
    // instrument states one; folding it into either would understate it.
    const nauru = deriveMarriageRequirement([
      variant('nauru-principal', [
        cond('spouse.citizenship.iso_n3', 'eq', '520'),
        cond('marriage_and_residence.continuous_months', 'gte', 84, { unit: 'months' }),
      ], 84),
    ]);
    expect(nauru).toMatchObject({
      combined_minimum_months: 84,
      marriage_minimum_months: null,
      residence_minimum_months: null,
    });
  });

  test('a boolean spouse limb records the limb without inventing a nationality', () => {
    // The UK records `partner.british_citizenship` as a boolean. The limb is
    // real; the ISO code was never written down. An empty list says exactly that,
    // and must never be read as "any nationality qualifies".
    const uk = deriveMarriageRequirement([
      variant('spouse_of_british_citizen', [
        cond('partner.british_citizenship', 'eq', true),
        cond('residence.lawful_months', 'gte', 36, { unit: 'months' }),
      ], 36),
    ]);
    expect(uk?.qualifying_spouse_iso_n3).toEqual([]);
    expect(uk?.residence_minimum_months).toBe(36);
  });

  test('a disjunction covering a child is not a marriage condition', () => {
    // Colombia's only family condition is one boolean spanning a spouse OR a
    // partner OR a child. It proves no marriage requirement and names no
    // nationality, so it derives nothing rather than a half-finding.
    expect(deriveMarriageRequirement([
      variant('family_two_years', [
        cond('family.colombian_spouse_partner_or_child', 'eq', true),
        cond('domicile.continuous_months', 'gte', 24, { unit: 'months' }),
      ], 24),
    ])).toBeNull();
    expect(route('colombia-naturalization-by-residence').marriage ?? null).toBeNull();
  });

  test('every published marriage limb traces to a spouse-side condition', () => {
    const withMarriage = compiled.routes.filter(item => item.marriage);
    expect(withMarriage.length).toBeGreaterThan(130);
    for (const item of withMarriage) {
      expect(item.marriage!.variants.length).toBeGreaterThan(0);
      // Positive-only: a published month figure is always a recorded one.
      for (const months of [
        item.marriage!.marriage_minimum_months,
        item.marriage!.residence_minimum_months,
        item.marriage!.combined_minimum_months,
      ]) {
        if (months !== null) expect(months).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('investment price derivation', () => {
  test('reads the amount and the currency out of the field name', () => {
    expect(deriveInvestmentPrice([
      variant('dominica-principal', [
        cond('investment.minimum_usd', 'gte', 200000),
        cond('compliance.due_diligence_passed', 'eq', true),
      ]),
    ])).toEqual({
      amount: 200000,
      currency: 'USD',
      basis: 'investment.minimum_usd',
      note: null,
    });
    expect(route('dominica-cbi').min_investment?.amount).toBe(200000);
    // Not every price is denominated in dollars, and none of them is converted.
    expect(route('pakistan-commonwealth-investment-citizenship').min_investment?.currency)
      .toBe('PKR');
  });

  test('a hedged figure keeps its hedge', () => {
    // Two routes record a number and then disclaim it. Publishing the number
    // without the author's caveat would read as firmer than the corpus claims.
    expect(route('bangladesh-investment-citizenship').min_investment?.note)
      .toContain('indicative');
  });

  test('a non-currency tail is not a price', () => {
    // `investment.holding_months` ends in three letters too. An allowlist is why
    // Türkiye is priced at USD 400,000 and not at THS 36.
    const turkiye = deriveInvestmentPrice([
      variant('turkiye-principal', [
        cond('investment.property_usd', 'gte', 400000),
        cond('investment.holding_months', 'gte', 36, { unit: 'months' }),
      ]),
    ]);
    expect(turkiye).toMatchObject({ amount: 400000, currency: 'USD' });
  });

  test('limbs in different currencies publish no price rather than an invented one', () => {
    // The corpus spans 29 currencies with no rate layer, so "the cheapest limb"
    // is not a question that can be answered across two of them.
    expect(deriveInvestmentPrice([
      variant('mixed', [
        cond('investment.minimum_usd', 'gte', 250000),
        cond('investment.minimum_eur', 'gte', 200000),
      ]),
    ])).toBeNull();
  });

  test('a recorded qualifying option is not a price', () => {
    // Grenada, Jordan and Egypt record a MENU of qualifying options, some of
    // them refundable deposits, in mixed currencies, with the amounts living
    // inside enum labels. None of that is a minimum, so none of it is derived.
    expect(deriveInvestmentPrice([
      variant('egypt-principal', [
        cond('investment.qualifying_option', 'in', [
          'treasury_contribution_usd_250000',
          'property_usd_300000',
        ]),
      ]),
    ])).toBeNull();
    expect(route('egypt-investor-citizenship').min_investment ?? null).toBeNull();
    expect(route('grenada-cbi').min_investment ?? null).toBeNull();
  });

  test('an unpriced programme is null, never zero', () => {
    expect(route('vanuatu-investor-citizenship').min_investment ?? null).toBeNull();
  });
});

describe('physical presence derivation', () => {
  test('reads the window out of the field name and the requirement out of the value', () => {
    expect(derivePhysicalPresence([
      variant('adult_standard', [
        cond('residence.physical_presence_days_previous_5_years', 'gte', 1095, { unit: 'days' }),
        // Days of PR STATUS, not days in the country. A status clock is not a
        // presence clock and must not be merged into one.
        cond('residence.permanent_resident_days_previous_5_years', 'gte', 730, { unit: 'days' }),
      ], 60),
    ])).toEqual({
      minimum_days: 1095,
      minimum_months: null,
      window_months: 60,
      days_per_year: null,
      basis: ['residence.physical_presence_days_previous_5_years'],
    });
  });

  test('a per-year floor is kept apart from a total', () => {
    // New Zealand wants 240 days in EACH year on top of 1,350 across five. A
    // total alone would say one long stay satisfies the route; it does not.
    expect(route('nz-citizenship-by-grant').physical_presence).toMatchObject({
      minimum_days: 1350,
      days_per_year: 240,
      window_months: 60,
    });
    // Taiwan's whole test is the per-year floor, with the 183 written into the
    // field name and the number of years in the value.
    expect(route('taiwan-naturalization').physical_presence).toMatchObject({
      minimum_days: null,
      days_per_year: 183,
      window_months: 60,
    });
  });

  test('months are not multiplied into days', () => {
    // The US counts in months. A month is not a fixed number of days and the
    // corpus has no rule for making it one, so the slot stays separate.
    expect(route('us-naturalization-after-lpr').physical_presence).toMatchObject({
      minimum_days: null,
      minimum_months: 30,
      window_months: 60,
    });
  });

  test('presence demanded of an ancestor is not presence demanded of the applicant', () => {
    // Canada's descent route tests the PARENT's 1,095 days before the birth.
    // Folding it in would tell a planner to spend three years somewhere on
    // their parent's behalf.
    expect(derivePhysicalPresence([
      variant('canadian_parent_also_born_abroad', [
        cond('parent.canada_physical_presence_days_before_birth', 'gte', 1095, { unit: 'days' }),
      ]),
    ])).toBeNull();
    expect(route('canada-citizenship-by-descent').physical_presence ?? null).toBeNull();
  });

  test('a route with no presence condition records nothing, not zero', () => {
    // The load-bearing rule: silence is NOT RECORDED. A naturalisation route
    // with no presence condition is not one you can satisfy from abroad.
    expect(derivePhysicalPresence([
      variant('plain', [cond('residence.years', 'gte', 5, { unit: 'years' })], 60),
    ])).toBeNull();
  });

  test('the CBI presence test survives, because 5 days is the finding', () => {
    // Antigua asks for 5 days across the first five years. Indistinguishable
    // from Canada's 1,095 once `eligibility` is dropped, which is the point.
    expect(route('antigua-barbuda-cip').physical_presence).toMatchObject({
      minimum_days: 5,
      window_months: 60,
    });
  });
});

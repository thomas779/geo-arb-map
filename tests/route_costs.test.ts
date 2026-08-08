import { describe, test, expect } from 'bun:test';
import { RouteCostsSchema } from '../scripts/lib/canonical-schema';
import { buildCanonicalPilot, CANONICAL_SOURCE_IS_SAMPLE } from '../scripts/lib/canonical-source';

const ref = [{ source_id: 'source:x', supports_fields: ['/routes/a/costs'] }];

describe('what the schema refuses to accept', () => {
  test('an amount with no source is rejected', () => {
    // The whole failure mode #169 describes: a figure arriving as a sentence with a
    // URL in it, because there was no source_refs slot to put it in.
    expect(RouteCostsSchema.safeParse({
      fees: [{ applies_to: 'adult', amount: { amount: 60_000, currency: 'ISK' } }],
      source_refs: [],
    }).success).toBe(false);
  });

  test('a currency must be an ISO code, not a symbol', () => {
    expect(RouteCostsSchema.safeParse({
      fees: [{ applies_to: 'adult', amount: { amount: 250, currency: '£' } }],
      source_refs: ref,
    }).success).toBe(false);
  });

  test('a zero fee is rejected, because free and unrecorded must not collide', () => {
    // MoneySchema requires positive. A route with no fee recorded carries no `costs`
    // at all; it must never be expressible as a 0 that renders as "free".
    expect(RouteCostsSchema.safeParse({
      fees: [{ applies_to: 'adult', amount: { amount: 0, currency: 'ISK' } }],
      source_refs: ref,
    }).success).toBe(false);
  });
});

describe('a threshold can bind without naming an amount', () => {
  test('means accepts a null amount when it is pegged to a moving index', () => {
    // Gibraltar reg. 7(1)(a) requires earnings no less than the Gibraltar average,
    // and reg. 3 defines that as a Gazette-published index. The test exists and
    // binds, but the instrument states no figure. Forcing a number here is exactly
    // how the #180 lead invented GBP 37,500.
    const parsed = RouteCostsSchema.safeParse({
      means: {
        amount: null,
        period: 'annual',
        applies_to: 'employee',
        pegged_to: 'average gross annual earnings in Gibraltar',
      },
      source_refs: ref,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.means!.amount).toBeNull();
    expect(parsed.data!.means!.pegged_to).not.toBe('');
  });

  test('absent costs stay absent rather than defaulting to an empty price', () => {
    // Null means NOT RECORDED, never free. Same rule as max_age and work_rights.
    const parsed = RouteCostsSchema.parse({ source_refs: ref });
    expect(parsed.fees).toEqual([]);
    expect(parsed.means).toBeNull();
    expect(parsed.effective).toEqual({ from: null, to: null });
  });
});

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('the two routes this was built for', () => {
  const pilot = buildCanonicalPilot() as unknown as {
    jurisdictions: Array<{
      routes: Array<{ id: string; costs?: unknown; variants: Array<{ timeline: { note?: string } }> }>;
      residence_routes?: Array<{ id: string; costs?: unknown }>;
    }>;
  };
  const routes = pilot.jurisdictions.flatMap(j => j.routes);
  const residence = pilot.jurisdictions.flatMap(j => j.residence_routes ?? []);

  test('Iceland records its fees and means as data, not prose', () => {
    const iceland = routes.find(r => r.id === 'iceland-naturalization')!;
    const costs = RouteCostsSchema.parse(iceland.costs);
    expect(costs.fees.map(f => f.applies_to).sort()).toEqual(['adult', 'child']);
    expect(costs.fees.find(f => f.applies_to === 'adult')!.amount)
      .toEqual({ amount: 60_000, currency: 'ISK' });
    expect(costs.means!.amount).toEqual({ amount: 259_951, currency: 'ISK' });
    // The peg is the point. This is a municipal aid benchmark, not a figure in the
    // nationality statute, so it moves without the law changing.
    expect(costs.means!.pegged_to).toContain('Reykjavík');
  });

  test('the amounts left the timeline note behind', () => {
    // A timeline note is for caveats about the CLOCK. Fee data there validated but
    // was unreadable by anything.
    const note = routes.find(r => r.id === 'iceland-naturalization')!.variants[0]!.timeline.note ?? '';
    expect(note).not.toContain('259,951');
    expect(note).not.toContain('60,000');
    // What remains is the actual clock caveat.
    expect(note).toContain('not a shortened residence clock');
  });

  test('Gibraltar records a binding threshold with no amount', () => {
    const gibraltar = residence.find(r => r.id === 'gibraltar-employment-residence-permit')!;
    const costs = RouteCostsSchema.parse(gibraltar.costs);
    expect(costs.fees.find(f => f.applies_to === 'application')!.amount)
      .toEqual({ amount: 250, currency: 'GBP' });
    expect(costs.fees.find(f => f.applies_to === 'renewal')!.amount)
      .toEqual({ amount: 20, currency: 'GBP' });
    expect(costs.means!.amount).toBeNull();
    expect(costs.means!.pegged_to).toContain('Employment Survey');
  });

  test('every recorded costs block cites a source', () => {
    for (const route of [...routes, ...residence]) {
      if (!route.costs) continue;
      expect(
        RouteCostsSchema.parse(route.costs).source_refs.length,
        `${route.id} records costs with no source`,
      ).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('Paraguay: the ladder, and three figures that were wrong (#161)', () => {
  const pilot = buildCanonicalPilot() as unknown as {
    jurisdictions: Array<{
      jurisdiction: { iso_n3: string };
      dual_nationality?: { status: string; detail: string };
      residence_routes?: Array<{
        id: string; counts_toward_permanent_residence: boolean; permit_duration_months: number | null;
        costs?: { fees: Array<{ amount: unknown; pegged_to: string }>; means: { amount: unknown; pegged_to: string } | null };
        variants: Array<{ timeline: { note?: string } }>;
        review: { note?: string };
      }>;
    }>;
  };
  // `skipIf` skips the TESTS, not this describe body, which still evaluates in
  // sample mode. Paraguay is not in the six-jurisdiction sample, so a non-null
  // deref here throws before any test is skipped and fails CI with an "unhandled
  // error between tests" rather than a readable assertion.
  const py = pilot.jurisdictions.find(j => j.jurisdiction.iso_n3 === '600');
  const routes = py?.residence_routes ?? [];
  const byId = (id: string) => routes.find(r => r.id === id)!;

  test('the ordinary entry step exists and is temporary, not permanent', () => {
    // Ley 6984/2022 art. 46 makes temporary residence a statutory prior requirement.
    // Modelling only the permanent stage described the wrong product to anyone
    // researching "cheap Paraguay residency", which is what this issue was about.
    const temp = byId('paraguay-temporary-residence');
    expect(temp.permit_duration_months).toBe(24);
    expect(temp.counts_toward_permanent_residence).toBe(true);
  });

  test('no means test on the entry step', () => {
    // Art. 50 lists twelve documentary requirements and none is a means test, and
    // Res. DNM 407/2026 says the solvency regime applies to permanent residence
    // "sin alterar los requisitos legalmente previstos para la residencia temporal".
    expect(byId('paraguay-temporary-residence').costs!.means).toBeNull();
  });

  test('solvency binds at the permanent stage but sets no amount', () => {
    // Res. 407/2026 contains no monetary threshold anywhere: proof is documentary
    // per category, and solvency "no podrá presumirse en ningún caso". A null amount
    // with a populated peg records that the gate is real without inventing a figure.
    const means = byId('paraguay-permanent-residence-solvency').costs!.means!;
    expect(means.amount).toBeNull();
    expect(means.pegged_to).toContain('no monetary threshold');
  });

  test('fees are jornales, not a frozen guarani figure', () => {
    // Ley 6984/2022 art. 100 sets fees in jornales, a statutory day-wage unit. The
    // guarani figure is a published conversion that moves when the jornal is
    // revalued, so recording 2,926,925 as the fee would freeze a number the law
    // never set. This is the same error as Gibraltar's invented GBP 37,500.
    for (const id of ['paraguay-temporary-residence', 'paraguay-permanent-residence-solvency']) {
      for (const fee of byId(id).costs!.fees) {
        expect(fee.amount, `${id} fee should carry no fixed amount`).toBeNull();
        expect(fee.pegged_to).toContain('jornal');
      }
    }
  });

  test('the two unsupported figures are no longer asserted', () => {
    const permanent = byId('paraguay-permanent-residence-solvency') as unknown as {
      summary: string; costs: { effective: { from: string | null } }; review: { note?: string };
    };
    // Res. 407/2026 is dated 28 May 2026 and carries no vigencia clause, so the
    // previously recorded "applications from 6 July 2026" was never in the instrument.
    // Checked on the summary and the effective date rather than the whole record,
    // because the review note names the date deliberately to document its removal.
    // Suppressing it there would erase the audit trail, which is the opposite of
    // what this is for.
    expect(permanent.summary).not.toContain('6 July 2026');
    expect(permanent.costs.effective.from).toBe('2026-05-28');
    expect(permanent.review.note).toContain('not supported by the instrument');
    // The conversion window is 3 months before expiry, not 90 days before and 30 after.
    const window = byId('paraguay-temporary-residence').variants[0]!.timeline.note ?? '';
    expect(window).toContain('three months before');
    expect(window).not.toContain('30 days');
  });

  test('the dual-nationality split is recorded, not flattened', () => {
    // Natural-born (art. 147) and naturalised (art. 150) sit under opposite regimes.
    // A single enum cannot express that, so the detail must carry both limbs.
    expect(py!.dual_nationality!.status).toBe('conditional');
    expect(py!.dual_nationality!.detail).toContain('147');
    expect(py!.dual_nationality!.detail).toContain('150');
  });
});

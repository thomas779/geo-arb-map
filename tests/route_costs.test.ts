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

import { describe, test, expect } from 'bun:test';
import type {
  BilateralLane,
  Bloc,
  BlocsData,
  CitizenshipRoutesData,
} from '../src/types';
// @ts-expect-error — plain-JS bun script, imported for its exported builder
import { buildTimelineRules } from '../scripts/build_timeline_rules.js';

/**
 * Regression + invariant tests for the dataset.
 *
 * Validator choice: hand-rolled, not zod. The shapes are shallow (strings,
 * {name, iso_n3} arrays, small enums) and the failure modes we care about
 * (missing field, wrong enum, malformed ISO) are one-line asserts. Zod would
 * add a dependency plus a second, parallel definition of every type that can
 * drift from src/types.ts exactly as silently as a hand-rolled check — with
 * worse error locality in test output.
 */

const data = (await Bun.file(
  new URL('../public/blocs_data.json', import.meta.url),
).json()) as BlocsData;

const coverage = (await Bun.file(
  new URL('../public/coverage.json', import.meta.url),
).json()) as { rows: Array<{ iso_n3: string; type: string }> };

const citizenshipRoutes = (await Bun.file(
  new URL('../public/citizenship_routes.json', import.meta.url),
).json()) as CitizenshipRoutesData;

const timelineRules = await Bun.file(
  new URL('../data/timeline_rules.json', import.meta.url),
).json() as {
  naturalization: Array<{
    iso_n3: string;
    ordinary_months?: number;
    ordinary_ref?: {
      route_id: string;
      fact: string;
      unit: 'months' | 'years';
    };
    conditional?: Array<{
      id: string;
      minimum_months?: number;
      minimum_ref?: {
        route_id: string;
        fact: string;
        unit: 'months' | 'years';
      };
      qualifying_lane_id?: string;
      qualifying_bloc_ids?: string[];
      excluded_iso_n3?: string[];
    }>;
  }>;
  heritage: Array<{ lane_id: string; duration_months: number }>;
  investment: Array<{ iso_n3: string; duration_months: number }>;
};

const compiledTimelineRules = await Bun.file(
  new URL('../public/timeline_rules.json', import.meta.url),
).json();

const curatedCitizenshipRoutes = await Bun.file(
  new URL('../data/citizenship_routes.json', import.meta.url),
).json();

const registry = await Bun.file(
  new URL('../data/registry.json', import.meta.url),
).json() as {
  sovereigns: Array<{ iso_n3: string }>;
  territories: Array<{ iso_n3: string }>;
  special: Array<{ id: string }>;
};

const ISO_RE = /^\d{3}$/;
const CATEGORIES = ['full', 'partial', 'hub_spoke', 'one_way', 'closed', 'proto'];
const ALLOCATIONS = ['right', 'ballot', 'quota_queue', 'discretionary'];

function memberOk(m: { name: string; iso_n3: string }, ctx: string) {
  expect(typeof m.name, `${ctx}: member name`).toBe('string');
  expect(m.iso_n3, `${ctx}: iso_n3 "${m.iso_n3}"`).toMatch(ISO_RE);
}

describe('regression: Russia dual-citizenship correction', () => {
  test('dual_citizenship.countries["643"].status is "allowed"', () => {
    expect(data.dual_citizenship?.countries['643']?.status).toBe('allowed');
  });

  test('no bloc claims Russia requires renunciation', () => {
    for (const b of data.blocs) {
      for (const text of [b.notes, b.fastest_entry]) {
        expect(text ?? '', `bloc ${b.id}`).not.toMatch(/Russia[^.]*requires renunciation/i);
      }
    }
  });
});

describe('schema conformance (mirrors src/types.ts)', () => {
  test('meta block', () => {
    expect(typeof data.meta.title).toBe('string');
    expect(data.meta.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof data.meta.disclaimer).toBe('string');
    for (const x of data.meta.excluded ?? []) {
      expect(typeof x.name).toBe('string');
      expect(typeof x.reason).toBe('string');
    }
  });

  test('blocs', () => {
    for (const b of data.blocs as Bloc[]) {
      const ctx = `bloc ${b.id}`;
      expect(typeof b.id, ctx).toBe('string');
      expect(typeof b.name, ctx).toBe('string');
      expect(CATEGORIES, `${ctx}: category "${b.category}"`).toContain(b.category);
      expect(b.color, ctx).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(b.members.length, ctx).toBeGreaterThan(0);
      b.members.forEach(m => memberOk(m, ctx));
      b.former_members?.forEach(m => memberOk(m, `${ctx} (former)`));
      for (const tier of ['TR', 'PR', 'CIT'] as const) {
        expect(typeof b.rights[tier], `${ctx}: rights.${tier}`).toBe('string');
      }
      expect(typeof b.fastest_entry, ctx).toBe('string');
      b.sub_bloc?.members_iso.forEach(iso =>
        expect(iso, `${ctx}: sub_bloc iso`).toMatch(ISO_RE));
    }
  });

  test('bilateral lanes', () => {
    for (const l of data.bilateral_lanes as BilateralLane[]) {
      const ctx = `lane ${l.id}`;
      expect(typeof l.id, ctx).toBe('string');
      expect(l.color, ctx).toMatch(/^#[0-9A-Fa-f]{6}$/);
      memberOk(l.destination, `${ctx} (destination)`);
      l.beneficiaries.forEach(m => memberOk(m, `${ctx} (beneficiary)`));
      expect(typeof l.grants, ctx).toBe('string');
      expect(typeof l.limits, ctx).toBe('string');
      expect(typeof l.leads_to_settlement, ctx).toBe('boolean');
      if (l.allocation !== undefined) {
        expect(ALLOCATIONS, `${ctx}: allocation "${l.allocation}"`).toContain(l.allocation);
      }
    }
  });

  test('dual_citizenship block', () => {
    const dc = data.dual_citizenship!;
    for (const [iso, policy] of Object.entries(dc.countries)) {
      expect(iso, `dual_citizenship country key`).toMatch(ISO_RE);
      expect(['allowed', 'banned', 'conditional'], `policy ${iso}`).toContain(policy.status);
    }
    for (const t of dc.treaty_exceptions) {
      t.parties.forEach(p => memberOk(p, `treaty ${t.id}`));
    }
  });

  test('pending_verification entries carry confidence + reason', () => {
    for (const p of data.pending_verification ?? []) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.confidence).toBe('string');
      expect(typeof p.reason).toBe('string');
    }
  });
});

describe('referential integrity', () => {
  test('every stacking_plays bloc id exists in blocs or lanes', () => {
    const known = new Set([
      ...data.blocs.map(b => b.id),
      ...data.bilateral_lanes.map(l => l.id),
    ]);
    for (const play of data.stacking_plays) {
      for (const id of play.blocs) {
        expect(known.has(id), `stacking play "${play.passport}" references "${id}"`).toBe(true);
      }
    }
  });

  test('identity lanes (empty beneficiaries) always have beneficiaries_note', () => {
    for (const l of data.bilateral_lanes) {
      if (l.beneficiaries.length === 0) {
        expect(typeof l.beneficiaries_note, `lane ${l.id}`).toBe('string');
        expect(l.beneficiaries_note!.length, `lane ${l.id}`).toBeGreaterThan(0);
      }
    }
  });

  test('lanes whose text mentions ballot/quota carry an explicit allocation', () => {
    // Negated mentions ("no ballot") are legitimate, so we only require the
    // allocation to be stated explicitly — a text/flag mismatch then needs a
    // deliberate data edit rather than slipping through as an implicit default.
    for (const l of data.bilateral_lanes) {
      if (/\bballot|quota\b/i.test(`${l.grants} ${l.limits}`)) {
        expect(l.allocation, `lane ${l.id} mentions ballot/quota but has no explicit allocation`).toBeDefined();
      }
    }
  });
});

describe('canonical timeline rules', () => {
  test('public timeline index is current with its referenced source facts', () => {
    expect(compiledTimelineRules).toEqual(
      buildTimelineRules(timelineRules, curatedCitizenshipRoutes),
    );
  });

  test('durations are unique, positive month values', () => {
    const naturalizationIds = timelineRules.naturalization.map(rule => rule.iso_n3);
    const heritageIds = timelineRules.heritage.map(rule => rule.lane_id);
    const investmentIds = timelineRules.investment.map(rule => rule.iso_n3);
    expect(new Set(naturalizationIds).size).toBe(naturalizationIds.length);
    expect(new Set(heritageIds).size).toBe(heritageIds.length);
    expect(new Set(investmentIds).size).toBe(investmentIds.length);

    for (const rule of timelineRules.naturalization) {
      expect(rule.iso_n3).toMatch(ISO_RE);
      expect(Number(Boolean(rule.ordinary_months)) + Number(Boolean(rule.ordinary_ref))).toBe(1);
      if (rule.ordinary_months) {
        expect(Number.isInteger(rule.ordinary_months)).toBe(true);
        expect(rule.ordinary_months).toBeGreaterThan(0);
      }
      for (const condition of rule.conditional ?? []) {
        expect(Number(Boolean(condition.minimum_months)) + Number(Boolean(condition.minimum_ref))).toBe(1);
        if (condition.minimum_months) {
          expect(Number.isInteger(condition.minimum_months)).toBe(true);
          expect(condition.minimum_months).toBeGreaterThan(0);
        }
      }
    }
    for (const rule of [...timelineRules.heritage, ...timelineRules.investment]) {
      expect(Number.isInteger(rule.duration_months)).toBe(true);
      expect(rule.duration_months).toBeGreaterThan(0);
    }
  });

  test('references resolve to reviewed routes or mapped arrangements', () => {
    const routeById = new Map(citizenshipRoutes.routes.map(route => [route.id, route]));
    const laneIds = new Set(data.bilateral_lanes.map(lane => lane.id));
    const blocIds = new Set(data.blocs.map(bloc => bloc.id));

    for (const rule of timelineRules.naturalization) {
      if (rule.ordinary_ref) {
        const route = routeById.get(rule.ordinary_ref.route_id);
        expect(route, rule.ordinary_ref.route_id).toBeDefined();
        expect(typeof route?.facts[rule.ordinary_ref.fact], rule.ordinary_ref.fact).toBe('number');
      }
      for (const condition of rule.conditional ?? []) {
        if (condition.minimum_ref) {
          const route = routeById.get(condition.minimum_ref.route_id);
          expect(route, condition.minimum_ref.route_id).toBeDefined();
          expect(typeof route?.facts[condition.minimum_ref.fact], condition.minimum_ref.fact).toBe('number');
        }
        if (condition.qualifying_lane_id) {
          expect(laneIds.has(condition.qualifying_lane_id), condition.id).toBe(true);
        }
        for (const blocId of condition.qualifying_bloc_ids ?? []) {
          expect(blocIds.has(blocId), condition.id).toBe(true);
        }
        for (const iso of condition.excluded_iso_n3 ?? []) {
          expect(iso, condition.id).toMatch(ISO_RE);
        }
      }
    }
    for (const rule of timelineRules.heritage) {
      expect(laneIds.has(rule.lane_id), rule.lane_id).toBe(true);
    }
  });
});

describe('coverage.json', () => {
  test('rows have unique iso_n3', () => {
    const seen = new Set<string>();
    for (const r of coverage.rows) {
      expect(seen.has(r.iso_n3), `duplicate coverage row ${r.iso_n3}`).toBe(false);
      seen.add(r.iso_n3);
    }
  });

  test('non-special rows use numeric iso_n3', () => {
    for (const r of coverage.rows) {
      if (r.type !== 'special') {
        expect(r.iso_n3, `coverage row ${r.iso_n3}`).toMatch(ISO_RE);
      }
    }
  });
});

describe('citizenship route database', () => {
  test('covers every registry jurisdiction exactly once across all four modes', () => {
    const registryIds = new Set([
      ...registry.sovereigns.map(row => row.iso_n3),
      ...registry.territories.map(row => row.iso_n3),
      ...registry.special.map(row => row.id),
    ]);
    const routeIds = citizenshipRoutes.jurisdictions.map(row => row.iso_n3);
    expect(new Set(routeIds).size).toBe(routeIds.length);
    expect(new Set(routeIds)).toEqual(registryIds);
    for (const row of citizenshipRoutes.jurisdictions) {
      expect(Object.keys(row.coverage).sort()).toEqual(
        ['ancestry', 'birth', 'investment', 'naturalization'],
      );
    }
  });

  test('route records are sourced, dated, and referentially valid', () => {
    const jurisdictionIds = new Set(citizenshipRoutes.jurisdictions.map(row => row.iso_n3));
    const ids = new Set<string>();
    for (const route of citizenshipRoutes.routes) {
      expect(ids.has(route.id), `duplicate route ${route.id}`).toBe(false);
      ids.add(route.id);
      expect(jurisdictionIds.has(route.country.iso_n3), route.id).toBe(true);
      expect(['ancestry', 'naturalization', 'birth', 'investment']).toContain(route.mode);
      expect(['active', 'inactive', 'verified_negative', 'pending_verification']).toContain(route.status);
      expect(route.last_checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(route.sources.length, route.id).toBeGreaterThan(0);
      for (const source of route.sources) {
        expect(source.url, route.id).toMatch(/^https:\/\//);
      }
    }
  });

  test('education residence rules preserve the France/Colombia distinction', () => {
    const france = citizenshipRoutes.routes.find(route =>
      route.id === 'france-study-naturalization-residence');
    const colombia = citizenshipRoutes.routes.find(route =>
      route.id === 'colombia-study-permanent-residence-credit');
    expect(france?.facts.residence_credit).toBe('full_if_lawful_habitual_and_continuous');
    expect(france?.facts.reduced_residence_years).toBe(2);
    expect(france?.facts.automatic).toBe(false);
    expect(colombia?.status).toBe('verified_negative');
    expect(colombia?.facts.residence_credit).toBe('none');
  });

  test('active CBI list is explicit and excludes pending statutory leads', () => {
    const active = citizenshipRoutes.routes.filter(route =>
      route.mode === 'investment' && route.status === 'active');
    const pending = citizenshipRoutes.routes.filter(route =>
      route.mode === 'investment' && route.status === 'pending_verification');
    expect(active.length).toBe(11);
    expect(pending.map(route => route.country.iso_n3).sort()).toEqual(['116', '882']);
  });

  test('Portugal records preserve the 2026 transition and nationality-dependent periods', () => {
    const portugal = citizenshipRoutes.routes.find(route =>
      route.id === 'portugal-ordinary-naturalization-2026');
    expect(portugal?.status).toBe('active');
    expect(portugal?.facts.effective_from).toBe('2026-05-19');
    expect(portugal?.facts.ordinary_residence_years_cplp_eu).toBe(7);
    expect(portugal?.facts.ordinary_residence_years_other).toBe(10);
    expect(portugal?.facts.pending_applications_old_law).toBe(true);
  });

  test('ended EU investor schemes cannot appear as active CBI', () => {
    const malta = citizenshipRoutes.routes.find(route =>
      route.id === 'malta-transactional-investor-citizenship-ended');
    const bulgaria = citizenshipRoutes.routes.find(route =>
      route.id === 'bulgaria-investor-citizenship-repealed');
    const turkiye = citizenshipRoutes.routes.find(route =>
      route.id === 'turkiye-exceptional-investor-citizenship');
    expect(malta?.status).toBe('inactive');
    expect(bulgaria?.status).toBe('inactive');
    expect(turkiye?.status).toBe('active');
    expect(turkiye?.facts.property_threshold_usd).toBe(400000);
    expect(turkiye?.facts.holding_period_years).toBe(3);
  });
});

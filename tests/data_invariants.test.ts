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

const citizenshipRoutes = (await Bun.file(
  new URL('../data/compiled/citizenship_routes.json', import.meta.url),
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
  heritage: Array<{
    iso_n3: string;
    route_id: string;
    duration_months: number;
    gate: string;
  }>;
  investment: Array<{ iso_n3: string; duration_months: number }>;
};

const compiledTimelineRules = await Bun.file(
  new URL('../src/data/timeline_rules.generated.json', import.meta.url),
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
  test('dual_citizenship.countries["586"] is conditional on the DGIP 22-country list', () => {
    const pk = data.dual_citizenship?.countries['586'];
    expect(pk?.status).toBe('conditional');
    expect(pk?.note).toContain('s.14(3)');
    expect(pk?.note).toContain('22');
    expect(pk?.sources?.join(' ')).toContain('dgip.gov.pk/immigration/dual_nationality.php');
  });

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

  test('bilateral lanes are nationality-based (no empty-beneficiary heritage layer)', () => {
    for (const l of data.bilateral_lanes) {
      expect(l.beneficiaries.length, `lane ${l.id} should list beneficiary countries`).toBeGreaterThan(0);
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
    // The committed index is curated rules plus rules derived from the private
    // canonical source, so a CI checkout (6-jurisdiction sample) cannot
    // reproduce the derived half. Assert the curated half round-trips exactly,
    // and that every derived rule is well-formed and names its source route.
    type NatRule = { iso_n3: string; ordinary_months: number; confidence: string; derived_from?: string };
    const regenerated = buildTimelineRules(timelineRules, curatedCitizenshipRoutes) as
      { naturalization: NatRule[]; heritage: unknown; investment: unknown };
    const curatedIsos = new Set(regenerated.naturalization.map((rule: NatRule) => rule.iso_n3));
    const compiledNat = compiledTimelineRules.naturalization as unknown as NatRule[];
    const compiledCurated = compiledNat
      .filter((rule: NatRule) => curatedIsos.has(rule.iso_n3))
      .sort((a: NatRule, b: NatRule) => a.iso_n3.localeCompare(b.iso_n3));
    expect(compiledCurated).toEqual(
      [...regenerated.naturalization].sort((a: NatRule, b: NatRule) => a.iso_n3.localeCompare(b.iso_n3)),
    );
    // Heritage rules get descent relations attached from the private canonical
    // source, so the same curated/derived split applies: compare the curated base
    // and validate the attached half separately, since a sample checkout cannot
    // reproduce it.
    type HeritageRule = Record<string, unknown> & {
      route_id: string;
      relations?: string[];
      deepest_recorded_degree?: number | null;
      limit_recorded?: boolean;
      maximum_degree?: number;
    };
    const ATTACHED = ['relations', 'deepest_recorded_degree', 'limit_recorded', 'maximum_degree'];
    const compiledHeritage = compiledTimelineRules.heritage as unknown as HeritageRule[];
    const withoutAttached = compiledHeritage.map(rule => {
      const base: Record<string, unknown> = { ...rule };
      for (const field of ATTACHED) delete base[field];
      return base;
    });
    expect(withoutAttached).toEqual(regenerated.heritage as Record<string, unknown>[]);
    expect(compiledTimelineRules.investment).toEqual(regenerated.investment);

    for (const rule of compiledHeritage) {
      if (!rule.relations) continue;
      // Every attached relation must be in the closed vocabulary, and the deepest
      // recorded degree must agree with it: a great-grandparent claim reporting
      // degree 2 would understate depth by a generation.
      expect(rule.relations.length).toBeGreaterThan(0);
      for (const relation of rule.relations) {
        expect(['parent', 'grandparent', 'great_grandparent', 'ancestor_unspecified'])
          .toContain(relation);
      }
      const degrees = { parent: 1, grandparent: 2, great_grandparent: 3 } as Record<string, number>;
      const named = rule.relations.map(relation => degrees[relation]).filter(Boolean) as number[];
      expect(rule.deepest_recorded_degree ?? null)
        .toBe(named.length ? Math.max(...named) : null);
      // A ceiling is only ever present alongside an authored maximum.
      expect(rule.limit_recorded).toBe(rule.maximum_degree !== undefined);
    }

    for (const rule of compiledNat) {
      if (curatedIsos.has(rule.iso_n3)) continue;
      // Derived rules must be sourced, high-confidence and a positive duration:
      // the planner must never assert a modelled or zero-length wait.
      expect(rule.derived_from, `derived rule ${rule.iso_n3} has no source route`).toBeTruthy();
      expect(rule.confidence).toBe('high');
      expect(rule.ordinary_months).toBeGreaterThan(0);
    }
  });

  test('durations are unique, positive month values', () => {
    const naturalizationIds = timelineRules.naturalization.map(rule => rule.iso_n3);
    const heritageIds = timelineRules.heritage.map(rule => rule.iso_n3);
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
    const residenceById = new Map(
      (citizenshipRoutes.residence_routes ?? []).map(route => [route.id, route]),
    );
    for (const rule of timelineRules.heritage) {
      expect(rule.iso_n3).toMatch(ISO_RE);
      expect(rule.gate === 'ancestor' || rule.gate.startsWith('claim:'), rule.route_id).toBe(true);
      const exists = routeById.has(rule.route_id) || residenceById.has(rule.route_id);
      expect(exists, `descent path route ${rule.route_id}`).toBe(true);
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
        // HTTP is allowed ONLY for named official publishers that serve no TLS at
        // all. bdlaws.minlaw.gov.bd is the Legislative and Parliamentary Affairs
        // Division of Bangladesh's Ministry of Law and is the publisher of record
        // for the Citizenship Act, 1951; its https endpoint does not connect.
        // The alternative is citing an aggregator for a statute, which is the
        // thing #127 exists to stop, so the weaker transport is the lesser harm.
        // Keep this list tiny and justified: every entry is a host we verified is
        // http-only, not a host we could not be bothered to check.
        const HTTP_ONLY_OFFICIAL = ['bdlaws.minlaw.gov.bd'];
        const host = (/^https?:\/\/([^/]+)/.exec(source.url)?.[1] ?? '').toLowerCase();
        if (!HTTP_ONLY_OFFICIAL.includes(host)) {
          expect(source.url, route.id).toMatch(/^https:\/\//);
        }
      }
    }
  });

  test('education residence rules preserve the France/Colombia distinction', () => {
    const france = citizenshipRoutes.routes.find(route =>
      route.id === 'france-study-naturalization-residence');
    // Colombia study-time absence is coverage note material, not a negative product row.
    const colombiaCredit = citizenshipRoutes.routes.find(route =>
      route.id === 'colombia-study-permanent-residence-credit');
    expect(france?.facts.residence_credit).toBe('full_if_lawful_habitual_and_continuous');
    expect(france?.facts.reduced_residence_years).toBe(2);
    expect(france?.facts.automatic).toBe(false);
    expect(colombiaCredit).toBeUndefined();
  });

  test('active CBI list is explicit and excludes pending statutory leads', () => {
    const active = citizenshipRoutes.routes.filter(route =>
      route.mode === 'investment' && route.status === 'active');
    const pending = citizenshipRoutes.routes.filter(route =>
      route.mode === 'investment' && route.status === 'pending_verification');
    expect(active.length).toBe(16);
    expect(active.map(route => route.id)).toContain('mauritius-investor-naturalization');
    // July 2026 gap-check batch: North Macedonia art. 11 confirmed active (was a
    // genuine gap); Samoa and Cambodia verified active from pending.
    expect(active.map(route => route.id)).toContain('north-macedonia-economic-interest-citizenship');
    expect(pending.map(route => route.country.iso_n3).sort()).toEqual(['032', '050', '586', '598']);
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

describe('monitor-lead verifications, July 2026', () => {
  test('Malta descent records the Act XXI of 2025 window and cites the act', () => {
    const descent = citizenshipRoutes.routes.find(route =>
      route.id === 'malta-registration-family-descent');
    // Act XXI of 2025 moved every 2007/2010 reference date in articles 3 and 5
    // to 1 August 2028. That date is the whole decision for a descent claim, so
    // it must never silently drop out of the summary again.
    expect(descent?.summary).toContain('1 August 2028');
    expect(descent?.summary).toContain('two consecutive ascendants born in Malta');
    expect(descent?.sources.map(source => source.url)).toContain(
      'https://legislation.mt/eli/act/2025/21/eng');
    expect(descent?.last_checked).toBe('2026-07-28');
  });

  test('Malta ended-investor route records the statutory deletion, not just the judgment', () => {
    const ended = citizenshipRoutes.routes.find(route =>
      route.id === 'malta-transactional-investor-citizenship-ended');
    expect(ended?.status).toBe('inactive');
    expect(ended?.summary).toContain('individual investor programme');
    expect(ended?.summary).toContain('no financial threshold');
    expect(ended?.sources.map(source => source.url)).toContain(
      'https://legislation.mt/eli/act/2025/21/eng');
  });

  test('Pakistan descent records retrospective parent-for-father substitution at high confidence', () => {
    const descent = citizenshipRoutes.routes.find(route =>
      route.id === 'pakistan-citizenship-by-parent');
    // s. 5(2) in the Pakistan Code consolidation (Act XXVII of 2026) makes the
    // 2000 "parent for father" substitution retrospective to the Act's commencement.
    expect(descent?.summary.toLowerCase()).toMatch(/retrospect|commencement/);
    expect(descent?.summary).not.toContain('has counted since 2000');
    expect(descent?.confidence).toBe('high');
    expect(descent?.sources[0]?.url).toContain('pakistancode.gov.pk');
  });

  test('Paraguay Investor Pass is priced at its lowest published tier', () => {
    const residence = citizenshipRoutes.residence_routes ?? [];
    const pass = residence.find(route => route.id === 'paraguay-investor-pass');
    expect(pass).toBeDefined();
    // USD 150k tourism is the floor; the 200k real-estate/BVA tiers live in the note.
    expect(pass?.min_investment).toEqual({ amount: 150000, currency: 'USD' });
    expect(pass?.outcome).toBe('permanent_residence');
    expect(pass?.confidence).toBe('medium');
  });

  // #136 residence medium→high batch (2026-08-04): primary-law upgrades only.
  test('#136 batch: Japan nomad, Spain non-lucrative, Portugal D7, Latvia deposit are high', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));

    const jp = byId.get('japan-digital-nomad-visa');
    expect(jp?.confidence).toBe('high');
    expect(jp?.min_income_monthly).toEqual({ amount: 833334, currency: 'JPY' });
    expect(jp?.permit_duration_months).toBe(6);
    expect(jp?.permit_renewable).toBe(false);
    expect(jp?.counts_toward_permanent_residence).toBe(false);
    expect(jp?.counts_toward_naturalization).toBe(false);
    expect(jp?.summary).toMatch(/10[, ]?000[, ]?000|10 million yen/i);
    expect(jp?.sources.some(s => s.url.includes('moj.go.jp/isa'))).toBe(true);

    const es = byId.get('spain-non-lucrative-visa');
    expect(es?.confidence).toBe('high');
    expect(es?.min_income_monthly).toEqual({ amount: 2400, currency: 'EUR' });
    expect(es?.physical_presence_days_per_year).toBe(183);
    expect(es?.permit_duration_months).toBe(12);
    expect(es?.permit_renewable).toBe(true);
    expect(es?.work_rights).toBe('none');
    expect(es?.summary).toMatch(/400\s*%|IPREM/i);
    expect(es?.sources.some(s => s.url.includes('boe.es') || s.url.includes('BOE-A-2024-24099'))).toBe(true);

    const pt = byId.get('portugal-d7-passive-income');
    expect(pt?.confidence).toBe('high');
    // RMMG 2026 = EUR 920 (DL 139/2025); 2025's 870 is superseded.
    expect(pt?.min_income_monthly).toEqual({ amount: 920, currency: 'EUR' });
    expect(pt?.counts_toward_permanent_residence).toBe(true);
    expect(pt?.counts_toward_naturalization).toBe(true);
    expect(pt?.sources.some(s => s.url.includes('vistos.mne.gov.pt') || s.url.includes('diariodarepublica'))).toBe(true);

    const lv = byId.get('latvia-investor-residence');
    expect(lv?.confidence).toBe('high');
    expect(lv?.min_investment).toEqual({ amount: 280000, currency: 'EUR' });
    expect(lv?.summary).toMatch(/280[, ]?000/);
    expect(lv?.summary).toMatch(/25[, ]?000/);
    expect(lv?.sources.some(s => s.url.includes('pmlp.gov.lv'))).toBe(true);
  });

  // Russia investor ВНЖ (Gov. Decree 2573) — high confidence only; quote-checked
  // 2026-08-04 against full decree text + Minek implementation note. Not CBI.
  test('Russia investor permanent residence is Decree 2573 at high confidence, not CBI', () => {
    const residence = citizenshipRoutes.residence_routes ?? [];
    const route = residence.find(r => r.id === 'russia-investor-permanent-residence');
    expect(route).toBeDefined();
    expect(route?.country.iso_n3).toBe('643');
    expect(route?.category).toBe('investment');
    expect(route?.status).toBe('active');
    expect(route?.outcome).toBe('permanent_residence');
    expect(route?.confidence).toBe('high');
    // Lowest published capital corridor is RUB 15m (regional social projects);
    // higher corridors (company tax floors, real-estate cadastral bands) stay in the summary.
    expect(route?.min_investment).toEqual({ amount: 15_000_000, currency: 'RUB' });
    expect(route?.counts_toward_permanent_residence).toBe(true);
    expect(route?.counts_toward_naturalization).toBe(true);
    // Direct PR without prior temporary residence (РВП).
    expect(route?.summary).toMatch(/без получения разрешения на временное проживание|without first obtaining a temporary residence permit|without.*РВП/i);
    expect(route?.summary).toContain('15 million');
    expect(route?.summary).toContain('30 million');
    expect(route?.summary).toContain('50 million');
    expect(route?.summary).toContain('20 million');
    expect(route?.summary).toContain('25 million');
    expect(route?.summary).toMatch(/sanctions/i);
    // No invented stay-day rule; physical presence is deliberately unset.
    expect(route?.physical_presence_days_per_year).toBeNull();
    const urls = (route?.sources ?? []).map(s => s.url);
    expect(urls.some(u => u.includes('government.ru') || u.includes('pravo.gov.ru'))).toBe(true);
    expect(urls.some(u => u.includes('economy.gov.ru'))).toBe(true);

    // Citizenship layer still records no CBI for Russia.
    const ru = citizenshipRoutes.jurisdictions.find(j => j.iso_n3 === '643');
    expect(ru?.residence_route_ids).toContain('russia-investor-permanent-residence');
    expect(ru?.coverage.investment).toBe('reviewed');
    const cbi = (citizenshipRoutes.routes ?? []).filter(
      r => r.country.iso_n3 === '643' && r.mode === 'investment' && r.status === 'active',
    );
    expect(cbi).toHaveLength(0);
  });

  // #190 talent / extraordinary ability expansion. Nine products at high, each
  // re-read verbatim against its instrument or derived from it; Ireland Critical
  // Skills and Canada Global Talent Stream at medium, for the reasons pinned
  // below. Several guards here assert the SUPERSEDED value is gone rather than
  // only the new one, because the defects this test exists to catch were fields
  // that quietly contradicted their own route summary.
  test('#190 talent_skilled expansion pins flagship products and taxonomy guards', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    const high = [
      'uk-global-talent',
      'us-eb1a-extraordinary-ability',
      'france-talent-salarie-qualifie',
      'france-talent-chercheur',
      'france-talent-carte-bleue-europeenne',
      'japan-highly-skilled-professional',
      'hong-kong-ttps',
      'hong-kong-qmas',
      'germany-eu-blue-card',
      'netherlands-highly-skilled-migrant',
    ] as const;
    for (const id of high) {
      const r = byId.get(id);
      expect(r, id).toBeTruthy();
      expect(r?.category).toBe('talent_skilled');
      expect(r?.status).toBe('active');
      expect(r?.confidence).toBe('high');
    }
    // Medium, each for a recorded reason. Ireland: the Critical Skills
    // Occupations List is not transcribed. Canada: canada.ca returns 403 to
    // automated fetch, so the CAD 80,000 / 150,000 pair could not be re-read and
    // has no independent official corroboration, unlike every `high` figure above.
    for (const id of [
      'ireland-critical-skills-employment-permit',
      'canada-global-talent-stream',
    ] as const) {
      const r = byId.get(id);
      expect(r, id).toBeTruthy();
      expect(r?.category).toBe('talent_skilled');
      expect(r?.status).toBe('active');
      expect(r?.confidence, id).toBe('medium');
    }

    // Ireland: Stamp 4 arrives about two years in, but it is a renewable
    // two-year permission, NOT permanent residence, and no Irish limb reaches PR
    // at 24 months. eligibility_months therefore carries the ordinary five-year
    // reckonable-residence clock. The superseded value is guarded explicitly.
    const ie = byId.get('ireland-critical-skills-employment-permit');
    expect(ie?.pathways?.[0]?.eligibility_months).toBe(60);
    expect(ie?.pathways?.[0]?.eligibility_months).not.toBe(24);
    expect(ie?.summary).toMatch(/not permanent residence/i);
    // Three floors apply (EUR 40,904 / 36,848 / 68,911), so no single monthly
    // scalar is honest; the figures live in the summary instead.
    expect(ie?.min_income_monthly).toBeNull();
    expect(ie?.summary).toMatch(/40,904/);

    // US: immigrant EB-1A is permanent; O-1 remains temporary nonimmigrant.
    expect(byId.get('us-eb1a-extraordinary-ability')?.outcome).toBe('permanent_residence');
    expect(byId.get('us-eb1a-extraordinary-ability')?.counts_toward_permanent_residence).toBe(true);
    expect(byId.get('us-o1-extraordinary-ability')?.outcome).toBe('residence');
    expect(byId.get('us-o1-extraordinary-ability')?.counts_toward_permanent_residence).toBe(false);

    // Canada GTS is TFWP temporary — not a PR product.
    const ca = byId.get('canada-global-talent-stream');
    expect(ca?.counts_toward_permanent_residence).toBe(false);
    expect(ca?.counts_toward_naturalization).toBe(false);
    expect(ca?.pathways?.[0]?.eligibility_months).toBeNull();
    // Exact twelfth of the CAD 80,000 Category A floor. Rounding up to 6667
    // overstates the threshold a shortlist filters on.
    expect(ca?.min_income_monthly).toEqual({ amount: 6666.67, currency: 'CAD' });

    // Germany: eligibility_months is a MINIMUM, so it carries the shortest
    // AufenthG §18c(2) limb — 21 months with ausreichende German ("verkürzt sich
    // auf 21 Monate"), not the 27 that applies with einfache German only. Both
    // limbs belong in the summary, and §18c must be cited, since §18g grants the
    // Blue Card but says nothing about settlement.
    const de = byId.get('germany-eu-blue-card');
    expect(de?.pathways?.[0]?.eligibility_months).toBe(21);
    expect(de?.summary).toMatch(/21 Monate|21 months/);
    expect(de?.summary).toMatch(/27 months/);
    expect(de?.sources.map(s => s.url).some(u => u.includes('__18c'))).toBe(true);

    // HK TTPS is not permanent at grant; 7-year ordinary residence for right of abode.
    const hk = byId.get('hong-kong-ttps');
    expect(hk?.outcome).toBe('residence');
    expect(hk?.pathways?.[0]?.eligibility_months).toBe(84);
    // Category A asks what the applicant EARNED in the preceding year, not what
    // they will be paid monthly. An earlier revision recorded 2.5M/12 = 208,333,
    // which ResidenceCard renders as an "HKD 208,333/mo" chip and so restated a
    // retrospective income test as a forward salary floor. Genuine periodic
    // salary conditions (FR, DE, CA below) do convert; this one must not.
    expect(hk?.min_income_monthly).toBeNull();
    expect(hk?.summary).toMatch(/2\.5 million/);
    expect(hk?.summary).toMatch(/immediately preceding|preceding the date of application/i);
    // Not sourced on the cited IMMD page, so not recorded.
    expect(hk?.min_age).toBeNull();

    // France non-investment talent limbs; investment porteur-de-projet stay in investment.
    expect(byId.get('france-talent-investor')?.category).toBe('investment');
    expect(byId.get('france-talent-business-creator')?.category).toBe('investment');
    expect(byId.get('france-talent-salarie-qualifie')?.min_income_monthly?.currency).toBe('EUR');
    expect(byId.get('france-talent-carte-bleue-europeenne')?.min_income_monthly?.amount).toBe(4947.75);

    // NL HSM 2026 ≥30 floor.
    expect(byId.get('netherlands-highly-skilled-migrant')?.min_income_monthly).toEqual({
      amount: 5942,
      currency: 'EUR',
    });

    // UK Global Talent: renewable multi-year, full work rights, settlement clock present.
    const uk = byId.get('uk-global-talent');
    expect(uk?.permit_duration_months).toBe(60);
    expect(uk?.permit_renewable).toBe(true);
    expect(uk?.work_rights).toBe('full');
    expect(uk?.min_age).toBe(18);

    const talent = (citizenshipRoutes.residence_routes ?? []).filter(r => r.category === 'talent_skilled');
    expect(talent.length).toBeGreaterThanOrEqual(28);
  });
});

describe('monitor-lead verifications, 30 July 2026', () => {
  test('monitor #177 Syria Decree 13 Kurdish route is medium with SANA source entity', () => {
    const route = citizenshipRoutes.routes.find(r => r.id === 'syria-kurdish-citizenship-decree-13-2026');
    expect(route).toBeDefined();
    expect(route?.confidence).toBe('medium');
    expect(route?.status).toBe('active');
    expect(route?.summary).toMatch(/Decree No\.\s*13|Decree No\. \(13\)|Decree No\. 13/i);
    expect(route?.summary).toMatch(/1962|Hasakah|al-Hasakah|Hasakeh/i);
    const urls = (route?.sources ?? []).map(s => s.url);
    expect(urls.some(u => u.includes('sana.sy'))).toBe(true);
  });

  test('monitor #176 Gibraltar Status long-residence is 20 years from Act 2026 primary law', () => {
    const route = citizenshipRoutes.residence_routes?.find(r => r.id === 'gibraltar-gibraltarian-status-long-residence');
    expect(route).toBeDefined();
    expect(route?.confidence).toBe('high');
    expect(route?.outcome).toBe('permanent_residence');
    expect(route?.pathways?.[0]?.eligibility_months).toBe(240);
    const summary = route?.summary ?? '';
    expect(summary).toMatch(/twenty years|20 years/i);
    expect(summary).toMatch(/ten-year|ten years|10 years/i); // savings for pre-30 Oct 2025
    expect(summary).not.toMatch(/permanent residency from five/i);
    const urls = (route?.sources ?? []).map(s => s.url);
    expect(urls.some(u => u.includes('gibraltarlaws.gov.gi') && u.includes('gibraltarian-status-amendment'))).toBe(true);
  });


  test('Slovakia descent records the new section 7(8) ancestor route', () => {
    const descent = citizenshipRoutes.routes.find(route =>
      route.id === 'slovakia-citizenship-by-parent');
    // Act 128/2026 inserted §7(8) on 15 July 2026. Verified verbatim against the
    // slov-lex consolidated text and diffed against the 12 June 2026 version,
    // which had no parent/grandparent/great-grandparent provision at all.
    expect(descent?.summary).toContain('15 July 2026');
    expect(descent?.summary).toContain('great-grandparent');
    // The two facts that make the route usable from abroad.
    expect(descent?.summary).toContain('no Slovak residence permit');
    expect(descent?.summary).toContain('no language test');
    expect(descent?.confidence).toBe('high');
    expect(descent?.sources.map(s => s.url)).toContain(
      'https://static.slov-lex.sk/static/SK/ZZ/1993/40/20260715.html');
  });

  test('residence batch 6 records LatAm RBI tracks and Palau RNS.ID digital credential', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    for (const id of [
      'brazil-viper-investor-residence',
      'chile-investor-temporary-residence',
      'chile-rentista-jubilado-temporary-residence',
      'colombia-m-visa-real-estate-investor',
      'colombia-m-visa-business-investor',
      'ecuador-investor-temporary-residence',
      'peru-rentista-residence',
      'peru-investor-residence',
      'palau-rns-digital-residency-id',
    ]) {
      expect(byId.has(id), id).toBe(true);
    }
    const palau = byId.get('palau-rns-digital-residency-id');
    expect(palau?.category).toBe('digital_identity');
    expect(palau?.counts_toward_permanent_residence).toBe(false);
    expect(palau?.counts_toward_naturalization).toBe(false);
    expect(palau?.summary.toLowerCase()).toContain('not a physical residence');
    expect(palau?.summary.toLowerCase()).toMatch(/digital identity|digital residency/);
    expect(palau?.min_investment?.amount).toBe(248);
    const chile = byId.get('chile-investor-temporary-residence');
    expect(chile?.min_investment?.amount).toBe(500000);
  });

  test('digital_identity holds Estonia e-Residency and Palau RNS.ID separately from nomad visas', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    const ee = byId.get('estonia-e-residency');
    const nomad = byId.get('estonia-digital-nomad');
    expect(ee?.category).toBe('digital_identity');
    expect(ee?.counts_toward_permanent_residence).toBe(false);
    expect(ee?.counts_toward_naturalization).toBe(false);
    expect(ee?.summary.toLowerCase()).toMatch(/not a visa|not a right to live/);
    expect(nomad?.category).toBe('digital_nomad');
    expect(byId.get('palau-rns-digital-residency-id')?.category).toBe('digital_identity');
  });

  test('digital_identity batch: active peers + paused Ukraine + announced Portugal + Georgia negative', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    for (const id of [
      'estonia-e-residency',
      'azerbaijan-e-residency',
      'lithuania-e-residency',
      'palau-rns-digital-residency-id',
      'kazakhstan-e-residency',
    ]) {
      const r = byId.get(id);
      expect(r, id).toBeTruthy();
      expect(r?.category, id).toBe('digital_identity');
      expect(r?.status, id).toBe('active');
      expect(r?.counts_toward_permanent_residence, id).toBe(false);
      expect(r?.counts_toward_naturalization, id).toBe(false);
    }
    expect(byId.get('ukraine-uresidency')?.category).toBe('digital_identity');
    expect(byId.get('ukraine-uresidency')?.status).toBe('inactive');
    expect(byId.get('portugal-e-residency-announced')?.category).toBe('digital_identity');
    expect(byId.get('portugal-e-residency-announced')?.status).toBe('pending_verification');
    // Georgia has no e-residency product — absences are not stored as product rows.
    expect(byId.has('georgia-e-residency-verified-negative')).toBe(false);
    expect(byId.get('kazakhstan-e-residency')?.min_investment?.amount).toBe(120);
    expect(byId.get('kazakhstan-e-residency')?.summary).toMatch(/not.*eGov|not.*visa|not a visa/i);
  });

  test('digital nomad N2 Americas: Argentina transitory + Panama remote worker', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    const ar = byId.get('argentina-digital-nomad-transitory');
    expect(ar?.category).toBe('digital_nomad');
    expect(ar?.counts_toward_permanent_residence).toBe(false);
    expect(ar?.counts_toward_naturalization).toBe(false);
    expect(ar?.summary).toMatch(/180 days|transitory/i);
    const pa = byId.get('panama-remote-worker-short-stay');
    expect(pa?.category).toBe('digital_nomad');
    expect(pa?.counts_toward_permanent_residence).toBe(false);
    expect(pa?.min_income_monthly?.amount).toBe(3000);
  });

  test('residence batch 7 British islands HNW/business routes (no golden-visa negative rows)', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    for (const id of [
      'gibraltar-hnw-residence',
      'isle-of-man-entrepreneur-investor-residence',
      'jersey-business-high-value-residence',
    ]) {
      expect(byId.has(id), id).toBe(true);
      expect(byId.get(id)?.status, id).toBe('active');
    }
    // Absences are not product rows.
    for (const id of [
      'gibraltar-passive-golden-visa-verified-negative',
      'isle-of-man-golden-visa-verified-negative',
      'jersey-golden-visa-verified-negative',
    ]) {
      expect(byId.has(id), id).toBe(false);
    }
  });

  test('digital nomad N1 Europe/Black Sea batch (CY RO + TR; DE absence not stored)', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    expect(byId.get('cyprus-digital-nomad-visa')?.category).toBe('digital_nomad');
    expect(byId.get('cyprus-digital-nomad-visa')?.counts_toward_permanent_residence).toBe(false);
    expect(byId.get('romania-digital-nomad-visa')?.counts_toward_naturalization).toBe(false);
    // Absences are not product rows; Türkiye is a live programme; Georgia's lapsed
    // pandemic scheme remains inactive (ended real programme).
    expect(byId.has('germany-digital-nomad-verified-negative')).toBe(false);
    expect(byId.get('turkey-digital-nomad-visa')?.status).toBe('active');
    expect(byId.get('turkey-digital-nomad-visa')?.min_income_monthly).toEqual({ amount: 3000, currency: 'USD' });
    expect(byId.get('georgia-remotely-from-georgia-ended')?.status).toBe('inactive');
  });

  test('digital nomad coverage batch adds Croatia Italy Hungary Colombia with no PR/citizenship path', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    for (const id of [
      'croatia-digital-nomad-temporary-stay',
      'italy-digital-nomad-visa',
      'hungary-white-card-digital-nomad',
      'colombia-digital-nomad-visa',
    ]) {
      const r = byId.get(id);
      expect(r, id).toBeTruthy();
      expect(r?.category).toBe('digital_nomad');
      expect(r?.counts_toward_permanent_residence).toBe(false);
      expect(r?.counts_toward_naturalization).toBe(false);
    }
    expect(byId.get('croatia-digital-nomad-temporary-stay')?.min_income_monthly?.amount).toBe(3622.5);
  });

  test('residence batch 5 records Nordics/Baltics startup tracks (no golden-visa negative rows)', () => {
    const ids = new Set(citizenshipRoutes.residence_routes?.map(r => r.id) ?? []);
    for (const id of [
      'denmark-startup-denmark',
      'finland-startup-entrepreneur',
      'finland-specialist',
      'lithuania-startup-visa',
      'romania-commercial-activity-long-stay',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    for (const id of [
      'denmark-golden-visa-verified-negative',
      'finland-golden-visa-verified-negative',
      'lithuania-golden-visa-verified-negative',
      'romania-golden-visa-verified-negative',
    ]) {
      expect(ids.has(id), id).toBe(false);
    }
    const fi = citizenshipRoutes.residence_routes?.find(r => r.id === 'finland-specialist');
    expect(fi?.min_income_monthly?.amount).toBe(3937);
  });

  test('priority jus soli batch: DR Chile conditional; Pakistan + Uruguay unconditional', () => {
    const byId = new Map(citizenshipRoutes.routes.map(r => [r.id, r]));
    expect(byId.get('dominican-republic-citizenship-by-birth')?.facts.jus_soli).toBe('conditional');
    expect(byId.get('chile-citizenship-by-birth')?.facts.jus_soli).toBe('conditional');
    // s. 4 Citizenship Act 1951 is general jus soli (diplomat/enemy-alien exceptions only).
    // Tier 1c 2026-07-30: corrected prior practice-as-statute jus_soli=none modeling.
    expect(byId.get('pakistan-citizenship-at-birth-by-parent')?.facts.jus_soli).toBe('unconditional');
    expect(byId.get('pakistan-citizenship-at-birth-by-parent')?.facts.unconditional_jus_soli).toBe(true);
    expect(byId.get('uruguay-nationality-by-birth')?.facts.jus_soli).toBe('unconditional');
    expect(byId.get('uruguay-nationality-by-birth')?.facts.unconditional_jus_soli).toBe(true);
    // Unconditional set: Americas core, the Commonwealth Caribbean, US territories
    // following US jus soli, plus Lesotho, Tuvalu, Peru, and Pakistan (s. 4 Act).
    // Corrected 2026-07-30 after nine jurisdictions were found misclassified as
    // `none` at high confidence — see #119. Every entry is sourced to official text.
    const unconditional = citizenshipRoutes.routes.filter(r =>
      r.mode === 'birth' && r.facts?.jus_soli === 'unconditional');
    expect(unconditional.map(r => r.country.iso_n3).sort()).toEqual([
      '028', '032', '052', '068', '076', '084', '124', '192', '212', '218',
      '222', '308', '316', '320', '328', '340', '388', '426', '484', '558',
      '580', '586', '591', '600', '604', '630', '659', '662', '670', '780',
      '798', '840', '850', '858', '862',
    ]);
    // Guard against silent UNDER-counting, which is how the errors above arose:
    // an exact-list assertion happily locks in a wrong answer. GLOBALCIT puts
    // unconditional ius soli near 19% of 191 states, so the sovereign count
    // (excluding the four US territories) belongs in a defensible band.
    const TERRITORIES = new Set(['316', '580', '630', '850']);
    const sovereigns = unconditional.filter(r => !TERRITORIES.has(r.country.iso_n3));
    expect(sovereigns.length).toBeGreaterThanOrEqual(28);
    expect(sovereigns.length).toBeLessThanOrEqual(42);
    // Birth coverage: every birth route carries structured jus_soli, with ONE
    // deliberate hole.
    //
    // Bangladesh was recorded `jus_soli: none` at confidence high on a single
    // constituteproject citation. Reading the statute (2026-08-08) contradicts it:
    // s.4 of the Citizenship Act, 1951 says "Every person born in Bangladesh after
    // the commencement of this Act shall be a citizen of Bangladesh by birth",
    // subject only to a diplomat and an enemy-alien proviso. The value was REMOVED
    // rather than flipped to unconditional, because P.O. 149/1972 has not been read
    // and asserting the opposite on this evidence would repeat the same error
    // backwards. `classifyJusSoli` therefore returns needs_review for it, which is
    // the honest answer.
    //
    // The named exception matters: this asserts the hole is exactly one route and
    // exactly that route, so coverage cannot quietly erode behind a lowered number.
    const birth = citizenshipRoutes.routes.filter(r => r.mode === 'birth');
    const withJs = birth.filter(r => r.facts?.jus_soli);
    const missing = birth.filter(r => !r.facts?.jus_soli).map(r => r.id);
    expect(missing).toEqual(['bangladesh-citizenship-at-birth-by-parent']);
    expect(withJs.length).toBe(birth.length - 1);
    expect(withJs.length).toBe(230);
  });

  test('digital nomad live programmes + Korea workcation; absences not stored', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    // Live programmes only. Mexico/Jamaica/UK have no branded nomad product —
    // that absence is derived UI, not a stored negative row. Antigua/Bahamas
    // lapsed programmes stay inactive (ended real programmes).
    expect(byId.get('namibia-digital-nomad-visa')?.status).toBe('active');
    expect(byId.get('south-africa-remote-work-visa')?.status).toBe('active');
    expect(byId.get('indonesia-remote-worker-visa')?.status).toBe('active');
    for (const id of ['antigua-nomad-digital-residence-ended', 'bahamas-beats-ended']) {
      expect(byId.get(id)?.status, id).toBe('inactive');
      expect(byId.get(id)?.counts_toward_permanent_residence, id).toBe(false);
    }
    for (const id of [
      'mexico-digital-nomad-verified-negative',
      'jamaica-digital-nomad-verified-negative',
      'uk-digital-nomad-verified-negative',
    ]) {
      expect(byId.has(id), id).toBe(false);
    }
    const kr = byId.get('korea-digital-nomad-workcation');
    expect(kr?.category).toBe('digital_nomad');
    expect(kr?.counts_toward_permanent_residence).toBe(false);
    expect(kr?.counts_toward_naturalization).toBe(false);
    const nomads = (citizenshipRoutes.residence_routes ?? []).filter(r => r.category === 'digital_nomad');
    // Count is live + inactive (ended) programmes only — absences not stored.
    expect(nomads.length).toBeGreaterThanOrEqual(34);
  });

  test('digital nomad gap fill: Costa Rica Ley 10008, Slovenia 2025 permit, Brazil VITEM XIV', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    for (const id of [
      'costa-rica-remote-worker-ley-10008',
      'slovenia-digital-nomad-temporary-residence',
      'brazil-vitem-xiv-digital-nomad',
    ]) {
      const r = byId.get(id);
      expect(r, id).toBeTruthy();
      expect(r?.category, id).toBe('digital_nomad');
      expect(r?.status, id).toBe('active');
      expect(r?.counts_toward_permanent_residence, id).toBe(false);
      expect(r?.counts_toward_naturalization, id).toBe(false);
    }
    expect(byId.get('costa-rica-remote-worker-ley-10008')?.min_income_monthly?.amount).toBe(3000);
    expect(byId.get('brazil-vitem-xiv-digital-nomad')?.min_income_monthly?.amount).toBe(1500);
  });

  test('residence IMC remainder batches 8–10 cover former gap ISOs with positive products', () => {
    // Pure absences (Maldives 462, Malawi 454) are no longer stored as negative
    // product rows — they drop off this set by design (positives-only rule).
    const isos = new Set((citizenshipRoutes.residence_routes ?? []).map(r => r.country.iso_n3));
    for (const iso of [
      '100', '804', '031', '674', // R8
      '818', '690', '144', // R9 (Maldives 462: no positive product)
      '340', '558', '242', '116', '417', // R10 (Malawi 454: no positive product)
    ]) {
      expect(isos.has(iso), iso).toBe(true);
    }
    expect(isos.has('462')).toBe(false);
    expect(isos.has('454')).toBe(false);
  });

  test('US birthright records unconditional jus soli after Trump v. Barbara', () => {
    const birth = citizenshipRoutes.routes.find(route => route.id === 'us-citizenship-by-birth');
    expect(birth?.facts.jus_soli).toBe('unconditional');
    expect(birth?.facts.unconditional_jus_soli).toBe(true);
    expect(birth?.facts.parent_condition).toBe('none');
    expect(birth?.summary).toContain('Trump v. Barbara');
    expect(birth?.summary).toContain('30 June 2026');
    expect(birth?.sources.map(s => s.url).join(' ')).toContain('supremecourt.gov/opinions/25pdf/25-365');
    expect(birth?.last_checked).toBe('2026-07-30');
  });

  test('Portugal birth route is structured as conditional jus soli', () => {
    const birth = citizenshipRoutes.routes.find(route =>
      route.id === 'portugal-birth-parent-residence-2026');
    expect(birth?.facts.jus_soli).toBe('conditional');
    expect(birth?.facts.unconditional_jus_soli).toBe(false);
    expect(birth?.facts.parent_condition).toBe('lawful_residence');
    expect(birth?.facts.parent_legal_residence_years).toBe(5);
  });

  test('Saint Lucia CIP records Act 22 of 2025 s.30A without inventing a day-count', () => {
    const cip = citizenshipRoutes.routes.find(route => route.id === 'saint-lucia-cip');
    expect(cip?.status).toBe('active');
    expect(cip?.facts.residence_required).toBe(false);
    expect(cip?.summary).toContain('s.30A');
    expect(cip?.summary).toContain('1 January 2026');
    expect(cip?.summary).toContain('not yet been published');
    expect(cip?.sources.map(s => s.title).join(' ')).toMatch(/\(Amendment\) Act 2025/);
    expect(cip?.last_checked).toBe('2026-07-30');
  });

  test('Sweden naturalization records the 6 June 2026 eight-year and self-support rules', () => {
    const sweden = citizenshipRoutes.routes.find(route =>
      route.id === 'sweden-naturalization');
    expect(sweden?.facts.eligibility_months).toEqual([96]);
    expect(sweden?.summary).toContain('eight years');
    expect(sweden?.summary).toContain('6 June 2026');
    expect(sweden?.summary).toContain('SEK 20,000');
    expect(sweden?.summary).toContain('no transitional relief');
    expect(sweden?.last_checked).toBe('2026-07-30');
  });

  test('Jordan investor route records both directions of the 15 July 2026 decision', () => {
    const jordan = citizenshipRoutes.routes.find(route =>
      route.id === 'jordan-investor-citizenship');
    expect(jordan?.status).toBe('active');
    // Shares up, property down — the same Cabinet decision moved the window both
    // ways, and the loosening is the half a reader is least likely to be told.
    const note = jordan?.pathways?.[0]?.note ?? '';
    expect(note).toContain('JOD 150,000');
    expect(note).toContain('five-year hold');
    expect(jordan?.last_checked).toBe('2026-07-30');
  });
});

describe('source quality: constituteproject is a lead, not a source of record', () => {
  // Owner policy (2026-07-30): constituteproject.org may be used to FIND a
  // provision but must not stand as the cited authority in the published data.
  // 357 routes currently violate this. Rather than assert zero and fail the
  // suite, ratchet: the count may only go down. Lower these numbers as
  // jurisdictions are re-sourced; never raise them.
  const CONSTITUTEPROJECT_ONLY_CEILING = 244;
  const CONSTITUTEPROJECT_ANY_CEILING = 261;

  const cites = (route: { sources: Array<{ url: string }> }) =>
    route.sources.some(source => source.url.includes('constituteproject'));
  const onlyCites = (route: { sources: Array<{ url: string }> }) =>
    route.sources.length > 0 && route.sources.every(source => source.url.includes('constituteproject'));

  test('a birth route sourced only to an aggregator cannot claim high confidence', () => {
    // The error signature behind every jus soli correction so far. `confidence`
    // defaults to 'high' in principalCitizenshipRoute, so these badges were never
    // an assertion that anyone verified the route — they are an unset field.
    //
    // That would be tolerable if the values were sound. Measured over the corpus,
    // birth routes citing only constituteproject record `jus_soli: none` 97% of the
    // time (72 of 74), against 41% (64 of 156) for birth routes with any other
    // source. Jurisdictions were not assigned to sources by their birthright
    // regime, so the gap is an ingestion artefact, most likely the aggregator's
    // "no UNCONDITIONAL jus soli" flattened to "none" on import.
    //
    // Four of four tested came back wrong: Jamaica, Trinidad (#119), Bangladesh
    // and Slovakia (2026-08). This asserts the class stays capped, and it is
    // self-healing: citing any non-aggregator source lifts the cap automatically.
    const offenders = citizenshipRoutes.routes.filter(route =>
      route.mode === 'birth'
      && route.sources.length > 0
      && route.sources.every(source => source.url.includes('constituteproject'))
      && route.confidence === 'high');
    expect(offenders.map(route => route.id)).toEqual([]);
  });

  test('no new route may take constituteproject as its only source', () => {
    const offenders = citizenshipRoutes.routes.filter(onlyCites);
    expect(offenders.length).toBeLessThanOrEqual(CONSTITUTEPROJECT_ONLY_CEILING);
  });

  test('overall constituteproject reliance does not grow', () => {
    expect(citizenshipRoutes.routes.filter(cites).length)
      .toBeLessThanOrEqual(CONSTITUTEPROJECT_ANY_CEILING);
  });

  // The two ceilings above are necessary but gameable: `onlyCites` means "EVERY
  // source is constituteproject", so bolting on one junk non-official source
  // lowers the count with zero quality gain. Demonstrated in the 5-year
  // naturalisation cluster — 16 routes share the identical modelled sentence but
  // only 13 are CP-only, so 3 already score "clean" while the year figure was
  // still never read from any statute. These two metrics ratchet UP instead, and
  // cannot be satisfied by adding noise.
  const OFFICIAL_SOURCED_FLOOR = 404;
  const PROVENANCE_DECLARED_FLOOR = 53;

  const OFFICIAL_HOST = /(^|\.)(gov|gob|gouv|govt|go)(\.[a-z]{2,3})?$/;
  const OFFICIAL_EXTRA = [
    'adilet.zan.kz', 'arlis.am', 'e-tar.lt', 'ejustice.just.fgov.be', 'elperuano.pe', 'indiacode.nic.in',
    'kenyalaw.org', 'legis.md', 'legislation.gov.uk', 'legislation.mt',
    'legislatie.just.ro', 'pisrs.si', 'portaljuridicandorra.ad',
    'riigiteataja.ee', 'slov-lex.sk', 'tuvalu-legislation.tv', 'uradni-list.si', 'zakon.rada.gov.ua',
  ];
  const isOfficialHost = (url: string): boolean => {
    const host = (/^https?:\/\/([^/]+)/.exec(url)?.[1] ?? '').toLowerCase();
    return OFFICIAL_HOST.test(host)
      || host.endsWith('.gc.ca') || host.endsWith('.admin.ch') || host.includes('europa.eu')
      || OFFICIAL_EXTRA.some(extra => host === extra || host.endsWith(`.${extra}`));
  };

  test('official-host sourcing only grows', () => {
    const sourced = citizenshipRoutes.routes.filter(route => route.sources.some(s => isOfficialHost(s.url)));
    expect(sourced.length).toBeGreaterThanOrEqual(OFFICIAL_SOURCED_FLOOR);
  });

  test('declared estimated/unverified provenance only grows', () => {
    // Honest downgrades must register as progress. Without this, re-sourcing a
    // jurisdiction that turns out to have NO official copy shows up as zero
    // movement on the descending ceilings and reads as failure.
    const declared = citizenshipRoutes.routes.filter(route =>
      /\bmodel(?:ed|led)\b/i.test(route.pathways?.[0]?.note ?? '') || route.confidence === 'low');
    expect(declared.length).toBeGreaterThanOrEqual(PROVENANCE_DECLARED_FLOOR);
  });

  test('every route classified unconditional jus soli has an official source', () => {
    // The birth-tourism answer is the most consequential thing in the dataset,
    // so this subset gets the strict rule now rather than via the ratchet.
    const unconditional = citizenshipRoutes.routes.filter(route =>
      route.facts?.jus_soli === 'unconditional');
    expect(unconditional.length).toBeGreaterThan(0);
    // Ratcheted to 1: Nicaragua alone remains, because its official
    // publisher (digesto.asamblea.gob.ni) is http-only and the URL invariant
    // requires https. Drive to 0 and assert toEqual([]) once an https official
    // copy of Ley 761 art. 45(1) is found.
    const unsourced = unconditional.filter(onlyCites).map(route => route.id);
    expect(unsourced.length).toBeLessThanOrEqual(1);
  });
});

describe('descent depth is recorded positively, never as a cutoff', () => {
  const ancestry = citizenshipRoutes.routes.filter(route => route.mode === 'ancestry');

  test('the derived field reaches the corpus and stays on ancestry routes', () => {
    // Was 1 of 238 before this landed: degree used to live only in eligibility
    // FIELD NAMES, which data-build drops with the rest of `eligibility`.
    const populated = ancestry.filter(route => route.descent);
    expect(ancestry.length).toBe(238);
    expect(populated.length).toBeGreaterThanOrEqual(230);
    // A `parent.*` condition on a birth route is jus sanguinis at birth, a
    // different question from descent depth, so the field must not appear there.
    for (const route of citizenshipRoutes.routes) {
      if (route.mode !== 'ancestry') expect(route.descent ?? null).toBeNull();
    }
  });

  test('Ireland records the grandparent it actually allows', () => {
    // Two variants: an Irish-born parent, and the foreign birth register for a
    // grandparent. The planner used to collapse both into one flat 18-month path.
    const ireland = ancestry.find(route => route.id === 'ireland-citizenship-by-descent');
    expect(ireland?.descent?.relations).toEqual(['parent', 'grandparent']);
    expect(ireland?.descent?.deepest_recorded_degree).toBe(2);
  });

  test('a missing deeper relation is not a ceiling', () => {
    // The rule this whole field exists to protect. Italy records only a parent
    // condition, yet Italian law transmits without a generational limit subject
    // to the 1948 and 2025 rules. Asserting maximum_degree here would tell
    // someone with an Italian great-grandparent that they do not qualify.
    const italy = ancestry.find(route => route.id === 'italy-citizenship-by-descent');
    expect(italy?.descent?.deepest_recorded_degree).toBe(1);
    expect(italy?.descent?.maximum_degree ?? null).toBeNull();
    expect(italy?.descent?.limit_recorded).toBe(false);

    // Corpus-wide, almost nothing records a ceiling. That is the honest state of
    // the data and the measure of what #155-adjacent sourcing still owes.
    const withLimit = ancestry.filter(route => route.descent?.limit_recorded);
    expect(withLimit.length).toBe(1);
    expect(withLimit[0]!.id).toBe('bulgaria-bulgarian-origin-naturalization');
    expect(withLimit[0]!.descent?.maximum_degree).toBe(3);
  });

  test('ethnic-origin claims carry lineage but no generation', () => {
    // Spätaussiedler, Kandas and the Spanish democratic-memory option are lineage
    // claims with no ancestral degree. They must never acquire a generation.
    //
    // What changed (#191): null used to be the answer, and it was too blunt. A
    // route deriving to null is invisible to every ancestry facet, which is how an
    // ethnic-descent route conferring German nationality automatically ended up
    // unreachable in the UI. Where the origin basis has now been authored, the
    // route records `origin_based: true` with NO degree — the same fact, made
    // visible. Unauthored ones legitimately stay null.
    for (const id of [
      'germany-spaetaussiedler',
      'kazakhstan-citizenship-by-kandas-status',
      'spain-democratic-memory-option',
    ]) {
      const route = ancestry.find(candidate => candidate.id === id);
      expect(route).toBeDefined();
      const descent = route?.descent ?? null;
      if (descent === null) continue;
      // The invariant that actually matters, unchanged: an origin claim is not a
      // generation.
      expect(descent.origin_based, id).toBe(true);
      expect(descent.deepest_recorded_degree, id).toBeNull();
      expect(descent.maximum_degree, id).toBeNull();
    }
  });

  test('great-grandparent depth survives, and is never read as grandparent', () => {
    const portugal = ancestry.find(
      route => route.id === 'portugal-great-grandchild-naturalization',
    );
    expect(portugal?.descent?.relations).toEqual(['great_grandparent']);
    expect(portugal?.descent?.relations).not.toContain('grandparent');
    expect(portugal?.descent?.deepest_recorded_degree).toBe(3);
  });
});

describe('residence eligibility gates', () => {
  const residence = citizenshipRoutes.residence_routes ?? [];

  test('age gates are only ever asserted, never inferred from silence', () => {
    // The semantics that make this field safe for a recommender: null means NOT
    // RECORDED, so eligibility logic must refuse to confirm rather than assume no
    // limit. Coverage is deliberately sparse (see #136) — only 6 of 33
    // retirement routes carry a verified gate — so treating absence as
    // "unrestricted" would recommend pensioner visas to thirty-year-olds.
    for (const route of residence) {
      if (route.min_age == null) continue;
      expect(route.min_age).toBeGreaterThan(0);
      expect(route.min_age).toBeLessThan(100);
      if (route.max_age != null) expect(route.max_age).toBeGreaterThan(route.min_age);
    }
    // Kenya Class K is the worked example: 35+ read from the Immigration
    // Regulations schedule, not from a summary or a comparative table.
    const kenya = residence.find(route => route.id === 'kenya-class-k-ordinary-resident');
    expect(kenya?.min_age).toBe(35);
    // And the guard against regex-harvesting prose: MM2H Silver mentions "50" as
    // a PRESENCE-waiver threshold, not an age floor, so it must stay unset.
    const silver = residence.find(route => route.id === 'malaysia-mm2h-silver');
    expect(silver?.min_age ?? null).toBeNull();
  });
});

describe('per-claim confidence', () => {
  test('Nepal keeps a high badge while showing medium effective confidence', () => {
    // The live case: s. 3(1) descent is high from the 2006 Act, the Fourth
    // Amendment procedure is press-reported. Before claims existed the author had
    // to downgrade the whole route or hedge in prose, and the prose hedge is lost
    // when a country slice is extracted.
    const nepal = citizenshipRoutes.routes.find(r => r.id === 'nepal-citizenship-by-descent');
    expect(nepal?.confidence).toBe('high');
    expect(nepal?.effective_confidence).toBe('medium');
    expect(nepal?.claims?.[0]?.confidence).toBe('medium');
  });

  test('effective confidence is never stronger than the badge', () => {
    // A claim may only lower what a consumer sees. If this ever inverts, a weak
    // detail would be able to promote a route.
    const order = { low: 0, medium: 1, high: 2 } as const;
    for (const route of citizenshipRoutes.routes) {
      const effective = route.effective_confidence ?? route.confidence;
      expect(
        order[effective] <= order[route.confidence],
        `${route.id} reports ${effective} effective against a ${route.confidence} badge`,
      ).toBe(true);
    }
  });

  test('routes without claims are untouched', () => {
    // Nothing may move silently: absent claims must leave the two values equal.
    for (const route of citizenshipRoutes.routes) {
      if (route.claims?.length) continue;
      expect(route.effective_confidence ?? route.confidence).toBe(route.confidence);
    }
  });
});

// Curaçao multi-year residence layer (monitor #194 follow-up, 2026-08-09).
// Atlas priority: renewable / multi-year tracks that ladder toward PR + Dutch
// naturalisation. ≤6-month short-stay remote/snowbird deliberately omitted.
describe('Curaçao multi-year residence layer, August 2026', () => {
  test('wealthy investor is XCG 500k floor with 3y renewable term; higher bands in summary', () => {
    const inv = (citizenshipRoutes.residence_routes ?? []).find(
      r => r.id === 'curacao-wealthy-investor-residence',
    );
    expect(inv).toBeDefined();
    expect(inv?.country.iso_n3).toBe('531');
    expect(inv?.category).toBe('investment');
    expect(inv?.status).toBe('active');
    expect(inv?.confidence).toBe('high');
    expect(inv?.min_investment).toEqual({ amount: 500_000, currency: 'XCG' });
    expect(inv?.permit_duration_months).toBe(36);
    expect(inv?.permit_renewable).toBe(true);
    expect(inv?.outcome).toBe('residence');
    expect(inv?.counts_toward_permanent_residence).toBe(true);
    expect(inv?.counts_toward_naturalization).toBe(true);
    expect(inv?.pathways?.[0]?.eligibility_months).toBe(60);
    expect(inv?.summary).toMatch(/500[, ]?000/);
    expect(inv?.summary).toMatch(/750[, ]?000/);
    expect(inv?.summary).toMatch(/1[, ]?500[, ]?000|1\.5/);
    expect(inv?.summary.toLowerCase()).toMatch(/not citizenship-by-investment|naturalisation|naturalization/);
    expect(inv?.sources.some(s => s.url.includes('immigrationcur.org') && s.url.includes('investeer'))).toBe(true);
    expect(inv?.last_checked).toBe('2026-08-09');
  });

  test('rentier/retired is renewable multi-year with no invented principal income floor', () => {
    const ret = (citizenshipRoutes.residence_routes ?? []).find(
      r => r.id === 'curacao-rentier-retired-residence',
    );
    expect(ret).toBeDefined();
    expect(ret?.category).toBe('retirement_pension');
    expect(ret?.status).toBe('active');
    expect(ret?.confidence).toBe('high');
    expect(ret?.permit_renewable).toBe(true);
    expect(ret?.counts_toward_permanent_residence).toBe(true);
    expect(ret?.counts_toward_naturalization).toBe(true);
    expect(ret?.pathways?.[0]?.eligibility_months).toBe(60);
    // TO only publishes family co-admission floors, not a principal passive-income product threshold.
    expect(ret?.min_income_monthly).toBeNull();
    expect(ret?.min_investment).toBeNull();
    expect(ret?.sources.some(s => s.url.includes('immigrationcur.org') && s.url.includes('rentenier'))).toBe(true);
  });

  test('short-stay and no-cbi absences are not stored as product rows', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    expect(byId.has('curacao-no-cbi')).toBe(false);
    expect(byId.has('curacao-remote-worker-short-stay')).toBe(false);
    expect(byId.has('curacao-snowbird-short-stay')).toBe(false);
    const cit = citizenshipRoutes.routes.filter(r => r.country?.iso_n3 === '531');
    expect(cit.length).toBeGreaterThanOrEqual(1);
  });

  test('corpus has no active verified_negative residence product rows', () => {
    const negs = (citizenshipRoutes.residence_routes ?? []).filter(
      r => r.status === 'verified_negative',
    );
    expect(negs.map(r => r.id)).toEqual([]);
  });
});

// Aruba + BES multi-year layers (same filter: renew beyond 1 year → PR / Dutch nat).
describe('Aruba and Caribbean Netherlands multi-year residence, August 2026', () => {
  test('Aruba retiree/interest-rate earner is 1y renewable with Afl 50k floor', () => {
    const r = (citizenshipRoutes.residence_routes ?? []).find(
      x => x.id === 'aruba-retiree-interest-rate-earner',
    );
    expect(r).toBeDefined();
    expect(r?.country.iso_n3).toBe('533');
    expect(r?.category).toBe('retirement_pension');
    expect(r?.confidence).toBe('high');
    expect(r?.permit_duration_months).toBe(12);
    expect(r?.permit_renewable).toBe(true);
    expect(r?.work_rights).toBe('none');
    expect(r?.min_income_monthly).toEqual({ amount: 4166.67, currency: 'AWG' });
    expect(r?.counts_toward_permanent_residence).toBe(true);
    expect(r?.counts_toward_naturalization).toBe(true);
    expect(r?.summary).toMatch(/50[, ]?000/);
    expect(r?.summary).toMatch(/100[, ]?000/);
    expect(r?.sources.some(s => s.url.includes('dimasaruba.aw') && s.url.includes('retiree'))).toBe(true);
  });

  test('Aruba indefinite residence is 120 months temporary ladder', () => {
    const r = (citizenshipRoutes.residence_routes ?? []).find(
      x => x.id === 'aruba-indefinite-residence',
    );
    expect(r?.outcome).toBe('permanent_residence');
    expect(r?.pathways?.[0]?.eligibility_months).toBe(120);
    expect(r?.confidence).toBe('high');
    expect(r?.sources.some(s => s.url.includes('indefinite'))).toBe(true);
  });

  test('Aruba director/shareholder has Afl 125k equity floor', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    const inv = byId.get('aruba-director-shareholder-residence');
    expect(inv?.min_investment).toEqual({ amount: 125_000, currency: 'AWG' });
    expect(inv?.confidence).toBe('medium');
    expect(byId.has('aruba-no-cbi')).toBe(false);
  });

  test('BES retired/independent means is renewable 1y with 120% MW means test; indefinite at 5y', () => {
    const byId = new Map((citizenshipRoutes.residence_routes ?? []).map(r => [r.id, r]));
    const ret = byId.get('caribbean-netherlands-retired-independent-means');
    expect(ret?.country.iso_n3).toBe('535');
    expect(ret?.category).toBe('retirement_pension');
    expect(ret?.confidence).toBe('high');
    expect(ret?.permit_duration_months).toBe(12);
    expect(ret?.permit_renewable).toBe(true);
    expect(ret?.min_income_monthly?.currency).toBe('USD');
    expect(ret?.summary).toMatch(/120\s*%/);
    expect(ret?.counts_toward_naturalization).toBe(true);
    // Winter visitor (max 6 months) not modelled.
    expect(byId.has('caribbean-netherlands-winter-visitor')).toBe(false);
    expect(byId.has('caribbean-netherlands-no-cbi')).toBe(false);

    const pr = byId.get('caribbean-netherlands-indefinite-residence');
    expect(pr?.outcome).toBe('permanent_residence');
    expect(pr?.pathways?.[0]?.eligibility_months).toBe(60);
  });
});

describe('the atlas publishes no negatives', () => {
  /**
   * Silence is how this atlas says a thing does not exist.
   *
   * A route earns a row by being a programme: one that is open, or one that really
   * ran and ended. A row asserting that some country has no golden visa is not a
   * programme, it is an absence dressed as data, and it invites a reader to treat
   * every country WITHOUT such a row as unchecked rather than as unremarkable.
   *
   * `inactive` is the line's other side and stays: the UK Tier 1 investor visa was
   * real, applicants held it, and its closure is a fact about a programme. That is
   * why this asserts on `verified_negative` alone and nothing broader.
   *
   * An invariant rather than a convention because the corpus is authored by several
   * people and agents at once, and the cheapest way to record "I checked and found
   * nothing" has always been to store the nothing.
   */
  test('stores no verified_negative rows in either family', () => {
    for (const family of ['routes', 'residence_routes'] as const) {
      const negatives = (citizenshipRoutes[family] ?? [])
        .filter((route: { status?: string }) => route.status === 'verified_negative')
        .map((route: { id: string }) => route.id);
      expect(negatives, `${family} must record programmes, not their absence`).toEqual([]);
    }
  });
});

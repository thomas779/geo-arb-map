import { describe, test, expect } from 'bun:test';
import type { BlocsData } from '../src/types';
import {
  acquisitionYears,
  EMPTY_PROFILE,
  goalKey,
  householdExtraCountries,
  normalizeProfile,
  profileHasInput,
  recommend,
  type Profile,
} from '../src/lib/planner';
import { shortestPaths, recommendPaths, type GraphEdge } from '../src/lib/pathfinder';
import { paramsForState, readProfile } from '../src/url';
import { clearStoredProfile, LEGACY_FLAGS_KEY, PROFILE_KEY } from '../src/lib/profile-storage';
import { dataCorrectionUrl, sourceUrl } from '../src/lib/trust';
// @ts-expect-error — plain-JS bun script, imported for its exported builder
import { buildEdges } from '../scripts/build_edges.js';

/**
 * The locked acceptance tests from docs/explorer-spec.md — required before
 * the explorer ships. They run against the REAL dataset + generated graph.
 */

const data = (await Bun.file(
  new URL('../public/blocs_data.json', import.meta.url),
).json()) as BlocsData;
const manual = await Bun.file(new URL('../data/manual_edges.json', import.meta.url)).json();
const generatedEdges = buildEdges(data, manual);
const edges: GraphEdge[] = generatedEdges.edges;

const profileOf = (over: Partial<Profile>): Profile => ({ ...EMPTY_PROFILE, ...over });
const citizen = (iso: string, name = iso) =>
  profileOf({ flags: [{ iso_n3: iso, name, status: 'cit' }] });

describe('explorer-spec acceptance tests', () => {
  test('(a) US citizen, no conditional facts: TN never chains into settlement', () => {
    // Work nodes must be terminal by construction…
    const workSources = new Set(edges.map(e => e.from).filter(f => f.startsWith('work:')));
    expect(workSources.size).toBe(0);
    // …and TN itself only ever lands on a work node
    for (const e of edges.filter(e => e.mechanism === 'tn_usmca')) {
      expect(e.to.startsWith('work:')).toBe(true);
    }
    // A Canadian citizen (TN beneficiary) reaches work:840 but no US settlement via TN
    const paths = shortestPaths(citizen('124', 'Canada'), edges);
    const toUsSettle = [...paths.entries()].filter(([node]) =>
      node === 'settle_full:840' || node === 'settle_partial:840' || node === 'cit:840');
    for (const [, info] of toUsSettle) {
      expect(info.steps.some(s => s.mechanism === 'tn_usmca')).toBe(false);
    }
  });

  test('(b) heritage gating: Law of Return appears only when the fact is checked', () => {
    const without = shortestPaths(citizen('840', 'United States'), edges);
    expect(without.has('cit:376')).toBe(false);

    const withHeritage = shortestPaths(
      profileOf({
        flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
        heritages: ['israel_law_of_return'],
      }),
      edges,
    );
    expect(withHeritage.has('cit:376')).toBe(true);
    // …and other identity lanes stay hidden
    expect(withHeritage.has('cit:616')).toBe(false); // Karta Polaka needs Polish descent
  });

  test('(c) Samoan citizen: the ballot quota never enters deterministic paths', () => {
    const paths = shortestPaths(citizen('882', 'Samoa'), edges);
    for (const [, info] of paths) {
      expect(info.steps.some(s => s.mechanism === 'nz_samoan_quota')).toBe(false);
    }
    // …but the edge exists in the graph, labeled as a ballot (for the chance panel)
    const ballot = edges.find(e => e.mechanism === 'nz_samoan_quota');
    expect(ballot?.allocation).toBe('ballot');
  });

  test('(d) renunciation destinations carry the flag onto the path', () => {
    // Kazakhstan bans dual; any path ending in cit:398 must be flagged
    const p = profileOf({
      flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
      heritages: ['kazakhstan_qandas'],
    });
    const paths = shortestPaths(p, edges);
    const kz = paths.get('cit:398');
    expect(kz).toBeDefined();
    expect(kz!.renounces).toBe(true);
    // …and recommendPaths nets the footprint rather than summing
    const recs = recommendPaths(p, data, edges, 20);
    const kzRec = recs.find(r => r.iso_n3 === '398');
    if (kzRec) expect(kzRec.renouncesPrevious).toBe(true);
  });

  test('(e) Greater China generates no edges at all', () => {
    expect(edges.some(e => e.mechanism === 'greater_china')).toBe(false);
  });

  test('multi-hop: Uruguayan reaches Spanish citizenship via Mercosur→Argentina? No — direct 2-yr lane wins', () => {
    // Uruguay is an Ibero-American beneficiary: expect a 2-hop plan
    // (Spain lane settle → naturalize) rather than anything longer.
    const paths = shortestPaths(citizen('858', 'Uruguay'), edges);
    const spain = paths.get('cit:724');
    expect(spain).toBeDefined();
    expect(spain!.years).toBeLessThanOrEqual(2);
    expect(spain!.steps.map(s => s.mechanism)).toContain('spain_iberoamerican');
  });

  test('multi-hop: US citizen chains DAFT → Dutch naturalization → (EU footprint)', () => {
    const paths = shortestPaths(citizen('840', 'United States'), edges);
    const nl = paths.get('cit:528');
    expect(nl).toBeDefined();
    expect(nl!.steps.some(s => s.mechanism === 'daft')).toBe(true);
    const recs = recommendPaths(citizen('840', 'United States'), data, edges, 10);
    const nlRec = recs.find(r => r.iso_n3 === '528');
    expect(nlRec && nlRec.marginal).toBeGreaterThan(25); // EU-wide gain
  });

  test('nationality-conditioned timelines do not leak onto unrelated paths', () => {
    const us = citizen('840', 'United States');
    const spain = shortestPaths(us, edges).get('cit:724');
    expect(spain).toBeDefined();
    // 14 years, and the route matters more than the number: DAFT into the
    // Netherlands (0) -> Dutch citizenship (5) -> Portugal via EU free movement
    // (0) -> Portuguese citizenship (7, the CPLP/EU tier under Lei Orgânica
    // 1/2026) -> Spain via EU (0) -> Spanish citizenship (2). That last step is
    // Spain's Código Civil art. 22.1 two-year track, which lists Portugal
    // explicitly, so it is earned rather than leaked: the traveller genuinely
    // holds a qualifying nationality by then.
    expect(spain!.years).toBe(14);
    // The guard this test exists for: a US passport cannot take the short track
    // directly. Reaching Spain quickly requires acquiring a qualifying
    // citizenship first, so the path is multi-hop and never 2 years outright.
    expect(spain!.years).toBeGreaterThan(2);
    expect(spain!.hops).toBeGreaterThan(1);
    expect(spain!.acquiredCitizenships).toContain('620');

    const uruguay = shortestPaths(citizen('858', 'Uruguay'), edges).get('cit:724');
    expect(uruguay?.years).toBe(2); // Ibero-American fast track, held from the start
    expect(uruguay?.hops).toBe(2);

    expect(recommend(us, data, 200).find(r => r.iso_n3 === '724')?.years).toBe(10);
    expect(recommend(citizen('858'), data, 200).find(r => r.iso_n3 === '724')?.years).toBe(2);
  });

  test('event accelerators do not become general naturalization timelines', () => {
    const emptyWithGoal = profileOf({ goals: [{ iso_n3: '724', intent: 'cit' }] });
    expect(recommend(emptyWithGoal, data, 200).find(r => r.iso_n3 === '076')?.years).toBe(4);
    expect(recommend(emptyWithGoal, data, 200).find(r => r.iso_n3 === '212')).toMatchObject({
      years: 0.5,
      via: 'cbi',
    });
    for (const edge of edges.filter(e =>
      e.mechanism === 'naturalization' && e.to === 'cit:076')) {
      expect(edge.years).toBe(4);
    }
    expect(edges.some(e => e.mechanism === 'naturalization' && e.to === 'cit:212')).toBe(false);
    expect(edges.find(e => e.mechanism === 'cbi' && e.to === 'cit:212')?.years).toBe(0.5);

    const durations = acquisitionYears(data);
    expect(durations.has('196')).toBe(false); // conditional Cyprus employment route
    expect(durations.get('604')).toBe(5); // conservative pending Peru timeline
  });

  test('planner timelines never parse arrangement or playbook prose', () => {
    const altered = structuredClone(data);
    altered.blocs.forEach(bloc => {
      bloc.fastest_entry = 'Editorial example changed to 99 years.';
    });
    altered.stacking_plays.forEach(play => {
      play.timeline = '123 years';
    });
    expect(acquisitionYears(altered)).toEqual(acquisitionYears(data));
  });

  test('multi-hop recommendations retain citizenships acquired along the path', () => {
    const angola = citizen('024', 'Angola');
    const spain = shortestPaths(angola, edges).get('cit:724');
    expect(spain?.citizenships).toEqual(['024', '076', '724']);
    expect(spain?.years).toBe(6);

    const rec = recommendPaths(angola, data, edges, 50).find(r => r.iso_n3 === '724');
    expect(rec?.marginal).toBe(41);
    expect(rec?.newBlocs).toContain('Mercosur Residence Agreement');
  });

  test('the six-hop budget reaches the multi-step chains the planner exists for', () => {
    // At the old budget of four a US passport could not reach Brazil or
    // Argentina AT ALL: golden visa -> PR -> naturalisation -> Mercosur
    // settlement is six edges, so the flagship use case was silently truncated.
    const us = citizen('840', 'United States');
    const reachable = shortestPaths(us, edges);
    const brazil = reachable.get('cit:076');
    expect(brazil).toBeDefined();
    expect(brazil!.hops).toBeGreaterThan(4);
    // Reachability floor: regressing the budget or the edge set should fail here
    // rather than quietly shrinking what the planner can find.
    expect(reachable.size).toBeGreaterThanOrEqual(90);
  });

  test('worst-case profile search stays inside a wall-clock ceiling', () => {
    // The Pareto state space grows super-exponentially with the hop budget: at
    // seven hops the worst profiles take seconds, which is why MAX_HOPS is a
    // measured cliff edge and not a dial. EU passports have the largest
    // frontier, so they are the worst case worth pinning.
    const worst = ['cit:233', 'cit:428', 'cit:756', 'cit:276'];
    for (const seed of worst) {
      const started = performance.now();
      shortestPaths(citizen(seed.slice(4)), edges);
      // Generous versus the ~209ms measured locally, so CI variance cannot make
      // this flaky, while still catching an order-of-magnitude regression.
      expect(performance.now() - started).toBeLessThan(2000);
    }
  });

  test('hop-bounded search prefers the cheaper path when the budget allows, and falls back when it does not', () => {
    const edge = (from: string, to: string, years: number): GraphEdge => ({
      from, to, years, mechanism: `${from}>${to}`,
      allocation: 'right', confidence: 'high', needs: [],
    });
    // Two ways to reach x: a free 3-hop detour, or a 1-year direct edge. Then
    // two more hops to the goal. Within the budget the free detour wins on years.
    const withinBudget = [
      edge('cit:001', 'a', 0),
      edge('a', 'b', 0),
      edge('b', 'x', 0),
      edge('cit:001', 'x', 1),
      edge('x', 'y', 0),
      edge('y', 'cit:999', 0),
    ];
    expect(shortestPaths(citizen('001'), withinBudget).get('cit:999')?.years).toBe(0);

    // Push the free detour past MAX_HOPS and the paid shortcut must win instead,
    // which is what keeps the budget honest rather than merely generous.
    const overBudget = [
      edge('cit:001', 'a', 0),
      edge('a', 'b', 0),
      edge('b', 'c', 0),
      edge('c', 'd', 0),
      edge('d', 'x', 0),
      edge('cit:001', 'x', 1),
      edge('x', 'y', 0),
      edge('y', 'cit:999', 0),
    ];
    expect(shortestPaths(citizen('001'), overBudget).get('cit:999')?.years).toBe(1);
  });
});

describe('goal solving', () => {
  test('non-US citizen wanting to WORK in the US gets a lane answer, not a shrug', async () => {
    const { solveGoals } = await import('../src/lib/pathfinder');
    const p = profileOf({
      flags: [{ iso_n3: '124', name: 'Canada', status: 'cit' }],
      goals: [{ iso_n3: '840', intent: 'work' }],
    });
    const [answer] = solveGoals(p, data, edges);
    expect(answer.best).not.toBeNull();
    expect(answer.reached).toBe('work:840');
    expect(answer.best!.steps.some(s => s.mechanism === 'tn_usmca' || s.mechanism === 'e2')).toBe(true);
  });

  test('a LIVE goal never accepts a work-only terminal', async () => {
    const { solveGoals } = await import('../src/lib/pathfinder');
    const p = profileOf({
      flags: [{ iso_n3: '124', name: 'Canada', status: 'cit' }],
      goals: [{ iso_n3: '840', intent: 'live' }],
    });
    const [answer] = solveGoals(p, data, edges);
    expect(answer.reached === null || !answer.reached.startsWith('work:')).toBe(true);
  });

  test('an existing PR satisfies a LIVE goal immediately', async () => {
    const { solveGoals } = await import('../src/lib/pathfinder');
    const p = profileOf({
      flags: [{ iso_n3: '840', name: 'United States', status: 'pr' }],
      goals: [{ iso_n3: '840', intent: 'live' }],
    });
    const [answer] = solveGoals(p, data, edges);
    expect(answer.best?.years).toBe(0);
    expect(answer.reached).toBe('pr:840');
  });

  test('renunciation answers enumerate the citizenship lost', async () => {
    const { solveGoals } = await import('../src/lib/pathfinder');
    const p = profileOf({
      flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
      heritages: ['kazakhstan_qandas'],
      goals: [{ iso_n3: '398', intent: 'cit' }],
    });
    const [answer] = solveGoals(p, data, edges);
    expect(answer.best?.renounces).toBe(true);
    expect(answer.best?.lostCitizenships).toEqual(['840']);
  });
});

describe('profile and URL regressions', () => {
  test('legacy stored profiles migrate to private schema-v2 defaults', () => {
    expect(normalizeProfile({
      flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
      goals: [{ iso_n3: '724', intent: 'live' }],
    })).toMatchObject({
      version: 2,
      watchedRoutes: [],
      alerts: { channel: 'none', verifiedOnly: true },
    });
  });

  test('watched routes are stable, deduplicated, and limited to existing goals', () => {
    const goal = { iso_n3: '724', intent: 'live' as const };
    expect(goalKey(goal)).toBe('live:724');
    const migrated = normalizeProfile({
      goals: [goal],
      watchedRoutes: ['live:724', 'live:724', 'work:840'],
      alerts: { channel: 'telegram', verifiedOnly: false },
    });
    expect(migrated.watchedRoutes).toEqual(['live:724']);
    expect(migrated.alerts).toEqual({ channel: 'telegram', verifiedOnly: true });
  });

  test('a goal by itself counts as planner input', () => {
    expect(profileHasInput(profileOf({
      goals: [{ iso_n3: '724', intent: 'live' }],
    }))).toBe(true);
  });

  test('a shared partner citizenship adds no duplicate household country', () => {
    const p = profileOf({
      flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
      partnerCitizenships: ['840'],
    });
    expect(householdExtraCountries(p, data)).toBe(0);
  });

  test('partner-only and goals-only profile URLs are recognized', () => {
    expect(readProfile(new URLSearchParams('partner=840'))?.partnerCitizenships).toEqual(['840']);
    expect(readProfile(new URLSearchParams('goals=724l'))?.goals).toEqual([
      { iso_n3: '724', intent: 'live' },
    ]);
  });

  test('map URL synchronization strips private profile parameters but preserves public tooling state', () => {
    const params = paramsForState(
      new URLSearchParams('flags=840c&born=344&partner=724&theme=light&info=privacy&bloc=legacy'),
      {
        // Map sub-state (blocs/lane/country) lives in the query only on the atlas route.
        view: 'map',
        blocs: ['eu_eea'],
        lane: null,
        routeClass: null,
        country: null,
        countryName: null,
      },
    );
    expect(params.get('flags')).toBeNull();
    expect(params.get('born')).toBeNull();
    expect(params.get('partner')).toBeNull();
    expect(params.get('theme')).toBe('light');
    expect(params.get('info')).toBe('privacy');
    expect(params.get('bloc')).toBeNull();
    expect(params.get('blocs')).toBe('eu_eea');
  });

  test('clearing a profile removes both current and legacy browser records', () => {
    const removed: string[] = [];
    clearStoredProfile({ removeItem: key => removed.push(key) });
    expect(removed).toEqual([PROFILE_KEY, LEGACY_FLAGS_KEY]);
  });

  test('correction links contain public route context but no profile facts', () => {
    const correction = new URL(dataCorrectionUrl('Spain route', 'goal:live:724'));
    expect(correction.hostname).toBe('github.com');
    expect(correction.searchParams.get('template')).toBe('data-correction.yml');
    // Route context prefills the form's `context` field (not dumped in the title).
    expect(correction.searchParams.get('context')).toContain('goal:live:724');
    expect(correction.toString()).not.toContain('partner=');
    expect(correction.toString()).not.toContain('flags=');
  });

  test('source labels become links only when they contain a domain', () => {
    expect(sourceUrl('US State Dept: travel.state.gov/content/travel/en/us-visas')).toBe(
      'https://travel.state.gov/content/travel/en/us-visas',
    );
    expect(sourceUrl('Brazil Ministry of Justice naturalization materials')).toBeNull();
  });
});

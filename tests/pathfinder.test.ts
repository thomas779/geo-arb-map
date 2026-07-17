import { describe, test, expect } from 'bun:test';
import type { BlocsData } from '../src/types';
import { EMPTY_PROFILE, type Profile } from '../src/lib/planner';
import { shortestPaths, recommendPaths, type GraphEdge } from '../src/lib/pathfinder';
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
const edges: GraphEdge[] = buildEdges(data, manual).edges;

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
});

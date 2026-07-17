import type { BlocsData } from '../types';
import { computeUnlocks, type Profile } from './planner';

/**
 * Multi-hop pathfinder over the status graph (public/edges.json), per
 * docs/explorer-spec.md:
 *  - legal logic decides which edges EXIST for this profile (needs gating,
 *    allocation === 'right' only — ballot/quota/discretionary never enter
 *    deterministic plans); graph logic only ranks among eligible edges
 *  - Dijkstra by years from all held statuses, max hop budget
 *  - work:* nodes are terminal by construction (no outgoing edges)
 *  - renunciation flags propagate onto the resulting path
 */

export interface GraphEdge {
  from: string;
  to: string;
  mechanism: string;
  years: number;
  allocation: 'right' | 'ballot' | 'quota_queue' | 'discretionary';
  confidence: string;
  needs: string[];
  renounces_previous?: boolean;
}

export interface EdgesFile {
  meta: unknown;
  edges: GraphEdge[];
}

export interface PathStep {
  mechanism: string;
  to: string;
  years: number;
}

export interface PathRec {
  iso_n3: string;
  name: string;
  years: number;
  hops: number;
  steps: PathStep[];
  marginal: number;
  newBlocs: string[];
  score: number;
  renouncesPrevious: boolean;
  via: 'path';
}

const MAX_HOPS = 4; // edge budget (bloc expansions are single 0-yr edges)

function needsSatisfied(needs: string[], profile: Profile): boolean {
  return needs.every(n => {
    if (n.startsWith('ancestor:')) return profile.ancestors.includes(n.slice(9));
    if (n.startsWith('heritage:')) return profile.heritages.includes(n.slice(9));
    // Not modeled as a user-checkable fact yet (child events render editorially)
    if (n === 'willing_child_abroad') return false;
    return false;
  });
}

/**
 * Cheapest (by years, then hops) path from the profile's held statuses to
 * every reachable cit:* node. Returns a map target-node → path info.
 */
export function shortestPaths(
  profile: Profile,
  edges: GraphEdge[],
): Map<string, { years: number; hops: number; steps: PathStep[]; renounces: boolean }> {
  const usable = edges.filter(e =>
    (e.allocation ?? 'right') === 'right' && needsSatisfied(e.needs ?? [], profile));

  const byFrom = new Map<string, GraphEdge[]>();
  for (const e of usable) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from)!.push(e);
  }

  interface State { years: number; hops: number; steps: PathStep[]; renounces: boolean }
  const best = new Map<string, State>();
  const queue: Array<{ node: string } & State> = [];

  const seed = (node: string) => queue.push({ node, years: 0, hops: 0, steps: [], renounces: false });
  for (const f of profile.flags) {
    if (f.status === 'cit') seed(`cit:${f.iso_n3}`);
    if (f.status === 'pr') seed(`pr:${f.iso_n3}`);
  }
  // Wildcard-from edges (identity lanes) are available directly when gated-in
  for (const e of byFrom.get('*') ?? []) {
    queue.push({
      node: e.to, years: e.years, hops: 1,
      steps: [{ mechanism: e.mechanism, to: e.to, years: e.years }],
      renounces: !!e.renounces_previous,
    });
  }

  while (queue.length) {
    // Dijkstra: lowest years first, then fewest hops
    queue.sort((a, b) => a.years - b.years || a.hops - b.hops);
    const cur = queue.shift()!;
    const seen = best.get(cur.node);
    if (seen && (seen.years < cur.years || (seen.years === cur.years && seen.hops <= cur.hops))) continue;
    best.set(cur.node, { years: cur.years, hops: cur.hops, steps: cur.steps, renounces: cur.renounces });

    if (cur.hops >= MAX_HOPS) continue;
    for (const e of byFrom.get(cur.node) ?? []) {
      queue.push({
        node: e.to,
        years: cur.years + e.years,
        hops: cur.hops + 1,
        steps: [...cur.steps, { mechanism: e.mechanism, to: e.to, years: e.years }],
        renounces: cur.renounces || !!e.renounces_previous,
      });
    }
  }
  return best;
}

/** Multi-hop replacement for the single-hop recommend(): ranked path plans. */
export function recommendPaths(
  profile: Profile,
  data: BlocsData,
  edges: GraphEdge[],
  limit = 5,
): PathRec[] {
  const held = new Set(profile.flags.filter(f => f.status === 'cit').map(f => f.iso_n3));
  const current = computeUnlocks(profile, data);
  const currentSize = current.countries.size;
  const currentBlocIds = new Set(current.blocs.map(b => b.id));

  const nameOf = (iso: string): string => {
    for (const b of data.blocs) {
      const m = b.members.find(x => x.iso_n3 === iso);
      if (m) return m.name;
    }
    for (const l of data.bilateral_lanes) {
      if (l.destination.iso_n3 === iso) return l.destination.name;
      const m = l.beneficiaries.find(x => x.iso_n3 === iso);
      if (m) return m.name;
    }
    return iso;
  };

  const paths = shortestPaths(profile, edges);
  const recs: PathRec[] = [];

  for (const [node, info] of paths) {
    if (!node.startsWith('cit:')) continue;
    const iso = node.slice(4);
    if (held.has(iso)) continue;
    if (info.steps.length === 0) continue;

    const nextProfile: Profile = info.renounces
      ? { ...profile, flags: [{ iso_n3: iso, name: iso, status: 'cit' }] }
      : { ...profile, flags: [...profile.flags, { iso_n3: iso, name: iso, status: 'cit' }] };
    const next = computeUnlocks(nextProfile, data);
    const nextCountries = new Set(next.countries);
    nextCountries.add(iso);
    for (const h of held) nextCountries.delete(h);
    const marginal = nextCountries.size - currentSize;
    if (marginal <= 0) continue;

    recs.push({
      iso_n3: iso,
      name: nameOf(iso),
      years: info.years,
      hops: info.hops,
      steps: info.steps,
      marginal,
      newBlocs: next.blocs.filter(b => !currentBlocIds.has(b.id)).map(b => b.name),
      score: marginal / Math.max(info.years, 0.75),
      renouncesPrevious: info.renounces,
      via: 'path',
    });
  }

  recs.sort((a, b) => b.score - a.score || b.marginal - a.marginal || a.years - b.years);
  return recs.slice(0, limit);
}

/** Human-readable one-line plan: "Mercosur residency → naturalize (~2 yrs)" */
export function describePath(steps: PathStep[], data: BlocsData): string {
  const mechName = (id: string): string => {
    if (id === 'naturalization') return 'naturalize';
    return data.blocs.find(b => b.id === id)?.name
      ?? data.bilateral_lanes.find(l => l.id === id)?.name
      ?? id;
  };
  return steps
    .map(s => `${mechName(s.mechanism)}${s.years ? ` (~${s.years} yr${s.years !== 1 ? 's' : ''})` : ''}`)
    .join(' → ');
}

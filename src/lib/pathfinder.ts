import type { BlocsData } from '../types';
import { computeUnlocks, type Goal, type Profile } from './planner';

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
  renouncesPrevious?: boolean;
}

export interface PathInfo {
  years: number;
  hops: number;
  steps: PathStep[];
  renounces: boolean;
  /** Citizenships held at the end of this path. */
  citizenships: string[];
  /** Citizenships acquired during the path, including any later lost. */
  acquiredCitizenships: string[];
  /** Citizenships surrendered and not subsequently reacquired. */
  lostCitizenships: string[];
}

export interface PathRec {
  iso_n3: string;
  name: string;
  years: number;
  hops: number;
  steps: PathStep[];
  marginal: number;
  newBlocs: string[];
  lostBlocs: string[];
  lostCitizenships: string[];
  score: number;
  renouncesPrevious: boolean;
  via: 'path';
}

const MAX_HOPS = 4; // edge budget (bloc expansions are single 0-yr edges)

function needsSatisfied(
  needs: string[],
  profile: Profile,
  citizenships: ReadonlySet<string>,
): boolean {
  return needs.every(n => {
    if (n.startsWith('ancestor:')) return profile.ancestors.includes(n.slice(9));
    if (n.startsWith('heritage:')) return profile.heritages.includes(n.slice(9));
    if (n.startsWith('citizenship_any:')) {
      return n.slice(16).split(',').some(iso => citizenships.has(iso));
    }
    // Not modeled as a user-checkable fact yet (child events render editorially)
    if (n === 'willing_child_abroad') return false;
    return false;
  });
}

interface State extends PathInfo {
  node: string;
}

function compareStates(a: State, b: State): number {
  return a.years - b.years
    || a.hops - b.hops
    || a.lostCitizenships.length - b.lostCitizenships.length
    || b.citizenships.length - a.citizenships.length;
}

function dominates(a: State, b: State): boolean {
  return a.years <= b.years
    && a.hops <= b.hops
    && a.lostCitizenships.length <= b.lostCitizenships.length;
}

function transition(cur: State, edge: GraphEdge): State {
  const citizenships = new Set(cur.citizenships);
  const acquired = new Set(cur.acquiredCitizenships);
  const lost = new Set(cur.lostCitizenships);

  if (edge.to.startsWith('cit:')) {
    const iso = edge.to.slice(4);
    if (!citizenships.has(iso)) acquired.add(iso);
    if (edge.renounces_previous) {
      for (const held of citizenships) {
        if (held !== iso) lost.add(held);
      }
      citizenships.clear();
    }
    citizenships.add(iso);
    lost.delete(iso);
  }

  return {
    node: edge.to,
    years: cur.years + edge.years,
    hops: cur.hops + 1,
    steps: [...cur.steps, {
      mechanism: edge.mechanism,
      to: edge.to,
      years: edge.years,
      renouncesPrevious: edge.renounces_previous,
    }],
    renounces: cur.renounces || !!edge.renounces_previous,
    citizenships: [...citizenships].sort(),
    acquiredCitizenships: [...acquired].sort(),
    lostCitizenships: [...lost].sort(),
  };
}

function withoutNode(state: State): PathInfo {
  const { node: _node, ...info } = state;
  return info;
}

/**
 * Cheapest (by years, then hops) path from the profile's held statuses to
 * every reachable cit:* node. Returns a map target-node → path info.
 */
export function shortestPaths(
  profile: Profile,
  edges: GraphEdge[],
): Map<string, PathInfo> {
  const usable = edges.filter(e => (e.allocation ?? 'right') === 'right');
  const byFrom = new Map<string, GraphEdge[]>();
  for (const e of usable) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from)!.push(e);
  }

  const initialCitizenships = profile.flags
    .filter(f => f.status === 'cit')
    .map(f => f.iso_n3)
    .sort();
  const base: State = {
    node: '',
    years: 0,
    hops: 0,
    steps: [],
    renounces: false,
    citizenships: initialCitizenships,
    acquiredCitizenships: [],
    lostCitizenships: [],
  };
  const bestByState = new Map<string, State[]>();
  const best = new Map<string, State>();
  const queue: State[] = [];

  const seed = (node: string) => queue.push({ ...base, node });
  for (const f of profile.flags) {
    if (f.status === 'cit') seed(`cit:${f.iso_n3}`);
    if (f.status === 'pr') seed(`pr:${f.iso_n3}`);
  }
  // Wildcard-from edges (identity lanes) are available directly when gated-in
  for (const e of byFrom.get('*') ?? []) {
    if (needsSatisfied(e.needs ?? [], profile, new Set(base.citizenships))) {
      queue.push(transition(base, e));
    }
  }

  while (queue.length) {
    // Dijkstra: lowest years first, then fewest hops
    queue.sort(compareStates);
    const cur = queue.shift()!;
    const stateKey = `${cur.node}|${cur.citizenships.join(',')}`;
    const seenStates = bestByState.get(stateKey) ?? [];
    if (seenStates.some(seen => dominates(seen, cur))) continue;
    bestByState.set(
      stateKey,
      [...seenStates.filter(seen => !dominates(cur, seen)), cur],
    );

    const seenNode = best.get(cur.node);
    if (!seenNode || compareStates(cur, seenNode) < 0) best.set(cur.node, cur);

    if (cur.hops >= MAX_HOPS) continue;
    for (const e of byFrom.get(cur.node) ?? []) {
      if (needsSatisfied(e.needs ?? [], profile, new Set(cur.citizenships))) {
        queue.push(transition(cur, e));
      }
    }
  }
  return new Map([...best].map(([node, state]) => [node, withoutNode(state)]));
}

function profileAfterPath(profile: Profile, info: PathInfo): Profile {
  const nonCitizenships = profile.flags.filter(f => f.status !== 'cit');
  return {
    ...profile,
    flags: [
      ...nonCitizenships,
      ...info.citizenships.map(iso => ({ iso_n3: iso, name: iso, status: 'cit' as const })),
    ],
  };
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

    const nextProfile = profileAfterPath(profile, info);
    const next = computeUnlocks(nextProfile, data);
    const nextCountries = new Set(next.countries);
    for (const acquired of info.citizenships) {
      if (!held.has(acquired)) nextCountries.add(acquired);
    }
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
      lostBlocs: current.blocs.filter(b => !next.blocs.some(n => n.id === b.id)).map(b => b.name),
      lostCitizenships: info.lostCitizenships.map(nameOf),
      score: marginal / Math.max(info.years, 0.75),
      renouncesPrevious: info.renounces,
      via: 'path',
    });
  }

  recs.sort((a, b) => b.score - a.score || b.marginal - a.marginal || a.years - b.years);
  return recs.slice(0, limit);
}

export interface GoalAnswer {
  goal: Goal;
  /** best deterministic path (null = no path with current facts) */
  best: {
    years: number;
    steps: PathStep[];
    renounces: boolean;
    lostCitizenships: string[];
    lostBlocs: string[];
  } | null;
  /** the terminal node the best path reaches (work:.. vs settle.. vs cit:..) */
  reached: string | null;
  /** chance-based lanes toward this goal (ballot/quota/discretionary) */
  chance: string[];
  /** true when the partner's citizenships already cover the goal */
  viaPartner: boolean;
}

/** Which graph nodes satisfy an intent, in preference order. */
function goalNodes(goal: Goal): string[] {
  const iso = goal.iso_n3;
  if (goal.intent === 'cit') return [`cit:${iso}`];
  if (goal.intent === 'work') return [`cit:${iso}`, `pr:${iso}`, `settle_full:${iso}`, `settle_partial:${iso}`, `work:${iso}`];
  return [`cit:${iso}`, `pr:${iso}`, `settle_full:${iso}`, `settle_partial:${iso}`]; // live
}

function heldStatusSatisfies(status: Profile['flags'][number]['status'], intent: Goal['intent']): boolean {
  if (intent === 'cit') return status === 'cit';
  if (intent === 'work') return status === 'cit' || status === 'pr' || status === 'diaspora';
  return true; // every modeled status grants at least a present right to live there
}

/**
 * Solve declared goals: cheapest deterministic path per goal, plus
 * chance-based options and partner coverage. Work goals treat work:* nodes
 * as legitimate answers — the one context where work-only lanes are wins.
 */
export function solveGoals(
  profile: Profile,
  data: BlocsData,
  edges: GraphEdge[],
): GoalAnswer[] {
  if (!profile.goals.length) return [];
  const paths = shortestPaths(profile, edges);
  const held = new Set(profile.flags.filter(f => f.status === 'cit').map(f => f.iso_n3));
  const current = computeUnlocks(profile, data);

  const partnerProfile: Profile = {
    ...profile,
    flags: profile.partnerCitizenships.map(iso => ({ iso_n3: iso, name: iso, status: 'cit' as const })),
    goals: [], partnerCitizenships: [],
  };
  const partnerCountries = profile.partnerCitizenships.length
    ? (() => { const u = computeUnlocks(partnerProfile, data); const s = new Set(u.countries); profile.partnerCitizenships.forEach(i => s.add(i)); return s; })()
    : new Set<string>();

  return profile.goals.map(goal => {
    let best: GoalAnswer['best'] = null;
    let reached: string | null = null;
    const direct = profile.flags.find(f =>
      f.iso_n3 === goal.iso_n3 && heldStatusSatisfies(f.status, goal.intent));
    if (direct) {
      best = {
        years: 0,
        steps: [],
        renounces: false,
        lostCitizenships: [],
        lostBlocs: [],
      };
      reached = `${direct.status}:${goal.iso_n3}`;
    } else {
      for (const node of goalNodes(goal)) {
        const p = paths.get(node);
        if (p && (best === null || p.years < best.years)) {
          const next = computeUnlocks(profileAfterPath(profile, p), data);
          best = {
            years: p.years,
            steps: p.steps,
            renounces: p.renounces,
            lostCitizenships: p.lostCitizenships,
            lostBlocs: current.blocs.filter(b => !next.blocs.some(n => n.id === b.id)).map(b => b.name),
          };
          reached = node;
        }
      }
    }
    const chance = data.bilateral_lanes
      .filter(l => l.destination.iso_n3 === goal.iso_n3
        && (l.allocation ?? 'right') !== 'right'
        && l.beneficiaries.some(b => held.has(b.iso_n3)))
      .map(l => l.name);
    return {
      goal, best, reached, chance,
      viaPartner: partnerCountries.has(goal.iso_n3),
    };
  });
}

/** Human-readable one-line plan: "Mercosur residency → naturalize (~2 yrs)" */
export function describePath(steps: PathStep[], data: BlocsData): string {
  const mechName = (id: string): string => {
    if (id === 'naturalization') return 'naturalize';
    if (id === 'cbi') return 'citizenship by investment';
    return data.blocs.find(b => b.id === id)?.name
      ?? data.bilateral_lanes.find(l => l.id === id)?.name
      ?? id;
  };
  return steps
    .map(s => `${mechName(s.mechanism)}${s.years ? ` (~${s.years} yr${s.years !== 1 ? 's' : ''})` : ''}`)
    .join(' → ');
}

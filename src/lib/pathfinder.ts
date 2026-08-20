import type { BlocsData } from '../types';
import {
  computeUnlocks,
  goalActor,
  householdMembers,
  type ActorId,
  type Goal,
  type Profile,
} from './planner';
import {
  gateWait,
  predicatesFromNeeds,
  predicatesSatisfied,
  type ActorState,
  type HouseholdView,
  type Predicate,
  type PredicateProvenance,
  type PredicateSubject,
} from './predicates';

/**
 * Multi-hop pathfinder over the status graph (data/compiled/edges.json, compiled at build time), per
 * docs/explorer-spec.md:
 *  - legal logic decides which edges EXIST for this profile (needs gating,
 *    and RATIONED allocations never enter deterministic plans — see
 *    `isRationed`); graph logic only ranks among eligible edges
 *  - Dijkstra by years from all held statuses, max hop budget
 *  - work:* nodes are terminal by construction (no outgoing edges)
 *  - renunciation flags propagate onto the resulting path
 */

/**
 * Is entry to this route RATIONED — can a fully qualifying applicant be turned
 * away because the places ran out or the draw went against them?
 *
 * This replaces an `allocation === 'right'` test, and the difference matters
 * because `allocation` answers a narrower question than the filter needed.
 *
 * The corpus marks 338 of 412 naturalisation pathways `discretionary`, and it is
 * correct to: almost every naturalisation statute on earth lets the minister
 * refuse an otherwise-qualifying applicant. Filtering on that removed 96 of every
 * 100 naturalisation routes from the planner. But formal discretion is not what
 * makes an outcome uncertain — as the owner put it, a state that reserves the
 * right to refuse and then refuses almost nobody has not given you a lottery. The
 * thing that actually stops a qualifying person is RATIONING: a ballot, a queue,
 * a numeric cap.
 *
 * So `ballot` and `quota_queue` are rationed and stay out of deterministic plans.
 * `discretionary` is not, and stays in — carrying its allocation so the UI can say
 * the grant is not automatic, which is true and worth saying.
 *
 * The honest signal would be an approval rate. The corpus holds none: zero uses of
 * approval_rate, refusal_rate or grants_per_year across 1,139 routes. Until that is
 * sourced, rationing is the best available proxy and this is where to change it.
 */
export function isRationed(edge: Pick<GraphEdge, 'allocation'>): boolean {
  const allocation = edge.allocation ?? 'right';
  return allocation === 'ballot' || allocation === 'quota_queue';
}

export interface GraphEdge {
  from: string;
  to: string;
  mechanism: string;
  years: number;
  allocation: 'right' | 'ballot' | 'quota_queue' | 'discretionary';
  confidence: string;
  /**
   * Legacy flat gate vocabulary. Still emitted and still honoured (see
   * `edgeGate`), but frozen: new gates are expressed as `predicates`, which can
   * name a subject other than the applicant and record where the fact came from.
   */
  needs: string[];
  /**
   * Typed gate. Present on every edge scripts/build_edges.js emits; absent only
   * on hand-built edges (tests, older compiled files), where it is derived from
   * `needs` by the shim.
   */
  predicates?: Predicate[];
  renounces_previous?: boolean;
  /**
   * Household member this edge belongs to. Absent — the overwhelming majority —
   * means "whoever is searching": blocs, lanes and naturalisation apply to any
   * person holding the qualifying status.
   *
   * `child` marks the jus-soli half of an event accelerator: an edge that grants
   * the CHILD a nationality, gated on a PARENT's declared intent. It has to be
   * excluded from the applicant's own search, because there it names a subject
   * (`parent`) that nothing in a lone search can answer — and the rule is that
   * such a subject throws rather than evaluating false. The actor field is what
   * keeps the edge out of the searches that cannot answer it, instead of making
   * the unanswerable case quiet.
   */
  actor?: ActorId;
}

export interface EdgesFile {
  meta: unknown;
  edges: GraphEdge[];
}

/**
 * A gate on someone other than the searching actor, carried onto the step it
 * unlocked. Composition is where provenance usually dies: the reason a step
 * became available is a fact about a different person, and dropping it leaves a
 * plan that says "then you get residence" with no way to show that it depends on
 * your partner naturalising first, or on which side of the sourced/self-attested
 * line that dependency sits.
 */
export interface HouseholdGate {
  subject: PredicateSubject;
  attribute: string;
  value: unknown;
  provenance: PredicateProvenance;
}

export interface PathStep {
  mechanism: string;
  to: string;
  years: number;
  renouncesPrevious?: boolean;
  /**
   * Years spent waiting for another member's status to come into existence,
   * before this step's own duration starts. Absent when zero, which is every
   * single-actor step.
   */
  waitYears?: number;
  /** Cross-actor gates this step rests on. Absent when there are none. */
  viaHousehold?: HouseholdGate[];
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

/**
 * Edge budget (bloc expansions are single 0-yr edges).
 *
 * Eight, chosen by measurement. At four the chain this planner exists to find
 * was unreachable: a US passport could not get to Brazil or Argentina at all,
 * because golden visa -> PR -> naturalisation -> Mercosur settlement runs six to
 * eight edges. Raising the budget only became affordable after the frontier
 * became a real priority queue (see StateQueue): the previous array was
 * re-sorted on every pop, so depth looked exponentially expensive when the cost
 * was actually the queue.
 *
 * Measured after that fix, per profile (worst case = EU passports, largest
 * frontier), against the 101-rule edge set:
 *
 *    6 hops:  51ms worst — 114 reachable, Brazil yes, Argentina no
 *    8 hops: 566ms worst — 142 reachable, Brazil yes, Argentina yes  <- here
 *   10 hops: 4.9s  worst — 144 reachable (+2 for ~9x the cost)
 *
 * So eight buys the full Mercosur chain and 87% more reachable outcomes than the
 * original four, while staying under a second for the worst realistic profile.
 * tests/pathfinder.test.ts pins the chain, a reachability floor and a wall-clock
 * ceiling, so a regression in any of the three fails rather than degrades.
 */
const MAX_HOPS = 8;

/**
 * The gate an edge imposes, as typed predicates.
 *
 * `predicates` wins when present; otherwise the legacy `needs` strings are
 * translated by the shim, which throws on any form it does not know. That
 * throw is the point of the change: the previous interpreter answered `false`
 * for an unrecognised gate, so an unmodelled requirement in the data removed
 * the edge from the graph without a word.
 */
export function edgeGate(edge: GraphEdge): Predicate[] {
  return edge.predicates ?? predicatesFromNeeds(edge.needs ?? []);
}

/**
 * Legacy-shaped entry point, kept so callers (and the tests that pin the
 * locked semantics) can evaluate a `needs` array directly. Identical to the
 * old interpreter on the four known forms, with two deliberate differences:
 * `willing_child_abroad` now reads `profile.intents` instead of hard-returning
 * false, and an unknown string throws instead of silently failing the edge.
 */
export function needsSatisfied(
  needs: string[],
  profile: Profile,
  citizenships: ReadonlySet<string>,
): boolean {
  return predicatesSatisfied(predicatesFromNeeds(needs), { profile, citizenships });
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

/**
 * Traverse one edge.
 *
 * `wait` is the year before which the edge's gate is not yet true, because it
 * rests on another household member's future status. The step therefore starts
 * at `max(now, wait)` rather than now. Arrival is still monotonically
 * non-decreasing in `cur.years`, which is what lets Dijkstra keep working: a
 * wait can delay a step but never make one cheaper.
 */
function transition(
  cur: State,
  edge: GraphEdge,
  wait = 0,
  via: HouseholdGate[] = [],
): State {
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

  const startsAt = Math.max(cur.years, wait);
  const waited = startsAt - cur.years;
  return {
    node: edge.to,
    years: startsAt + edge.years,
    hops: cur.hops + 1,
    steps: [...cur.steps, {
      mechanism: edge.mechanism,
      to: edge.to,
      years: edge.years,
      renouncesPrevious: edge.renounces_previous,
      ...(waited > 0 ? { waitYears: waited } : {}),
      ...(via.length ? { viaHousehold: via } : {}),
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
/**
 * Binary min-heap over the search frontier.
 *
 * The frontier used to be a plain array re-sorted on every pop, so a search cost
 * O(n log n) per step and the whole traversal degraded to roughly O(n^2 log n).
 * That is what made a six-hop budget look unaffordable (3.2s for an EU profile);
 * it was the queue, not the graph. Popping is O(log n) here.
 */
class StateQueue {
  private readonly items: State[] = [];

  get size(): number {
    return this.items.length;
  }

  push(state: State): void {
    const items = this.items;
    items.push(state);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compareStates(items[index], items[parent]) >= 0) break;
      [items[index], items[parent]] = [items[parent], items[index]];
      index = parent;
    }
  }

  pop(): State | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length === 0) return top;
    items[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < items.length && compareStates(items[left], items[smallest]) < 0) smallest = left;
      if (right < items.length && compareStates(items[right], items[smallest]) < 0) smallest = right;
      if (smallest === index) break;
      [items[index], items[smallest]] = [items[smallest], items[index]];
      index = smallest;
    }
    return top;
  }
}

export interface SearchOptions {
  /**
   * Which household member this search is for. Only decides which edges apply
   * (`GraphEdge.actor`); the member's facts come from `profile`, so a partner is
   * searched by passing THEIR profile, not a flag.
   */
  actor?: ActorId;
  /**
   * Other members' solved state, keyed by the subject naming them from this
   * member's point of view. Absent = a lone search: `partner` predicates fall
   * back to the declared `partnerCitizenships`, exactly as before.
   */
  household?: HouseholdView;
}

export function shortestPaths(
  profile: Profile,
  edges: GraphEdge[],
  options: SearchOptions = {},
): Map<string, PathInfo> {
  const actor: ActorId = options.actor ?? 'self';
  const household = options.household;
  const usable = edges.filter(e => !isRationed(e) && (e.actor ?? actor) === actor);
  const byFrom = new Map<string, GraphEdge[]>();
  // Resolved once per search rather than per visit: cheap (thousands of edges
  // against millions of relaxations), and it makes an unreadable gate throw
  // deterministically at the start of the search instead of only if the edge
  // happens to be reached.
  const gates = new Map<GraphEdge, Predicate[]>();
  // The cross-actor half of each gate, precomputed so the provenance can be
  // attached to the step without re-walking the predicate list per relaxation.
  const crossActor = new Map<GraphEdge, HouseholdGate[]>();
  for (const e of usable) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from)!.push(e);
    const gate = edgeGate(e);
    gates.set(e, gate);
    const via = gate
      .filter(p => p.subject !== 'self')
      .map(p => ({
        subject: p.subject,
        attribute: p.attribute,
        value: p.value,
        provenance: p.provenance,
      }));
    if (via.length) crossActor.set(e, via);
  }
  const gateSatisfied = (e: GraphEdge, citizenships: ReadonlySet<string>): boolean =>
    predicatesSatisfied(gates.get(e) ?? edgeGate(e), { profile, citizenships, household });
  // A lone search has nobody else's timeline to wait for, so skip the read
  // entirely rather than paying for it on every relaxation.
  const waitFor = household
    ? (e: GraphEdge, citizenships: ReadonlySet<string>): number =>
      gateWait(gates.get(e) ?? edgeGate(e), { profile, citizenships, household })
    : () => 0;

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
  const queue = new StateQueue();

  const seed = (node: string) => queue.push({ ...base, node });
  for (const f of profile.flags) {
    if (f.status === 'cit') seed(`cit:${f.iso_n3}`);
    if (f.status === 'pr') seed(`pr:${f.iso_n3}`);
  }
  // Wildcard-from edges (identity lanes) are available directly when gated-in
  const baseHeld = new Set(base.citizenships);
  for (const e of byFrom.get('*') ?? []) {
    if (gateSatisfied(e, baseHeld)) {
      queue.push(transition(base, e, waitFor(e, baseHeld), crossActor.get(e)));
    }
  }

  while (queue.size) {
    // Dijkstra: lowest years first, then fewest hops (the heap keeps that order)
    const cur = queue.pop()!;
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
    const held = new Set(cur.citizenships);
    for (const e of byFrom.get(cur.node) ?? []) {
      if (gateSatisfied(e, held)) {
        queue.push(transition(cur, e, waitFor(e, held), crossActor.get(e)));
      }
    }
  }
  return new Map([...best].map(([node, state]) => [node, withoutNode(state)]));
}

/* ── Household solving ─────────────────────────────────────────────────────── */

/**
 * How many times the members are re-solved against each other.
 *
 * THE BOUND THAT MATTERS. The obvious way to give two people their own status
 * sets is one joint search over the product of their states, which is where the
 * cost explodes: the Pareto frontier is already the expensive part of a single
 * search (see MAX_HOPS), and squaring it puts the worst-case EU profile far past
 * the wall-clock ceiling the tests pin.
 *
 * So the search stays per-member and the members communicate only through a
 * summary of each other: a map of nationality → earliest year they can hold it.
 * The first round solves everyone against declared facts; the second re-solves
 * anyone whose view of somebody else grew, which is what lets "your partner
 * naturalises, then sponsors you" resolve at all. The summary only ever grows
 * and the years in it only ever fall,
 * so the iteration is monotone and converges; two rounds is where it converges
 * for every shape in the data, because the second round is what turns an
 * ACQUIRED nationality into a gate and nothing in the corpus gates on a
 * nationality that itself needed a cross-actor gate.
 *
 * Cost is therefore members × rounds single-actor searches — at most six, and
 * exactly one for the common profile with no partner and no declared child —
 * never the product of their state spaces. Rounds that would change nothing are
 * skipped, so the six is a ceiling rather than a bill.
 */
const MAX_HOUSEHOLD_ROUNDS = 2;

export interface MemberSolution {
  actor: ActorId;
  /** That member's own facts, as the solver saw them. */
  profile: Profile;
  /** Reachable nodes for THIS member, on their own status set. */
  paths: Map<string, PathInfo>;
  /** Nationality → earliest year this member can hold it (0 = holds it today). */
  citizenshipAt: Map<string, number>;
}

export interface HouseholdSolution {
  members: Map<ActorId, MemberSolution>;
  /** Rounds actually run; 1 means nothing propagated between members. */
  rounds: number;
}

function heldCitizenships(profile: Profile): string[] {
  return profile.flags.filter(f => f.status === 'cit').map(f => f.iso_n3);
}

/**
 * Summarise a member for the others: what they can hold, and when.
 *
 * Bound worth stating: the year comes from that member's own cheapest path to
 * the nationality, so a gate naming TWO of one member's nationalities is not
 * verified against a single path of theirs. `eq` names one and `in` is a
 * disjunction, so nothing in the corpus reaches that case; a conjunctive
 * multi-nationality gate on one person would need the joint search this
 * deliberately avoids.
 */
function summarise(profile: Profile, paths: Map<string, PathInfo>): Map<string, number> {
  const at = new Map<string, number>();
  for (const iso of heldCitizenships(profile)) at.set(iso, 0);
  for (const [node, info] of paths) {
    if (!node.startsWith('cit:')) continue;
    const iso = node.slice(4);
    // A path that renounces on the way does not leave the member holding what
    // it passed through, so only the surviving set counts as availability.
    if (!info.citizenships.includes(iso)) continue;
    const previous = at.get(iso);
    if (previous === undefined || info.years < previous) at.set(iso, info.years);
  }
  return at;
}

function sameSummary(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [iso, year] of a) if (b.get(iso) !== year) return false;
  return true;
}

/**
 * What one member can see of the others, keyed by the subject that names them.
 *
 * Every subject the member's edges could name is present, empty or not: an entry
 * with nothing in it says "we know there is no such person", which may
 * legitimately fail a gate, whereas an ABSENT entry means the solve never
 * modelled them and makes the gate throw. Nothing here may be silently false.
 */
function viewFor(
  actor: ActorId,
  summaries: Map<ActorId, Map<string, number>>,
  intents: Map<ActorId, ReadonlySet<string>>,
): HouseholdView {
  const empty: ActorState = { citizenshipAt: new Map(), intents: new Set() };
  const stateOf = (of: ActorId): ActorState => ({
    citizenshipAt: summaries.get(of) ?? new Map(),
    intents: intents.get(of) ?? new Set(),
  });
  if (actor === 'child') {
    // A parent is the union of the adults: either parent's declared intent is
    // enough to assert the birth, and either one's nationality is the child's
    // potential descent claim (which nothing reads yet, but the state is real).
    const parentIntents = new Set<string>();
    const parentCitizenshipAt = new Map<string, number>();
    for (const adult of ['self', 'partner'] as const) {
      const state = stateOf(adult);
      for (const intent of state.intents) parentIntents.add(intent);
      for (const [iso, year] of state.citizenshipAt) {
        const previous = parentCitizenshipAt.get(iso);
        if (previous === undefined || year < previous) parentCitizenshipAt.set(iso, year);
      }
    }
    return {
      parent: { citizenshipAt: parentCitizenshipAt, intents: parentIntents },
      // A child has no partner in this model, and that is a fact rather than a gap.
      partner: empty,
    };
  }
  // Each adult's `partner` is the other one. Undeclared = empty, which is the
  // honest reading of a profile that names no partner.
  return { partner: stateOf(actor === 'self' ? 'partner' : 'self') };
}

/**
 * Solve every declared household member, letting each one's statuses unlock the
 * others' edges.
 *
 * A single-member household runs exactly one search with no household view at
 * all, so a profile with no partner and no declared child goes down the same
 * code path as before and returns the same answers.
 */
export function solveHousehold(profile: Profile, edges: GraphEdge[]): HouseholdSolution {
  const members = householdMembers(profile);
  const intents = new Map<ActorId, ReadonlySet<string>>(
    members.map(m => [m.actor, new Set(m.profile.intents)]),
  );
  const summaries = new Map<ActorId, Map<string, number>>(
    members.map(m => [m.actor, new Map(heldCitizenships(m.profile).map(iso => [iso, 0]))]),
  );

  const solutions = new Map<ActorId, MemberSolution>();
  let rounds = 0;
  let stale = new Set<ActorId>(members.map(m => m.actor));

  while (stale.size && rounds < MAX_HOUSEHOLD_ROUNDS) {
    rounds += 1;
    const nextSummaries = new Map(summaries);
    for (const member of members) {
      if (!stale.has(member.actor)) continue;
      const paths = shortestPaths(member.profile, edges, {
        actor: member.actor,
        // The lone case keeps the pre-household context so `partner` predicates
        // read the declared list and the search is byte-for-byte the old one.
        household: members.length === 1
          ? undefined
          : viewFor(member.actor, summaries, intents),
      });
      solutions.set(member.actor, {
        actor: member.actor,
        profile: member.profile,
        paths,
        citizenshipAt: summarise(member.profile, paths),
      });
      nextSummaries.set(member.actor, solutions.get(member.actor)!.citizenshipAt);
    }
    const grew = new Set<ActorId>();
    for (const [actor, summary] of nextSummaries) {
      if (!sameSummary(summaries.get(actor) ?? new Map(), summary)) grew.add(actor);
      summaries.set(actor, summary);
    }
    // Re-solve a member only when somebody ELSE grew: growing yourself changes
    // nothing about the edges available to you. With one member that is never
    // true, so the loop stops after a single search.
    stale = new Set(
      members
        .map(m => m.actor)
        .filter(actor => [...grew].some(other => other !== actor)),
    );
  }

  return { members: solutions, rounds };
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

export interface GoalPlan {
  years: number;
  steps: PathStep[];
  renounces: boolean;
  lostCitizenships: string[];
  lostBlocs: string[];
}

/** One household member's answer to one goal. */
export interface ActorGoalAnswer {
  actor: ActorId;
  /** best deterministic path for this member (null = none with their facts) */
  best: GoalPlan | null;
  /** the terminal node their best path reaches */
  reached: string | null;
}

export interface GoalAnswer {
  goal: Goal;
  /**
   * best deterministic path (null = no path with current facts). For a
   * `household` goal this is the BINDING member — the slowest, or an unsolved
   * one — because "we can all live there" is only true when the last of us can.
   */
  best: GoalPlan | null;
  /** the terminal node the best path reaches (work:.. vs settle.. vs cit:..) */
  reached: string | null;
  /** chance-based lanes toward this goal (ballot/quota/discretionary) */
  chance: string[];
  /**
   * True when the PARTNER covers this goal ALREADY, at this intent.
   *
   * Two corrections over what this used to mean. It is intent-aware: a partner
   * who can only work somewhere no longer marks a citizenship goal as covered,
   * and their EU settlement rights no longer pass as citizenship coverage. And
   * it is present-tense: the partner's own multi-year naturalisation route is
   * not "already covered", it is a plan, and it belongs in `perActor` with its
   * price attached rather than in a badge that says the problem is solved.
   */
  viaPartner: boolean;
  /** Per-member answers: everyone the goal's actor covers. */
  perActor: ActorGoalAnswer[];
  /** Members with no deterministic path — for a household goal, who blocks it. */
  blockedActors: ActorId[];
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
 * One member's answer for one goal, on that member's own facts and own solved
 * paths. Extracted from the old single-actor body unchanged, which is what keeps
 * the `self` answers identical.
 */
function answerForMember(
  member: MemberSolution,
  goal: Goal,
  data: BlocsData,
): ActorGoalAnswer {
  const { profile, paths } = member;
  const current = computeUnlocks(profile, data);
  let best: GoalPlan | null = null;
  let reached: string | null = null;

  const direct = profile.flags.find(f =>
    f.iso_n3 === goal.iso_n3 && heldStatusSatisfies(f.status, goal.intent));
  if (direct) {
    return {
      actor: member.actor,
      best: { years: 0, steps: [], renounces: false, lostCitizenships: [], lostBlocs: [] },
      reached: `${direct.status}:${goal.iso_n3}`,
    };
  }
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
  return { actor: member.actor, best, reached };
}

/** Which members a goal's actor is asking about. */
function actorsForGoal(goal: Goal, solved: Map<ActorId, MemberSolution>): ActorId[] {
  const actor = goalActor(goal);
  if (actor === 'self') return ['self'];
  if (actor === 'partner') return solved.has('partner') ? ['partner'] : [];
  // household: everyone the profile declares, the child included — if a child is
  // asserted, "we can all live there" has to answer for them too.
  return [...solved.keys()];
}

/**
 * Solve declared goals: cheapest deterministic path per goal, per actor, plus
 * chance-based options and partner coverage. Work goals treat work:* nodes
 * as legitimate answers — the one context where work-only lanes are wins.
 */
export function solveGoals(
  profile: Profile,
  data: BlocsData,
  edges: GraphEdge[],
): GoalAnswer[] {
  if (!profile.goals.length) return [];
  const household = solveHousehold(profile, edges);
  const solved = household.members;

  return profile.goals.map(goal => {
    const actors = actorsForGoal(goal, solved);
    const perActor = actors
      .map(actor => solved.get(actor))
      .filter((member): member is MemberSolution => member !== undefined)
      .map(member => answerForMember(member, goal, data));

    // The binding member: an unsolved one if there is any, else the slowest.
    // A household goal is only met when the LAST member can meet it.
    const blockedActors = perActor.filter(a => a.best === null).map(a => a.actor);
    const binding = blockedActors.length
      ? perActor.find(a => a.best === null)!
      : perActor.reduce<ActorGoalAnswer | null>(
        (worst, a) => (worst === null || a.best!.years > worst.best!.years ? a : worst),
        null,
      );

    // Chance lanes are read against the nationalities of whoever is asking.
    const held = new Set<string>();
    for (const actor of actors.length ? actors : (['self'] as ActorId[])) {
      const member = solved.get(actor);
      if (member) for (const iso of member.profile.flags.filter(f => f.status === 'cit')) {
        held.add(iso.iso_n3);
      }
    }
    const chance = data.bilateral_lanes
      .filter(l => l.destination.iso_n3 === goal.iso_n3
        && (l.allocation ?? 'right') !== 'right'
        && l.beneficiaries.some(b => held.has(b.iso_n3)))
      .map(l => l.name);

    // Intent-aware partner coverage. `answerForMember` searches `goalNodes`,
    // which is where the intent lives: a citizenship goal only looks at cit:ISO,
    // so a partner who can merely work or settle there no longer covers it. The
    // old version compared against a flat country set and could not tell the
    // difference. Zero years is the "already" in the claim.
    const partner = solved.get('partner');
    const partnerAnswer = partner
      ? perActor.find(a => a.actor === 'partner') ?? answerForMember(partner, goal, data)
      : null;
    const viaPartner = partnerAnswer?.best?.years === 0;

    return {
      goal,
      best: binding?.best ?? null,
      reached: binding?.reached ?? null,
      chance,
      viaPartner,
      perActor,
      blockedActors,
    };
  });
}

/**
 * Human-readable one-line plan: "Mercosur residency → naturalize (~2 yrs)".
 *
 * A cross-actor step renders its wait as its own clause. Without it the numbers
 * on the line no longer add up to the plan's total, and the years that went
 * missing would be exactly the ones spent waiting on somebody else — the part a
 * household plan most needs to say out loud.
 */
export function describePath(steps: PathStep[], data: BlocsData): string {
  const mechName = (id: string): string => {
    if (id === 'naturalization') return 'naturalize';
    if (id === 'cbi') return 'citizenship by investment';
    return data.blocs.find(b => b.id === id)?.name
      ?? data.bilateral_lanes.find(l => l.id === id)?.name
      ?? id;
  };
  const yrs = (n: number) => `~${n} yr${n !== 1 ? 's' : ''}`;
  const waitFor = (step: PathStep): string => {
    if (!step.waitYears) return '';
    const who = step.viaHousehold?.[0]?.subject;
    return `wait for ${who ?? 'household'} (${yrs(step.waitYears)}) → `;
  };
  return steps
    .map(s => `${waitFor(s)}${mechName(s.mechanism)}${s.years ? ` (${yrs(s.years)})` : ''}`)
    .join(' → ');
}

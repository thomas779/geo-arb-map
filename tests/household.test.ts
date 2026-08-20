import { describe, test, expect } from 'bun:test';
import type { BlocsData } from '../src/types';
import {
  computeUnlocks,
  EMPTY_PROFILE,
  goalKey,
  householdExtraCountries,
  householdMembers,
  normalizeProfile,
  partnerProfileOf,
  type Profile,
} from '../src/lib/planner';
import {
  describePath,
  shortestPaths,
  solveGoals,
  solveHousehold,
  type GraphEdge,
} from '../src/lib/pathfinder';
import { UnknownPredicateError, type Predicate } from '../src/lib/predicates';
import { readProfile } from '../src/url';
// @ts-expect-error — plain-JS bun script, imported for its exported builder
import { buildEdges, validateBuiltEdges } from '../scripts/build_edges.js';

/**
 * The household solver (step 2): every member gets their own status set, an
 * edge one member unlocks can be another member's, and a goal can be asked on
 * somebody else's behalf.
 *
 * Two properties carry most of this file. First, a household of one behaves
 * EXACTLY as the single-actor pathfinder did — that is the regression risk, and
 * the whole shipped graph runs through it. Second, a synthetic household member
 * carries only their own facts: the bug this replaces spread the applicant's
 * profile onto the partner, so your grandparent and your heritage claim were
 * credited to them.
 */

const data = (await Bun.file(
  new URL('../public/blocs_data.json', import.meta.url),
).json()) as BlocsData;
const manual = await Bun.file(new URL('../data/manual_edges.json', import.meta.url)).json();
const corpus = await Bun.file(
  new URL('../data/compiled/citizenship_routes.json', import.meta.url),
).json();
const edges: GraphEdge[] = buildEdges(data, manual, corpus).edges;

/**
 * Bun allows 5s per test, which is tight for the checks that solve the whole
 * shipped graph — the bijection test alone runs ten searches, and CI's runner is
 * slower than a laptop.
 *
 * This is NOT the problem hoisting solved. There, one answer was recomputed across
 * four tests and sharing it was the fix. Here the computation IS the assertion, so
 * it gets room. Reach for this only when the work is genuinely the test; if two
 * tests want the same answer, hoist instead.
 */
const FULL_GRAPH_TIMEOUT_MS = 30_000;

const profileOf = (over: Partial<Profile>): Profile => ({ ...EMPTY_PROFILE, ...over });
const citizen = (iso: string, name = iso) =>
  profileOf({ flags: [{ iso_n3: iso, name, status: 'cit' }] });

describe('a household of one is the single-actor search, unchanged', () => {
  test('every reachable node, cost and step matches shortestPaths exactly', () => {
    for (const iso of ['840', '858', '024', '276', '124']) {
      const profile = citizen(iso);
      const lone = shortestPaths(profile, edges);
      const solved = solveHousehold(profile, edges);
      expect([...solved.members.keys()]).toEqual(['self']);
      // One search, not two: nothing to propagate between members.
      expect(solved.rounds).toBe(1);
      const self = solved.members.get('self')!;
      // Same node set and same value at every node: a bijection, not a subset.
      expect(self.paths.size).toBe(lone.size);
      for (const [node, info] of lone) {
        expect(self.paths.get(node), `${iso} -> ${node}`).toEqual(info);
      }
    }
  }, FULL_GRAPH_TIMEOUT_MS);

  test('no step in the shipped graph acquires a wait or a cross-actor gate on its own', () => {
    // A lone search has nobody else's timeline to wait for, so these fields must
    // stay absent — their presence would mean a cross-actor cost leaked into a
    // single-actor plan.
    for (const [, info] of shortestPaths(citizen('840'), edges)) {
      for (const step of info.steps) {
        expect(step.waitYears).toBeUndefined();
        expect(step.viaHousehold).toBeUndefined();
      }
    }
  }, FULL_GRAPH_TIMEOUT_MS);
});

describe('the partner leak', () => {
  /**
   * The synthesis this replaced, verbatim from pathfinder.ts before the fix, as
   * the oracle. `{...profile}` is the bug: everything after it overrides only
   * flags, goals and partnerCitizenships, so `ancestors`, `heritages` and
   * `birthplace` came along.
   */
  const oldPartnerCountries = (profile: Profile): Set<string> => {
    if (!profile.partnerCitizenships.length) return new Set<string>();
    const partner: Profile = {
      ...profile,
      flags: profile.partnerCitizenships.map(iso => ({ iso_n3: iso, name: iso, status: 'cit' as const })),
      goals: [], partnerCitizenships: [],
    };
    const countries = new Set(computeUnlocks(partner, data).countries);
    profile.partnerCitizenships.forEach(iso => countries.add(iso));
    return countries;
  };

  const leaky = profileOf({
    flags: [{ iso_n3: '392', name: 'Japan', status: 'cit' }],
    ancestors: ['372'],
    heritages: ['israel_law_of_return'],
    birthplace: '344',
    goals: [{ iso_n3: '376', intent: 'cit' }],
    partnerCitizenships: ['724'],
  });

  // Solved once and shared, because the tests below read different fields of the
  // same two answers. Hoisting `solveHousehold` alone was not enough — the leak
  // test still ran its own `solveGoals`, a second full solve, and timed out on CI
  // at 5.8s against Bun's 5s default while passing locally. Both live out here now.
  const leakySolved = solveHousehold(leaky, edges).members.get('partner')!;
  const leakyGoals = solveGoals(leaky, data, edges);

  test('a synthetic partner starts from their own facts and nothing else', () => {
    const partner = partnerProfileOf(leaky);
    expect(partner.flags).toEqual([{ iso_n3: '724', name: '724', status: 'cit' }]);
    expect(partner.ancestors).toEqual([]);
    expect(partner.heritages).toEqual([]);
    expect(partner.birthplace).toBeNull();
    expect(partner.goals).toEqual([]);
    expect(partner.partnerCitizenships).toEqual([]);
  });

  test('your Law of Return claim is no longer credited to your partner', () => {
    // BEFORE: the synthetic partner inherited `heritages`, so Israel appeared in
    // their coverage set and the planner told you "your partner's citizenship
    // covers it (family derivation)" on the strength of YOUR claim.
    expect(oldPartnerCountries(leaky).has('376')).toBe(true);

    // AFTER: nothing in the profile says the partner has any claim on Israel.
    expect(leakySolved.paths.has('cit:376')).toBe(false);
    expect(leakyGoals[0].viaPartner).toBe(false);
  });

  test('a partner keeps the routes that are genuinely theirs', () => {
    // Not a blanket suppression: a Spaniard really can reach Irish citizenship
    // through EU free movement and ordinary naturalisation. What changed is the
    // REASON — five years of residence, not your grandparent.
    expect(leakySolved.paths.get('cit:372')!.years).toBeGreaterThan(0);
    expect(leakySolved.paths.get('cit:372')!.steps.length).toBeGreaterThan(1);
  });

  test('the solver never reads one member\'s claims for another', () => {
    // The leak at the search layer rather than the summary layer: heritage and
    // ancestry are `self`-only attributes, and `self` in a partner's search is
    // the partner.
    const withClaims = profileOf({
      flags: [{ iso_n3: '840', name: 'US', status: 'cit' }],
      heritages: ['kazakhstan_qandas'],
      partnerCitizenships: ['724'],
    });
    const solved = solveHousehold(withClaims, edges);
    expect(solved.members.get('self')!.paths.has('cit:398')).toBe(true);
    expect(solved.members.get('partner')!.paths.has('cit:398')).toBe(false);
  }, FULL_GRAPH_TIMEOUT_MS);
});

describe('renunciation stays per actor', () => {
  test('one member renouncing does not strip another\'s citizenship', () => {
    const profile = profileOf({
      flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
      heritages: ['kazakhstan_qandas'],
      partnerCitizenships: ['724'],
    });
    const solved = solveHousehold(profile, edges);

    // Self takes the Kazakh claim and loses the US passport for it.
    const mine = solved.members.get('self')!.paths.get('cit:398')!;
    expect(mine.renounces).toBe(true);
    expect(mine.lostCitizenships).toEqual(['840']);

    // The partner is untouched: still Spanish, having lost nothing.
    const theirs = solved.members.get('partner')!;
    expect(theirs.paths.get('cit:724')!.citizenships).toEqual(['724']);
    expect(theirs.paths.get('cit:724')!.lostCitizenships).toEqual([]);
    expect(theirs.citizenshipAt.get('724')).toBe(0);
  }, FULL_GRAPH_TIMEOUT_MS);

  test('a nationality a member renounces on the way is not offered to the others', () => {
    // Availability is what one member can HOLD, not what they passed through.
    // A path that surrenders a nationality cannot lend it to a partner's gate.
    const profile = profileOf({
      flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
      heritages: ['kazakhstan_qandas'],
      partnerCitizenships: ['724'],
    });
    const self = solveHousehold(profile, edges).members.get('self')!;
    expect(self.paths.get('cit:398')!.lostCitizenships).toContain('840');
    // 840 is still available at 0 — it is HELD today, and the Kazakh path is one
    // option among many rather than a commitment.
    expect(self.citizenshipAt.get('840')).toBe(0);
    expect(self.citizenshipAt.get('398')).toBe(1);
  });
});

describe('cross-actor edges', () => {
  const edge = (
    from: string, to: string, years: number, mechanism: string,
    predicates: Predicate[] = [],
  ): GraphEdge => ({
    from, to, years, mechanism,
    allocation: 'right', confidence: 'high', needs: [], predicates,
  });

  /**
   * The shape the household solver exists for: your partner naturalises, and
   * their new nationality is what sponsors you.
   *
   * Nothing in the shipped corpus gates on a partner yet — the spouse routes are
   * unsourced, so inventing one to make a test pass would be worse than the gap
   * — hence a hand-built graph, exactly as the hop-budget tests use.
   */
  const sponsorship: Predicate = {
    subject: 'partner', attribute: 'citizenship', op: 'eq',
    value: '900', provenance: 'sourced',
  };
  const graph = [
    edge('cit:002', 'pr:900', 0, 'eu_style_lane'),
    edge('pr:900', 'cit:900', 3, 'naturalization'),
    edge('*', 'pr:900', 0, 'spouse_sponsorship', [sponsorship]),
  ];

  test('a partner\'s ACQUIRED citizenship unlocks a node for you, priced from when it exists', () => {
    const profile = profileOf({
      flags: [{ iso_n3: '001', name: 'Nowhere', status: 'cit' }],
      partnerCitizenships: ['002'],
    });
    const solved = solveHousehold(profile, graph);
    expect(solved.rounds).toBe(2); // round 1 solves them, round 2 propagates

    // The partner gets there on their own lane: free residence, three-year wait.
    expect(solved.members.get('partner')!.paths.get('cit:900')!.years).toBe(3);

    // You are sponsored, but not before they hold it: three years of waiting,
    // then your own three-year clock. Charging nothing for the wait would have
    // invented three years the household does not have.
    const mine = solved.members.get('self')!;
    const sponsored = mine.paths.get('pr:900')!;
    expect(sponsored.years).toBe(3);
    expect(sponsored.steps[0].waitYears).toBe(3);
    expect(mine.paths.get('cit:900')!.years).toBe(6);
  });

  test('the gate\'s provenance survives composition onto the step it unlocked', () => {
    const profile = profileOf({
      flags: [{ iso_n3: '001', name: 'Nowhere', status: 'cit' }],
      partnerCitizenships: ['002'],
    });
    const path = solveHousehold(profile, graph).members.get('self')!.paths.get('cit:900')!;
    expect(path.steps[0].viaHousehold).toEqual([{
      subject: 'partner', attribute: 'citizenship', value: '900', provenance: 'sourced',
    }]);
    // …and the rendered plan says whose clock the wait is on, so the numbers on
    // the line still add up to the six years the path actually costs.
    expect(describePath(path.steps, data))
      .toBe('wait for partner (~3 yrs) → spouse_sponsorship → naturalize (~3 yrs)');
  });

  test('no partner, no sponsorship — and no silent throw either', () => {
    // An undeclared partner is a KNOWN fact ("there is nobody"), so the gate
    // legitimately fails. What must not happen is the search dying on it.
    const alone = profileOf({ flags: [{ iso_n3: '001', name: 'Nowhere', status: 'cit' }] });
    expect(solveHousehold(alone, graph).members.get('self')!.paths.has('pr:900')).toBe(false);
    expect(shortestPaths(alone, graph).has('pr:900')).toBe(false);
  });

  test('a declared partner who cannot reach the nationality unlocks nothing', () => {
    const wrongPartner = profileOf({
      flags: [{ iso_n3: '001', name: 'Nowhere', status: 'cit' }],
      partnerCitizenships: ['003'],
    });
    expect(solveHousehold(wrongPartner, graph).members.get('self')!.paths.has('pr:900')).toBe(false);
  });
});

describe('unknown stays loud across the household', () => {
  test('a subject the solve did not model throws rather than failing the edge', () => {
    // `parent` resolves only in a child's search. An edge that names it without
    // declaring itself the child's edge lands in the applicant's own solve,
    // where nobody can answer it — and that must be an error, not a false.
    const rogue: GraphEdge = {
      from: 'cit:001', to: 'cit:900', mechanism: 'my_mothers_intent',
      years: 0, allocation: 'right', confidence: 'high', needs: [],
      predicates: [{
        subject: 'parent', attribute: 'intent', op: 'eq',
        value: 'child_abroad', provenance: 'self_attested',
      }],
    };
    const profile = profileOf({
      flags: [{ iso_n3: '001', name: 'Nowhere', status: 'cit' }],
      partnerCitizenships: ['002'],
    });
    expect(() => solveHousehold(profile, [rogue])).toThrow(UnknownPredicateError);
    expect(() => shortestPaths(citizen('001'), [rogue])).toThrow(/actor: "child"/);
  });

  test('the build refuses that edge before it can ever be solved', () => {
    const rogue = {
      from: '*', to: 'cit:900', mechanism: 'my_mothers_intent',
      years: 0, allocation: 'right', confidence: 'high', needs: [],
      predicates: [{
        subject: 'parent', attribute: 'intent', op: 'eq',
        value: 'child_abroad', provenance: 'self_attested',
      }],
    };
    expect(() => validateBuiltEdges([rogue])).toThrow(UnknownPredicateError);
    expect(() => validateBuiltEdges([rogue])).toThrow(/only resolves in a child actor's search/);
    // Declaring the actor is what makes it legal.
    expect(() => validateBuiltEdges([{ ...rogue, actor: 'child' }])).not.toThrow();
    expect(() => validateBuiltEdges(edges)).not.toThrow();
  });

  test('an accelerator grant for an unmodelled person fails the build', () => {
    const invented = {
      edges: [{
        id: 'invented_accelerator', reason_code: 'event_accelerator',
        grants: [{ who: 'sibling', node: 'cit:076', years: 0 }],
      }],
    };
    expect(() => buildEdges(data, invented, corpus)).toThrow(/unknown who="sibling"/);
  });
});

describe('the child is a member, not a dropped grant', () => {
  const withChild = profileOf({
    flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
    intents: ['child_abroad'],
  });

  test('every who: child grant in the corpus now reaches the graph', () => {
    // All three were silently discarded by `if (grant.who !== 'parent') continue;`
    // — the only multi-actor data in the repo, and none of it was in the graph.
    const childEdges = edges.filter(e => e.actor === 'child');
    expect(childEdges.map(e => e.to).sort()).toEqual(['cit:032', 'cit:076', 'cit:484']);
  });

  test('the child acquires the jus-soli nationality, and the parent does not', () => {
    const solved = solveHousehold(withChild, edges);
    expect([...solved.members.keys()].sort()).toEqual(['child', 'self']);

    const child = solved.members.get('child')!;
    for (const iso of ['076', '484', '032']) {
      const path = child.paths.get(`cit:${iso}`)!;
      expect(path.years).toBe(0);
      expect(path.hops).toBe(1);
    }
    // …and the child's own passports then open the rest of the graph to them,
    // which is the point of giving them a status set of their own.
    expect(child.paths.size).toBeGreaterThan(100);

    // The parent's half is a different edge with a different price, and the
    // parent never gets the child's birthright.
    const self = solved.members.get('self')!;
    expect(self.paths.get('cit:076')!.years).toBe(1);
    expect(self.paths.get('cit:484')!.years).toBe(2);
  });

  test('the parent route runs through the residence the statute counts from', () => {
    // `grant.via` used to be ignored, so a parent walked into a nationality
    // without ever holding the residence its clock runs from.
    const self = solveHousehold(withChild, edges).members.get('self')!;
    const brazil = self.paths.get('cit:076')!;
    expect(brazil.steps.map(s => s.to)).toEqual(['pr:076', 'cit:076']);
    expect(brazil.steps.map(s => s.years)).toEqual([0, 1]);
    // Argentina grants family residence and nothing more — no citizenship
    // fast-track was ever verified, so there must be no `via` invented for it.
    expect(self.paths.get('pr:032')!.steps.map(s => s.to)).toEqual(['pr:032']);
  });

  test('no declared intent, no child member and no child edges anywhere', () => {
    const solved = solveHousehold(citizen('840'), edges);
    expect([...solved.members.keys()]).toEqual(['self']);
    for (const [, info] of solved.members.get('self')!.paths) {
      expect(info.steps.some(s => s.to === 'cit:032' && s.years === 0)).toBe(false);
    }
  });
});

describe('goals have an actor', () => {
  const household = profileOf({
    flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
    partnerCitizenships: ['724'],
  });

  test('a partner goal is answered on the partner\'s facts', () => {
    const [answer] = solveGoals(
      { ...household, goals: [{ iso_n3: '724', intent: 'cit', actor: 'partner' }] },
      data, edges,
    );
    expect(answer.best!.years).toBe(0);
    expect(answer.reached).toBe('cit:724');
    expect(answer.perActor.map(a => a.actor)).toEqual(['partner']);
  });

  test('a household goal answers for everyone and is bound by the slowest', () => {
    const [answer] = solveGoals(
      { ...household, goals: [{ iso_n3: '724', intent: 'live', actor: 'household' }] },
      data, edges,
    );
    const yearsFor = (actor: string): number =>
      answer.perActor.find(a => a.actor === actor)!.best!.years;
    expect(yearsFor('partner')).toBe(0);
    expect(yearsFor('self')).toBeGreaterThan(0);
    // "We can all live there" is only true when the LAST of us can.
    expect(answer.best!.years).toBe(yearsFor('self'));
    expect(answer.blockedActors).toEqual([]);
  });

  test('a household goal names the member who cannot get there', () => {
    const [answer] = solveGoals(
      {
        ...household,
        heritages: ['israel_law_of_return'],
        goals: [{ iso_n3: '376', intent: 'cit', actor: 'household' }],
      },
      data, edges,
    );
    // You have the claim; your partner does not, so the household cannot.
    expect(answer.blockedActors).toEqual(['partner']);
    expect(answer.best).toBeNull();
    expect(answer.perActor.find(a => a.actor === 'self')!.best).not.toBeNull();
  });

  test('a partner goal with no partner declared answers for nobody', () => {
    const [answer] = solveGoals(
      { ...citizen('840'), goals: [{ iso_n3: '724', intent: 'cit', actor: 'partner' }] },
      data, edges,
    );
    expect(answer.perActor).toEqual([]);
    expect(answer.best).toBeNull();
  });

  test('a self goal answers exactly as it did before actors existed', () => {
    const [answer] = solveGoals(
      {
        ...citizen('840', 'United States'),
        heritages: ['kazakhstan_qandas'],
        goals: [{ iso_n3: '398', intent: 'cit' }],
      },
      data, edges,
    );
    expect(answer.best!.renounces).toBe(true);
    expect(answer.best!.lostCitizenships).toEqual(['840']);
    expect(answer.perActor.map(a => a.actor)).toEqual(['self']);
  });
});

describe('viaPartner is intent-aware', () => {
  const partnered = (intent: 'cit' | 'live' | 'work'): Profile => profileOf({
    flags: [{ iso_n3: '392', name: 'Japan', status: 'cit' }],
    partnerCitizenships: ['124'],
    goals: [{ iso_n3: '840', intent }],
  });

  test('a work-only partner route cannot satisfy a citizenship or live goal', () => {
    // A Canadian's only route into the US is TN, which terminates at work:840.
    // That is a real answer to "can we work there" and no answer at all to "can
    // we become American" — a distinction the old flat country set could not
    // make, because it compared a destination against a set with no intent in it.
    expect(solveGoals(partnered('work'), data, edges)[0].viaPartner).toBe(true);
    expect(solveGoals(partnered('live'), data, edges)[0].viaPartner).toBe(false);
    expect(solveGoals(partnered('cit'), data, edges)[0].viaPartner).toBe(false);
  });

  test('settlement rights no longer masquerade as citizenship coverage', () => {
    // The old set was every country the partner could reach on any footing, so a
    // Spaniard's EU free movement was reported as covering a CITIZENSHIP goal in
    // states they cannot naturalise into within the modelled graph.
    const profile = profileOf({
      flags: [{ iso_n3: '392', name: 'Japan', status: 'cit' }],
      partnerCitizenships: ['724'],
      goals: [
        { iso_n3: '040', intent: 'cit' },
        { iso_n3: '040', intent: 'live' },
      ],
    });
    const [asCitizenship, asResidence] = solveGoals(profile, data, edges);
    expect(asCitizenship.viaPartner).toBe(false);
    expect(asResidence.viaPartner).toBe(true);
  });

  test('a partner\'s own multi-year route is a plan, not existing coverage', () => {
    // A Spaniard genuinely can become Irish, in five years. That is not "your
    // partner's citizenship already covers it" — the badge says the problem is
    // solved and it is not — so it belongs in the per-actor answer with its
    // price attached, which is where it now is.
    const profile = profileOf({
      flags: [{ iso_n3: '392', name: 'Japan', status: 'cit' }],
      partnerCitizenships: ['724'],
      goals: [{ iso_n3: '372', intent: 'cit', actor: 'partner' }],
    });
    const [answer] = solveGoals(profile, data, edges);
    expect(answer.viaPartner).toBe(false);
    expect(answer.perActor[0].best!.years).toBeGreaterThan(0);
  });
});

describe('profile and URL compatibility', () => {
  test('a goal without an actor round-trips unchanged', () => {
    expect(readProfile(new URLSearchParams('goals=724l'))?.goals).toEqual([
      { iso_n3: '724', intent: 'live' },
    ]);
    expect(normalizeProfile({ goals: [{ iso_n3: '724', intent: 'live' }] }).goals).toEqual([
      { iso_n3: '724', intent: 'live' },
    ]);
    expect(goalKey({ iso_n3: '724', intent: 'live' })).toBe('live:724');
  });

  test('an actor prefix is read from the URL and keyed distinctly', () => {
    expect(readProfile(new URLSearchParams('goals=724l,p840c,h276l'))?.goals).toEqual([
      { iso_n3: '724', intent: 'live' },
      { iso_n3: '840', intent: 'cit', actor: 'partner' },
      { iso_n3: '276', intent: 'live', actor: 'household' },
    ]);
    expect(goalKey({ iso_n3: '840', intent: 'cit', actor: 'partner' })).toBe('partner:cit:840');
    // Distinct keys, so watching one goal does not watch the other.
    expect(goalKey({ iso_n3: '724', intent: 'live', actor: 'household' }))
      .not.toBe(goalKey({ iso_n3: '724', intent: 'live' }));
  });

  test('an invented actor becomes self rather than a fourth kind of person', () => {
    expect(normalizeProfile({
      goals: [{ iso_n3: '724', intent: 'live', actor: 'landlord' }],
    }).goals).toEqual([{ iso_n3: '724', intent: 'live' }]);
  });

  test('household membership follows the facts the profile records', () => {
    expect(householdMembers(citizen('840')).map(m => m.actor)).toEqual(['self']);
    expect(householdMembers(profileOf({ partnerCitizenships: ['724'] })).map(m => m.actor))
      .toEqual(['self', 'partner']);
    expect(householdMembers(profileOf({
      partnerCitizenships: ['724'], intents: ['child_abroad'],
    })).map(m => m.actor)).toEqual(['self', 'partner', 'child']);
  });

  test('the household country count no longer moves with your own claims', () => {
    // Same partner, same answer: how many jurisdictions THEY add cannot depend
    // on whether you ticked a heritage box about yourself.
    const base = { flags: [{ iso_n3: '392', name: 'Japan', status: 'cit' as const }] };
    const plain = profileOf({ ...base, partnerCitizenships: ['724'] });
    const claimed = profileOf({
      ...base, partnerCitizenships: ['724'],
      heritages: ['israel_law_of_return', 'kazakhstan_qandas'],
      birthplace: '344',
    });
    expect(householdExtraCountries(claimed, data)).toBe(householdExtraCountries(plain, data));
  });
});

describe('the locked acceptance rules hold for every member, not just the applicant', () => {
  test('(c) the Samoan Quota stays out of every member\'s deterministic plan', () => {
    // Per-actor state multiplied the number of searches, so the allocation
    // filter has to hold in all of them: a ballot is not a plan for a partner or
    // a child either.
    const profile = profileOf({
      flags: [{ iso_n3: '882', name: 'Samoa', status: 'cit' }],
      partnerCitizenships: ['882'],
      intents: ['child_abroad'],
    });
    const solved = solveHousehold(profile, edges);
    expect(solved.members.size).toBe(3);
    for (const member of solved.members.values()) {
      for (const [, info] of member.paths) {
        expect(info.steps.some(s => s.mechanism === 'nz_samoan_quota')).toBe(false);
      }
    }
  });

  test('(d) a Brazilian pathway into a renunciation destination still shows the loss', () => {
    // The child is Brazilian by birth; the Kazakh claim is the parent's. Each
    // member's losses are their own.
    const profile = profileOf({
      flags: [{ iso_n3: '076', name: 'Brazil', status: 'cit' }],
      heritages: ['kazakhstan_qandas'],
      intents: ['child_abroad'],
    });
    const solved = solveHousehold(profile, edges);
    const mine = solved.members.get('self')!.paths.get('cit:398')!;
    expect(mine.renounces).toBe(true);
    expect(mine.lostCitizenships).toEqual(['076']);
    // The child keeps their Brazilian nationality: it is not the parent's to lose.
    const child = solved.members.get('child')!;
    expect(child.paths.get('cit:076')!.lostCitizenships).toEqual([]);
    expect(child.citizenshipAt.get('076')).toBe(0);
  });
});

describe('the household search stays inside a wall-clock ceiling', () => {
  test('a fully declared household on the worst-case profiles', () => {
    // The bound is members x rounds single-actor searches — at most six, never
    // the product of their state spaces. Worst case is a fully populated
    // household (self + partner + child) on an EU passport, which has the
    // largest frontier.
    for (const iso of ['233', '428', '756', '276']) {
      const profile = profileOf({
        flags: [{ iso_n3: iso, name: iso, status: 'cit' }],
        partnerCitizenships: ['840'],
        intents: ['child_abroad'],
      });
      const started = performance.now();
      const solved = solveHousehold(profile, edges);
      // ~1.6s locally for three members. 8000ms is 5x that: loose enough for a
      // noisy runner, tight enough to catch the joint-state-space regression
      // this design exists to avoid.
      expect(performance.now() - started).toBeLessThan(8000);
      expect(solved.rounds).toBeLessThanOrEqual(2);
      expect(solved.members.size).toBe(3);
    }
  }, 60_000);
});

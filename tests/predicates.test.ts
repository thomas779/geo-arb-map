import { describe, test, expect } from 'bun:test';
import type { BlocsData } from '../src/types';
import { EMPTY_PROFILE, type Profile } from '../src/lib/planner';
import { needsSatisfied, shortestPaths, type GraphEdge } from '../src/lib/pathfinder';
import {
  evaluatePredicate,
  predicateProblem,
  predicatesFromNeeds,
  predicatesSatisfied,
  PREDICATE_ATTRIBUTES,
  UnknownPredicateError,
  type AttributeRegistry,
  type Predicate,
} from '../src/lib/predicates';
// @ts-expect-error — plain-JS bun script, imported for its exported builder
import { buildEdges, validateBuiltEdges } from '../scripts/build_edges.js';

/**
 * The predicate gate model (src/lib/predicates.ts).
 *
 * The property under test throughout is that an unrecognised gate FAILS —
 * loudly, at build time or by throwing at solve time — rather than evaluating
 * to false and deleting its edge from the graph without a word, which is what
 * the flat `needs: string[]` interpreter did.
 */

const data = (await Bun.file(
  new URL('../public/blocs_data.json', import.meta.url),
).json()) as BlocsData;
const manual = await Bun.file(new URL('../data/manual_edges.json', import.meta.url)).json();
const corpus = await Bun.file(
  new URL('../data/compiled/citizenship_routes.json', import.meta.url),
).json();
const built = buildEdges(data, manual, corpus);
const edges: GraphEdge[] = built.edges;

const profileOf = (over: Partial<Profile>): Profile => ({ ...EMPTY_PROFILE, ...over });
const citizen = (iso: string) =>
  profileOf({ flags: [{ iso_n3: iso, name: iso, status: 'cit' }] });

describe('predicate validation fails the build', () => {
  const sound: Predicate = {
    subject: 'self', attribute: 'heritage', op: 'eq',
    value: 'israel_law_of_return', provenance: 'self_attested',
  };

  test('an unknown attribute is a build failure, not a dropped edge', () => {
    const rogue = { ...sound, attribute: 'favourite_colour' };
    expect(predicateProblem(rogue)).toContain('unknown attribute');

    // …and the build itself refuses it, naming the edge.
    const edge = {
      from: '*', to: 'cit:380', mechanism: 'invented_route',
      years: 0, allocation: 'right', confidence: 'high', needs: [],
      predicates: [rogue],
    };
    expect(() => validateBuiltEdges([...edges, edge])).toThrow(UnknownPredicateError);
    expect(() => validateBuiltEdges([edge])).toThrow(/invented_route.*favourite_colour/s);

    // The graph as actually built is clean.
    expect(() => validateBuiltEdges(edges)).not.toThrow();
  });

  test('every emitted edge carries predicates the solver can answer', () => {
    expect(edges.length).toBeGreaterThan(2000);
    for (const edge of edges) {
      expect(Array.isArray(edge.predicates)).toBe(true);
      for (const predicate of edge.predicates!) {
        expect(predicateProblem(predicate)).toBeNull();
      }
    }
    // The gated minority: 21 today, all of them derived from the legacy strings.
    const gated = edges.filter(e => (e.predicates ?? []).length > 0);
    expect(gated.length).toBe(edges.filter(e => e.needs.length > 0).length);
    for (const edge of gated) {
      expect(edge.predicates).toEqual(predicatesFromNeeds(edge.needs));
    }
  });

  test('an op the attribute cannot support is rejected', () => {
    expect(predicateProblem({ ...sound, op: 'gte', value: 2 }))
      .toMatch(/set-valued and does not support op gte/);
    expect(predicateProblem({ ...sound, op: 'in', value: [] }))
      .toMatch(/non-empty array/);
    expect(predicateProblem({ ...sound, op: 'sounds_like' as never }))
      .toMatch(/unknown op/);
    expect(predicateProblem({ ...sound, provenance: 'vibes' as never }))
      .toMatch(/unknown provenance/);
  });

  test('household subjects are expressible but rejected until step 2 reads them', () => {
    // The type admits them — that is the point of `subject` — but nothing can
    // evaluate a parent or child fact yet, so writing one into the data must
    // fail the build rather than quietly evaluating false.
    const partner: Predicate = {
      subject: 'partner', attribute: 'citizenship', op: 'eq',
      value: '724', provenance: 'sourced',
    };
    expect(predicateProblem(partner)).toBeNull();

    for (const subject of ['parent', 'child'] as const) {
      const problem = predicateProblem({ ...partner, subject });
      expect(problem).toContain(`cannot be read for subject ${subject}`);
      expect(problem).toContain('household solver');
    }
  });
});

describe('provenance is carried, not inferred', () => {
  test('a self-attested gate is distinguishable from a sourced one', () => {
    const lawOfReturn = edges.find(e => e.to === 'cit:376' && (e.predicates ?? []).length);
    expect(lawOfReturn?.predicates).toEqual([{
      subject: 'self', attribute: 'heritage', op: 'eq',
      value: 'israel_law_of_return', provenance: 'self_attested',
    }]);

    // A statute's qualifying-nationality list is sourced: the law names it.
    const conditional = edges.find(e =>
      e.mechanism === 'naturalization' && (e.predicates ?? []).length);
    expect(conditional?.predicates?.[0]).toMatchObject({
      attribute: 'citizenship', op: 'in', provenance: 'sourced',
    });

    // A ticked ancestry box is sourced on the LAW side (the descent route is in
    // the corpus); a heritage claim has no verifiable counterpart, so the two
    // gate families genuinely differ and the field must survive the build.
    const byProvenance = new Set(
      edges.flatMap(e => e.predicates ?? []).map(p => p.provenance),
    );
    expect([...byProvenance].sort()).toEqual(['self_attested', 'sourced']);
  });
});

describe('the legacy string gates still evaluate identically', () => {
  /** The interpreter this change replaced, verbatim, as the oracle. */
  const legacyNeedsSatisfied = (
    needs: string[],
    profile: Profile,
    citizenships: ReadonlySet<string>,
  ): boolean => needs.every(n => {
    if (n.startsWith('ancestor:')) return profile.ancestors.includes(n.slice(9));
    if (n.startsWith('heritage:')) return profile.heritages.includes(n.slice(9));
    if (n.startsWith('citizenship_any:')) {
      return n.slice(16).split(',').some(iso => citizenships.has(iso));
    }
    if (n === 'willing_child_abroad') return false;
    return false;
  });

  const gates = [
    [],
    ['ancestor:380'],
    ['ancestor:372'],
    ['heritage:israel_law_of_return'],
    ['heritage:kazakhstan_qandas'],
    ['citizenship_any:620,724'],
    ['citizenship_any:840'],
    ['ancestor:380', 'citizenship_any:620,724'],
  ];
  const profiles: Array<[string, Profile, ReadonlySet<string>]> = [
    ['empty', EMPTY_PROFILE, new Set()],
    ['us citizen', citizen('840'), new Set(['840'])],
    ['italian ancestry', profileOf({ ancestors: ['380'] }), new Set()],
    ['irish ancestry, holds pt', profileOf({ ancestors: ['372'] }), new Set(['620'])],
    ['law of return', profileOf({ heritages: ['israel_law_of_return'] }), new Set()],
    ['both claims', profileOf({
      ancestors: ['380', '372'],
      heritages: ['israel_law_of_return', 'kazakhstan_qandas'],
    }), new Set(['620', '840'])],
  ];

  test('the four known forms agree with the old interpreter, gate by gate', () => {
    for (const [label, profile, citizenships] of profiles) {
      for (const gate of gates) {
        expect(
          needsSatisfied(gate, profile, citizenships),
          `${label} × ${JSON.stringify(gate)}`,
        ).toBe(legacyNeedsSatisfied(gate, profile, citizenships));
      }
    }
  });

  test('an unknown gate string throws instead of silently failing the edge', () => {
    // The old interpreter returned false here, which removed the edge from the
    // graph with no error — the whole reason for this change.
    expect(legacyNeedsSatisfied(['spouse_of:724'], EMPTY_PROFILE, new Set())).toBe(false);
    expect(() => needsSatisfied(['spouse_of:724'], EMPTY_PROFILE, new Set()))
      .toThrow(UnknownPredicateError);
    expect(() => predicatesFromNeeds(['spouse_of:724'])).toThrow(/unknown legacy gate/);
  });

  test('a hand-built edge with an unreadable gate throws at search time', () => {
    const rogue: GraphEdge = {
      from: 'cit:840', to: 'cit:724', mechanism: 'made_up',
      years: 0, allocation: 'right', confidence: 'high',
      needs: ['married_to_a_spaniard'],
    };
    expect(() => shortestPaths(citizen('840'), [rogue])).toThrow(UnknownPredicateError);
  });
});

describe('willing_child_abroad is a real predicate now', () => {
  const gate = predicatesFromNeeds(['willing_child_abroad']);

  test('it reads Profile.intents rather than hard-returning false', () => {
    expect(gate).toEqual([{
      subject: 'self', attribute: 'intent', op: 'eq',
      value: 'child_abroad', provenance: 'self_attested',
    }]);
    const ctx = (profile: Profile) => ({ profile, citizenships: new Set<string>() });
    expect(predicatesSatisfied(gate, ctx(citizen('840')))).toBe(false);
    expect(predicatesSatisfied(gate, ctx(profileOf({ intents: ['child_abroad'] })))).toBe(true);
  });

  test('the child-birth accelerators become reachable when the intent is declared', () => {
    const without = shortestPaths(citizen('840'), edges);
    const with_ = shortestPaths(
      profileOf({
        flags: [{ iso_n3: '840', name: 'United States', status: 'cit' }],
        intents: ['child_abroad'],
      }),
      edges,
    );
    // Mexico is not reachable at all from a US passport without the event —
    // these three edges were dead weight in the graph until now.
    expect(without.has('cit:484')).toBe(false);
    expect(with_.get('cit:484')!.years).toBe(2);
    expect(with_.get('cit:484')!.steps.some(s => s.mechanism === 'mexico_child_parent_naturalization'))
      .toBe(true);
  });

  test('an undeclared intent changes nothing about the shipped graph', () => {
    // The gate is opt-in, so a profile that has not declared it must reach
    // exactly what it reached before the predicate existed.
    const before = shortestPaths(citizen('840'), edges);
    const accelerators = new Set(
      edges.filter(e => (e.needs ?? []).includes('willing_child_abroad')).map(e => e.mechanism),
    );
    expect(accelerators.size).toBe(3);
    for (const [, info] of before) {
      expect(info.steps.some(s => accelerators.has(s.mechanism))).toBe(false);
    }
  });
});

describe('the model can express what the corpus records', () => {
  test('ordinal attributes evaluate as thresholds, not as set membership', () => {
    // No ordinal attribute is registered yet (the profile records no generation
    // depth), so the ordinal half of the model is exercised through a registry
    // shaped exactly like the real one. This is what a `descent_degree` gate —
    // "an ancestor no further back than the third generation" — would look like.
    const registry: AttributeRegistry = {
      ...PREDICATE_ATTRIBUTES,
      ancestry_degree: {
        kind: 'ordinal',
        subjects: ['self'],
        ops: ['gte', 'lte', 'exists'],
        describe: 'generations back to the qualifying ancestor',
        read: (_subject, ctx) => ({
          kind: 'ordinal',
          value: ctx.profile.ancestors.length ? ctx.profile.ancestors.length : null,
        }),
      },
    };
    const ctx = { profile: profileOf({ ancestors: ['380', '372'] }), citizenships: new Set<string>() };
    const p = (op: 'gte' | 'lte' | 'exists', value: unknown): Predicate => ({
      subject: 'self', attribute: 'ancestry_degree', op, value, provenance: 'sourced',
    });
    expect(evaluatePredicate(p('lte', 3), ctx, registry)).toBe(true);
    expect(evaluatePredicate(p('lte', 1), ctx, registry)).toBe(false);
    expect(evaluatePredicate(p('gte', 2), ctx, registry)).toBe(true);
    expect(evaluatePredicate(p('exists', null), ctx, registry)).toBe(true);

    // Unknown is never zero: a profile with no answer fails a threshold rather
    // than passing one.
    const blank = { profile: EMPTY_PROFILE, citizenships: new Set<string>() };
    expect(evaluatePredicate(p('lte', 3), blank, registry)).toBe(false);
    expect(evaluatePredicate(p('exists', null), blank, registry)).toBe(false);

    // And the ordinal attribute still refuses categorical ops.
    expect(predicateProblem(p('eq' as never, 2), registry))
      .toMatch(/ordinal-valued and does not support op eq/);
  });

  test("a partner's nationality is readable today", () => {
    const p: Predicate = {
      subject: 'partner', attribute: 'citizenship', op: 'in',
      value: ['724', '620'], provenance: 'sourced',
    };
    const ctx = (partnerCitizenships: string[]) => ({
      profile: profileOf({ partnerCitizenships }),
      citizenships: new Set<string>(),
    });
    expect(evaluatePredicate(p, ctx(['724']))).toBe(true);
    expect(evaluatePredicate(p, ctx(['840']))).toBe(false);
    // …and is NOT confused with the applicant's own set, which is what makes
    // this a household variable rather than a second spelling of `self`.
    expect(evaluatePredicate(p, { profile: citizen('724'), citizenships: new Set(['724']) }))
      .toBe(false);
  });
});

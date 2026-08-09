import { describe, test, expect } from 'bun:test';
import { DESCENT_REACH, descentReach, deriveDescentRelations } from '../scripts/lib/descent-relations';
import { descentRelationLabel, DESCENT_PATHS } from '../src/lib/timeline-rules';
import type { DescentReach } from '../src/types';

const cond = (field: string, operator = 'eq', value: unknown = true) => ({ field, operator, value });

describe('descent relation derivation', () => {
  test('reads the generation out of the field name', () => {
    expect(deriveDescentRelations([cond('parent.citizenship.iso_n3', 'eq', '616')])).toEqual({
      relations: ['parent'],
      deepest_recorded_degree: 1,
      maximum_degree: null,
      limit_recorded: false,
      origin_based: false,
    });
    expect(
      deriveDescentRelations([cond('grandparent.birth.island_of_ireland')])?.deepest_recorded_degree,
    ).toBe(2);
    // The generation sits inside a longer segment here, not as its own token.
    expect(
      deriveDescentRelations([cond('heritage.portuguese_great_grandparent')])?.relations,
    ).toEqual(['great_grandparent']);
  });

  test('great_grandparent is never misread as grandparent', () => {
    // A naive substring check matches "grandparent" inside "great_grandparent" and
    // would under-report the depth by a generation.
    const finding = deriveDescentRelations([cond('heritage.portuguese_great_grandparent')]);
    expect(finding?.relations).not.toContain('grandparent');
    expect(finding?.deepest_recorded_degree).toBe(3);
  });

  test('splits a disjunctive segment so both sides are recorded', () => {
    // Saint Lucia, Chile and Sao Tome all use this shape, and it covers two degrees
    // in one boolean.
    const finding = deriveDescentRelations([cond('parent_or_grandparent.citizenship.iso_n3', 'eq', '152')]);
    expect(finding?.relations).toEqual(['parent', 'grandparent']);
    expect(finding?.deepest_recorded_degree).toBe(2);

    // Hungary: a parent qualifies, and so does an unspecified ancestor.
    const hungary = deriveDescentRelations([cond('parent_or_ancestor.hungarian_citizenship_or_origin')]);
    expect(hungary?.relations).toEqual(['parent', 'ancestor_unspecified']);
    // An open-ended ancestor has no degree, so the deepest PROVEN generation is
    // still the parent. It must not silently become Infinity or null.
    expect(hungary?.deepest_recorded_degree).toBe(1);
  });

  test('absence of a deeper relation is never a cutoff', () => {
    // The load-bearing rule. Italy records only a parent condition, yet Italian law
    // transmits without a generational limit subject to the 1948 and 2025 rules.
    // Deriving maximum_degree: 1 here would invent a restriction and tell users with
    // an Italian great-grandparent that they do not qualify.
    const italy = deriveDescentRelations([
      cond('parent.citizenship.iso_n3', 'eq', '380'),
      cond('italy.post_2025_connection_exception'),
    ]);
    expect(italy?.maximum_degree).toBeNull();
    expect(italy?.limit_recorded).toBe(false);
  });

  test('an authored numeric bound is the only source of a maximum', () => {
    // Bulgaria is the sole route in the corpus with a real generational ceiling.
    const bulgaria = deriveDescentRelations([
      cond('ancestor.bulgarian_origin_degree', 'lte', 3),
    ]);
    expect(bulgaria?.maximum_degree).toBe(3);
    expect(bulgaria?.limit_recorded).toBe(true);
    expect(bulgaria?.relations).toContain('ancestor_unspecified');

    // `lt` is exclusive, so the deepest qualifying generation is one shallower.
    expect(deriveDescentRelations([cond('x.degree', 'lt', 3)])?.maximum_degree).toBe(2);
    // The tightest bound wins when several are present.
    expect(
      deriveDescentRelations([cond('a.degree', 'lte', 4), cond('b.degree', 'lte', 2)])?.maximum_degree,
    ).toBe(2);
  });

  test('a ceiling stated in prose is authored, and the tightest bound still wins', () => {
    // Poland writes its cutoff as words, not as a degree field: "at least one of
    // her parents or grandparents, or two great-grandparents". The derivation reads
    // only lte/lt operators, so before this field the corpus recorded exactly one
    // ceiling across 238 ancestry routes and B2b could never move.
    const poland = deriveDescentRelations(
      [cond('parent.citizenship.iso_n3', 'eq', '616')],
      {
        relations: ['parent', 'grandparent', 'great_grandparent'],
        origin_based: true,
        maximum_degree: 3,
        basis: 'Ustawa o repatriacji art. 5 ust. 1 pkt 1',
      },
    );
    expect(poland?.maximum_degree).toBe(3);
    expect(poland?.limit_recorded).toBe(true);

    // Cabo Verde names a trineto — a great-great-grandchild — a generation the
    // relation enum cannot express. The numeric ceiling must not be clamped to the
    // deepest nameable relation, or the map understates the route by a generation.
    const caboVerde = deriveDescentRelations(
      [cond('parent.citizenship.iso_n3', 'eq', '132')],
      {
        relations: ['parent', 'grandparent', 'great_grandparent'],
        maximum_degree: 4,
        basis: 'Lei 33/X/2023 art. 8 n. 1 al. e)',
      },
    );
    expect(caboVerde?.maximum_degree).toBe(4);
    expect(caboVerde?.deepest_recorded_degree).toBe(3);

    // An authored ceiling and a derived one are the same kind of claim, so the
    // tighter of the two wins rather than whichever was read last.
    expect(
      deriveDescentRelations([cond('x.degree', 'lte', 2)], { maximum_degree: 4, basis: 'x' })?.maximum_degree,
    ).toBe(2);
  });

  test('a ceiling and no-limit cannot both be authored', () => {
    // The two say opposite things about one provision, so one of them was read
    // wrong. Failing at build time beats publishing either.
    expect(() => deriveDescentRelations(
      [cond('parent.citizenship.iso_n3', 'eq', '616')],
      { unlimited: true, maximum_degree: 3, basis: 'contradictory' },
    )).toThrow(/unlimited and capped/);
  });

  test('a stated ceiling is never taken from a list that merely stops', () => {
    // Slovakia and Ukraine each state a great-grandparent tier on ONE limb while a
    // second instrument reaches an unspecified ancestor with no cutoff. Recording
    // maximum_degree 3 there would cap a limb the statute leaves open — the exact
    // inversion this module exists to prevent — so neither authors a ceiling.
    const ukraine = deriveDescentRelations(
      [cond('parent.citizenship.iso_n3', 'eq', '804')],
      {
        relations: ['parent', 'grandparent', 'great_grandparent', 'ancestor_unspecified'],
        origin_based: true,
        basis: 'stattia 8 names the generations; the foreign-Ukrainian limb states no cutoff',
      },
    );
    expect(ukraine?.maximum_degree).toBeNull();
    expect(ukraine?.limit_recorded).toBe(false);
  });

  test('non-ancestral and opaque conditions contribute nothing', () => {
    // Ethnic-origin claims carry no generation. `natural_born` describes the
    // APPLICANT's prior status, not an ancestor, so Philippines records only parent.
    expect(deriveDescentRelations([cond('heritage.armenian_ethnic_origin')])).toBeNull();
    expect(deriveDescentRelations([cond('family.third_generation_conditions_met')])).toBeNull();
    expect(deriveDescentRelations([cond('residence.months', 'gte', 60)])).toBeNull();
    expect(
      deriveDescentRelations([cond('parent_or_natural_born.filipino_citizenship')])?.relations,
    ).toEqual(['parent']);
  });

  test('returns null rather than an empty finding when there is no descent signal', () => {
    // Callers must be able to tell "no ancestral condition recorded" apart from
    // "qualifies at parent level", so this cannot collapse to a default.
    expect(deriveDescentRelations([])).toBeNull();
  });

  test('father and mother count as parent, and duplicates collapse', () => {
    // Jordan uses `father.citizenship`; gendered transmission is a separate finding
    // from depth and must not change the degree.
    expect(deriveDescentRelations([cond('father.citizenship.iso_n3', 'eq', '400')])?.relations).toEqual([
      'parent',
    ]);
    expect(
      deriveDescentRelations([
        cond('parent.citizenship.iso_n3', 'eq', '380'),
        cond('parent.birth.island_of_ireland'),
      ])?.relations,
    ).toEqual(['parent']);
  });

  test('relations come back in generation order, not insertion order', () => {
    // Stable output keeps the projected artifact deterministic.
    const finding = deriveDescentRelations([
      cond('ancestor.citizenship.iso_n3', 'eq', '470'),
      cond('grandparent.birth.island_of_ireland'),
      cond('parent.citizenship.iso_n3', 'eq', '372'),
    ]);
    expect(finding?.relations).toEqual(['parent', 'grandparent', 'ancestor_unspecified']);
  });
});

describe('descent relation labels reach the planner', () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    iso_n3: '380',
    route_id: 'x',
    duration_months: 18,
    gate: 'ancestor',
    confidence: 'legacy' as const,
    ...over,
  });

  test('names the relation instead of asserting an unconditional path', () => {
    expect(descentRelationLabel(rule({ relations: ['parent'] }))).toBe('parent');
    expect(descentRelationLabel(rule({ relations: ['parent', 'grandparent'] })))
      .toBe('parent or grandparent');
    expect(descentRelationLabel(rule({ relations: ['parent', 'grandparent', 'great_grandparent'] })))
      .toBe('parent, grandparent or great-grandparent');
  });

  test('an open-ended ancestor is said out loud, not silently dropped', () => {
    // Hungary: `parent_or_ancestor`. Rendering only "parent" would understate the
    // route and could talk a qualifying applicant out of it.
    expect(descentRelationLabel(rule({ relations: ['parent', 'ancestor_unspecified'] })))
      .toBe('parent, or a wider ancestor');
    expect(descentRelationLabel(rule({ relations: ['ancestor_unspecified'] })))
      .toBe('a qualifying ancestor');
  });

  test('an authored ceiling is stated as a generation count', () => {
    expect(descentRelationLabel(rule({ relations: ['ancestor_unspecified'], maximum_degree: 3 })))
      .toBe('ancestor up to 3 generations back');
  });

  test('no relations means no claim at all', () => {
    // Ethnic-origin claims must render nothing rather than a vague placeholder.
    expect(descentRelationLabel(rule())).toBeNull();
    expect(descentRelationLabel(rule({ relations: [] }))).toBeNull();
  });

  test('the shipped rule table carries relations for the descent routes', () => {
    // Guards the build step: if attachDescentRelations stops running, Ireland's
    // grandparent track silently reverts to an unlabelled 18-month claim.
    const ireland = DESCENT_PATHS.find(path => path.route_id === 'ireland-citizenship-by-descent');
    expect(ireland?.relations).toEqual(['parent', 'grandparent']);
    expect(descentRelationLabel(ireland!)).toBe('parent or grandparent');
    // And the honest caveat survives: nothing in the table records a cutoff.
    expect(DESCENT_PATHS.some(path => path.limit_recorded)).toBe(false);
  });
});

describe('reach: what the ancestry facet should actually show (#191)', () => {
  // The facet highlighted 232 of 240 jurisdictions, because every country
  // transmits to the child of a citizen. The useful question is narrower:
  // grandparent-or-deeper, or ethnic/diaspora ties.

  test('an origin test is not a generation', () => {
    // Germany's Spätaussiedler route asks about ethnic German affiliation, not
    // about descent from a German citizen, so it records no ancestral relation at
    // all and previously derived to null — invisible in every ancestry facet.
    const germany = deriveDescentRelations(
      [{ field: 'heritage.ethnic_german_resettler', operator: 'eq', value: true }],
      { origin_based: true, basis: 'Federal Expellees Act' },
    );
    expect(germany).not.toBeNull();
    expect(germany!.relations).toEqual([]);
    expect(descentReach(germany)).toBe('origin_based');
  });

  test('origin wins over degree when a route carries both', () => {
    // Israel transmits by descent under the Nationality Law AND by Jewish status
    // under the Law of Return. Origin is the limb people are searching for, so a
    // route carrying both files under origin rather than under its degree.
    const israel = deriveDescentRelations(
      [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '376' }],
      { relations: ['parent', 'grandparent'], origin_based: true, basis: 'Law of Return s.4A' },
    );
    expect(descentReach(israel)).toBe('origin_based');
    // The authored grandchild limb is still recorded, not swallowed by the bucket.
    expect(israel!.relations).toContain('grandparent');
  });

  test('an authored limb is traceable', () => {
    // A value that cannot be traced to a provision is indistinguishable from a
    // guess, which is the failure this whole corpus is organised against.
    const finding = deriveDescentRelations(
      [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '376' }],
      { relations: ['grandparent'], basis: 'Law of Return s.4A' },
    );
    expect(finding!.authored_basis).toContain('s.4A');
  });

  test('nothing recorded reads as not_recorded, never as parent_only', () => {
    // 223 routes sit at degree 1 mostly because nobody authored a deeper limb, not
    // because one was checked for and ruled out. Collapsing those two states is how
    // a facet publishes a confident wrong answer for the jurisdictions users most
    // care about.
    expect(descentReach(null)).toBe('not_recorded');
    expect(descentReach(deriveDescentRelations([{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '008' }])))
      .toBe('parent_only');
  });

  test('a grandparent limb buckets separately from a parent one', () => {
    const ireland = deriveDescentRelations([
      { field: 'grandparent.birth.island_of_ireland', operator: 'eq', value: true },
    ]);
    expect(descentReach(ireland)).toBe('grandparent_or_deeper');
  });

  test('the browser copy of the reach union has not drifted', () => {
    // src/ never imports from scripts/, so `DescentReach` is duplicated in
    // src/types.ts and the facet paints from that copy. Both assignments below are
    // compile-time checks, one in each direction: a bucket added to the derivation
    // and never listed for the browser would silently paint nothing.
    const forBrowser: DescentReach[] = [...DESCENT_REACH];
    const forDerivation: (typeof DESCENT_REACH)[number] = 'not_recorded' as DescentReach;
    expect(forBrowser).toHaveLength(DESCENT_REACH.length);
    expect(forDerivation).toBe('not_recorded');
  });

  test('unlimited is authored, never inferred from silence', () => {
    // The module's founding rule: a `parent.*` condition proves a parent qualifies,
    // it does not prove a grandparent fails. So an unlimited reading must come from
    // the instrument saying so, and a bare parent condition must NOT produce it.
    const silent = deriveDescentRelations([{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '380' }]);
    expect(descentReach(silent)).toBe('parent_only');
    const stated = deriveDescentRelations(
      [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '380' }],
      { unlimited: true, basis: 'the instrument states no generational cutoff' },
    );
    expect(descentReach(stated)).toBe('unlimited');
  });
});

import { describe, test, expect } from 'bun:test';
import { deriveDescentRelations } from '../scripts/lib/descent-relations';
import { descentRelationLabel, DESCENT_PATHS } from '../src/lib/timeline-rules';

const cond = (field: string, operator = 'eq', value: unknown = true) => ({ field, operator, value });

describe('descent relation derivation', () => {
  test('reads the generation out of the field name', () => {
    expect(deriveDescentRelations([cond('parent.citizenship.iso_n3', 'eq', '616')])).toEqual({
      relations: ['parent'],
      deepest_recorded_degree: 1,
      maximum_degree: null,
      limit_recorded: false,
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

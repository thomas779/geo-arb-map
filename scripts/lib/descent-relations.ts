/**
 * Derive which ancestral relations a descent route records as qualifying.
 *
 * Background: the corpus encodes descent degree in eligibility *field names*
 * rather than values. `parent.citizenship.iso_n3`, `grandparent.birth.island_of_ireland`,
 * `heritage.portuguese_great_grandparent` and `parent_or_grandparent.citizenship.iso_n3`
 * all carry a generation in the identifier, and `data-build` drops the whole
 * `eligibility` array before publication, so no consumer can see any of it. This
 * module re-encodes that authored signal into a typed field.
 *
 * It is a re-encoding, not a new fact: every value traces to an eligibility
 * condition somebody authored from an instrument.
 *
 * THE CRITICAL DISTINCTION, and the reason this is not simply a max() over degrees:
 * a `parent.*` condition proves a parent QUALIFIES. It does not prove a grandparent
 * FAILS. Italy records only `parent.citizenship.iso_n3`, yet Italian law transmits
 * without a generational limit subject to the 1948 and 2025 rules. Deriving
 * `maximum_degree: 1` from that would invent a restriction the corpus never
 * recorded, which `canonical-schema.ts` forbids: "omission means not recorded and
 * must never be treated as a negative finding".
 *
 * So `relations` is positive-only, and `maximum_degree` is populated ONLY from an
 * authored numeric bound (an `lte`/`lt` operator on a degree field). Corpus-wide
 * exactly one route has that today: Bulgaria's `ancestor.bulgarian_origin_degree lte 3`.
 */

export const DESCENT_RELATIONS = [
  'parent',
  'grandparent',
  'great_grandparent',
  'ancestor_unspecified',
] as const;

export type DescentRelation = (typeof DESCENT_RELATIONS)[number];

/** Generation count, where the applicant is 0. Open-ended relations have no degree. */
const DEGREE: Record<DescentRelation, number | null> = {
  parent: 1,
  grandparent: 2,
  great_grandparent: 3,
  ancestor_unspecified: null,
};

export interface DescentRelationsFinding {
  /** Relations an authored condition records as qualifying. Positive-only, sorted. */
  relations: DescentRelation[];
  /** Deepest generation proven to qualify. null when only open-ended conditions exist. */
  deepest_recorded_degree: number | null;
  /** An authored ceiling. Populated only from a numeric bound in the instrument. */
  maximum_degree: number | null;
  /**
   * False means no cutoff is recorded, NOT that there is no cutoff. Anything
   * scoring this must treat false as unknown, per the spec rule that unrecorded
   * is never zero.
   */
  limit_recorded: boolean;
}

/**
 * Tokens that denote a generation when they appear as a field-name segment.
 * Deliberately small: ethnic-origin claims (`heritage.armenian_ethnic_origin`),
 * opaque booleans (`family.third_generation_conditions_met`) and applicant-side
 * status (`parent_or_natural_born.filipino_citizenship`, where `natural_born`
 * describes the applicant rather than an ancestor) contribute nothing, so those
 * routes record whichever relations they do name and leave the rest unknown.
 */
const TOKEN_TO_RELATION: Array<[RegExp, DescentRelation]> = [
  // Longest first: great_grandparent must not be matched as grandparent.
  [/^great[_-]?grand(parent|father|mother)$/, 'great_grandparent'],
  [/^grand(parent|father|mother)$/, 'grandparent'],
  [/^(parent|father|mother)$/, 'parent'],
  [/^ancestor$/, 'ancestor_unspecified'],
];

/** A degree field carrying an authored numeric ceiling, e.g. `*_degree lte 3`. */
const DEGREE_FIELD = /(^|[._])degree$/;

type Condition = { field: string; operator: string; value: unknown };

function relationsFromField(field: string): DescentRelation[] {
  const found = new Set<DescentRelation>();
  // Field names are dot-separated identifiers, and a single segment may itself be
  // a disjunction: `parent_or_grandparent`, `parent_or_ancestor`. Split on both so
  // each side is classified independently.
  for (const segment of field.split('.')) {
    for (const token of segment.split('_or_')) {
      for (const [pattern, relation] of TOKEN_TO_RELATION) {
        if (pattern.test(token)) {
          found.add(relation);
          break;
        }
      }
    }
  }
  // `heritage.portuguese_great_grandparent` puts the generation inside a longer
  // segment, so fall back to a substring check when no whole token matched.
  if (found.size === 0) {
    if (/great[_-]?grandparent/.test(field)) found.add('great_grandparent');
    else if (/grandparent/.test(field)) found.add('grandparent');
  }
  return [...found];
}

/**
 * @param conditions every eligibility condition across the route's variants.
 * @returns null when the route records no ancestral relation at all, so callers
 *   can distinguish "no descent signal" from "descent at parent level".
 */
export function deriveDescentRelations(conditions: Condition[]): DescentRelationsFinding | null {
  const relations = new Set<DescentRelation>();
  let maximumDegree: number | null = null;

  for (const condition of conditions) {
    for (const relation of relationsFromField(condition.field)) relations.add(relation);

    if (
      DEGREE_FIELD.test(condition.field)
      && (condition.operator === 'lte' || condition.operator === 'lt')
      && typeof condition.value === 'number'
    ) {
      // `lt` is exclusive, so the deepest qualifying generation is one shallower.
      const ceiling = condition.operator === 'lt' ? condition.value - 1 : condition.value;
      maximumDegree = maximumDegree === null ? ceiling : Math.min(maximumDegree, ceiling);
      // A numeric degree bound implies ancestors beyond the named relations qualify
      // up to that depth, which is exactly the open-ended case.
      relations.add('ancestor_unspecified');
    }
  }

  if (relations.size === 0) return null;

  const degrees = [...relations]
    .map(relation => DEGREE[relation])
    .filter((degree): degree is number => degree !== null);

  return {
    relations: DESCENT_RELATIONS.filter(relation => relations.has(relation)),
    deepest_recorded_degree: degrees.length ? Math.max(...degrees) : null,
    maximum_degree: maximumDegree,
    limit_recorded: maximumDegree !== null,
  };
}

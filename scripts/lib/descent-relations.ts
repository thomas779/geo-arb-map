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
 * So `relations` is positive-only, and `maximum_degree` is populated ONLY from a
 * bound the instrument states: either a numeric `lte`/`lt` operator on a degree
 * field (corpus-wide, only Bulgaria's `ancestor.bulgarian_origin_degree lte 3`), or
 * an explicitly authored `maximum_degree` for a cutoff written in prose, which is
 * the shape most instruments use. Both are readings of a stated rule; neither may
 * come from an enumeration that merely stops.
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
  /**
   * The route qualifies on ETHNIC OR NATIONAL ORIGIN rather than on descent from a
   * citizen. Deliberately not a degree, because it is not a generation: the Law of
   * Return, Spätaussiedler recognition and the Armenian/Bulgarian/Kyrgyz origin
   * routes ask what you ARE, not how many generations back a citizen sits. Forcing
   * them onto the degree scale is why Israel derived as `parent` and Germany's
   * Spätaussiedler route derived as nothing at all.
   */
  origin_based: boolean;
  /** Set when any part of this finding was authored rather than derived. */
  authored_basis?: string;
}

/**
 * A limb the instrument states but the eligibility conditions do not encode.
 *
 * The derivation reads field NAMES, so a limb described only in prose is invisible.
 * Israel is the worked case: its summary says the Law of Return extends "to a child
 * and grandchild of a Jew", while its only authored condition names a parent.
 *
 * Same discipline as the derivation: positive-only. `unlimited` may be set only
 * where the instrument states no generational cutoff, never inferred from the
 * absence of one — the difference between "the law says it keeps going" and
 * "nobody wrote down where it stops".
 */
export interface AuthoredDescent {
  relations?: DescentRelation[];
  origin_based?: boolean;
  /** The instrument states no generational limit. Never inferred from silence. */
  unlimited?: boolean;
  /**
   * A ceiling the instrument STATES, expressed as a generation count where the
   * applicant is 0. The derivation can only see a numeric bound written as an
   * `lte`/`lt` operator on a degree field — corpus-wide exactly one route, Bulgaria.
   * A cutoff written in prose ("at least one of her parents or grandparents, or two
   * great-grandparents") is invisible to it, which is why `B2b Descent CEILING` sat
   * at 1 of 238.
   *
   * Same positive-only rule as everything else here, and this field is where it
   * bites hardest: set it ONLY where the instrument closes the list. Never from an
   * enumeration that merely stops, never from silence, and never on a route that
   * also carries an unbounded limb — Slovakia and Ukraine each state a
   * great-grandparent ceiling on one limb while a second instrument reaches an
   * unspecified ancestor with no cutoff, so neither records a maximum.
   *
   * May exceed the `DESCENT_RELATIONS` enum: Cabo Verde names `trineto`, a
   * great-great-grandchild, which is a generation the relation list cannot express.
   */
  maximum_degree?: number;
  /** Why, citing the provision. Required, so an authored value is always traceable. */
  basis: string;
}

/** What a consumer shows. `not_recorded` is first-class, never collapsed to "parent only". */
export const DESCENT_REACH = [
  'origin_based',
  'unlimited',
  'grandparent_or_deeper',
  'parent_only',
  'not_recorded',
] as const;

export type DescentReach = (typeof DESCENT_REACH)[number];

/**
 * Bucket a finding for presentation.
 *
 * Ordering matters. `origin_based` wins over any degree because an origin test is a
 * different question, and a route can carry both — Israel transmits by descent AND
 * by origin, and origin is the limb users are looking for. A null finding returns
 * `not_recorded` rather than `parent_only`, because 223 routes sit at degree 1
 * mostly because no deeper limb was ever authored, not because one was checked for
 * and ruled out.
 */
export function descentReach(finding: DescentRelationsFinding | null): DescentReach {
  if (!finding) return 'not_recorded';
  if (finding.origin_based) return 'origin_based';
  if (finding.relations.includes('ancestor_unspecified') && finding.maximum_degree === null) {
    return 'unlimited';
  }
  const deepest = finding.deepest_recorded_degree;
  if (deepest !== null && deepest >= 2) return 'grandparent_or_deeper';
  if (deepest === 1) return 'parent_only';
  return 'not_recorded';
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
export function deriveDescentRelations(
  conditions: Condition[],
  authored?: AuthoredDescent,
): DescentRelationsFinding | null {
  const relations = new Set<DescentRelation>();
  // An authored ceiling and a derived one are the same kind of fact — a bound the
  // instrument states — so they share one slot and the tightest wins below.
  let maximumDegree: number | null = authored?.maximum_degree ?? null;
  if (authored?.unlimited && maximumDegree !== null) {
    throw new Error(
      `authored descent cannot be both unlimited and capped at ${maximumDegree}: ${authored.basis}`,
    );
  }
  for (const relation of authored?.relations ?? []) relations.add(relation);
  // An instrument stating no cutoff is an open-ended ancestor claim, which is what
  // `ancestor_unspecified` with no ceiling already means. Reuse it rather than add a
  // second way to say the same thing.
  if (authored?.unlimited) relations.add('ancestor_unspecified');

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

  // An origin-based route legitimately records no ancestral relation — Spätaussiedler
  // asks about ethnicity, not about a citizen ancestor — so it must still produce a
  // finding rather than falling through to null.
  if (relations.size === 0 && !authored?.origin_based) return null;

  const degrees = [...relations]
    .map(relation => DEGREE[relation])
    .filter((degree): degree is number => degree !== null);

  return {
    relations: DESCENT_RELATIONS.filter(relation => relations.has(relation)),
    deepest_recorded_degree: degrees.length ? Math.max(...degrees) : null,
    maximum_degree: maximumDegree,
    limit_recorded: maximumDegree !== null,
    origin_based: authored?.origin_based ?? false,
    ...(authored ? { authored_basis: authored.basis } : {}),
  };
}

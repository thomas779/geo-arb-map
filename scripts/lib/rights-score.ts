/**
 * Composite scoring primitives for the rights index (docs/rights-index-spec.md).
 *
 * This module exists because of one measured fact: most of the index's inputs are
 * missing. `bun run index:audit` reports 4 of 15 dimensions scoreable, four schemas
 * fully built with zero rows, and two with no schema at all. A scorer that read
 * absence as a zero would rank every country identically low while looking precise,
 * which is exactly the unfalsifiable number this index exists to replace.
 *
 * So the rules from the spec are enforced here rather than left to each caller:
 *
 *  1. UNRECORDED IS NEVER ZERO. A null value is excluded from the mean and from its
 *     denominator. It never becomes a 0, and it never becomes a favourable default
 *     (no recorded conscription must not read as "no conscription").
 *  2. COMPLETENESS TRAVELS WITH THE SCORE. Every result carries the share of weight
 *     actually scored, so a rank resting on 2 of 7 dimensions is visibly weaker.
 *  3. A COMPOSITE CANNOT OUTRANK ITS WEAKEST MATERIAL INPUT on confidence.
 *
 * The consequence of rule 1 is worth stating plainly, because it looks like a bug
 * until you see why: renormalising over scored dimensions means a country measured
 * only on its strongest dimension gets a HIGH score with LOW completeness. That is
 * correct and is why `rankable` exists. Publishing such a score inside a league
 * table without the completeness beside it would be a misuse of this module.
 */

export const CONFIDENCE_ORDER = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE_ORDER)[number];

/**
 * A dimension's contribution. `value` is 0..100 where 100 is the most open or the
 * strongest right; `null` means NOT RECORDED and is the whole point of the type.
 */
export interface DimensionScore {
  id: string;
  /** Relative importance. Need not sum to 1; shares are computed. Must be > 0. */
  weight: number;
  value: number | null;
  /** Required when `value` is present, forbidden when it is null. */
  confidence: Confidence | null;
}

export interface AxisScore {
  /** Weighted mean over SCORED dimensions only. null when nothing was scored. */
  score: number | null;
  /** Share of total weight that was scored, 0..1. */
  completeness: number;
  scored: number;
  total: number;
  /** Weakest confidence among dimensions carrying a material share. */
  confidence: Confidence | null;
  /** Share of scored weight at each confidence level, so the label is auditable. */
  confidenceMix: Record<Confidence, number>;
  /** Ids with no recorded value, for "what would improve this rank" copy. */
  missing: string[];
  /** Whether completeness clears the floor for inclusion in a published rank. */
  rankable: boolean;
}

/**
 * Below this share of weight a score is reported but must not be ranked against
 * others. Chosen rather than derived, and stated so it can be argued with: at half
 * the weight missing, the surviving dimensions are measuring a different thing from
 * a fully-scored country, so ordering the two implies a comparison that does not hold.
 */
export const MIN_RANKABLE_COMPLETENESS = 0.5;

/**
 * A dimension carrying less than this share of scored weight does not drag the
 * composite's confidence label down. Without a floor, one 2%-weight low-confidence
 * input would brand an otherwise well-sourced composite "low", which would make the
 * label useless and push authors toward dropping weak dimensions entirely. The
 * distribution in `confidenceMix` is the auditable form; this label is a convenience.
 */
export const MATERIAL_WEIGHT_SHARE = 0.1;

const weaker = (a: Confidence, b: Confidence): Confidence =>
  CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;

/**
 * Compose one axis. Throws on a malformed dimension rather than scoring it: a
 * silently-mis-weighted rank is worse than a failed build.
 */
export function scoreAxis(
  dimensions: DimensionScore[],
  options: { materialWeightShare?: number; minRankableCompleteness?: number } = {},
): AxisScore {
  const materialShare = options.materialWeightShare ?? MATERIAL_WEIGHT_SHARE;
  const rankableFloor = options.minRankableCompleteness ?? MIN_RANKABLE_COMPLETENESS;

  const seen = new Set<string>();
  for (const dimension of dimensions) {
    if (!(dimension.weight > 0) || !Number.isFinite(dimension.weight)) {
      throw new Error(`Dimension ${dimension.id} needs a positive finite weight`);
    }
    if (seen.has(dimension.id)) throw new Error(`Duplicate dimension ${dimension.id}`);
    seen.add(dimension.id);
    if (dimension.value === null) {
      // Confidence on an unrecorded value would imply we know something we do not.
      if (dimension.confidence !== null) {
        throw new Error(`Dimension ${dimension.id} has no value but claims confidence`);
      }
      continue;
    }
    if (!Number.isFinite(dimension.value) || dimension.value < 0 || dimension.value > 100) {
      throw new Error(`Dimension ${dimension.id} value must be 0..100, got ${dimension.value}`);
    }
    if (dimension.confidence === null) {
      throw new Error(`Dimension ${dimension.id} has a value but no confidence`);
    }
  }

  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  const scoredDimensions = dimensions.filter(dimension => dimension.value !== null);
  const scoredWeight = scoredDimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  const missing = dimensions.filter(d => d.value === null).map(d => d.id);

  const emptyMix: Record<Confidence, number> = { low: 0, medium: 0, high: 0 };

  if (scoredWeight === 0) {
    // Nothing recorded. Not a zero score: an absence of evidence.
    return {
      score: null,
      completeness: 0,
      scored: 0,
      total: dimensions.length,
      confidence: null,
      confidenceMix: emptyMix,
      missing,
      rankable: false,
    };
  }

  // Weights renormalise over the scored dimensions, so a null neither contributes
  // a 0 nor silently reweights its neighbours toward one.
  const score = scoredDimensions.reduce(
    (sum, dimension) => sum + dimension.value! * (dimension.weight / scoredWeight),
    0,
  );

  const confidenceMix = { ...emptyMix };
  for (const dimension of scoredDimensions) {
    confidenceMix[dimension.confidence!] += dimension.weight / scoredWeight;
  }

  const material = scoredDimensions.filter(
    dimension => dimension.weight / scoredWeight >= materialShare,
  );
  // If every dimension is below the floor, fall back to all of them rather than
  // returning null: something WAS scored, so a confidence must be reported.
  const confidence = (material.length ? material : scoredDimensions)
    .map(dimension => dimension.confidence!)
    .reduce(weaker);

  return {
    score,
    completeness: scoredWeight / totalWeight,
    scored: scoredDimensions.length,
    total: dimensions.length,
    confidence,
    confidenceMix,
    missing,
    rankable: scoredWeight / totalWeight >= rankableFloor,
  };
}

/**
 * Order countries for a published rank.
 *
 * Unrankable entries are not interleaved by score. They sort after every rankable
 * one, because placing a country measured on one dimension next to one measured on
 * seven asserts a comparison the data cannot support. They are still returned, so
 * the caller can show them in a clearly separate "not enough data" group.
 */
export function rankAxis<T>(
  entries: Array<{ key: T; axis: AxisScore }>,
): Array<{ key: T; axis: AxisScore; rank: number | null }> {
  const rankable = entries.filter(entry => entry.axis.rankable && entry.axis.score !== null);
  const rest = entries.filter(entry => !(entry.axis.rankable && entry.axis.score !== null));
  rankable.sort((a, b) => (b.axis.score! - a.axis.score!) || String(a.key).localeCompare(String(b.key)));
  return [
    ...rankable.map((entry, index) => ({ ...entry, rank: index + 1 })),
    ...rest
      .slice()
      .sort((a, b) => String(a.key).localeCompare(String(b.key)))
      .map(entry => ({ ...entry, rank: null })),
  ];
}

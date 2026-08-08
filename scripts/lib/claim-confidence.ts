/**
 * Derive what a consumer should believe about a route, given that its confidence
 * badge covers claims of very different strength.
 *
 * The problem this solves, from the 2026-08-06 lead pass: three routes shipped at
 * `confidence: high` while carrying a claim their own note described as
 * press-reported and needing re-quoting. `indonesia-naturalization`'s note read
 * "before treating as high-confidence fixed amounts" on a route flagged high. The
 * author had no way to say "the statutory floor is solid, this fee figure is not"
 * except in prose, and prose does not survive extraction into a country slice.
 *
 * It also matters upstream of the rights index. `docs/rights-index-spec.md` requires
 * that a composite cannot report higher confidence than its weakest material input,
 * and `scripts/lib/rights-score.ts` implements that. But the inputs are per-route
 * confidences that have ALREADY averaged over strong and weak claims, so the floor
 * was only as good as the granularity beneath it. This supplies the granularity.
 */

import { CONFIDENCE_ORDER, type Confidence } from './rights-score';

export interface RouteClaim {
  id: string;
  statement: string;
  confidence: Confidence;
  source_refs?: unknown[];
}

export interface ConfidenceBreakdown {
  /** The route's own badge, unchanged. */
  route: Confidence;
  /** Weakest of the route badge and every claim. What a consumer should believe. */
  effective: Confidence;
  /** Claims strictly weaker than the route badge, i.e. what pulled it down. */
  weakenedBy: RouteClaim[];
  /** Claims resting on no registered source at all. */
  unsourced: RouteClaim[];
}

const rank = (confidence: Confidence): number => CONFIDENCE_ORDER.indexOf(confidence);

/**
 * Weakest wins, always.
 *
 * A claim can only ever LOWER what a consumer sees. That asymmetry is deliberate:
 * a high-confidence footnote on a medium route tells you nothing useful, whereas a
 * medium-confidence footnote on a high route is precisely the Nepal case and must
 * be visible.
 */
export function effectiveConfidence(
  routeConfidence: Confidence,
  claims: readonly RouteClaim[] = [],
): ConfidenceBreakdown {
  const weakest = claims.reduce<Confidence>(
    (worst, claim) => (rank(claim.confidence) < rank(worst) ? claim.confidence : worst),
    routeConfidence,
  );
  return {
    route: routeConfidence,
    effective: weakest,
    weakenedBy: claims.filter(claim => rank(claim.confidence) < rank(routeConfidence)),
    // An empty source_refs is legal and meaningful: it records that a claim rests
    // on nothing registered. Surfacing it separately stops that state being
    // discovered only when someone re-reads the note.
    unsourced: claims.filter(claim => (claim.source_refs ?? []).length === 0),
  };
}

/**
 * Guard for authoring: a claim asserted at high confidence with no registered
 * source is the exact combination that let a fabricated citation look settled.
 *
 * @returns the offending claims, empty when the route is self-consistent.
 */
export function unsupportedHighClaims(claims: readonly RouteClaim[] = []): RouteClaim[] {
  return claims.filter(
    claim => claim.confidence === 'high' && (claim.source_refs ?? []).length === 0,
  );
}

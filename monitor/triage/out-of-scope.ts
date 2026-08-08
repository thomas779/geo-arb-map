/**
 * Drop lead classes the atlas does not model, before they become GitHub issues.
 *
 * Seven US administrative leads were closed as out of scope in three weeks
 * (#148, #149, #173, #175, #178, #184, #187), each needing a human to read it,
 * write a disposition and close it. The reasons were identical every time, so the
 * cost was pure repetition rather than judgement.
 *
 * WHAT THIS IS NOT. It is not a relevance score and it must never become one. It
 * matches explicit textual markers for three classes whose out-of-scope status is
 * a definitional fact about this dataset, not an editorial call:
 *
 *  - **TPS / EAD.** Work authorisation attached to a humanitarian designation.
 *    Confers no settlement right, counts toward no PR or naturalisation clock,
 *    and changes nobody's eligibility for a status the atlas models.
 *  - **Petition and work-visa fees.** A cost borne on a temporary status. Fees
 *    matter to applicants, but a fee change alters no acquisition route. (Note
 *    this is narrower than it sounds: investment-migration thresholds are
 *    explicitly excluded from the match, because those DO define a route.)
 *  - **Pre-publication proposed rules.** Sent to OMB, or an announced intent to
 *    propose. No legal effect and no public text, so nothing can be verified
 *    against a primary source. These are re-surfaced by the monitor if and when
 *    they are actually published.
 *
 * A dropped lead is REPORTED, never silently discarded, so a wrong filter shows up
 * in the run summary rather than vanishing. That is the whole safety story here:
 * the filter is allowed to be wrong, it is not allowed to be invisible.
 */

export interface OutOfScopeVerdict {
  /** Short machine-readable class, for the run report. */
  reason: 'tps_or_ead' | 'temporary_status_fee' | 'pre_publication_proposal';
  /** The phrase that matched, so a wrong filter can be diagnosed from the report. */
  matched: string;
}

/**
 * Investment migration thresholds are route-defining and must never be filtered as
 * "a fee". Checked first so a CBI price change cannot be lost to the fee rule.
 */
const ROUTE_DEFINING = /citizenship[- ]by[- ]investment|golden visa|residence[- ]by[- ]investment|\bCBI\b|\bRBI\b|naturalisation fee|naturalization fee/i;

const RULES: Array<{ reason: OutOfScopeVerdict['reason']; pattern: RegExp }> = [
  {
    reason: 'tps_or_ead',
    pattern: /\btemporary protected status\b|\bTPS\b|employment authorization document|\bEAD\b/i,
  },
  {
    reason: 'temporary_status_fee',
    // Anchored on the petition/visa context so a naturalisation or investment
    // threshold cannot match. "fee" alone is far too broad.
    pattern: /\b(?:H-1B|L-1|H1B|L1|petition|nonimmigrant|work[- ]visa)\b[^.]{0,80}\bfees?\b|\bfees?\b[^.]{0,80}\b(?:H-1B|L-1|petition|nonimmigrant)\b/i,
  },
  {
    reason: 'pre_publication_proposal',
    pattern: /sent a proposed rule to OMB|proposed rule to OMB|under OMB review|pending public notice and comment|intends to propose|advance notice of proposed rulemaking/i,
  },
];

/**
 * @returns the verdict when the text is a known out-of-scope class, else null.
 */
export function outOfScopeVerdict(text: string): OutOfScopeVerdict | null {
  const haystack = String(text ?? '');
  if (!haystack.trim()) return null;
  // A route-defining signal is never filtered, whatever else it says.
  if (ROUTE_DEFINING.test(haystack)) return null;
  for (const rule of RULES) {
    const match = rule.pattern.exec(haystack);
    if (match) return { reason: rule.reason, matched: match[0].slice(0, 80) };
  }
  return null;
}

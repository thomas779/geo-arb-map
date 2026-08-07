/**
 * Vet the primary-source URLs a sweep finding claims.
 *
 * The sweep already receives the URLs Google actually returned, as grounding
 * annotations on the response, and already resolves the redirect wrappers. It
 * used those only as a proof-of-search gate: "did the model search at all". The
 * URL that reached the lead was whatever the model typed, validated by nothing
 * stronger than `/^https?:\/\//`.
 *
 * On 2026-08-07 that shipped a lead citing
 * `gibraltarlaws.gov.gi/akn/gi/act/subsidiary/2026/166/eng@2026-07-09`, triaged
 * `Confidence: high` with `Primary source needed: No`. The whole `/akn/` path
 * space 404s: the site uses `/legislations/<slug>-<id>`. The instrument was real,
 * the URL was not, and it was on a genuine government host.
 *
 * That last detail decides the design. **Host-level matching would not have caught
 * it**, because the fabricated path sat on a host the model had genuinely searched.
 * Two independent checks are needed:
 *
 *  - `grounded`: does this exact URL appear in what the search actually returned?
 *    Catches invented hosts and pages the model never saw.
 *  - `reachable`: does it resolve? Catches a real host with an invented path,
 *    which is the failure that actually happened.
 *
 * Neither alone is sufficient and neither costs a token.
 */

export type CitationVerdict = 'grounded' | 'reachable' | 'unverified';

export interface CitationCheck {
  url: string;
  /** Present in the resolved grounding set. */
  grounded: boolean;
  /** HTTP status, or null when the request failed outright. */
  status: number | null;
  reachable: boolean;
  verdict: CitationVerdict;
}

/** Trailing slashes and fragments are not meaningful differences between citations. */
export function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = '';
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Pure classification against the grounded set, so the matching rule is testable
 * without a network. Exact match only: a shared host is exactly what the Gibraltar
 * fabrication had.
 */
export function isGrounded(url: string, groundedUrls: readonly string[]): boolean {
  const target = canonicalizeUrl(url);
  return groundedUrls.some(candidate => canonicalizeUrl(candidate) === target);
}

async function probe(
  url: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<number | null> {
  // HEAD first because it is free; a fair number of government sites answer 405
  // or 501 to HEAD while serving GET, so fall through rather than judging on it.
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const response = await fetcher(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (method === 'HEAD' && (response.status === 405 || response.status === 501)) continue;
      return response.status;
    } catch {
      if (method === 'GET') return null;
    }
  }
  return null;
}

export async function checkCitations(
  urls: readonly string[],
  groundedUrls: readonly string[],
  { fetcher = fetch, timeoutMs = 10_000 }: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<CitationCheck[]> {
  return Promise.all(urls.map(async url => {
    const grounded = isGrounded(url, groundedUrls);
    const status = await probe(url, fetcher, timeoutMs);
    const reachable = status !== null && status < 400;
    // Grounded outranks merely reachable: appearing in the search results is
    // evidence the page exists AND that the model actually read it.
    const verdict: CitationVerdict = grounded ? 'grounded' : reachable ? 'reachable' : 'unverified';
    return { url, grounded, status, reachable, verdict };
  }));
}

export interface VettedFinding {
  primary_urls: string[];
  status: string;
  needs_primary_source: boolean;
  citation_checks: CitationCheck[];
}

/**
 * Apply the checks to one finding's claimed sources.
 *
 * Deliberately does NOT delete an unverified URL. A dead link on a lead is useful
 * to a reviewer: it says "the model thinks this instrument exists here and it does
 * not". Dropping it silently would hide the failure and leave a claim with no
 * citation at all, which reads as though nothing was ever offered. Instead the
 * finding is demoted so no downstream step can treat it as settled.
 */
export function applyCitationVerdicts<T extends { primary_urls: string[]; status: string }>(
  finding: T,
  checks: CitationCheck[],
): T & { needs_primary_source: boolean; citation_checks: CitationCheck[] } {
  const usable = checks.filter(check => check.verdict !== 'unverified');
  // `confirmed` asserts the change is real and sourced. Without one citation that
  // is either grounded or reachable, it is a rumour with a footnote.
  const status = finding.status === 'confirmed' && usable.length === 0 ? 'rumour' : finding.status;
  return {
    ...finding,
    status,
    // Forces "Primary source needed: Yes" on the lead whenever nothing verified.
    needs_primary_source: usable.length === 0,
    citation_checks: checks,
  };
}

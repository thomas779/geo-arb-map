import { describe, test, expect } from 'bun:test';
import { findingToLead } from '../monitor/sweep/run';
import {
  applyCitationVerdicts,
  canonicalizeUrl,
  checkCitations,
  isGrounded,
} from '../monitor/sweep/citations';

/** Minimal fetch double: map url -> status, or 'throw' to simulate a dead host. */
const fakeFetch = (routes: Record<string, number | 'throw'>): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const outcome = routes[url];
    if (outcome === undefined || outcome === 'throw') throw new Error('network');
    void init;
    return { status: outcome, url } as Response;
  }) as unknown as typeof fetch;

const GIBRALTAR_FABRICATED =
  'https://www.gibraltarlaws.gov.gi/akn/gi/act/subsidiary/2026/166/eng@2026-07-09';
const GIBRALTAR_REAL =
  'https://www.gibraltarlaws.gov.gi/legislations/residency-regulations-2026-8527';

describe('the Gibraltar fabrication', () => {
  test('a real host with an invented path is caught by reachability, not by grounding', () => {
    // The whole point of the design. The model had genuinely searched
    // gibraltarlaws.gov.gi, so any host-level check passes and the fabricated
    // path sails through. Only the exact-URL and reachability checks catch it.
    expect(isGrounded(GIBRALTAR_FABRICATED, [GIBRALTAR_REAL])).toBe(false);
    // and to be explicit about what a host check would have concluded:
    expect(new URL(GIBRALTAR_FABRICATED).host).toBe(new URL(GIBRALTAR_REAL).host);
  });

  test('end to end: the lead is demoted and flagged for a primary source', async () => {
    const checks = await checkCitations(
      [GIBRALTAR_FABRICATED],
      [GIBRALTAR_REAL],
      { fetcher: fakeFetch({ [GIBRALTAR_FABRICATED]: 404, [GIBRALTAR_REAL]: 200 }) },
    );
    expect(checks[0]!.verdict).toBe('unverified');
    expect(checks[0]!.status).toBe(404);

    const vetted = applyCitationVerdicts(
      { primary_urls: [GIBRALTAR_FABRICATED], status: 'confirmed' },
      checks,
    );
    // Was: confirmed, "Primary source needed: No". That combination is what let a
    // fabricated citation look settled.
    expect(vetted.status).toBe('rumour');
    expect(vetted.needs_primary_source).toBe(true);
  });
});

describe('grounding match', () => {
  test('exact match wins, ignoring trailing slash and fragment', () => {
    expect(isGrounded('https://example.gov/a/b', ['https://example.gov/a/b/'])).toBe(true);
    expect(isGrounded('https://example.gov/a/b#s3', ['https://example.gov/a/b'])).toBe(true);
    expect(isGrounded('https://EXAMPLE.gov/a/b', ['https://example.gov/a/b'])).toBe(true);
  });

  test('a different path on the same host is not grounded', () => {
    expect(isGrounded('https://example.gov/invented', ['https://example.gov/real'])).toBe(false);
  });

  test('an unparseable string does not throw and does not match', () => {
    expect(() => canonicalizeUrl('not a url')).not.toThrow();
    expect(isGrounded('not a url', ['https://example.gov/real'])).toBe(false);
  });
});

describe('reachability probing', () => {
  test('a 200 that was never in the search results is still usable', async () => {
    // Models legitimately cite a deeper page than the one Google surfaced, so
    // reachable-but-ungrounded must not be rejected outright.
    const checks = await checkCitations(
      ['https://example.gov/deep'],
      ['https://example.gov/index'],
      { fetcher: fakeFetch({ 'https://example.gov/deep': 200 }) },
    );
    expect(checks[0]!.verdict).toBe('reachable');
    expect(applyCitationVerdicts({ primary_urls: [], status: 'confirmed' }, checks).status)
      .toBe('confirmed');
  });

  test('HEAD rejections fall through to GET rather than failing the citation', async () => {
    // Several government sites answer 405 to HEAD and serve GET fine. Judging on
    // the HEAD status would mark real primary sources dead.
    let heads = 0;
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      if ((init as RequestInit)?.method === 'HEAD') { heads += 1; return { status: 405 } as Response; }
      return { status: 200 } as Response;
    }) as unknown as typeof fetch;
    const checks = await checkCitations(['https://slow.gov/doc'], [], { fetcher });
    expect(heads).toBe(1);
    expect(checks[0]!.status).toBe(200);
    expect(checks[0]!.reachable).toBe(true);
  });

  test('a host that does not resolve is unverified, not a crash', async () => {
    const checks = await checkCitations(
      ['https://invented.example/doc'],
      [],
      { fetcher: fakeFetch({ 'https://invented.example/doc': 'throw' }) },
    );
    expect(checks[0]!.status).toBeNull();
    expect(checks[0]!.verdict).toBe('unverified');
  });

  test('grounded outranks reachable when both hold', async () => {
    const checks = await checkCitations(
      ['https://example.gov/a'],
      ['https://example.gov/a'],
      { fetcher: fakeFetch({ 'https://example.gov/a': 200 }) },
    );
    expect(checks[0]!.verdict).toBe('grounded');
  });
});

describe('what the vetting refuses to do', () => {
  test('an unverified citation is kept on the lead, not deleted', async () => {
    // A dead link tells the reviewer "the model believes this instrument exists
    // here and it does not". Dropping it would leave a claim with no citation,
    // which reads as though none was ever offered.
    const checks = await checkCitations(
      [GIBRALTAR_FABRICATED],
      [],
      { fetcher: fakeFetch({ [GIBRALTAR_FABRICATED]: 404 }) },
    );
    const vetted = applyCitationVerdicts(
      { primary_urls: [GIBRALTAR_FABRICATED], status: 'confirmed' },
      checks,
    );
    expect(vetted.primary_urls).toEqual([GIBRALTAR_FABRICATED]);
    expect(vetted.citation_checks[0]!.status).toBe(404);
  });

  test('one good citation among several bad ones keeps the finding confirmed', async () => {
    const checks = await checkCitations(
      [GIBRALTAR_FABRICATED, GIBRALTAR_REAL],
      [GIBRALTAR_REAL],
      { fetcher: fakeFetch({ [GIBRALTAR_FABRICATED]: 404, [GIBRALTAR_REAL]: 200 }) },
    );
    const vetted = applyCitationVerdicts(
      { primary_urls: [GIBRALTAR_FABRICATED, GIBRALTAR_REAL], status: 'confirmed' },
      checks,
    );
    expect(vetted.status).toBe('confirmed');
    expect(vetted.needs_primary_source).toBe(false);
  });

  test('a non-confirmed finding is not promoted by having good citations', async () => {
    const checks = await checkCitations(
      ['https://example.gov/a'], ['https://example.gov/a'],
      { fetcher: fakeFetch({ 'https://example.gov/a': 200 }) },
    );
    expect(applyCitationVerdicts({ primary_urls: [], status: 'rumour' }, checks).status)
      .toBe('rumour');
  });
});

describe('the vetting verdict reaches the lead', () => {
  const finding = (over: Record<string, unknown> = {}) => ({
    iso_n3: '292',
    jurisdiction: 'Gibraltar',
    claim: 'Gibraltar introduced the Residency Regulations 2026',
    headline: 'Gibraltar residency regulations',
    status: 'confirmed' as const,
    primary_urls: [GIBRALTAR_FABRICATED],
    effective_date: '2026-07-14',
    affects_dataset: true,
    category: 'residency',
    brief: 'A new permit framework.',
    evidence_quote: 'q',
    original_quote: 'q',
    legal_instrument: 'LN 2026/166',
    ...over,
  });

  test('a fabricated citation forces "Primary source needed: Yes"', () => {
    // The bug this pins: needs_primary_source was recomputed downstream as
    // primary_urls.length === 0. A fabricated URL on a real host is a non-empty
    // array, so the Gibraltar lead shipped as "Primary source needed: No" with a
    // citation that 404s, next to "Confidence: high".
    const vetted = applyCitationVerdicts(finding(), [{
      url: GIBRALTAR_FABRICATED, grounded: false, status: 404, reachable: false, verdict: 'unverified',
    }]);
    expect(vetted.needs_primary_source).toBe(true);
    const lead = findingToLead({ ...finding(), ...vetted } as never);
    expect(lead?.needs_primary_source).toBe(true);
  });

  test('a verified citation still reports "Primary source needed: No"', () => {
    const vetted = applyCitationVerdicts(finding({ primary_urls: [GIBRALTAR_REAL] }), [{
      url: GIBRALTAR_REAL, grounded: true, status: 200, reachable: true, verdict: 'grounded',
    }]);
    expect(vetted.needs_primary_source).toBe(false);
    expect(findingToLead({ ...finding({ primary_urls: [GIBRALTAR_REAL] }), ...vetted } as never)?.needs_primary_source)
      .toBe(false);
  });

  test('an unvetted finding falls back to the URL count', () => {
    // Fixture and offline paths never run the vetting, so the old behaviour has
    // to survive when needs_primary_source is absent.
    expect(findingToLead(finding({ primary_urls: ['https://example.gov/a'] }) as never)?.needs_primary_source)
      .toBe(false);
    expect(findingToLead(finding({ primary_urls: [] }) as never)).toBeNull();
  });
});

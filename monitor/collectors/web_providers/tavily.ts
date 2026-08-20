/** Tavily discovery adapter — maps reusable client hits → DiscoverLead. */

import { tavilySearch } from '../../lib/web-clients';
import {
  gazetteQuery,
  mobilityQuery,
  regionOfficialHosts,
  searchHitToLead,
  splitByLookback,
  type DiscoverLead,
  type ProviderPackResult,
  type RegionPack,
} from './shared';

function timeRangeFor(lookbackDays: number): 'day' | 'week' | 'month' {
  return lookbackDays <= 1 ? 'day' : lookbackDays <= 7 ? 'week' : 'month';
}

async function runPass(opts: {
  apiKey: string;
  pack: RegionPack;
  lookbackDays: number;
  maxResults: number;
  timeoutMs: number;
  query: string;
  includeDomains?: string[];
  pass: 'open_web' | 'official_allowlist';
}): Promise<ProviderPackResult> {
  const result = await tavilySearch({
    apiKey: opts.apiKey,
    query: opts.query,
    searchDepth: 'basic',
    topic: 'news',
    timeRange: timeRangeFor(opts.lookbackDays),
    maxResults: opts.maxResults,
    timeoutMs: opts.timeoutMs,
    // Only ever set on the constrained pass. On the open pass this stays
    // undefined, because include_domains RESTRICTS: applying it there would turn
    // "what is new anywhere" into "what do hosts we already watch say", which is
    // the one question the open pass is not for.
    ...(opts.includeDomains?.length ? { includeDomains: opts.includeDomains } : {}),
    // `country` is deliberately not set. Tavily honours it only under
    // `topic: 'general'` and this adapter runs `topic: 'news'`; flipping topic to
    // make it bite would change the result mix for a reason that has nothing to
    // do with geography. See TavilySearchOptions.country.
  });
  if (result.error) {
    return {
      provider: 'tavily',
      region: opts.pack.id,
      leads: [],
      backfill: [],
      credits_used: result.credits_used,
      cost_dollars: null,
      error: result.error,
    };
  }
  const mapped = result.hits
    .map(hit => searchHitToLead({
      provider: 'tavily',
      region: opts.pack.id,
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      published: hit.published,
      pass: opts.pass,
    }))
    .filter((lead): lead is DiscoverLead => lead !== null);
  // time_range is coarse, so older items do come back. They are coverage-refresh
  // material, not this week's news; the backfill list existed for them and was
  // never filled.
  const split = splitByLookback(mapped, opts.lookbackDays);

  return {
    provider: 'tavily',
    region: opts.pack.id,
    leads: split.leads,
    backfill: split.backfill,
    credits_used: result.credits_used,
    cost_dollars: null,
  };
}

export async function searchTavilyRegion(opts: {
  apiKey: string;
  pack: RegionPack;
  lookbackDays: number;
  maxResults: number;
  timeoutMs: number;
}): Promise<ProviderPackResult> {
  return runPass({
    ...opts,
    query: mobilityQuery(opts.pack, opts.lookbackDays),
    pass: 'open_web',
  });
}

/**
 * The constrained pass: the same week, asked of the official publishers we
 * already trust for this region.
 *
 * ADDITIVE. It does not replace searchTavilyRegion and must not — an allowlisted
 * query can only return hosts already in the manifest, so on its own it would
 * never surface a ministry page we do not yet watch. Two questions, two calls:
 * "what changed anywhere" and "what did the gazettes publish".
 *
 * Returns null when the region has no manifest hosts. Sending an empty
 * include_domains would be read as no filter, i.e. a second unconstrained query
 * billed and reported as a constrained one.
 */
export async function searchTavilyGazetteRegion(opts: {
  apiKey: string;
  pack: RegionPack;
  lookbackDays: number;
  maxResults: number;
  timeoutMs: number;
  /** Injectable so a test can pin the allowlist without a manifest read. */
  hosts?: string[];
}): Promise<ProviderPackResult | null> {
  const hosts = opts.hosts ?? regionOfficialHosts(opts.pack);
  if (!hosts.length) return null;
  return runPass({
    ...opts,
    query: gazetteQuery(opts.pack, opts.lookbackDays),
    includeDomains: hosts,
    pass: 'official_allowlist',
  });
}

/** Tavily discovery adapter — maps reusable client hits → DiscoverLead. */

import { tavilySearch } from '../../lib/web-clients';
import {
  mobilityQuery,
  searchHitToLead,
  splitByLookback,
  type DiscoverLead,
  type ProviderPackResult,
  type RegionPack,
} from './shared';

export async function searchTavilyRegion(opts: {
  apiKey: string;
  pack: RegionPack;
  lookbackDays: number;
  maxResults: number;
  timeoutMs: number;
}): Promise<ProviderPackResult> {
  const result = await tavilySearch({
    apiKey: opts.apiKey,
    query: mobilityQuery(opts.pack, opts.lookbackDays),
    searchDepth: 'basic',
    topic: 'news',
    timeRange: opts.lookbackDays <= 1 ? 'day' : opts.lookbackDays <= 7 ? 'week' : 'month',
    maxResults: opts.maxResults,
    timeoutMs: opts.timeoutMs,
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

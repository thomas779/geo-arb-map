/** Firecrawl discovery adapter — maps reusable client hits → DiscoverLead. */

import { firecrawlScrape as scrapeClient, firecrawlSearch } from '../../lib/web-clients';
import {
  mobilityQuery,
  searchHitToLead,
  type DiscoverLead,
  type ProviderPackResult,
  type RegionPack,
} from './shared';

export async function searchFirecrawlRegion(opts: {
  apiKey: string;
  pack: RegionPack;
  lookbackDays: number;
  maxResults: number;
  timeoutMs: number;
  scrape: boolean;
}): Promise<ProviderPackResult> {
  const tbs = opts.lookbackDays <= 1
    ? 'qdr:d'
    : opts.lookbackDays <= 7
      ? 'qdr:w'
      : 'qdr:m';

  const result = await firecrawlSearch({
    apiKey: opts.apiKey,
    query: mobilityQuery(opts.pack, opts.lookbackDays),
    limit: opts.maxResults,
    tbs,
    sources: ['web'],
    scrape: opts.scrape,
    timeoutMs: opts.timeoutMs,
  });

  if (result.error) {
    return {
      provider: 'firecrawl',
      region: opts.pack.id,
      leads: [],
      backfill: [],
      credits_used: result.credits_used,
      cost_dollars: null,
      error: result.error,
    };
  }

  const leads = result.hits
    .map(hit => searchHitToLead({
      provider: 'firecrawl',
      region: opts.pack.id,
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      published: hit.published,
    }))
    .filter((lead): lead is DiscoverLead => lead !== null);

  return {
    provider: 'firecrawl',
    region: opts.pack.id,
    leads,
    backfill: [],
    credits_used: result.credits_used,
    cost_dollars: null,
  };
}

/** Re-export scrape for callers that still import from this path. */
export async function scrapeFirecrawlUrl(opts: {
  apiKey: string;
  url: string;
  timeoutMs: number;
}): Promise<{ markdown: string | null; credits_used: number | null; error?: string }> {
  const result = await scrapeClient({
    apiKey: opts.apiKey,
    url: opts.url,
    timeoutMs: opts.timeoutMs,
  });
  return {
    markdown: result.markdown,
    credits_used: result.credits_used,
    error: result.error,
  };
}

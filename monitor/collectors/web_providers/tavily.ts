/** Tavily search provider — basic depth (1 credit / call) for free-tier longevity. */

import {
  mobilityQuery,
  searchHitToLead,
  type DiscoverLead,
  type ProviderPackResult,
  type RegionPack,
} from './shared';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
  usage?: { credits?: number };
}

export async function searchTavilyRegion(opts: {
  apiKey: string;
  pack: RegionPack;
  lookbackDays: number;
  maxResults: number;
  timeoutMs: number;
}): Promise<ProviderPackResult> {
  const query = mobilityQuery(opts.pack, opts.lookbackDays);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic', // 1 credit; avoid advanced (2) on free plan
        topic: 'news',
        time_range: opts.lookbackDays <= 1 ? 'day' : opts.lookbackDays <= 7 ? 'week' : 'month',
        max_results: Math.min(Math.max(opts.maxResults, 1), 10),
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        include_usage: true,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        provider: 'tavily',
        region: opts.pack.id,
        leads: [],
        backfill: [],
        credits_used: null,
        cost_dollars: null,
        error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
      };
    }
    const body = JSON.parse(text) as TavilyResponse;
    const leads = (body.results ?? [])
      .map(hit => searchHitToLead({
        provider: 'tavily',
        region: opts.pack.id,
        title: hit.title ?? '',
        url: hit.url ?? '',
        snippet: hit.content ?? null,
        published: hit.published_date ?? null,
      }))
      .filter((lead): lead is DiscoverLead => lead !== null);

    return {
      provider: 'tavily',
      region: opts.pack.id,
      leads,
      backfill: [],
      credits_used: body.usage?.credits ?? 1,
      cost_dollars: null,
    };
  } catch (error) {
    return {
      provider: 'tavily',
      region: opts.pack.id,
      leads: [],
      backfill: [],
      credits_used: null,
      cost_dollars: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

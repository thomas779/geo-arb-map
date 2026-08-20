/** Reusable Tavily Search client — free-tier friendly defaults. */

import { SOCIAL_NOISE_DOMAINS, type WebSearchResult } from './types';

export interface TavilySearchOptions {
  apiKey?: string;
  query: string;
  /** Default basic (1 credit). Never leave unset with auto_parameters. */
  searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast';
  topic?: 'general' | 'news' | 'finance';
  timeRange?: 'day' | 'week' | 'month' | 'year' | null;
  maxResults?: number;
  excludeDomains?: string[];
  includeRawContent?: boolean;
  /** Drop hits below this Tavily score (docs recommend post-filtering). */
  minScore?: number;
  timeoutMs?: number;
}

export async function tavilySearch(opts: TavilySearchOptions): Promise<WebSearchResult> {
  const apiKey = opts.apiKey ?? process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return {
      provider: 'tavily',
      hits: [],
      credits_used: null,
      cost_dollars: null,
      structured: null,
      request_id: null,
      error: 'TAVILY_API_KEY missing',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: opts.query,
        search_depth: opts.searchDepth ?? 'basic',
        auto_parameters: false,
        topic: opts.topic ?? 'news',
        time_range: opts.timeRange ?? 'week',
        max_results: Math.min(Math.max(opts.maxResults ?? 5, 1), 8),
        include_answer: false,
        include_raw_content: opts.includeRawContent ?? false,
        include_images: false,
        include_usage: true,
        exclude_domains: opts.excludeDomains ?? [...SOCIAL_NOISE_DOMAINS],
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        provider: 'tavily',
        hits: [],
        credits_used: null,
        cost_dollars: null,
        structured: null,
        request_id: null,
        error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
      };
    }
    const body = JSON.parse(text) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        published_date?: string;
        score?: number;
      }>;
      usage?: { credits?: number };
      request_id?: string;
    };
    const minScore = opts.minScore ?? 0.45;
    const hits = (body.results ?? [])
      .filter(hit => (hit.score ?? 1) >= minScore)
      .map(hit => ({
        title: hit.title ?? '',
        url: hit.url ?? '',
        snippet: hit.content ?? null,
        published: hit.published_date ?? null,
        score: hit.score ?? null,
        raw: hit,
      }))
      .filter(hit => hit.title && hit.url);

    return {
      provider: 'tavily',
      hits,
      credits_used: body.usage?.credits ?? 1,
      cost_dollars: null,
      structured: null,
      request_id: body.request_id ?? null,
    };
  } catch (error) {
    return {
      provider: 'tavily',
      hits: [],
      credits_used: null,
      cost_dollars: null,
      structured: null,
      request_id: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

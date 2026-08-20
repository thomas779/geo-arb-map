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
  /**
   * RESTRICTS results to these hosts — an allowlist, not a preference. A pass
   * that sets it can only return hosts it already named, so it complements an
   * open query and must never replace one. Absent or empty means unconstrained.
   */
  includeDomains?: string[];
  /**
   * Plumbed but deliberately UNUSED by this repo's callers. Tavily applies
   * `country` only when `topic: 'general'`, and the discovery adapter runs
   * `topic: 'news'` (monitor/collectors/web_providers/tavily.ts). Switching topic
   * to make this field bite would change the result mix for a reason unrelated to
   * geography, so the option exists for a future general-topic caller and the
   * adapter leaves it unset.
   */
  country?: string;
  includeRawContent?: boolean;
  /** Drop hits below this Tavily score (docs recommend post-filtering). */
  minScore?: number;
  timeoutMs?: number;
}

/**
 * The request body, split out so the defaults are assertable without a network
 * call: an absent new option must change nothing about the existing request.
 */
export function buildTavilyRequestBody(opts: TavilySearchOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
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
  };
  // An empty array is NOT an empty allowlist — Tavily reads it as no filter,
  // i.e. an unconstrained search billed as a constrained one.
  if (opts.includeDomains?.length) body.include_domains = opts.includeDomains;
  if (opts.country) body.country = opts.country;
  return body;
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
      body: JSON.stringify(buildTavilyRequestBody(opts)),
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

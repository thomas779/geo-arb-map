/** Reusable Firecrawl search + scrape clients — scrape is opt-in. */

import { SOCIAL_NOISE_DOMAINS, type WebScrapeResult, type WebSearchResult } from './types';

export interface FirecrawlSearchOptions {
  apiKey?: string;
  query: string;
  /** Results per source type. Keep low on free tier (2 credits / 10 results). */
  limit?: number;
  /** Google tbs-style filter; applies to web source only. */
  tbs?: string;
  /** Prefer a single source — web+news doubles volume for the same credit band. */
  sources?: Array<'web' | 'news'>;
  excludeDomains?: string[];
  /** Dangerous on free tier: +1 credit per result. */
  scrape?: boolean;
  timeoutMs?: number;
}

export async function firecrawlSearch(opts: FirecrawlSearchOptions): Promise<WebSearchResult> {
  const apiKey = opts.apiKey ?? process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return {
      provider: 'firecrawl',
      hits: [],
      credits_used: null,
      cost_dollars: null,
      structured: null,
      request_id: null,
      error: 'FIRECRAWL_API_KEY missing',
    };
  }

  const sources = (opts.sources ?? ['web']).map(type => ({ type }));
  const body: Record<string, unknown> = {
    query: opts.query,
    limit: Math.min(Math.max(opts.limit ?? 5, 1), 5),
    tbs: opts.tbs ?? 'qdr:w',
    sources,
    excludeDomains: opts.excludeDomains ?? [...SOCIAL_NOISE_DOMAINS],
    ignoreInvalidURLs: true,
  };
  if (opts.scrape) {
    body.scrapeOptions = {
      formats: [{ type: 'markdown' }],
      onlyMainContent: true,
      parsers: [],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        provider: 'firecrawl',
        hits: [],
        credits_used: null,
        cost_dollars: null,
        structured: null,
        request_id: null,
        error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
      };
    }
    const parsed = JSON.parse(text) as {
      success?: boolean;
      data?: {
        web?: Array<{ title?: string; description?: string; url?: string; markdown?: string }>;
        news?: Array<{ title?: string; snippet?: string; url?: string; date?: string; markdown?: string }>;
      };
      creditsUsed?: number;
      id?: string;
      error?: string;
    };
    if (parsed.success === false) {
      return {
        provider: 'firecrawl',
        hits: [],
        credits_used: parsed.creditsUsed ?? null,
        cost_dollars: null,
        structured: null,
        request_id: parsed.id ?? null,
        error: parsed.error || 'Firecrawl search unsuccessful',
      };
    }

    const hits = [
      ...(parsed.data?.news ?? []).map(hit => ({
        title: hit.title ?? '',
        url: hit.url ?? '',
        snippet: hit.snippet ?? (hit.markdown ? hit.markdown.slice(0, 400) : null),
        published: hit.date ?? null,
        score: null as number | null,
        raw: hit,
      })),
      ...(parsed.data?.web ?? []).map(hit => ({
        title: hit.title ?? '',
        url: hit.url ?? '',
        snippet: hit.description ?? (hit.markdown ? hit.markdown.slice(0, 400) : null),
        published: null as string | null,
        score: null as number | null,
        raw: hit,
      })),
    ].filter(hit => hit.title && hit.url);

    return {
      provider: 'firecrawl',
      hits,
      credits_used: parsed.creditsUsed ?? null,
      cost_dollars: null,
      structured: null,
      request_id: parsed.id ?? null,
    };
  } catch (error) {
    return {
      provider: 'firecrawl',
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

export async function firecrawlScrape(opts: {
  apiKey?: string;
  url: string;
  timeoutMs?: number;
}): Promise<WebScrapeResult> {
  const apiKey = opts.apiKey ?? process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { provider: 'firecrawl', url: opts.url, markdown: null, credits_used: null, error: 'FIRECRAWL_API_KEY missing' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: opts.url,
        formats: [{ type: 'markdown' }],
        onlyMainContent: true,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        provider: 'firecrawl',
        url: opts.url,
        markdown: null,
        credits_used: null,
        error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
      };
    }
    const parsed = JSON.parse(text) as {
      success?: boolean;
      data?: { markdown?: string };
      creditsUsed?: number;
      error?: string;
    };
    if (!parsed.success) {
      return {
        provider: 'firecrawl',
        url: opts.url,
        markdown: null,
        credits_used: parsed.creditsUsed ?? null,
        error: parsed.error || 'scrape failed',
      };
    }
    return {
      provider: 'firecrawl',
      url: opts.url,
      markdown: parsed.data?.markdown ?? null,
      credits_used: parsed.creditsUsed ?? 1,
    };
  } catch (error) {
    return {
      provider: 'firecrawl',
      url: opts.url,
      markdown: null,
      credits_used: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

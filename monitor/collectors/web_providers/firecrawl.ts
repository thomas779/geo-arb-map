/**
 * Firecrawl search provider.
 *
 * Default: search only (no scrapeOptions) — ~2 credits / 10 results.
 * Optional scrape of capped primary-looking URLs is separate (1 credit / page).
 */

import {
  mobilityQuery,
  searchHitToLead,
  type DiscoverLead,
  type ProviderPackResult,
  type RegionPack,
} from './shared';

interface FirecrawlWebHit {
  title?: string;
  description?: string;
  url?: string;
  markdown?: string | null;
}

interface FirecrawlSearchResponse {
  success?: boolean;
  data?: { web?: FirecrawlWebHit[]; news?: FirecrawlWebHit[] };
  creditsUsed?: number;
  error?: string;
}

export async function searchFirecrawlRegion(opts: {
  apiKey: string;
  pack: RegionPack;
  lookbackDays: number;
  maxResults: number;
  timeoutMs: number;
  /** When true, attach markdown scrape to each hit (expensive on free tier). */
  scrape: boolean;
}): Promise<ProviderPackResult> {
  const query = mobilityQuery(opts.pack, opts.lookbackDays);
  const tbs = opts.lookbackDays <= 1
    ? 'qdr:d'
    : opts.lookbackDays <= 7
      ? 'qdr:w'
      : 'qdr:m';

  const body: Record<string, unknown> = {
    query,
    limit: Math.min(Math.max(opts.maxResults, 1), 10),
    // Top-level tbs applies across sources; keep scrape off unless explicitly enabled.
    tbs,
    sources: [{ type: 'news' }, { type: 'web' }],
    ignoreInvalidURLs: true,
  };
  if (opts.scrape) {
    body.scrapeOptions = {
      formats: [{ type: 'markdown' }],
      onlyMainContent: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        provider: 'firecrawl',
        region: opts.pack.id,
        leads: [],
        backfill: [],
        credits_used: null,
        cost_dollars: null,
        error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
      };
    }
    const parsed = JSON.parse(text) as FirecrawlSearchResponse;
    if (parsed.success === false) {
      return {
        provider: 'firecrawl',
        region: opts.pack.id,
        leads: [],
        backfill: [],
        credits_used: parsed.creditsUsed ?? null,
        cost_dollars: null,
        error: parsed.error || 'Firecrawl search unsuccessful',
      };
    }

    const hits = [
      ...(parsed.data?.news ?? []),
      ...(parsed.data?.web ?? []),
    ];
    const leads = hits
      .map(hit => searchHitToLead({
        provider: 'firecrawl',
        region: opts.pack.id,
        title: hit.title ?? '',
        url: hit.url ?? '',
        snippet: hit.description ?? (hit.markdown ? hit.markdown.slice(0, 400) : null),
      }))
      .filter((lead): lead is DiscoverLead => lead !== null);

    return {
      provider: 'firecrawl',
      region: opts.pack.id,
      leads,
      backfill: [],
      credits_used: parsed.creditsUsed ?? null,
      cost_dollars: null,
    };
  } catch (error) {
    return {
      provider: 'firecrawl',
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

/** Scrape a single URL to markdown (1 credit). Used sparingly for primary enrichment. */
export async function scrapeFirecrawlUrl(opts: {
  apiKey: string;
  url: string;
  timeoutMs: number;
}): Promise<{ markdown: string | null; credits_used: number | null; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
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
      return { markdown: null, credits_used: null, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    const parsed = JSON.parse(text) as {
      success?: boolean;
      data?: { markdown?: string };
      creditsUsed?: number;
      error?: string;
    };
    if (!parsed.success) {
      return {
        markdown: null,
        credits_used: parsed.creditsUsed ?? null,
        error: parsed.error || 'scrape failed',
      };
    }
    return {
      markdown: parsed.data?.markdown ?? null,
      credits_used: parsed.creditsUsed ?? 1,
    };
  } catch (error) {
    return {
      markdown: null,
      credits_used: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

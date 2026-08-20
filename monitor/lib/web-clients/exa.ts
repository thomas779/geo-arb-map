/** Reusable Exa Search client — structured synthesis via outputSchema. */

import { SOCIAL_NOISE_DOMAINS, type WebSearchResult } from './types';

export interface ExaSearchOptions {
  apiKey?: string;
  query: string;
  systemPrompt?: string;
  /** Prefer deep-lite weekly; escalate to deep only when needed. */
  type?: 'auto' | 'fast' | 'instant' | 'deep-lite' | 'deep' | 'deep-reasoning';
  outputSchema?: Record<string, unknown>;
  numResults?: number;
  startPublishedDate?: string | null;
  /**
   * RESTRICTS results to these hosts — it is an allowlist, not a preference. A
   * caller that sets it can only ever re-find the hosts it names, so it belongs
   * on a deliberately constrained pass and never on an open discovery query.
   * Absent or empty means unconstrained, which is the default.
   */
  includeDomains?: string[];
  /**
   * Defaults to SOCIAL_NOISE_DOMAINS so this client matches the Tavily and
   * Firecrawl ones. Until this existed, Exa had no domain filtering at all and
   * the weekly workflow's "social domains excluded" note was true for two of the
   * three providers.
   */
  excludeDomains?: string[];
  /**
   * Two-letter country code Exa localises ranking to. Absent means unset — Exa
   * decides — which is the existing behaviour.
   */
  userLocation?: string;
  timeoutMs?: number;
}

/**
 * The request body, split out so the defaults are assertable without a network
 * call: the load-bearing property of a new option is that an absent one changes
 * nothing about the request we were already sending.
 */
export function buildExaRequestBody(opts: ExaSearchOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query: opts.query,
    type: opts.type ?? 'deep-lite',
    numResults: opts.numResults ?? 12,
    contents: { highlights: { maxCharacters: 2000 } },
    excludeDomains: opts.excludeDomains ?? [...SOCIAL_NOISE_DOMAINS],
  };
  if (opts.systemPrompt) body.systemPrompt = opts.systemPrompt;
  if (opts.outputSchema) body.outputSchema = opts.outputSchema;
  if (opts.startPublishedDate) body.startPublishedDate = opts.startPublishedDate;
  // An empty array is NOT an empty allowlist — Exa would read it as no filter at
  // all, which is the opposite of what a caller asking for one wants.
  if (opts.includeDomains?.length) body.includeDomains = opts.includeDomains;
  if (opts.userLocation) body.userLocation = opts.userLocation;
  return body;
}

export async function exaSearch(opts: ExaSearchOptions): Promise<WebSearchResult> {
  const apiKey = opts.apiKey ?? process.env.EXA_API_KEY;
  if (!apiKey) {
    return {
      provider: 'exa',
      hits: [],
      credits_used: null,
      cost_dollars: null,
      structured: null,
      request_id: null,
      error: 'EXA_API_KEY missing',
    };
  }

  const body = buildExaRequestBody(opts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        provider: 'exa',
        hits: [],
        credits_used: null,
        cost_dollars: null,
        structured: null,
        request_id: null,
        error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
      };
    }
    const parsed = JSON.parse(text) as {
      requestId?: string;
      results?: Array<{ title?: string; url?: string; highlights?: string[]; publishedDate?: string }>;
      output?: { content?: unknown };
      costDollars?: { total?: number };
    };
    const hits = (parsed.results ?? [])
      .map(hit => ({
        title: hit.title ?? '',
        url: hit.url ?? '',
        snippet: hit.highlights?.join(' […] ') ?? null,
        published: hit.publishedDate ?? null,
        score: null as number | null,
        raw: hit,
      }))
      .filter(hit => hit.title && hit.url);

    return {
      provider: 'exa',
      hits,
      credits_used: null,
      cost_dollars: typeof parsed.costDollars?.total === 'number' ? parsed.costDollars.total : null,
      structured: parsed.output?.content ?? null,
      request_id: parsed.requestId ?? null,
    };
  } catch (error) {
    return {
      provider: 'exa',
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

/** Reusable Exa Search client — structured synthesis via outputSchema. */

import type { WebSearchResult } from './types';

export interface ExaSearchOptions {
  apiKey?: string;
  query: string;
  systemPrompt?: string;
  /** Prefer deep-lite weekly; escalate to deep only when needed. */
  type?: 'auto' | 'fast' | 'instant' | 'deep-lite' | 'deep' | 'deep-reasoning';
  outputSchema?: Record<string, unknown>;
  numResults?: number;
  startPublishedDate?: string | null;
  timeoutMs?: number;
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

  const body: Record<string, unknown> = {
    query: opts.query,
    type: opts.type ?? 'deep-lite',
    numResults: opts.numResults ?? 12,
    contents: { highlights: { maxCharacters: 2000 } },
  };
  if (opts.systemPrompt) body.systemPrompt = opts.systemPrompt;
  if (opts.outputSchema) body.outputSchema = opts.outputSchema;
  if (opts.startPublishedDate) body.startPublishedDate = opts.startPublishedDate;

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

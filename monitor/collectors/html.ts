// Stable polling for official pages that offer neither feeds nor webhooks.

import { createHash } from 'node:crypto';
import { decodeEntities } from './rss';
import { makeSignal, type Signal, type SignalTier } from '../schema/signal';

export interface HtmlSource {
  id: string;
  tier: SignalTier;
  adapter: 'html_index';
  url: string;
  jurisdictions?: string[];
}

interface ParseOptions {
  retrievedAt?: string;
}

function normalizeHtml(html: string): string {
  return decodeEntities(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' '))
    .trim();
}

function pageTitle(html: string, fallback: string): string {
  const match = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return (match ? normalizeHtml(match[1]) : '') || fallback;
}

export function parseHtmlSnapshot(
  html: string,
  source: HtmlSource,
  { retrievedAt }: ParseOptions = {},
): Signal[] {
  const content = normalizeHtml(html);
  if (!content) return [];
  const contentHash = createHash('sha256').update(content).digest('hex');
  return [makeSignal({
    sourceId: source.id,
    tier: source.tier,
    jurisdiction: source.jurisdictions?.[0] ?? 'multi',
    externalId: `${source.url}#${contentHash}`,
    url: source.url,
    title: pageTitle(html, new URL(source.url).hostname),
    excerpt: content,
    retrievedAt,
  })];
}

export async function collectHtmlSnapshot(
  source: HtmlSource,
  { fetchImpl = fetch, retrievedAt }: ParseOptions & { fetchImpl?: typeof fetch } = {},
): Promise<Signal[]> {
  const response = await fetchImpl(source.url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'flag-paths-monitor/0.1 (+https://github.com/thomas779/geo-arb-map)',
    },
  });
  if (!response.ok) throw new Error(`${source.id}: HTML fetch failed (${response.status})`);
  return parseHtmlSnapshot(await response.text(), source, { retrievedAt });
}

// Dependency-free RSS 2.0 and Atom parsing for publisher-controlled feeds.

import { makeSignal, type Signal, type SignalTier } from '../schema/signal';

export interface RssSource {
  id: string;
  tier: SignalTier;
  adapter: 'rss';
  url: string;
  jurisdictions?: string[];
  max_items?: number;
}

interface ParseOptions {
  retrievedAt?: string;
}

export function decodeEntities(str = ''): string {
  return String(str)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([a-f0-9]+);/gi, (_, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))
    .trim();
}

function extractTag(block: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

function extractAtomLink(block: string): string {
  const alternate = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (alternate) return decodeEntities(alternate[1]);
  const anyHref = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return anyHref ? decodeEntities(anyHref[1]) : extractTag(block, 'link');
}

function normalizeDate(value: string): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function parseRss(xml: string, source: RssSource, { retrievedAt }: ParseOptions = {}): Signal[] {
  const rssItems = [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map(match => ({ block: match[1], atom: false }));
  const atomEntries = [...String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)]
    .map(match => ({ block: match[1], atom: true }));
  const maxItems = Number(source.max_items ?? 25);

  return [...rssItems, ...atomEntries].slice(0, maxItems).flatMap(({ block, atom }) => {
    const link = atom ? extractAtomLink(block) : extractTag(block, 'link');
    const externalId = extractTag(block, atom ? 'id' : 'guid') || link;
    const title = extractTag(block, 'title');
    if (!link || !externalId || !title) return [];

    const description =
      extractTag(block, 'description') ||
      extractTag(block, 'summary') ||
      extractTag(block, 'content:encoded') ||
      extractTag(block, 'content');
    const published =
      extractTag(block, 'pubDate') ||
      extractTag(block, 'published') ||
      extractTag(block, 'updated') ||
      extractTag(block, 'dc:date');

    return [makeSignal({
      sourceId: source.id,
      tier: source.tier,
      jurisdiction: source.jurisdictions?.[0] ?? 'multi',
      externalId,
      url: link,
      title: stripMarkup(title),
      excerpt: stripMarkup(description),
      publishedAt: normalizeDate(published),
      retrievedAt,
    })];
  });
}

export async function collectRss(
  source: RssSource,
  { fetchImpl = fetch, retrievedAt }: ParseOptions & { fetchImpl?: typeof fetch } = {},
): Promise<Signal[]> {
  // A browser-like User-Agent + Accept header clears naive bot blocks that reject
  // obvious crawler UAs; hard blocks still fail and are reported per source.
  const response = await fetchImpl(source.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 flag-paths-monitor',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
  });
  if (!response.ok) throw new Error(`${source.id}: RSS fetch failed (${response.status})`);
  return parseRss(await response.text(), source, { retrievedAt });
}

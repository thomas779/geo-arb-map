// Curated public Telegram channel collector. This intentionally targets only
// allow-listed t.me/s/<channel> preview pages; it is not broad social listening.

import { decodeEntities } from './rss';
import { makeSignal, type Signal, type SignalTier } from '../schema/signal';

export interface TelegramSource {
  id: string;
  tier: SignalTier;
  adapter: 'telegram_html';
  url: string;
  channel: string;
  jurisdictions?: string[];
  max_items?: number;
}

interface ParseOptions {
  retrievedAt?: string;
}

function stripMarkup(value: string): string {
  return decodeEntities(value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n'));
}

function titleFromText(text: string): string {
  const firstLine = text.split('\n').map(line => line.trim()).find(Boolean) ?? text;
  return firstLine.slice(0, 180);
}

export function parseTelegramPreview(
  html: string,
  source: TelegramSource,
  { retrievedAt }: ParseOptions = {},
): Signal[] {
  const chunks = String(html).split('<div class="tgme_widget_message_wrap').slice(1);
  const maxItems = Number(source.max_items ?? 25);

  return chunks.flatMap(chunk => {
    if (/\bservice_message\b/.test(chunk)) return [];
    const post = chunk.match(/\bdata-post="([^"]+)"/)?.[1];
    const messageHtml = chunk.match(
      /<div class="tgme_widget_message_text[^"]*js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    )?.[1];
    const publishedAt = chunk.match(/<time\b[^>]*datetime="([^"]+)"/i)?.[1];
    if (!post || !messageHtml) return [];
    if (!post.startsWith(`${source.channel}/`)) return [];

    const text = stripMarkup(messageHtml);
    if (!text) return [];
    const url = `https://t.me/${post}`;
    return [makeSignal({
      sourceId: source.id,
      tier: source.tier,
      jurisdiction: source.jurisdictions?.[0] ?? 'multi',
      externalId: post,
      url,
      title: titleFromText(text),
      excerpt: text,
      publishedAt: publishedAt ?? null,
      retrievedAt,
    })];
  }).slice(-maxItems);
}

export async function collectTelegramPreview(
  source: TelegramSource,
  { fetchImpl = fetch, retrievedAt }: ParseOptions & { fetchImpl?: typeof fetch } = {},
): Promise<Signal[]> {
  const response = await fetchImpl(source.url, {
    headers: { 'User-Agent': 'flag-paths-monitor/0.1 (+https://github.com/thomas779/geo-arb-map)' },
  });
  if (!response.ok) {
    throw new Error(`${source.id}: Telegram preview fetch failed (${response.status})`);
  }
  return parseTelegramPreview(await response.text(), source, { retrievedAt });
}

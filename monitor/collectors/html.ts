// Stateful polling for official pages that offer neither feeds nor webhooks.

import { createHash } from 'node:crypto';
import { decodeEntities } from './rss';
import { makeSignal, type Signal, type SignalTier } from '../schema/signal';
import type { MonitorPageState, PageHealth, PageObservation } from '../state';

export interface HtmlPage {
  id: string;
  url: string;
  jurisdiction?: string;
  keywords?: string[];
}

export interface HtmlSource {
  id: string;
  tier: SignalTier;
  adapter: 'html_index';
  url: string;
  jurisdictions?: string[];
  keywords?: string[];
  page_id?: string;
}

interface ParseOptions {
  retrievedAt?: string;
}

export interface HtmlCollectionResult {
  signals: Signal[];
  observation: PageObservation;
  error: string | null;
}

export function normalizeHtml(html: string): string {
  return decodeEntities(String(html)
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript|template)\b[^>]*>[^]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' '))
    .trim()
    .slice(0, 200_000);
}

function pageTitle(html: string, fallback: string): string {
  const match = String(html).match(/<title\b[^>]*>([^]*?)<\/title>/i);
  return (match ? normalizeHtml(match[1]) : '') || fallback;
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function diffNormalizedText(previous: string, current: string): string {
  if (previous === current) return 'No normalized text change.';
  const before = previous.split(/\s+/);
  const after = current.split(/\s+/);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) suffix += 1;
  const contextStart = Math.max(0, prefix - 18);
  const beforeEnd = Math.min(before.length, before.length - suffix + 18);
  const afterEnd = Math.min(after.length, after.length - suffix + 18);
  const beforeText = before.slice(contextStart, beforeEnd).join(' ').slice(0, 3_000);
  const afterText = after.slice(contextStart, afterEnd).join(' ').slice(0, 3_000);
  return `- ${beforeText}\n+ ${afterText}`;
}

function keywordMatch(text: string, keywords: string[] | undefined): boolean {
  if (!keywords?.length) return true;
  const normalized = text.toLocaleLowerCase();
  return keywords.some(keyword => normalized.includes(keyword.toLocaleLowerCase()));
}

function blockedPage(status: number, title: string, content: string): boolean {
  if ([401, 403, 429].includes(status)) return true;
  const sample = `${title} ${content.slice(0, 8_000)}`.toLocaleLowerCase();
  return /access denied|just a moment|verify you are human|captcha|bot protection|cloudflare ray id|sign in to continue|login required|enable javascript and cookies/.test(sample);
}

function failureState(status: number): PageHealth {
  if (status === 404 || status === 410) return 'missing';
  if ([401, 403, 429].includes(status)) return 'blocked';
  return 'error';
}

function pageId(source: HtmlSource): string {
  return `${source.id}:${source.page_id ?? hashText(source.url).slice(0, 12)}`;
}

export function parseHtmlSnapshot(
  html: string,
  source: HtmlSource,
  { retrievedAt }: ParseOptions = {},
): Signal[] {
  const content = normalizeHtml(html);
  if (!content) return [];
  const contentHash = hashText(content);
  return [makeSignal({
    sourceId: source.id,
    tier: source.tier,
    jurisdiction: source.jurisdictions?.[0] ?? 'multi',
    externalId: `${source.url}#${contentHash}`,
    url: source.url,
    title: pageTitle(html, new URL(source.url).hostname),
    excerpt: content,
    retrievedAt,
    eventType: 'page_changed',
    change: {
      page_id: pageId(source),
      previous_hash: null,
      current_hash: contentHash,
      diff: '+ Initial normalized page snapshot',
    },
  })];
}

export async function collectHtmlPage(
  source: HtmlSource,
  previous: MonitorPageState | null,
  { fetchImpl = fetch, retrievedAt = new Date().toISOString() }:
    ParseOptions & { fetchImpl?: typeof fetch } = {},
): Promise<HtmlCollectionResult> {
  const hadSuccessfulBaseline = Boolean(previous?.last_success_hash);
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml',
    'User-Agent': 'flag-paths-monitor/0.2 (+https://github.com/thomas779/geo-arb-map)',
  };
  if (previous?.etag) headers['If-None-Match'] = previous.etag;
  if (previous?.last_modified) headers['If-Modified-Since'] = previous.last_modified;

  let response: Response;
  try {
    response = await fetchImpl(source.url, { headers, redirect: 'follow' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      signals: [],
      error: message,
      observation: {
        page_id: pageId(source), source_id: source.id,
        jurisdiction: source.jurisdictions?.[0] ?? 'multi', attempted_at: retrievedAt,
        state: 'error', change_kind: hadSuccessfulBaseline ? 'access_changed' : 'fetch_failed',
        http_status: null, requested_url: source.url, final_url: null,
        previous_hash: previous?.last_success_hash ?? null, current_hash: null,
        previous_text: previous?.current_text ?? null, current_text: null, text_diff: null,
        etag: previous?.etag ?? null, last_modified: previous?.last_modified ?? null,
        error: message,
      },
    };
  }

  const base = {
    page_id: pageId(source), source_id: source.id,
    jurisdiction: source.jurisdictions?.[0] ?? 'multi', attempted_at: retrievedAt,
    http_status: response.status, requested_url: source.url,
    final_url: response.url || source.url,
    previous_hash: previous?.last_success_hash ?? null,
    etag: response.headers.get('etag') ?? previous?.etag ?? null,
    last_modified: response.headers.get('last-modified') ?? previous?.last_modified ?? null,
  };

  if (response.status === 304) {
    return { signals: [], error: null, observation: {
      ...base, state: previous?.state === 'redirected' ? 'redirected' : 'healthy',
      change_kind: 'unchanged', current_hash: previous?.last_success_hash ?? null,
      previous_text: previous?.previous_text ?? null,
      current_text: previous?.current_text ?? null, text_diff: null, error: null,
    } };
  }

  if (!response.ok) {
    const state = failureState(response.status);
    const message = `${source.id}: HTML fetch failed (${response.status})`;
    return { signals: [], error: message, observation: {
      ...base, state,
      change_kind: hadSuccessfulBaseline && previous?.state !== state ? 'access_changed' : 'fetch_failed',
      current_hash: null, previous_text: previous?.current_text ?? null,
      current_text: null, text_diff: null, error: message,
    } };
  }

  const html = await response.text();
  const content = normalizeHtml(html);
  const title = pageTitle(html, new URL(source.url).hostname);
  if (!content || blockedPage(response.status, title, content)) {
    const message = `${source.id}: page appears to be a login or bot-protection screen`;
    return { signals: [], error: message, observation: {
      ...base, state: 'blocked',
      change_kind: hadSuccessfulBaseline && previous?.state !== 'blocked' ? 'access_changed' : 'fetch_failed',
      current_hash: null, previous_text: previous?.current_text ?? null,
      current_text: content || null, text_diff: null, error: message,
    } };
  }

  const currentHash = hashText(content);
  const changed = Boolean(previous?.last_success_hash && previous.last_success_hash !== currentHash);
  const baseline = !previous?.last_success_hash;
  const diff = changed ? diffNormalizedText(previous?.current_text ?? '', content) : null;
  const state: PageHealth = response.redirected || Boolean(response.url && response.url !== source.url)
    ? 'redirected'
    : 'healthy';
  const observation: PageObservation = {
    ...base, state,
    change_kind: baseline ? 'baseline' : changed ? 'page_changed' : 'unchanged',
    current_hash: currentHash, previous_text: previous?.current_text ?? null,
    current_text: content, text_diff: diff, error: null,
  };
  const signals = changed && keywordMatch(`${title} ${diff ?? ''}`, source.keywords)
    ? [makeSignal({
      sourceId: source.id, tier: source.tier,
      jurisdiction: source.jurisdictions?.[0] ?? 'multi',
      externalId: `${source.url}#${currentHash}`, url: source.url, title,
      excerpt: content, retrievedAt, eventType: 'page_changed',
      change: {
        page_id: pageId(source), previous_hash: previous?.last_success_hash ?? null,
        current_hash: currentHash, diff: diff ?? 'Normalized page text changed.',
      },
    })]
    : [];
  return { signals, observation, error: null };
}

export async function collectHtmlSnapshot(
  source: HtmlSource,
  { fetchImpl = fetch, retrievedAt }: ParseOptions & { fetchImpl?: typeof fetch } = {},
): Promise<Signal[]> {
  const result = await collectHtmlPage(source, null, { fetchImpl, retrievedAt });
  if (result.error) throw new Error(result.error);
  return parseHtmlSnapshot(result.observation.current_text ?? '', source, { retrievedAt });
}

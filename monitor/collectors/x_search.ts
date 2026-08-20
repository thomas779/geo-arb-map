// X (Twitter) discovery via the xAI Agent Tools API (server-side x_search tool).
// Immigration lawyers and agencies post rule changes on X hours-to-days before
// news or Google indexes them, and xAI is the only provider that grounds on X's
// live social graph. To avoid the firehose burying small, high-signal niche
// accounts, the search is scoped to a curated watchlist (with a broad fallback).
// Emits one Signal per post, flagging the jurisdiction for the verify sweep.
// DISCOVERY ONLY — the primary-source + evidence-audit gate still guards every
// publication; an X post can never verify a dataset change on its own.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import countries from 'i18n-iso-countries';
import { makeSignal, type Signal, type SignalTier } from '../schema/signal';
import { parseJsonArray } from '../triage/triage';

const WATCHLIST_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sources', 'x-watchlist.json');

// Curated X handles to prioritise. Open search buries small, high-signal niche
// accounts; scoping to a watchlist makes coverage of them reliable. The list is
// grown by the reverse-discovery seed job and the citation-mining candidate
// report, not hand-guessed. Returns [] (→ broad search) if the file is absent.
export function loadWatchlist(file: string = WATCHLIST_PATH): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { handles?: unknown };
    if (!Array.isArray(parsed.handles)) return [];
    return [...new Set(parsed.handles.map(handle => String(handle).trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
  } catch {
    return [];
  }
}

export interface XSearchConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxResults: number;
  lookbackHours: number;
  timeoutMs: number;
  watchlist: string[];
  sourceId: string;
  tier: SignalTier;
}

// null when no key is configured, so the collector skips gracefully (X search
// is opt-in) rather than failing the run.
export function xSearchConfigFromEnv(): XSearchConfig | null {
  const apiKey = process.env.MONITOR_XAI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: process.env.MONITOR_XAI_BASE_URL || 'https://api.x.ai/v1',
    model: process.env.MONITOR_XAI_MODEL || 'grok-4.5',
    maxResults: Number(process.env.MONITOR_XAI_MAX_RESULTS) || 15,
    lookbackHours: Number(process.env.MONITOR_XAI_LOOKBACK_HOURS) || 6,
    // Agentic tool calls + reasoning can take a couple of minutes; keep a
    // generous ceiling. It runs once/day, so a slow call barely matters.
    timeoutMs: Number(process.env.MONITOR_XAI_TIMEOUT_MS) || 180_000,
    watchlist: loadWatchlist(),
    sourceId: 'x-search',
    tier: 'discovery',
  };
}

const SYSTEM_PROMPT =
  'You monitor X (Twitter) for real, officially announced or officially proposed government changes to '
  + 'citizenship, naturalization, residency, visa, or investment-migration (CBI/RBI) rules. Include only posts '
  + 'about actual government/policy changes with a concrete source — never opinion, ads, promotions, or generic '
  + 'commentary. Prefer official agencies, immigration lawyers, and specialist reporters.';

/** `allowed_x_handles` is capped at 20 by the API and is silently rejected above it. */
export const MAX_ALLOWED_HANDLES = 20;

/**
 * Build the server-side x_search tool entry.
 *
 * Scoping used to live in the PROSE of the user prompt as `from:a OR from:b …`,
 * which left the model to translate an English instruction into search behaviour.
 * On 2026-08-04 it resolved a 15-handle watchlist plus "anything else you find"
 * into two broad calls, used zero sources, and spent 1,271 of its 1,276 output
 * tokens reasoning its way to an empty array.
 *
 * `allowed_x_handles` and `from_date` are the documented parameters for this
 * (docs.x.ai, X Search Parameters), so coverage becomes a property of the request
 * rather than of prompt compliance, and the reasoning burden that consumed the
 * spend mostly disappears.
 *
 * Note this makes the search EXCLUSIVE to the watchlist: `allowed_x_handles` is a
 * filter, not a ranking hint. That is the deliberate trade. The open half of the
 * hybrid returned nothing on the only run it ever had, broad discovery is already
 * covered by RSS and Bluesky, and an unscoped X firehose is precisely what buries
 * the niche accounts the watchlist exists to catch.
 */
export function buildXSearchTool(
  watchlist: string[],
  lookbackHours: number,
  now: Date,
): Record<string, unknown> {
  const tool: Record<string, unknown> = { type: 'x_search' };
  if (watchlist.length) {
    tool.allowed_x_handles = watchlist.slice(0, MAX_ALLOWED_HANDLES);
  }
  // from_date is a DATE, so an N-hour window has to round outward to whole days
  // or the first hours of the window fall outside it. Over-fetching is corrected
  // by the caller's own lookback filter; under-fetching loses posts silently.
  const from = new Date(now.getTime() - lookbackHours * 3_600_000);
  tool.from_date = from.toISOString().slice(0, 10);
  return tool;
}

export function buildUserPrompt(hours: number, watchlist: string[] = []): string {
  // Handle scoping and the date range are request parameters now (see
  // buildXSearchTool), so the prompt only has to describe WHAT qualifies and the
  // output contract. Restating the handles here would re-introduce the reasoning
  // burden the parameters exist to remove.
  const priority = watchlist.length
    ? 'The search is already restricted to a curated set of accounts, so report everything qualifying that you find. '
    : '';
  return `${priority}Search X for posts from roughly the last ${hours} hours about such changes. `
    + 'Search in English AND in the local language of the country involved (e.g. Spanish, Portuguese, French, '
    + 'Arabic, Vietnamese) — official changes are often announced or discussed in local language first. '
    + 'Return ONLY a JSON array (no prose, no code fences); return [] if nothing qualifies. Each item:\n'
    + '{"iso_n3":"UN M49 numeric country code of the jurisdiction, or \'\' if unclear",'
    + '"jurisdiction":"country name",'
    + '"headline":"a 6-12 word headline naming the country and the change",'
    + '"summary":"1-2 sentences: what changed and one concrete number, date, or detail",'
    + '"url":"the permalink to the source X post"}\n'
    + 'Include the source X post URL for every item. Deduplicate the same change.';
}

// Resolve a jurisdiction hint (M49 numeric, ISO alpha-2/3, or a country name)
// to a UN M49 numeric code so the sweep can flag it; '' when unresolved.
export function resolveIso(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  if (/^\d{3}$/.test(raw)) return raw;
  // A failed code lookup falls THROUGH to the name lookup rather than returning
  // ''. Short country nicknames are shaped exactly like codes: "UAE" is not a
  // valid alpha-3 (that is ARE) and "UK" is not a valid alpha-2 (GB), so the
  // early return resolved both to '' — which silently disabled every downstream
  // step keyed on iso_n3. getAlpha2Code knows both.
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const numeric = countries.alpha2ToNumeric(raw.toUpperCase());
    if (numeric) return numeric;
  }
  if (/^[A-Za-z]{3}$/.test(raw)) {
    const numeric = countries.alpha3ToNumeric(raw.toUpperCase());
    if (numeric) return String(numeric);
  }
  const alpha2 = countries.getAlpha2Code(raw, 'en');
  return alpha2 ? (countries.alpha2ToNumeric(alpha2) ?? '') : '';
}

interface XSearchBody {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  citations?: unknown[];
}

// The Responses API returns the model text either as a convenience `output_text`
// string or split across `output[].content[].text`. Handle both.
function extractText(body: XSearchBody): string {
  if (typeof body.output_text === 'string') return body.output_text;
  if (Array.isArray(body.output)) {
    return body.output
      .flatMap(item => (Array.isArray(item?.content) ? item.content : []))
      .map(part => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

// Turn the xAI response into signals. Tolerant: a non-JSON body yields no
// signals rather than throwing, so one bad response never sinks the collector.
export function parseXSearchResponse(
  body: unknown,
  config: XSearchConfig,
  { retrievedAt }: { retrievedAt?: string } = {},
): Signal[] {
  const content = extractText(body as XSearchBody);
  let items: unknown[];
  try {
    items = parseJsonArray(content);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const signals: Signal[] = [];
  for (const value of items) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const url = String(item.url ?? item.x_url ?? item.post_url ?? item.link ?? '').trim();
    const title = String(item.headline ?? item.title ?? '').trim();
    if (!/^https?:\/\//i.test(url) || !title || seen.has(url)) continue;
    seen.add(url);
    signals.push(makeSignal({
      sourceId: config.sourceId,
      tier: config.tier,
      jurisdiction: resolveIso(item.iso_n3) || resolveIso(item.iso) || resolveIso(item.jurisdiction) || 'multi',
      externalId: url,
      url,
      title,
      excerpt: String(item.summary ?? item.brief ?? '').trim().replace(/\s+/g, ' ').slice(0, 500),
      publishedAt: null,
      retrievedAt,
    }));
  }
  return signals;
}

export async function collectXSearch(
  config: XSearchConfig,
  { fetchImpl = fetch, retrievedAt }: { fetchImpl?: typeof fetch; retrievedAt?: string } = {},
): Promise<Signal[]> {
  // Agent Tools API (the current interface — Live Search was retired). The
  // server-side x_search tool grounds the answer on X; the model decides how
  // many searches to run for the query.
  const requestBody = {
    model: config.model,
    instructions: SYSTEM_PROMPT,
    input: [{ role: 'user', content: buildUserPrompt(config.lookbackHours, config.watchlist) }],
    tools: [buildXSearchTool(config.watchlist, config.lookbackHours, new Date())],
    stream: false,
  };
  const response = await fetchImpl(`${config.baseUrl}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`x-search: xAI request failed (${response.status}) ${detail}`.slice(0, 300));
  }
  const body = await response.json();
  // Surface token/tool usage in the run log so the real cost is visible without
  // opening the xAI console.
  const usage = (body as { usage?: unknown }).usage;
  if (usage) console.log(`x-search usage: ${JSON.stringify(usage)}`);
  return parseXSearchResponse(body, config, { retrievedAt });
}

// X (Twitter) discovery via the xAI Live Search API. Immigration lawyers and
// agencies post rule changes on X hours-to-days before news or Google indexes
// them, and xAI is the only provider that grounds on X's live social graph.
// This asks Grok to search X for recent official mobility-law changes and emits
// one Signal per post, which flags the jurisdiction for the verify sweep. It is
// DISCOVERY ONLY — the primary-source + evidence-audit gate still guards every
// publication; an X post can never verify a dataset change on its own.

import countries from 'i18n-iso-countries';
import { makeSignal, type Signal, type SignalTier } from '../schema/signal';
import { parseJsonArray } from '../triage/triage';

export interface XSearchConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxResults: number;
  lookbackHours: number;
  timeoutMs: number;
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
    sourceId: 'x-search',
    tier: 'discovery',
  };
}

const SYSTEM_PROMPT =
  'You monitor X (Twitter) for real, officially announced or officially proposed government changes to '
  + 'citizenship, naturalization, residency, visa, or investment-migration (CBI/RBI) rules. Include only posts '
  + 'about actual government/policy changes with a concrete source — never opinion, ads, promotions, or generic '
  + 'commentary. Prefer official agencies, immigration lawyers, and specialist reporters.';

function userPrompt(hours: number): string {
  return `Search X for posts from roughly the last ${hours} hours about such changes. `
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
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d{3}$/.test(raw)) return raw;
  if (/^[A-Za-z]{2}$/.test(raw)) return countries.alpha2ToNumeric(raw.toUpperCase()) ?? '';
  if (/^[A-Za-z]{3}$/.test(raw)) return countries.alpha3ToNumeric(raw.toUpperCase()) ?? '';
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
    input: [{ role: 'user', content: userPrompt(config.lookbackHours) }],
    tools: [{ type: 'x_search' }],
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

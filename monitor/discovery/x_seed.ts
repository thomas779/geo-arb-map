#!/usr/bin/env bun

// Reverse-discovery seed for the X watchlist. Instead of hand-guessing handles
// (unreliable) or letting open search bury small accounts, this asks Grok — via
// the x_search tool — to surface X accounts that regularly post REAL official
// mobility-law changes, IRRESPECTIVE of follower count. Two modes:
//   - directory: "which accounts consistently post this kind of update?"
//   - reverse:   seeded from our own published changes (monitor_posts) —
//                "who reported THESE specific changes?"
// Every candidate MUST carry a real X post URL as evidence — the guardrail that
// stops the model inventing plausible-but-fake handles. Output is a review file
// (never auto-merged into the watchlist); a human approves additions.
//
// Manual only (no cron) — one Grok call per run — so it never spends on its own.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import countries from 'i18n-iso-countries';
import { loadWatchlist, xSearchConfigFromEnv, type XSearchConfig } from '../collectors/x_search';
import { parseJsonArray } from '../triage/triage';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SEED_SYSTEM =
  'You build a watchlist of X (Twitter) accounts that regularly report REAL, officially announced or proposed '
  + 'government changes to citizenship, naturalization, residency, visa, or investment-migration (CBI/RBI) rules. '
  + 'You MUST use the x_search tool to check live X — never answer from memory or invent handles. Include accounts '
  + 'of ANY follower count; small, niche, and country-specific accounts (immigration lawyers, boutique firms, '
  + 'specialist reporters) are especially valuable. Exclude pure promotion/ads and generic political commentary.';

const JSON_SHAPE =
  'Return ONLY a JSON array (no prose, no code fences); return [] if none. Each item: '
  + '{"handle":"the X handle without @","jurisdiction":"main country it covers (name) or \'\' if global",'
  + '"evidence_url":"URL of ONE real, recent post from this account about a mobility-law change (from x_search)",'
  + '"why":"what it covers and rough posting cadence"}. '
  + 'Every item MUST include a real evidence_url on x.com — omit any account you cannot back with one. Deduplicate handles.';

function excludeClause(watchlist: string[]): string {
  return watchlist.length ? `Do NOT include accounts already on our list: ${watchlist.map(h => `@${h}`).join(', ')}. ` : '';
}

// Use the current watchlist as ANCHORS — mimicking X's "You might like": the
// accounts followed alongside / recommended next to known-good mobility-law
// accounts are themselves usually the niche accounts we want.
export function buildDirectoryPrompt(watchlist: string[]): string {
  const anchors = watchlist.length
    ? `We already follow these accounts, which post exactly the updates we want: ${watchlist.map(h => `@${h}`).join(', ')}. `
      + 'Find MORE accounts like them — the accounts X would surface under "You might like" next to these, and the accounts they interact with — that also post real mobility-law changes. Do NOT re-list the ones above. '
    : '';
  return 'Use x_search to find X accounts that CONSISTENTLY post official mobility-law updates, of ANY follower count. '
    + `${anchors}`
    + 'Only include an account if it has posted at least 2 relevant updates in roughly the last 6 months and you can cite one. '
    + JSON_SHAPE;
}

export interface SeedChange { jurisdiction: string; category: string; url: string; }

export function buildReversePrompt(changes: SeedChange[], watchlist: string[]): string {
  const list = changes.map((change, index) => `${index + 1}. ${change.jurisdiction} — ${change.category} — ${change.url}`).join('\n');
  return 'Below are recent official mobility-law changes we have tracked. Use x_search to find the X accounts that '
    + 'reported, broke, or substantively covered each — especially small/specialist/country-specific ones. '
    + `${excludeClause(watchlist)}\n\nChanges:\n${list}\n\n`
    + JSON_SHAPE;
}

export interface SeedCandidate { handle: string; jurisdiction: string; evidence_url: string; why: string; }

function responseText(body: unknown): string {
  const parsed = body as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  if (typeof parsed.output_text === 'string') return parsed.output_text;
  if (Array.isArray(parsed.output)) {
    return parsed.output
      .flatMap(item => (Array.isArray(item?.content) ? item.content : []))
      .map(part => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

// Parse + hard-filter: a valid X handle, a real x.com/twitter.com evidence URL
// (the anti-hallucination gate), not already on the watchlist, deduped.
export function parseSeedCandidates(body: unknown, watchlist: string[] = []): SeedCandidate[] {
  let items: unknown[];
  try {
    items = parseJsonArray(responseText(body));
  } catch {
    return [];
  }
  const have = new Set(watchlist.map(h => h.toLowerCase()));
  const seen = new Set<string>();
  const out: SeedCandidate[] = [];
  for (const value of items) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const handle = String(item.handle ?? '').trim().replace(/^@/, '').toLowerCase();
    const evidenceUrl = String(item.evidence_url ?? item.url ?? '').trim();
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) continue;
    if (!/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(evidenceUrl)) continue;
    if (have.has(handle) || seen.has(handle)) continue;
    seen.add(handle);
    out.push({
      handle,
      jurisdiction: String(item.jurisdiction ?? '').trim().slice(0, 60),
      evidence_url: evidenceUrl,
      why: String(item.why ?? '').trim().replace(/\s+/g, ' ').slice(0, 200),
    });
  }
  return out;
}

async function askGrok(config: XSearchConfig, userContent: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(`${config.baseUrl}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      instructions: SEED_SYSTEM,
      input: [{ role: 'user', content: userContent }],
      tools: [{ type: 'x_search' }],
      stream: false,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`x-seed: xAI request failed (${response.status}) ${await response.text().catch(() => '')}`.slice(0, 300));
  }
  const body = await response.json();
  const usage = (body as { usage?: unknown }).usage;
  if (usage) console.log(`x-seed usage: ${JSON.stringify(usage)}`);
  return body;
}

// Read the most recent published changes from a monitor_posts D1 export.
function recentChanges(stateDb: string, limit: number): SeedChange[] {
  let database: Database;
  let temporaryDirectory: string | null = null;
  if (stateDb.endsWith('.sql')) {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-paths-seed-'));
    database = new Database(path.join(temporaryDirectory, 'state.sqlite'), { create: true, strict: true });
    database.exec(fs.readFileSync(stateDb, 'utf8'));
  } else {
    database = new Database(stateDb, { strict: true });
  }
  try {
    const rows = database
      .query('SELECT iso_n3, category, primary_url FROM monitor_posts ORDER BY posted_at DESC LIMIT ?1')
      .all(limit) as Array<{ iso_n3: string; category: string; primary_url: string | null }>;
    return rows
      .filter(row => row.primary_url)
      .map(row => ({ jurisdiction: countries.getName(row.iso_n3, 'en') || row.iso_n3, category: row.category, url: String(row.primary_url) }));
  } finally {
    database.close();
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

interface Options { mode: 'directory' | 'reverse' | 'both'; stateDb: string | null; limit: number; outJson: string; outMd: string; }

function readArgs(argv: string[]): Options {
  const options: Options = {
    mode: 'directory',
    stateDb: process.env.MONITOR_STATE_DB ? path.resolve(process.env.MONITOR_STATE_DB) : null,
    limit: 15,
    outJson: path.join(ROOT, '.generated/monitor/x-watchlist-candidates.json'),
    outMd: path.join(ROOT, '.generated/monitor/x-watchlist-candidates.md'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--mode') options.mode = argv[++index] as Options['mode'];
    else if (value === '--state-db') options.stateDb = path.resolve(argv[++index]);
    else if (value === '--limit') options.limit = Number(argv[++index]);
    else if (value === '--out-json') options.outJson = path.resolve(argv[++index]);
    else if (value === '--out-md') options.outMd = path.resolve(argv[++index]);
    else throw new Error(`Unknown x-seed option: ${value}`);
  }
  if (!['directory', 'reverse', 'both'].includes(options.mode)) throw new Error(`--mode must be directory|reverse|both`);
  return options;
}

function renderMarkdown(candidates: SeedCandidate[], generatedAt: string): string {
  const lines = [
    '# X watchlist — candidate accounts (for review)',
    '',
    `Generated ${generatedAt}. Each account is backed by a real X post (evidence). Review, then add approved`,
    'handles to `monitor/sources/x-watchlist.json`. Discovery only.',
    '',
    '| Handle | Jurisdiction | Evidence | Why |',
    '| --- | --- | --- | --- |',
    ...candidates.map(c => `| \`@${c.handle}\` | ${c.jurisdiction || '—'} | [post](${c.evidence_url}) | ${c.why.replace(/\|/g, '\\|')} |`),
  ];
  if (!candidates.length) lines.push('| _none found_ | | | |');
  return `${lines.join('\n')}\n`;
}

if (import.meta.main) {
  (async () => {
    try {
      const options = readArgs(process.argv.slice(2));
      const config = xSearchConfigFromEnv();
      if (!config) throw new Error('MONITOR_XAI_API_KEY is not set');
      const watchlist = loadWatchlist();

      const candidates: SeedCandidate[] = [];
      const seen = new Set<string>();
      const collect = (found: SeedCandidate[]) => {
        for (const candidate of found) if (!seen.has(candidate.handle)) { seen.add(candidate.handle); candidates.push(candidate); }
      };

      if (options.mode === 'directory' || options.mode === 'both') {
        collect(parseSeedCandidates(await askGrok(config, buildDirectoryPrompt(watchlist), fetch), watchlist));
      }
      if (options.mode === 'reverse' || options.mode === 'both') {
        if (!options.stateDb) throw new Error('reverse mode needs --state-db (a monitor_posts D1 export)');
        const changes = recentChanges(options.stateDb, options.limit);
        if (changes.length) collect(parseSeedCandidates(await askGrok(config, buildReversePrompt(changes, watchlist), fetch), watchlist));
      }

      const generatedAt = new Date().toISOString();
      fs.mkdirSync(path.dirname(options.outJson), { recursive: true });
      fs.writeFileSync(options.outJson, `${JSON.stringify({ generated_at: generatedAt, mode: options.mode, candidates }, null, 2)}\n`);
      fs.writeFileSync(options.outMd, renderMarkdown(candidates, generatedAt));
      console.log(`x-seed: ${candidates.length} evidence-backed candidate account(s) → ${options.outMd}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  })();
}

#!/usr/bin/env bun

// Auto-publish verified sweep findings to the Telegram news channel. Reuses the
// existing publication safety gate: every post is checked by the LLM
// evidence-audit (auditTelegramPost) against its own cited evidence and must
// carry a primary-source URL. A D1-backed ledger (monitor_posts) prevents the
// same change from being posted twice. Only status="confirmed" findings are
// eligible; data changes are handled separately by the issue pipeline.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import {
  auditTelegramPost,
  sendTelegramPost,
  type ReviewIssue,
  type TelegramPost,
} from './telegram';
import countries from 'i18n-iso-countries';
import { llmConfigFromEnv } from '../llm/client';
import type { Finding } from '../sweep/run';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TELEGRAM_MESSAGE_LIMIT = 4096;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Country flag emoji from an ISO-3166 numeric code, for an eye-catching, scannable
// channel. Falls back to a globe for territories/specials without a flag.
function flagEmoji(isoN3: string): string {
  try {
    const alpha2 = countries.numericToAlpha2(isoN3);
    if (!alpha2 || alpha2.length !== 2) return '🌍';
    return String.fromCodePoint(...[...alpha2.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
  } catch {
    return '🌍';
  }
}

interface NewsOptions {
  findings: string;
  apply: boolean;
  stateDb: string | null;
  stateSql: string;
  max: number;
}

export function fingerprint(finding: Pick<Finding, 'iso_n3' | 'claim' | 'effective_date'>): string {
  const normalizedClaim = finding.claim.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha1')
    .update(`${finding.iso_n3}|${normalizedClaim}|${finding.effective_date ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

// Resolve a source URL to something that actually opens. The grounded model
// sometimes fabricates deep-link paths/ids (e.g. a gazette search with a made-up
// id) that 404. Keep the link if it resolves; otherwise fall back to the
// official domain root, which always works and is the correct publisher. Never
// blocks publishing — on any failure it degrades to the domain root.
export async function verifySourceUrl(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  let origin = '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return url;
    origin = parsed.origin;
  } catch {
    return url;
  }
  try {
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
    });
    if (response.ok) return response.url || url;
  } catch {
    // network error / timeout / bot-block — fall back to the domain root
  }
  return origin || url;
}

export function buildNewsPost(finding: Finding): TelegramPost {
  const sources = finding.primary_urls;
  if (sources.length === 0) throw new Error('finding has no primary source URL');
  const headline = (finding.headline || finding.claim).slice(0, 160);
  const link = sources.length === 1
    ? `<a href="${escapeAttr(sources[0])}">Source</a>`
    : sources.map((url, index) => `<a href="${escapeAttr(url)}">Source ${index + 1}</a>`).join(' · ');

  const text = [
    `${flagEmoji(finding.iso_n3)} <b>${escapeHtml(headline)}</b>`,
    '',
    escapeHtml(finding.brief),
    '',
    link,
  ].join('\n');
  if (text.length > TELEGRAM_MESSAGE_LIMIT) {
    throw new Error(`News post is ${text.length} characters; maximum is ${TELEGRAM_MESSAGE_LIMIT}`);
  }
  return { issue_number: 0, issue_url: sources[0], text, sources };
}

// Synthesize the minimal ReviewIssue that auditTelegramPost reads: it only needs
// a "## Verified evidence" section. This lets the auto-news path reuse the exact
// same LLM evidence-audit as the human-reviewed issue path, unchanged.
export function synthesizeIssue(finding: Finding): ReviewIssue {
  const body = [
    '## Verified evidence',
    '',
    finding.claim,
    finding.brief,
    finding.effective_date ? `Effective date: ${finding.effective_date}.` : '',
    ...finding.primary_urls.map(url => `- ${url}`),
  ].filter(Boolean).join('\n');
  return {
    number: 0,
    title: finding.claim,
    body,
    url: finding.primary_urls[0] ?? '',
    comments: [],
  };
}

// Dedup ledger. Mirrors the collector's state pattern: read from an exported D1
// snapshot (.sql or .sqlite), buffer portable INSERTs, and write them for the
// workflow to apply back to D1. In-memory when no path is given (local/dry-run).
class NewsPostStore {
  readonly database: Database;
  readonly mutations: string[] = [];
  private temporaryDirectory: string | null = null;

  constructor(root: string, inputPath?: string | null) {
    if (inputPath?.endsWith('.sql')) {
      this.temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-paths-news-'));
      this.database = new Database(path.join(this.temporaryDirectory, 'state.sqlite'), { create: true, strict: true });
      this.database.exec(fs.readFileSync(inputPath, 'utf8'));
    } else {
      this.database = new Database(inputPath || ':memory:', { create: true, strict: true });
    }
    this.database.exec(fs.readFileSync(
      path.join(root, 'data/d1/migrations/0004_monitor_posts.sql'),
      'utf8',
    ));
  }

  has(fp: string): boolean {
    return Boolean(this.database.query('SELECT 1 FROM monitor_posts WHERE fingerprint = ?1').get(fp));
  }

  record(fp: string, finding: Finding, messageId: number, postedAt: string): void {
    const values = [fp, finding.iso_n3, finding.category, finding.status, messageId, finding.primary_urls[0] ?? null, postedAt];
    const sql = `INSERT OR IGNORE INTO monitor_posts
      (fingerprint, iso_n3, category, status, telegram_message_id, primary_url, posted_at)
      VALUES (${values.map(value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`).join(', ')});`;
    this.database.exec(sql);
    this.mutations.push(sql);
  }

  writeMutations(outputPath: string): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${this.mutations.join('\n')}\n`);
  }

  close(): void {
    this.database.close();
    if (this.temporaryDirectory) fs.rmSync(this.temporaryDirectory, { recursive: true, force: true });
  }
}

function readArgs(argv: string[]): NewsOptions {
  const outDir = path.join(ROOT, '.out');
  const options: NewsOptions = {
    findings: path.join(outDir, 'findings.json'),
    apply: false,
    stateDb: process.env.MONITOR_STATE_DB ? path.resolve(process.env.MONITOR_STATE_DB) : null,
    stateSql: path.join(outDir, 'monitor-posts.sql'),
    max: Number(process.env.MONITOR_NEWS_MAX) || 20,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') options.apply = true;
    else if (value === '--dry-run') options.apply = false;
    else if (value === '--findings') options.findings = path.resolve(argv[++index]);
    else if (value === '--state-db') options.stateDb = path.resolve(argv[++index]);
    else if (value === '--state-sql') options.stateSql = path.resolve(argv[++index]);
    else if (value === '--max') options.max = Number(argv[++index]);
    else throw new Error(`Unknown news option: ${value}`);
  }
  if (!Number.isInteger(options.max) || options.max < 1) throw new Error('--max must be a positive integer');
  return options;
}

export async function runNews(options: NewsOptions): Promise<{ published: number; skipped: number }> {
  const findings = JSON.parse(fs.readFileSync(options.findings, 'utf8')) as Finding[];
  const confirmed = findings.filter(finding => finding.status === 'confirmed').slice(0, options.max);
  const store = options.stateDb ? new NewsPostStore(path.resolve(ROOT, '..'), options.stateDb) : null;
  const llm = llmConfigFromEnv();
  if (options.apply && !llm) throw new Error('A monitoring LLM must be configured to auto-publish news');

  let published = 0;
  let skipped = 0;
  for (const finding of confirmed) {
    const fp = fingerprint(finding);
    if (store?.has(fp)) { skipped += 1; console.log(`skip (already posted): ${finding.iso_n3} ${finding.claim.slice(0, 60)}`); continue; }
    // Make sure the "Source" link opens; fall back to the domain root if not.
    finding.primary_urls = await Promise.all(finding.primary_urls.map(url => verifySourceUrl(url)));
    let post: TelegramPost;
    try {
      post = buildNewsPost(finding);
    } catch (error) {
      skipped += 1;
      console.warn(`skip (unpublishable): ${finding.iso_n3}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (llm) {
      try {
        await auditTelegramPost(synthesizeIssue(finding), post, { llm });
      } catch (error) {
        skipped += 1;
        console.warn(`skip (audit blocked): ${finding.iso_n3}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    } else {
      console.warn('::warning title=News audit skipped::No LLM configured; dry-run cannot verify evidence');
    }
    if (!options.apply) {
      console.log(`\n--- would publish (${finding.iso_n3}) ---\n${post.text}\n`);
      published += 1;
      continue;
    }
    const messageId = await sendTelegramPost(post, {
      token: process.env.TELEGRAM_BOT_TOKEN ?? '',
      channelId: process.env.TELEGRAM_CHANNEL_ID ?? '',
      parseMode: 'HTML',
      disablePreview: true,
    });
    store?.record(fp, finding, messageId, new Date().toISOString());
    published += 1;
    console.log(`published ${finding.iso_n3} as Telegram message ${messageId}`);
  }

  if (store) {
    store.writeMutations(options.stateSql);
    store.close();
  }
  console.log(`${options.apply ? 'published' : 'previewed'} ${published}, skipped ${skipped}`);
  return { published, skipped };
}

if (import.meta.main) {
  try {
    await runNews(readArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

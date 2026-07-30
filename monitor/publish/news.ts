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
import { llmConfigFromEnv, resolveRedirect } from '../llm/client';
import { changeKey, normalizeInstrument, officialSourcesByJurisdiction, type Finding } from '../sweep/run';
import { hostFromUrl, isGovish } from '../discovery/citations';

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

// Dedup key. Hashes the change's canonical identity (changeKey): the legal
// instrument when the change cites one — a law is one event no matter how many
// outlets report it or what date they attach — else iso+category+effective_date.
// The grounded model rephrases the same change (and wobbles its date) every run,
// so a claim- or date-based key reposted the same story every 6h (Portugal went
// out 4x). The window check in runNews (hasRecentChange) backstops the instrument-
// less fallback when the date still wobbles.
export function fingerprint(
  finding: Pick<Finding, 'iso_n3' | 'category' | 'effective_date' | 'legal_instrument'>,
): string {
  return createHash('sha1').update(changeKey(finding)).digest('hex').slice(0, 16);
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

// Auto-publish integrity gate. Before a finding reaches the channel, confirm its
// primary source is (a) an authoritative host (gov-ish or on the jurisdiction's
// manifest official-source list), (b) actually reachable, and (c) actually
// contains the quoted evidence in its original language. This blocks the failure
// the LLM evidence-audit can't catch: a hallucinated-but-internally-consistent
// finding, or a fabricated/404'd deep link (which verifySourceUrl would otherwise
// launder to a domain root). Only used on the live --apply path.
export type SourceVerdict = { verdict: 'verified' | 'refuted' | 'inconclusive'; reason: string };

// Normalise page/quote text to a comparable stream of lowercased letter/number
// "words": drop tags + script/style, decode numeric & named entities, fold
// accents (NFD + strip combining marks) so entity-encoded and raw accents match,
// and reduce punctuation to spaces (curly vs straight quotes stop mattering).
export function normalizeText(value: string): string {
  return value
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ' '; } })
    .replace(/&#(\d+);/g, (_, dec: string) => { try { return String.fromCodePoint(Number(dec)); } catch { return ' '; } })
    .replace(/&[a-z]+;/gi, ' ')
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// True if any contiguous ~8-word run of the quote appears on the page (tolerant
// of one transcription slip anywhere in the quote). For unsegmented scripts
// (CJK — few/no spaces) fall back to a character substring. A fabricated quote
// has no matching run.
export function quoteOnPage(pageNorm: string, quoteNorm: string): boolean {
  const words = quoteNorm.split(' ').filter(Boolean);
  if (words.length < 4) {
    const chars = quoteNorm.replace(/ /g, '');
    return chars.length >= 12 && pageNorm.replace(/ /g, '').includes(chars.slice(0, 24));
  }
  const run = Math.min(8, words.length);
  for (let i = 0; i + run <= words.length; i += 1) {
    if (pageNorm.includes(words.slice(i, i + run).join(' '))) return true;
  }
  return false;
}

const nonAsciiCount = (value: string) => (value.match(/[^\u0000-\u007f]/g) ?? []).length;

// Auto-publish integrity gate. Returns a tri-state verdict:
//   verified     — authoritative host + the quoted evidence is on the page
//   refuted      — non-authoritative host, OR a readable same-script page that
//                  does NOT contain the quote (real negative evidence)
//   inconclusive — could not check (unreachable/403, PDF, JS-only shell, script
//                  mismatch, no quote). "Absence of evidence" is NOT refutation;
//                  runNews falls back to grounding-citation corroboration.
export async function verifyPrimarySource(
  url: string,
  originalQuote: string,
  allowedHosts: Set<string>,
  fetcher: typeof fetch = fetch,
  claimContext?: { category?: string; claim?: string; headline?: string },
): Promise<SourceVerdict> {
  const host = hostFromUrl(url);
  if (!host) return { verdict: 'refuted', reason: 'unparseable url' };
  if (!isGovish(host) && !allowedHosts.has(host)) return { verdict: 'refuted', reason: `non-authoritative host (${host})` };
  const quoteNorm = normalizeText(originalQuote);
  if (quoteNorm.replace(/ /g, '').length < 12) return { verdict: 'inconclusive', reason: 'no verifiable quote' };
  let body: string;
  let contentType = '';
  try {
    const response = await fetcher(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
    });
    contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) return { verdict: 'inconclusive', reason: `source returned ${response.status}` };
    body = await response.text();
  } catch {
    return { verdict: 'inconclusive', reason: 'source unreachable' };
  }
  if (/application\/pdf/i.test(contentType) || body.slice(0, 5) === '%PDF-') {
    return { verdict: 'inconclusive', reason: 'pdf source (text not machine-checkable here)' };
  }
  const pageNorm = normalizeText(body);
  if (quoteOnPage(pageNorm, quoteNorm)) {
    // Quote is real — still block Saint Lucia-style grafts: CBI claim attached to a
    // constitution / ordinary-registration provision that never mentions investment.
    const graft = detectTopicGraft({
      category: claimContext?.category ?? '',
      claim: claimContext?.claim ?? '',
      headline: claimContext?.headline ?? '',
      pageNorm,
      quoteNorm,
    });
    if (graft) return { verdict: 'refuted', reason: graft };
    return { verdict: 'verified', reason: 'ok' };
  }
  // Only a genuinely text-heavy page makes a MISSING quote real negative evidence.
  // Measured: a real gov.im article server-renders ~200 normalized chars, while
  // JS-SPA gazettes (legislation.gov.au, u.ae) expose 1200-1400 chars of nav/
  // footer boilerplate with the actual content loaded by script. A bar this high
  // keeps those SPAs "inconclusive" (→ corroboration + never-silent) rather than
  // hard-refuting a real change we simply couldn't scrape.
  if (pageNorm.replace(/ /g, '').length < 1500) return { verdict: 'inconclusive', reason: 'page has little readable text (JS-rendered?)' };
  if (nonAsciiCount(quoteNorm) >= 8 && nonAsciiCount(pageNorm) < 8) return { verdict: 'inconclusive', reason: 'page/quote script mismatch' };
  return { verdict: 'refuted', reason: 'quoted evidence not found on a readable page' };
}

// Topic tokens: claim says CBI/investment but the cited page is a different route
// (constitution, ordinary naturalization, commonwealth registration, etc.).
const INVESTMENT_ROUTE_RE = /\b(invest(?:ment|or)?|cbi|cip|economic citizenship|national economic fund|qualifying investment|citizenship by investment|golden visa|residence by investment|real estate project|enterprise project)\b/i;
const ORDINARY_REGISTRATION_RE = /\b(commonwealth citizen|ordinarily resident|ordinary residence|chapter (vii|7|vi|6)|registration after|naturalis(?:ation|ation) after|years? of ordinary residence|constitution)\b/i;
const CBI_CLAIM_RE = /\b(cbi|cip|citizenship by investment|investment programme|investment program|genuine link|economic citizenship|passport for investment|qualifying dependant)\b/i;

/**
 * Detect claim→source topic grafts (e.g. Saint Lucia #122: CBI "genuine link"
 * claim backed by a constitution chapter on Commonwealth 7-year registration).
 * Returns a human-readable reason when the graft is clear; null when OK/unknown.
 */
export function detectTopicGraft(input: {
  category: string;
  claim: string;
  headline: string;
  pageNorm: string;
  quoteNorm: string;
}): string | null {
  const category = (input.category || '').toLowerCase();
  const claimBlob = `${input.claim} ${input.headline}`;
  const sourceBlob = `${input.quoteNorm} ${input.pageNorm.slice(0, 8000)}`;

  const claimIsCbi = category === 'cbi' || category === 'investment' || CBI_CLAIM_RE.test(claimBlob);
  if (!claimIsCbi) return null;

  const sourceHasInvestment = INVESTMENT_ROUTE_RE.test(sourceBlob);
  const sourceLooksOrdinary = ORDINARY_REGISTRATION_RE.test(sourceBlob);

  // Hard graft: CBI/investment claim + ordinary/constitutional registration language
  // and no investment programme language on the cited page.
  if (!sourceHasInvestment && sourceLooksOrdinary) {
    return 'topic mismatch: claim is investment/CBI but cited provision is ordinary registration or constitutional citizenship (not an investment route)';
  }
  // Softer graft: claim screams CBI but the source never mentions investment at all.
  if (!sourceHasInvestment && CBI_CLAIM_RE.test(claimBlob) && category === 'cbi') {
    return 'topic mismatch: CBI claim but cited source never mentions investment, CBI, or a programme contribution';
  }
  return null;
}

// Corroboration fallback for an INCONCLUSIVE primary source (PDF / 403 / JS-only
// shell / script mismatch). The grounding citations are independent search hits
// the model already used; resolve each short-lived redirect to its real host and
// check whether the primary source's own host appears among them. If the model
// found the same authoritative publisher independently, treat the change as
// corroborated rather than blocking a real update we simply couldn't scrape.
export async function corroboratedByCitations(
  primaryHost: string,
  citations: Array<{ uri: string }>,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!primaryHost) return false;
  const resolved = await Promise.all(
    citations.slice(0, 10).map(citation =>
      resolveRedirect(citation.uri, { fetcher }).then(hostFromUrl).catch(() => null)),
  );
  const hosts = new Set(resolved.filter((h): h is string => Boolean(h)));
  // Match the host or a registrable-domain suffix (dre.pt vs www.dre.pt wobble).
  return [...hosts].some(host =>
    host === primaryHost || host.endsWith(`.${primaryHost}`) || primaryHost.endsWith(`.${host}`));
}

interface BlockedNews {
  iso_n3: string;
  jurisdiction: string;
  headline: string;
  category: string;
  primary_urls: string[];
  reason: string;
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
// Include ISO date, prose date, and original-language quote so the auditor is not
// forced to invent mismatches from thin English-only fragments.
export function synthesizeIssue(finding: Finding): ReviewIssue {
  const effective = finding.effective_date?.trim() || '';
  const proseDate = effective ? proseDateFromIso(effective) : '';
  const body = [
    '## Verified evidence',
    '',
    finding.evidence_quote ? `Source passage (English): "${finding.evidence_quote}"` : '',
    finding.original_quote && finding.original_quote !== finding.evidence_quote
      ? `Source passage (original language): "${finding.original_quote}"`
      : '',
    finding.claim,
    finding.brief,
    effective
      ? `Effective date: ${effective}${proseDate ? ` (${proseDate})` : ''}.`
      : '',
    finding.legal_instrument ? `Legal instrument: ${finding.legal_instrument}.` : '',
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

/** "2026-06-06" → "6 June 2026" so the evidence pack and post share a prose form. */
export function proseDateFromIso(value: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const year = match[1];
  const month = months[Number(match[2]) - 1];
  const day = String(Number(match[3]));
  if (!month || !day || day === 'NaN') return '';
  return `${day} ${month} ${year}`;
}

// Dedup ledger. Mirrors the collector's state pattern: read from an exported D1
// snapshot (.sql or .sqlite), buffer portable INSERTs, and write them for the
// workflow to apply back to D1. In-memory when no path is given (local/dry-run).
export class NewsPostStore {
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

  // Semantic dedup. The same change is reworded across runs and outlets, and its
  // extracted effective_date wobbles, so exact fingerprints miss it. Treat any
  // post for the same jurisdiction + acquisition category within the window as
  // the same event (Portugal naturalization went out 4x before this).
  hasRecentChange(isoN3: string, category: string, windowDays: number, now: Date): boolean {
    const cutoff = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
    return Boolean(this.database
      .query('SELECT 1 FROM monitor_posts WHERE iso_n3 = ?1 AND category = ?2 AND posted_at >= ?3 LIMIT 1')
      .get(isoN3, category, cutoff));
  }

  record(fp: string, finding: Finding, messageId: number, postedAt: string): void {
    const values = [fp, finding.iso_n3, finding.category, finding.status, messageId, finding.primary_urls[0] ?? null, postedAt];
    const sql = `INSERT OR IGNORE INTO monitor_posts
      (fingerprint, iso_n3, category, status, telegram_message_id, primary_url, posted_at)
      VALUES (${values.map(value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replace(/[\r\n]+/g, ' ').replace(/'/g, "''")}'`).join(', ')});`;
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

export async function runNews(options: NewsOptions): Promise<{ published: number; skipped: number; blocked: number }> {
  const findings = JSON.parse(fs.readFileSync(options.findings, 'utf8')) as Finding[];
  const confirmed = findings.filter(finding => finding.status === 'confirmed').slice(0, options.max);
  const dedupWindowDays = Number(process.env.MONITOR_NEWS_DEDUP_WINDOW_DAYS) || 120;
  const store = options.stateDb ? new NewsPostStore(path.resolve(ROOT, '..'), options.stateDb) : null;
  const llm = llmConfigFromEnv();
  // Refuse to publish without the dedup ledger — otherwise every run re-posts
  // every confirmed finding. Dry-run (preview) is still allowed without a store.
  if (options.apply && !store) throw new Error('--apply requires --state-db (the dedup ledger); refusing to publish without dedup');
  if (options.apply && !llm) throw new Error('A monitoring LLM must be configured to auto-publish news');
  // Authoritative-host allowlist per jurisdiction, for the auto-publish gate.
  const officialHosts = officialSourcesByJurisdiction(ROOT);

  let published = 0;
  let skipped = 0;
  const blocked: BlockedNews[] = [];
  try {
    for (const finding of confirmed) {
      const fp = fingerprint(finding);
      if (store?.has(fp)) { skipped += 1; console.log(`skip (already posted): ${finding.iso_n3} ${finding.claim.slice(0, 60)}`); continue; }
      // The category window exists for instrument-LESS findings, whose extracted
      // effective_date wobbles across outlets and defeats the exact fingerprint.
      // A finding that cites a legal instrument already deduped exactly via
      // has(fp) above — blocking it here suppressed genuinely NEW law for 120
      // days whenever ANY same-category post existed (a real Portuguese
      // nationality reform, Lei Orgânica 1/2026, was skipped this way because
      // earlier naturalization posts for 620 sat inside the window).
      const citesInstrument = normalizeInstrument(finding.legal_instrument) !== '';
      if (!citesInstrument
        && store?.hasRecentChange(finding.iso_n3, finding.category, dedupWindowDays, new Date())) {
        skipped += 1;
        console.log(`skip (no instrument cited; same ${finding.category} change for ${finding.iso_n3} within ${dedupWindowDays}d): ${finding.claim.slice(0, 60)}`);
        continue;
      }
      // Keep the un-rewritten primary URLs for the integrity gate (verifySourceUrl
      // below may degrade a dead deep-link to a domain root for the display link).
      const originalPrimaries = [...finding.primary_urls];
      // Prefer the original-language quote for page matching; fall back to English.
      const quoteForPage = (finding.original_quote || finding.evidence_quote || '').trim();

      // Official-source gate FIRST on apply: host + live page + quote. This is the
      // real verification for auto-publish (no human in the loop). LLM audit is a
      // secondary wording/consistency check only and must not be the sole gate.
      if (options.apply) {
        const allowedHosts = new Set((officialHosts.get(finding.iso_n3) ?? [])
          .map(source => hostFromUrl(source.url))
          .filter((h): h is string => Boolean(h)));
        let verdict: SourceVerdict = { verdict: 'refuted', reason: 'no authoritative primary source' };
        const claimContext = {
          category: finding.category,
          claim: finding.claim,
          headline: finding.headline,
        };
        for (const candidate of originalPrimaries) {
          const attempt = await verifyPrimarySource(candidate, quoteForPage, allowedHosts, undefined, claimContext);
          if (attempt.verdict === 'verified') { verdict = attempt; break; }
          if (attempt.verdict === 'inconclusive' && verdict.verdict === 'refuted') verdict = attempt;
        }
        if (verdict.verdict === 'inconclusive') {
          const primaryHost = hostFromUrl(originalPrimaries[0] ?? '') ?? '';
          verdict = await corroboratedByCitations(primaryHost, finding.citations)
            ? { verdict: 'verified', reason: `quote unverifiable (${verdict.reason}); host corroborated by grounding citations` }
            : { verdict: 'refuted', reason: `${verdict.reason}; not corroborated by grounding citations` };
        }
        if (verdict.verdict !== 'verified') {
          skipped += 1;
          blocked.push({
            iso_n3: finding.iso_n3,
            jurisdiction: finding.jurisdiction,
            headline: finding.headline || finding.claim,
            category: finding.category,
            primary_urls: originalPrimaries,
            reason: verdict.reason,
          });
          console.warn(`::warning title=News blocked (${finding.jurisdiction})::${verdict.reason} — ${finding.claim.slice(0, 80)}`);
          continue;
        }
      }

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
      // Secondary: LLM consistency check. Prompt is material-facts-only — do not
      // treat date format / paraphrase / HTML as unsupported (wording risk).
      if (llm) {
        try {
          await auditTelegramPost(synthesizeIssue(finding), post, { llm });
        } catch (error) {
          skipped += 1;
          console.warn(`skip (audit blocked): ${finding.iso_n3}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      } else if (!options.apply) {
        console.warn('::warning title=News audit skipped::No LLM configured; dry-run cannot verify evidence');
      } else {
        // Apply already refused earlier when llm is missing.
      }
      if (!options.apply) {
        console.log(`\n--- would publish (${finding.iso_n3}) ---\n${post.text}\n`);
        published += 1;
        continue;
      }

      // Send, then record immediately. A later finding's send failure must not
      // lose the ledger of what already posted — that caused duplicate reposts.
      let messageId: number;
      try {
        messageId = await sendTelegramPost(post, {
          token: process.env.TELEGRAM_BOT_TOKEN ?? '',
          channelId: process.env.TELEGRAM_CHANNEL_ID ?? '',
          parseMode: 'HTML',
          disablePreview: true,
        });
      } catch (error) {
        // Don't record (it may not have posted); keep going so one 429/502
        // doesn't abort the run and drop the earlier sends from the ledger.
        skipped += 1;
        console.warn(`skip (send failed): ${finding.iso_n3}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      store?.record(fp, finding, messageId, new Date().toISOString());
      published += 1;
      console.log(`published ${finding.iso_n3} as Telegram message ${messageId}`);
    }
  } finally {
    // Always persist what we recorded, even if the loop threw unexpectedly.
    if (store) {
      store.writeMutations(options.stateSql);
      store.close();
    }
    // Never silent: write the blocked-for-review artifact on every apply run
    // (empty array when nothing was blocked) so a suppressed update is visible.
    if (options.apply) {
      const blockedPath = path.join(ROOT, '.out', 'blocked-news.json');
      fs.mkdirSync(path.dirname(blockedPath), { recursive: true });
      fs.writeFileSync(blockedPath, `${JSON.stringify(blocked, null, 2)}\n`);
    }
  }
  if (blocked.length) console.warn(`${blocked.length} finding(s) blocked for review → .out/blocked-news.json`);
  console.log(`${options.apply ? 'published' : 'previewed'} ${published}, skipped ${skipped}`);
  return { published, skipped, blocked: blocked.length };
}

if (import.meta.main) {
  try {
    await runNews(readArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

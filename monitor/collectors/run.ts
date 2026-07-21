#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { collectRss, parseRss, type RssSource } from './rss';
import {
  collectHtmlPage,
  collectHtmlSnapshot,
  parseHtmlSnapshot,
  type HtmlPage,
  type HtmlSource,
} from './html';
import {
  collectTelegramPreview,
  parseTelegramPreview,
  type TelegramSource,
} from './telegram';
import { dedupeSignals, type Signal, type SignalTier } from '../schema/signal';
import { MonitorStateStore } from '../state';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface ManifestSource {
  id: string;
  tier: SignalTier;
  adapter: string;
  status: 'active' | 'planned';
  url?: string;
  channel?: string;
  jurisdictions?: string[];
  max_items?: number;
  notes?: string;
  pages?: HtmlPage[];
  keywords?: string[];
  keyword_match?: 'any' | 'all';
}

interface SourceManifest {
  sources: ManifestSource[];
}

export interface CollectorOptions {
  fixtureDir: string | null;
  sourceId: string | null;
  strict: boolean;
  output: string;
  report: string;
  lookbackDays: number;
  stateDb: string | null;
  stateSql: string;
}

interface SourceResult {
  source_id: string;
  status: 'ok' | 'partial' | 'error';
  fetched?: number;
  accepted?: number;
  error?: string;
  duration_ms: number;
  pages_attempted?: number;
  pages_changed?: number;
}

export interface CollectionReport {
  retrieved_at: string;
  fixture_mode: boolean;
  lookback_days: number;
  sources_attempted: number;
  sources_failed: number;
  signal_count: number;
  duplicate_count: number;
  sources: SourceResult[];
}

function readArgs(argv: string[]): CollectorOptions {
  const options: CollectorOptions = {
    fixtureDir: null,
    sourceId: null,
    strict: false,
    output: path.join(ROOT, '.out', 'signals.json'),
    report: path.join(ROOT, '.out', 'collection-report.json'),
    lookbackDays: Number(process.env.MONITOR_LOOKBACK_DAYS ?? 14),
    stateDb: process.env.MONITOR_STATE_DB ? path.resolve(process.env.MONITOR_STATE_DB) : null,
    stateSql: path.join(ROOT, '.out', 'monitor-state.sql'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--strict') options.strict = true;
    else if (value === '--fixture-dir') options.fixtureDir = path.resolve(argv[++index]);
    else if (value === '--source') options.sourceId = argv[++index];
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--report') options.report = path.resolve(argv[++index]);
    else if (value === '--lookback-days') options.lookbackDays = Number(argv[++index]);
    else if (value === '--state-db') options.stateDb = path.resolve(argv[++index]);
    else if (value === '--state-sql') options.stateSql = path.resolve(argv[++index]);
    else throw new Error(`Unknown collector option: ${value}`);
  }
  if (!Number.isFinite(options.lookbackDays) || options.lookbackDays < 0) {
    throw new Error('--lookback-days must be a non-negative number');
  }
  return options;
}

function isRssSource(source: ManifestSource): source is ManifestSource & RssSource {
  return source.adapter === 'rss' && typeof source.url === 'string' && source.url.length > 0;
}

function isTelegramSource(source: ManifestSource): source is ManifestSource & TelegramSource {
  return source.adapter === 'telegram_html' &&
    typeof source.url === 'string' &&
    source.url.length > 0 &&
    typeof source.channel === 'string' &&
    source.channel.length > 0;
}

function isHtmlSource(source: ManifestSource): source is ManifestSource & HtmlSource {
  return source.adapter === 'html_index' && (
    (typeof source.url === 'string' && source.url.length > 0)
    || Boolean(source.pages?.length)
  );
}

export function expandHtmlPages(source: ManifestSource & HtmlSource): HtmlSource[] {
  if (!source.pages?.length) return [source];
  return source.pages.map(page => ({
    id: source.id,
    tier: source.tier,
    adapter: 'html_index',
    url: page.url,
    jurisdictions: [page.jurisdiction ?? source.jurisdictions?.[0] ?? 'multi'],
    keywords: page.keywords ?? source.keywords,
    page_id: page.id,
  }));
}

export function signalMatchesKeywords(signal: Signal, source: ManifestSource): boolean {
  if (!source.keywords?.length) return true;
  const haystack = `${signal.title} ${signal.excerpt}`.toLocaleLowerCase();
  const matches = source.keywords.map(keyword => haystack.includes(keyword.toLocaleLowerCase()));
  return source.keyword_match === 'all' ? matches.every(Boolean) : matches.some(Boolean);
}

function collectFixture(source: ManifestSource, fixtureDir: string, retrievedAt: string): Signal[] {
  const extension = isTelegramSource(source) || isHtmlSource(source) ? 'html' : 'xml';
  const fixturePath = path.join(fixtureDir, `${source.id}.${extension}`);
  if (!fs.existsSync(fixturePath)) throw new Error(`fixture missing: ${fixturePath}`);
  const fixture = fs.readFileSync(fixturePath, 'utf8');
  if (isRssSource(source)) return parseRss(fixture, source, { retrievedAt });
  if (isTelegramSource(source)) return parseTelegramPreview(fixture, source, { retrievedAt });
  if (isHtmlSource(source)) return expandHtmlPages(source).flatMap(page =>
    parseHtmlSnapshot(fixture, page, { retrievedAt }));
  throw new Error(`active adapter "${source.adapter}" is not implemented`);
}

function withinLookback(signal: Signal, days: number, now: string): boolean {
  if (days === 0 || !signal.published_at) return true;
  return Date.parse(signal.published_at) >= Date.parse(now) - days * 86_400_000;
}

export async function runCollectors(
  options: CollectorOptions,
): Promise<{ signals: Signal[]; report: CollectionReport }> {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'sources', 'manifest.json'), 'utf8'),
  ) as SourceManifest;
  const active = manifest.sources.filter(source =>
    source.status === 'active' && (!options.sourceId || source.id === options.sourceId));
  if (options.sourceId && active.length === 0) {
    throw new Error(`No active source found with id "${options.sourceId}"`);
  }

  const retrievedAt = new Date().toISOString();
  const collected: Signal[] = [];
  const sourceResults: SourceResult[] = [];
  const state = options.stateDb
    ? new MonitorStateStore(path.resolve(ROOT, '..'), options.stateDb)
    : null;

  for (const source of active) {
    const startedAt = Date.now();
    try {
      let pagesAttempted: number | undefined;
      let pagesChanged: number | undefined;
      let pageErrors: string[] = [];
      const found = options.fixtureDir
        ? collectFixture(source, options.fixtureDir, retrievedAt)
        : isRssSource(source)
          ? await collectRss(source, { retrievedAt })
          : isTelegramSource(source)
            ? await collectTelegramPreview(source, { retrievedAt })
            : isHtmlSource(source)
              ? state
                ? await (async () => {
                  const pages = expandHtmlPages(source);
                  pagesAttempted = pages.length;
                  pagesChanged = 0;
                  const signals: Signal[] = [];
                  for (const page of pages) {
                    const prior = state.getPage(`${page.id}:${page.page_id ?? ''}`)
                      ?? state.getPage(`${page.id}:${createHash('sha256').update(page.url).digest('hex').slice(0, 12)}`);
                    const result = await collectHtmlPage(page, prior, { retrievedAt });
                    state.record(result.observation);
                    signals.push(...result.signals);
                    if (result.observation.change_kind === 'page_changed') pagesChanged += 1;
                    if (result.error) pageErrors.push(`${page.page_id ?? page.url}: ${result.error}`);
                  }
                  return signals;
                })()
                : (await Promise.all(expandHtmlPages(source).map(page =>
                  collectHtmlSnapshot(page, { retrievedAt })))).flat()
            : (() => { throw new Error(`active adapter "${source.adapter}" is not implemented`); })();
      const recent = found
        .filter(signal => withinLookback(signal, options.lookbackDays, retrievedAt))
        .filter(signal => signalMatchesKeywords(signal, source));
      collected.push(...recent);
      sourceResults.push({
        source_id: source.id,
        status: pageErrors.length ? 'partial' : 'ok',
        fetched: found.length,
        accepted: recent.length,
        duration_ms: Date.now() - startedAt,
        ...(pagesAttempted == null ? {} : { pages_attempted: pagesAttempted }),
        ...(pagesChanged == null ? {} : { pages_changed: pagesChanged }),
        ...(pageErrors.length ? { error: pageErrors.join('; ') } : {}),
      });
      if (pageErrors.length) {
        console.error(`::warning title=Monitor source partially failed::${source.id}: ${pageErrors.join('; ')}`);
      } else {
        console.log(`${source.id}: ${recent.length}/${found.length} signals inside lookback`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sourceResults.push({
        source_id: source.id,
        status: 'error',
        error: message,
        duration_ms: Date.now() - startedAt,
      });
      console.error(`::warning title=Monitor source failed::${source.id}: ${message}`);
    }
  }

  const signals = dedupeSignals(collected);
  const failures = sourceResults.filter(result => result.status !== 'ok');
  const hardFailures = sourceResults.filter(result => result.status === 'error');
  const report: CollectionReport = {
    retrieved_at: retrievedAt,
    fixture_mode: Boolean(options.fixtureDir),
    lookback_days: options.lookbackDays,
    sources_attempted: active.length,
    sources_failed: failures.length,
    signal_count: signals.length,
    duplicate_count: collected.length - signals.length,
    sources: sourceResults,
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(path.dirname(options.report), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(signals, null, 2)}\n`);
  fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  if (state) {
    state.writeMutations(options.stateSql);
    state.close();
  }
  console.log(`wrote ${signals.length} signals to ${options.output}`);

  // Page-level access degradation is durable monitoring data, not a reason to
  // discard healthy signals from every other source. Strict mode still fails
  // on collector/adapter crashes; partial health remains visible in D1 and the
  // collection report for follow-up.
  if ((options.strict && hardFailures.length > 0) || (active.length > 0 && failures.length === active.length)) {
    throw new Error(`${failures.length}/${active.length} monitor sources failed (${hardFailures.length} hard)`);
  }
  return { signals, report };
}

if (import.meta.main) {
  try {
    await runCollectors(readArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

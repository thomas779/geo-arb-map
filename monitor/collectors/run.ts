#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRss, parseRss, type RssSource } from './rss';
import {
  collectTelegramPreview,
  parseTelegramPreview,
  type TelegramSource,
} from './telegram';
import { dedupeSignals, type Signal, type SignalTier } from '../schema/signal';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ManifestSource {
  id: string;
  tier: SignalTier;
  adapter: string;
  status: 'active' | 'planned';
  url?: string;
  channel?: string;
  jurisdictions?: string[];
  max_items?: number;
  notes?: string;
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
}

interface SourceResult {
  source_id: string;
  status: 'ok' | 'error';
  fetched?: number;
  accepted?: number;
  error?: string;
  duration_ms: number;
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
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--strict') options.strict = true;
    else if (value === '--fixture-dir') options.fixtureDir = path.resolve(argv[++index]);
    else if (value === '--source') options.sourceId = argv[++index];
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--report') options.report = path.resolve(argv[++index]);
    else if (value === '--lookback-days') options.lookbackDays = Number(argv[++index]);
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

function collectFixture(source: ManifestSource, fixtureDir: string, retrievedAt: string): Signal[] {
  const extension = isTelegramSource(source) ? 'html' : 'xml';
  const fixturePath = path.join(fixtureDir, `${source.id}.${extension}`);
  if (!fs.existsSync(fixturePath)) throw new Error(`fixture missing: ${fixturePath}`);
  const fixture = fs.readFileSync(fixturePath, 'utf8');
  if (isRssSource(source)) return parseRss(fixture, source, { retrievedAt });
  if (isTelegramSource(source)) return parseTelegramPreview(fixture, source, { retrievedAt });
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

  for (const source of active) {
    const startedAt = Date.now();
    try {
      const found = options.fixtureDir
        ? collectFixture(source, options.fixtureDir, retrievedAt)
        : isRssSource(source)
          ? await collectRss(source, { retrievedAt })
          : isTelegramSource(source)
            ? await collectTelegramPreview(source, { retrievedAt })
            : (() => { throw new Error(`active adapter "${source.adapter}" is not implemented`); })();
      const recent = found.filter(signal => withinLookback(signal, options.lookbackDays, retrievedAt));
      collected.push(...recent);
      sourceResults.push({
        source_id: source.id,
        status: 'ok',
        fetched: found.length,
        accepted: recent.length,
        duration_ms: Date.now() - startedAt,
      });
      console.log(`${source.id}: ${recent.length}/${found.length} signals inside lookback`);
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
  const failures = sourceResults.filter(result => result.status === 'error');
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
  console.log(`wrote ${signals.length} signals to ${options.output}`);

  if ((options.strict && failures.length > 0) || (active.length > 0 && failures.length === active.length)) {
    throw new Error(`${failures.length}/${active.length} monitor sources failed`);
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

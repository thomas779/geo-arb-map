#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNewsletterMessages, type EmailSource } from './email';
import type { NormalizedNewsletterMessage } from '../schema/newsletter';
import type { SignalTier } from '../schema/signal';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ManifestSource {
  id: string;
  tier: SignalTier;
  adapter: string;
  status: 'active' | 'planned';
  jurisdictions?: string[];
}

interface SourceManifest {
  sources: ManifestSource[];
}

interface NewsletterDispatch {
  client_payload?: {
    source_id?: unknown;
    message?: unknown;
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizedMessage(value: unknown): NormalizedNewsletterMessage {
  if (!value || typeof value !== 'object') {
    throw new TypeError('client_payload.message must be an object');
  }
  const message = value as Record<string, unknown>;
  return {
    message_id: requiredString(message.message_id, 'message.message_id'),
    subject: requiredString(message.subject, 'message.subject'),
    text: typeof message.text === 'string' ? message.text : '',
    received_at: requiredString(message.received_at, 'message.received_at'),
    canonical_url: requiredString(message.canonical_url, 'message.canonical_url'),
  };
}

export function signalFromNewsletterDispatch(
  event: NewsletterDispatch,
  manifest: SourceManifest,
  retrievedAt = new Date().toISOString(),
) {
  const sourceId = requiredString(event.client_payload?.source_id, 'client_payload.source_id');
  const source = manifest.sources.find(entry => entry.id === sourceId);
  if (!source || source.adapter !== 'email') {
    throw new TypeError(`Unknown email source: ${sourceId}`);
  }
  const emailSource: EmailSource = {
    id: source.id,
    tier: source.tier,
    adapter: 'email',
    jurisdictions: source.jurisdictions,
  };
  const signals = parseNewsletterMessages(
    [normalizedMessage(event.client_payload?.message)],
    emailSource,
    { retrievedAt },
  );
  if (signals.length !== 1) {
    throw new TypeError('Newsletter dispatch did not contain an auditable public article URL');
  }
  return signals[0];
}

function readArgs(argv: string[]) {
  const options = {
    event: process.env.GITHUB_EVENT_PATH || '',
    output: path.join(ROOT, '.out', 'signals.json'),
    report: path.join(ROOT, '.out', 'collection-report.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--event') options.event = path.resolve(argv[++index]);
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--report') options.report = path.resolve(argv[++index]);
    else throw new Error(`Unknown newsletter dispatch option: ${value}`);
  }
  if (!options.event) throw new Error('GITHUB_EVENT_PATH or --event is required');
  return options;
}

if (import.meta.main) {
  try {
    const options = readArgs(process.argv.slice(2));
    const event = JSON.parse(fs.readFileSync(options.event, 'utf8')) as NewsletterDispatch;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'sources', 'manifest.json'), 'utf8'),
    ) as SourceManifest;
    const retrievedAt = new Date().toISOString();
    const signal = signalFromNewsletterDispatch(event, manifest, retrievedAt);
    const report = {
      retrieved_at: retrievedAt,
      fixture_mode: false,
      lookback_days: 0,
      sources_attempted: 1,
      sources_failed: 0,
      signal_count: 1,
      duplicate_count: 0,
      sources: [{
        source_id: signal.source_id,
        status: 'ok',
        fetched: 1,
        accepted: 1,
        duration_ms: 0,
      }],
    };
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.mkdirSync(path.dirname(options.report), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify([signal], null, 2)}\n`);
    fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote newsletter signal ${signal.id} to ${options.output}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

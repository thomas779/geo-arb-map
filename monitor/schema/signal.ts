// The one shape every collector emits, regardless of source transport.

import { createHash } from 'node:crypto';

export type SignalTier = 'discovery' | 'verification';

export interface Signal {
  id: string;
  source_id: string;
  tier: SignalTier;
  jurisdiction: string;
  url: string;
  title: string;
  excerpt: string;
  published_at: string | null;
  retrieved_at: string;
}

export interface MakeSignalInput {
  sourceId: string;
  tier: SignalTier;
  jurisdiction?: string;
  externalId: string;
  url: string;
  title: string;
  excerpt?: string;
  publishedAt?: string | null;
  retrievedAt?: string;
}

export const SIGNAL_TIERS = new Set<SignalTier>(['discovery', 'verification']);

export function signalId(sourceId: string, externalId: string): string {
  return createHash('sha1').update(`${sourceId}:${externalId}`).digest('hex').slice(0, 12);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Signal ${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalDate(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
    throw new TypeError(`Signal ${field} must be an ISO-compatible date`);
  }
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) throw new TypeError(`Signal ${field} must be an ISO-compatible date`);
  return new Date(parsed).toISOString();
}

export function makeSignal({
  sourceId,
  tier,
  jurisdiction,
  externalId,
  url,
  title,
  excerpt = '',
  publishedAt,
  retrievedAt = new Date().toISOString(),
}: MakeSignalInput): Signal {
  const cleanSourceId = requiredString(sourceId, 'source_id');
  const cleanExternalId = requiredString(externalId, 'external_id');
  if (!SIGNAL_TIERS.has(tier)) {
    throw new TypeError('Signal tier must be "discovery" or "verification"');
  }

  return assertSignal({
    id: signalId(cleanSourceId, cleanExternalId),
    source_id: cleanSourceId,
    tier,
    jurisdiction: requiredString(jurisdiction || 'multi', 'jurisdiction'),
    url: requiredString(url, 'url'),
    title: requiredString(title, 'title').slice(0, 300),
    excerpt: String(excerpt ?? '').trim().slice(0, 500),
    published_at: optionalDate(publishedAt, 'published_at'),
    retrieved_at: optionalDate(retrievedAt, 'retrieved_at'),
  });
}

export function assertSignal(value: unknown): Signal {
  if (!value || typeof value !== 'object') throw new TypeError('Signal must be an object');
  const signal = value as Record<string, unknown>;
  if (!/^[a-f0-9]{12}$/.test(requiredString(signal.id, 'id'))) {
    throw new TypeError('Signal id must be a 12-character lowercase hex hash');
  }
  requiredString(signal.source_id, 'source_id');
  requiredString(signal.jurisdiction, 'jurisdiction');
  requiredString(signal.url, 'url');
  requiredString(signal.title, 'title');
  if (!SIGNAL_TIERS.has(signal.tier as SignalTier)) {
    throw new TypeError(`Invalid Signal tier: ${String(signal.tier)}`);
  }
  optionalDate(signal.published_at, 'published_at');
  if (optionalDate(signal.retrieved_at, 'retrieved_at') === null) {
    throw new TypeError('Signal retrieved_at is required');
  }
  return value as Signal;
}

export function dedupeSignals(signals: Signal[]): Signal[] {
  const byId = new Map<string, Signal>();
  for (const signal of signals) {
    assertSignal(signal);
    if (!byId.has(signal.id)) byId.set(signal.id, signal);
  }
  return [...byId.values()];
}

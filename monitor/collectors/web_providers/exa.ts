/** Exa deep-search provider with structured lead output. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import countries from 'i18n-iso-countries';
import {
  type DiscoverLead,
  type ProviderPackResult,
  type RegionPack,
} from './shared';

const PROMPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'prompts',
  'exa-weekly-discovery.md',
);

/**
 * Exa caps outputSchema objects at 10 properties. Keep the lead shape ≤10 and
 * derive disposition / horizon / affects_dataset locally after the call.
 */
const LEAD_SCHEMA = {
  type: 'object',
  required: ['leads', 'coverage_backfill'],
  additionalProperties: false,
  properties: {
    leads: { type: 'array', items: leadItemSchema() },
    coverage_backfill: { type: 'array', items: leadItemSchema() },
  },
} as const;

function leadItemSchema() {
  // Exactly 10 properties — Exa rejects schemas with more than 10 per object.
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'jurisdiction',
      'claim_summary',
      'change_kind',
      'timing',
      'discovery_url',
      'confidence',
      'disposition',
    ],
    properties: {
      jurisdiction: { type: 'string', description: 'ISO alpha-2 or country name' },
      claim_summary: { type: 'string' },
      change_kind: {
        type: 'string',
        enum: [
          'threshold', 'eligibility', 'new_programme', 'closure',
          'dual_nationality', 'naturalisation', 'other',
        ],
      },
      timing: {
        type: 'string',
        enum: ['in_force', 'announced_not_yet_in_force', 'rumour', 'unclear'],
      },
      effective_or_announced_date: { type: ['string', 'null'] },
      primary_url: { type: ['string', 'null'] },
      discovery_url: { type: 'string' },
      quote: { type: ['string', 'null'], description: 'Verbatim ≤40 words; caveats may follow after — ' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      disposition: {
        type: 'string',
        enum: [
          'verify_and_author', 'pending_enactment', 'needs_primary',
          'not_newsworthy', 'already_held',
        ],
      },
    },
  };
}

function normalizeLead(raw: Record<string, unknown>, region: string): DiscoverLead | null {
  const claim = String(raw.claim_summary ?? '').trim();
  const discovery = String(raw.discovery_url ?? '').trim();
  if (!claim || !discovery) return null;
  const timing = (raw.timing as DiscoverLead['timing']) || 'unclear';
  const confidence = (raw.confidence as DiscoverLead['confidence']) || 'low';
  const primary = raw.primary_url ? String(raw.primary_url) : null;
  const disposition = (raw.disposition as DiscoverLead['recommended_disposition'])
    || (raw.recommended_disposition as DiscoverLead['recommended_disposition'])
    || (timing === 'rumour' || timing === 'announced_not_yet_in_force'
      ? 'pending_enactment'
      : primary
        ? 'verify_and_author'
        : 'needs_primary');
  const jurisdiction = String(raw.jurisdiction ?? '').trim() || 'unknown';
  return {
    jurisdiction,
    iso_n3: alpha2ToN3(jurisdiction),
    claim_summary: claim,
    change_kind: (raw.change_kind as DiscoverLead['change_kind']) || 'other',
    timing,
    effective_or_announced_date: raw.effective_or_announced_date
      ? String(raw.effective_or_announced_date).slice(0, 10)
      : null,
    horizon: timing === 'in_force' ? 'past_7_days' : 'upcoming_6_12_months',
    primary_url: primary,
    discovery_url: discovery,
    quote: raw.quote ? String(raw.quote) : null,
    confidence,
    affects_dataset: disposition !== 'not_newsworthy',
    recommended_disposition: disposition,
    why_not_noise: 'Exa structured mobility-law lead',
    notes: String(raw.notes ?? ''),
    region,
    provider: 'exa',
  };
}

function alpha2ToN3(jurisdiction: string): string | null {
  const code = jurisdiction.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const n = countries.alpha2ToNumeric(code);
  return n ? String(n).padStart(3, '0') : null;
}

function extractPack(content: unknown, region: string): { leads: DiscoverLead[]; backfill: DiscoverLead[] } {
  let parsed = content;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      return { leads: [], backfill: [] };
    }
  }
  if (!parsed || typeof parsed !== 'object') return { leads: [], backfill: [] };
  const obj = parsed as { leads?: unknown[]; coverage_backfill?: unknown[] };
  const leads = (obj.leads ?? [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => normalizeLead(item, region))
    .filter((item): item is DiscoverLead => item !== null);
  const backfill = (obj.coverage_backfill ?? [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => normalizeLead(item, region))
    .filter((item): item is DiscoverLead => item !== null);
  return { leads, backfill };
}

function startPublishedIso(lookbackDays: number): string {
  return new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
}

export function loadExaSystemPrompt(): string {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

export async function searchExaRegion(opts: {
  apiKey: string;
  pack: RegionPack;
  lookbackDays: number;
  searchType: string;
  systemPrompt: string;
  timeoutMs: number;
}): Promise<ProviderPackResult> {
  const query =
    `Flag Paths mobility-law discovery for REGION: ${opts.pack.label}. `
    + `Focus on: ${opts.pack.queryHint}. `
    + `Return structured leads for the last ${opts.lookbackDays} days and upcoming `
    + `announced/rumoured changes (next 6–12 months). Prefer gazette/ministry/CIP primaries.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
      },
      body: JSON.stringify({
        query,
        type: opts.searchType,
        numResults: 12,
        systemPrompt: opts.systemPrompt,
        outputSchema: LEAD_SCHEMA,
        startPublishedDate: startPublishedIso(opts.lookbackDays),
        contents: { highlights: { maxCharacters: 2000 } },
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        provider: 'exa',
        region: opts.pack.id,
        leads: [],
        backfill: [],
        credits_used: null,
        cost_dollars: null,
        error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
      };
    }
    const body = JSON.parse(text) as {
      output?: { content?: unknown };
      costDollars?: { total?: number };
    };
    const packOut = extractPack(body.output?.content, opts.pack.id);
    return {
      provider: 'exa',
      region: opts.pack.id,
      leads: packOut.leads,
      backfill: packOut.backfill,
      credits_used: null,
      cost_dollars: typeof body.costDollars?.total === 'number' ? body.costDollars.total : null,
    };
  } catch (error) {
    return {
      provider: 'exa',
      region: opts.pack.id,
      leads: [],
      backfill: [],
      credits_used: null,
      cost_dollars: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Exa deep-search provider with structured lead output. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import countries from 'i18n-iso-countries';
import { exaSearch } from '../../lib/web-clients';
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
 * Exa caps each object in outputSchema at 10 properties. Use 8 plain string
 * fields (no null unions — empty string means absent) so validation stays happy.
 * coverage_backfill is derived empty here; older items can come from Tavily/Firecrawl.
 */
const LEAD_SCHEMA = {
  type: 'object',
  required: ['leads'],
  properties: {
    leads: {
      type: 'array',
      description:
        'Mobility-law leads. Each item JSON keys: jurisdiction, claim_summary, change_kind, '
        + 'timing, discovery_url, primary_url, quote, confidence, disposition, effective_date',
      items: {
        type: 'object',
        // Stay well under Exa's 10-property cap (counted per object).
        required: ['jurisdiction', 'claim_summary', 'discovery_url', 'confidence'],
        properties: {
          jurisdiction: { type: 'string' },
          claim_summary: { type: 'string' },
          change_kind: { type: 'string' },
          timing: { type: 'string' },
          discovery_url: { type: 'string' },
          primary_url: { type: 'string' },
          quote: { type: 'string' },
          confidence: { type: 'string' },
        },
      },
    },
  },
} as const;

function emptyToNull(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

function normalizeLead(raw: Record<string, unknown>, region: string): DiscoverLead | null {
  const claim = String(raw.claim_summary ?? '').trim();
  const discovery = String(raw.discovery_url ?? '').trim();
  if (!claim || !discovery) return null;
  const timingRaw = String(raw.timing ?? 'unclear');
  const timing = (
    ['in_force', 'announced_not_yet_in_force', 'rumour', 'unclear'].includes(timingRaw)
      ? timingRaw
      : 'unclear'
  ) as DiscoverLead['timing'];
  const confidenceRaw = String(raw.confidence ?? 'low');
  const confidence = (
    ['high', 'medium', 'low'].includes(confidenceRaw) ? confidenceRaw : 'low'
  ) as DiscoverLead['confidence'];
  const primary = emptyToNull(raw.primary_url);
  const dispositionRaw = String(raw.disposition ?? '');
  const disposition = (
    [
      'verify_and_author', 'pending_enactment', 'needs_primary',
      'not_newsworthy', 'already_held',
    ].includes(dispositionRaw)
      ? dispositionRaw
      : (timing === 'rumour' || timing === 'announced_not_yet_in_force'
        ? 'pending_enactment'
        : primary
          ? 'verify_and_author'
          : 'needs_primary')
  ) as DiscoverLead['recommended_disposition'];
  const jurisdiction = String(raw.jurisdiction ?? '').trim() || 'unknown';
  const kindRaw = String(raw.change_kind ?? 'other');
  const change_kind = (
    [
      'threshold', 'eligibility', 'new_programme', 'closure',
      'dual_nationality', 'naturalisation', 'other',
    ].includes(kindRaw)
      ? kindRaw
      : 'other'
  ) as DiscoverLead['change_kind'];
  return {
    jurisdiction,
    iso_n3: alpha2ToN3(jurisdiction),
    claim_summary: claim,
    change_kind,
    timing,
    effective_or_announced_date: emptyToNull(raw.effective_date ?? raw.effective_or_announced_date)
      ?.slice(0, 10) ?? null,
    horizon: timing === 'in_force' ? 'past_7_days' : 'upcoming_6_12_months',
    primary_url: primary,
    discovery_url: discovery,
    quote: emptyToNull(raw.quote),
    confidence,
    affects_dataset: disposition !== 'not_newsworthy',
    recommended_disposition: disposition,
    why_not_noise: 'Exa structured mobility-law lead',
    notes: '',
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
  const obj = parsed as { leads?: unknown[] };
  const leads = (obj.leads ?? [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => normalizeLead(item, region))
    .filter((item): item is DiscoverLead => item !== null);
  return { leads, backfill: [] };
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

  const result = await exaSearch({
    apiKey: opts.apiKey,
    query,
    systemPrompt: opts.systemPrompt,
    type: opts.searchType as 'deep-lite' | 'deep' | 'deep-reasoning' | 'auto',
    outputSchema: LEAD_SCHEMA as unknown as Record<string, unknown>,
    numResults: 12,
    startPublishedDate: startPublishedIso(opts.lookbackDays),
    timeoutMs: opts.timeoutMs,
  });

  if (result.error) {
    return {
      provider: 'exa',
      region: opts.pack.id,
      leads: [],
      backfill: [],
      credits_used: null,
      cost_dollars: result.cost_dollars,
      error: result.error,
    };
  }

  const packOut = extractPack(result.structured, opts.pack.id);
  return {
    provider: 'exa',
    region: opts.pack.id,
    leads: packOut.leads,
    backfill: packOut.backfill,
    credits_used: null,
    cost_dollars: result.cost_dollars,
  };
}

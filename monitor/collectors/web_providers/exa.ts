/** Exa deep-search provider with structured lead output. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exaSearch } from '../../lib/web-clients';
// The jurisdiction resolver already exists for X search (M49 / alpha-2 / alpha-3
// / country name → M49). Reused rather than re-written so both collectors resolve
// "UAE" the same way.
import { resolveIso } from '../x_search';
import {
  hostOf,
  isHttpUrl,
  isNonPrimaryHost,
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
 * Exa caps each object in outputSchema at 10 properties. Plain string fields
 * only (no null unions — empty string means absent) so validation stays happy.
 *
 * All 10 slots are now spent. The last two went to the two answers the prompt
 * asks for and the schema had no way to carry back: `affects_dataset` (prompt
 * "Set affects_dataset false for pure process changes") and `instrument`, which
 * is what makes one gazette act reported by three outlets one lead.
 */
const LEAD_SCHEMA = {
  type: 'object',
  required: ['leads'],
  properties: {
    leads: {
      type: 'array',
      description:
        'Mobility-law leads. Each item JSON keys: jurisdiction, claim_summary, change_kind, '
        + 'timing, discovery_url, primary_url, quote, confidence, affects_dataset, instrument',
      items: {
        type: 'object',
        // Exactly at Exa's 10-property cap (counted per object).
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
          affects_dataset: {
            type: 'string',
            description:
              '"true" if a modelled eligibility/threshold/status field would move; "false" for '
              + 'pure process, competent-authority or political-rights changes; "" if you cannot tell',
          },
          instrument: {
            type: 'string',
            description:
              'Official identifier of the law/decree/act if one is cited (e.g. "1/2026", "PF-67"); '
              + '"" if none is named. Never invent one.',
          },
        },
      },
    },
  },
} as const;

function emptyToNull(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

/**
 * null is NOT RECORDED. An unset, empty or unrecognised value stays null rather
 * than defaulting to true: the row asserting "this changes the dataset" is the
 * row a reviewer acts on, so nothing but an explicit answer may write it.
 */
function parseAffectsDataset(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const s = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', '1'].includes(s)) return true;
  if (['false', 'no', '0'].includes(s)) return false;
  return null;
}

function normalizeLead(raw: Record<string, unknown>, region: string): DiscoverLead | null {
  const claim = String(raw.claim_summary ?? '').trim();
  const discovery = String(raw.discovery_url ?? '').trim();
  // discovery_url is the one link every lead must have, so it gets the same URL
  // test as primary_url. "N/A" is not a discovery source.
  if (!claim || !isHttpUrl(discovery)) return null;
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
  // A primary_url only counts if it is a URL and its host can be authority. The
  // prompt says this three times ("never as authority", "set primary_url null
  // and recommended_disposition to needs_primary") and enforced it nowhere, so a
  // Fragomen alert or the literal string "N/A" used to flip a row to
  // verify_and_author. Rejected values are reported in notes, not swallowed.
  const primaryRaw = emptyToNull(raw.primary_url);
  const primaryRejections: string[] = [];
  let primary: string | null = null;
  if (primaryRaw) {
    if (!isHttpUrl(primaryRaw)) {
      primaryRejections.push(`primary_url discarded — not an http(s) URL: "${primaryRaw.slice(0, 120)}"`);
    } else if (isNonPrimaryHost(primaryRaw)) {
      primaryRejections.push(
        `primary_url discarded — ${hostOf(primaryRaw)} is trade press / a firm alert, `
        + 'a discovery pointer and never authority',
      );
    } else {
      primary = primaryRaw;
    }
  }
  const dispositionRaw = String(raw.disposition ?? '');
  const claimed = (
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
  // verify_and_author means "a reviewer can go and author from the primary".
  // Without a surviving primary there is nothing to author from.
  const disposition: DiscoverLead['recommended_disposition'] =
    claimed === 'verify_and_author' && !primary ? 'needs_primary' : claimed;
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
  const quote = emptyToNull(raw.quote);
  return {
    jurisdiction,
    iso_n3: resolveIso(jurisdiction) || null,
    claim_summary: claim,
    change_kind,
    timing,
    effective_or_announced_date: emptyToNull(raw.effective_date ?? raw.effective_or_announced_date)
      ?.slice(0, 10) ?? null,
    horizon: timing === 'in_force' ? 'past_7_days' : 'upcoming_6_12_months',
    primary_url: primary,
    discovery_url: discovery,
    quote,
    confidence,
    // Read, never inferred. The old `disposition !== 'not_newsworthy'` asserted a
    // dataset impact on every row that merely was not obvious noise.
    affects_dataset: parseAffectsDataset(raw.affects_dataset),
    recommended_disposition: disposition,
    // Describe the row, do not editorialise it. The old fixed string
    // ("Exa structured mobility-law lead") read as a model determination that
    // this is not noise, on rows where the model had said nothing of the kind.
    why_not_noise: [
      `Exa structured row: ${change_kind}, timing ${timing}`,
      primary ? `primary cited on ${hostOf(primary)}` : 'no usable primary cited',
      quote ? 'verbatim quote supplied' : 'no quote supplied',
    ].join('; '),
    notes: primaryRejections.join(' '),
    instrument: emptyToNull(raw.instrument),
    region,
    provider: 'exa',
  };
}

export interface ExaPackExtract {
  leads: DiscoverLead[];
  backfill: DiscoverLead[];
  /** Rows present in the payload that lacked a claim or a usable discovery URL. */
  dropped_incomplete: number;
  /** Set when the payload itself is unusable — NOT the same as a quiet week. */
  error?: string;
}

/**
 * A malformed payload is an error, not an empty result.
 *
 * Returning `{leads: []}` for a parse failure, a non-object, or a renamed
 * wrapper key made a broken response indistinguishable from a genuinely quiet
 * week: `result.error` stayed unset, the run logged "→ 0 leads" and exited 0, so
 * the pipeline reported success for a week it had learned nothing about.
 */
export function extractPack(content: unknown, region: string): ExaPackExtract {
  const empty = { leads: [], backfill: [], dropped_incomplete: 0 };
  if (content == null || content === '') {
    return { ...empty, error: 'Exa returned no structured output' };
  }
  let parsed = content;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      return {
        ...empty,
        error: `Exa structured output was not JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...empty, error: `Exa structured output was not a JSON object (got ${Array.isArray(parsed) ? 'array' : typeof parsed})` };
  }
  const obj = parsed as { leads?: unknown; coverage_backfill?: unknown };
  if (obj.leads !== undefined && !Array.isArray(obj.leads)) {
    return { ...empty, error: 'Exa structured output has a non-array "leads"' };
  }
  if (obj.coverage_backfill !== undefined && !Array.isArray(obj.coverage_backfill)) {
    return { ...empty, error: 'Exa structured output has a non-array "coverage_backfill"' };
  }
  if (obj.leads === undefined && obj.coverage_backfill === undefined) {
    // A renamed or missing wrapper key. The schema requires `leads`, so its
    // absence means the response did not follow the schema — report it.
    return { ...empty, error: `Exa structured output has no "leads" key (keys: ${Object.keys(obj).slice(0, 8).join(', ') || 'none'})` };
  }
  let dropped = 0;
  const normalize = (items: unknown[]): DiscoverLead[] => items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => {
      const lead = normalizeLead(item, region);
      if (!lead) dropped += 1;
      return lead;
    })
    .filter((item): item is DiscoverLead => item !== null);
  // coverage_backfill is what the prompt tells the model to fill (method rule 6);
  // it was specified, generated, and then thrown away by this function.
  const leads = normalize((obj.leads ?? []) as unknown[]);
  const backfill = normalize((obj.coverage_backfill ?? []) as unknown[]);
  return { leads, backfill, dropped_incomplete: dropped };
}

function startPublishedIso(lookbackDays: number): string {
  return new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
}

export function loadExaSystemPrompt(): string {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

/**
 * Positive terms only. What NOT to report is the system prompt's job — it is read
 * by a model that can honour a negation, whereas a query is matched as keywords.
 */
export function buildExaQuery(pack: RegionPack, lookbackDays: number): string {
  return (
    `Flag Paths mobility-law discovery for REGION: ${pack.label}. `
    + `Focus on: ${pack.queryHint}. `
    + `Return structured leads for the last ${lookbackDays} days and upcoming `
    + `announced/rumoured changes (next 6–12 months). Prefer gazette/ministry/CIP primaries.`
  );
}

export async function searchExaRegion(opts: {
  apiKey: string;
  pack: RegionPack;
  lookbackDays: number;
  searchType: string;
  systemPrompt: string;
  timeoutMs: number;
}): Promise<ProviderPackResult> {
  const query = buildExaQuery(opts.pack, opts.lookbackDays);

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
    dropped_incomplete: packOut.dropped_incomplete,
    ...(packOut.error ? { error: packOut.error } : {}),
  };
}

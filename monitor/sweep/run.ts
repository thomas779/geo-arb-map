#!/usr/bin/env bun

// AI-native per-jurisdiction sweep. Driven by data/registry.json, a grounded
// Gemini call asks — for each jurisdiction — whether any citizenship, residency,
// visa, or CBI rule has changed (or is upcoming) that we do not already record,
// and confirms it against current primary sources. Findings are written to
// .out/findings.json; the subset that would change jurisdiction DATA is also
// written to .out/leads.json in the existing Lead shape so the unchanged
// issue pipeline (monitor:draft / monitor:open) renders them for human review.
// This never edits the dataset and never publishes; publishing is monitor:news.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateGroundedText,
  llmConfigFromEnv,
  type GroundedResult,
  type GroundingCitation,
} from '../llm/client';
import { parseJsonArray, seenSignalIds, type Lead, type ImpactType } from '../triage/triage';
import {
  datasetContextForJurisdiction,
  inferJurisdictions,
  type BlocsData,
  type CitizenshipData,
  type DatasetContext,
} from '../triage/context';
import { makeSignal, type Signal } from '../schema/signal';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FINDING_STATUSES = ['confirmed', 'proposed', 'rumour', 'not_found'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export interface Finding {
  iso_n3: string;
  jurisdiction: string;
  claim: string;
  headline: string;
  status: Exclude<FindingStatus, 'not_found'>;
  primary_urls: string[];
  effective_date: string | null;
  affects_dataset: boolean;
  category: string;
  brief: string;
  citations: GroundingCitation[];
  search_queries: string[];
}

interface RegistryEntry {
  iso_n3: string;
  name: string;
}

interface SweepOptions {
  only: string[] | null;
  maxCalls: number;
  concurrency: number;
  rotationIndex: number | null;
  mode: 'discovery' | 'rotation';
  output: string;
  leadsOutput: string;
  report: string;
  existingIssues: string;
  fixtureResponse: string | null;
  dryRun: boolean;
}

interface SweepReport {
  ran_at: string;
  mode: string;
  model: string | null;
  jurisdictions_selected: number;
  calls_made: number;
  grounded_queries: number;
  citations_seen: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  token_usage: Record<string, number>;
  findings: number;
  by_status: Record<string, number>;
  affects_dataset: number;
  skipped_no_search: number;
}

const CONFIDENCE_BY_STATUS: Record<Finding['status'], Lead['confidence']> = {
  confirmed: 'high',
  proposed: 'medium',
  rumour: 'low',
};

// Coarse map from a finding category to the triage impact_type used by the issue
// renderer. A reviewer refines this; it only seeds the draft.
function impactTypeForCategory(category: string): Exclude<ImpactType, 'not_relevant'> {
  const normalized = category.toLowerCase();
  if (normalized.includes('invest') || normalized.includes('cbi') || normalized.includes('rbi')) {
    return 'cost_or_investment_threshold';
  }
  if (normalized.includes('quota') || normalized.includes('ballot')) {
    return 'quota_ballot_or_opening_closure';
  }
  return 'eligibility';
}

function readArgs(argv: string[]): SweepOptions {
  const outDir = path.join(ROOT, '.out');
  const options: SweepOptions = {
    only: null,
    maxCalls: Number(process.env.MONITOR_SWEEP_MAX_CALLS) || 300,
    concurrency: Number(process.env.MONITOR_SWEEP_CONCURRENCY) || 5,
    rotationIndex: null,
    mode: process.env.MONITOR_SWEEP_MODE === 'discovery' ? 'discovery' : 'rotation',
    output: path.join(outDir, 'findings.json'),
    leadsOutput: path.join(outDir, 'leads.json'),
    report: path.join(outDir, 'sweep-report.json'),
    existingIssues: path.join(outDir, 'existing-issues.json'),
    fixtureResponse: null,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--only') options.only = String(argv[++index]).split(',').map(item => item.trim()).filter(Boolean);
    else if (value === '--max-calls') options.maxCalls = Number(argv[++index]);
    else if (value === '--concurrency') options.concurrency = Number(argv[++index]);
    else if (value === '--rotation-index') options.rotationIndex = Number(argv[++index]);
    else if (value === '--mode') options.mode = argv[++index] === 'discovery' ? 'discovery' : 'rotation';
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--leads-output') options.leadsOutput = path.resolve(argv[++index]);
    else if (value === '--report') options.report = path.resolve(argv[++index]);
    else if (value === '--existing-issues') options.existingIssues = path.resolve(argv[++index]);
    else if (value === '--fixture-response') options.fixtureResponse = path.resolve(argv[++index]);
    else if (value === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown sweep option: ${value}`);
  }
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 1) {
    throw new Error('--max-calls must be a positive integer');
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive integer');
  }
  return options;
}

export function loadRegistry(registry: {
  sovereigns?: Array<{ iso_n3: string; name: string }>;
  territories?: Array<{ iso_n3: string; name: string }>;
  special?: Array<{ id: string; name: string }>;
}): RegistryEntry[] {
  return [
    ...(registry.sovereigns ?? []).map(item => ({ iso_n3: item.iso_n3, name: item.name })),
    ...(registry.territories ?? []).map(item => ({ iso_n3: item.iso_n3, name: item.name })),
    ...(registry.special ?? []).map(item => ({ iso_n3: item.id, name: item.name })),
  ];
}

// A compact view of what we already record, to keep sweep-prompt input tokens low:
// per-mode coverage states + terse route labels + region names, not full summaries.
function compactContext(context: DatasetContext): unknown {
  return {
    coverage: context.jurisdictions.map(j => ({ name: j.name, ...j.coverage })),
    routes: context.citizenship_routes.map(route => `${route.mode}/${route.status}: ${route.title}`),
    regions: context.regional_access.map(region => region.name),
  };
}

export function buildSweepPrompt(
  entry: RegistryEntry,
  context: DatasetContext,
  rssExcerpts: string[],
): string {
  return `You are fact-checking government mobility rules for ${entry.name} (ISO ${entry.iso_n3}).
First, use Google Search to find the most recent OFFICIAL / primary sources (government, gazette, court,
or tax authority; native language is fine) on ${entry.name}'s citizenship, residency, visa, and
citizenship/residency-by-investment (CBI/RBI) rules — prioritise the last 12 months and anything
announced or upcoming. You MUST search before answering; do not rely on prior knowledge alone.
Keep it efficient: run a few targeted searches (about 3-5), not an exhaustive sweep.
Then report ONLY changes that are already in force OR announced/upcoming and are NOT already reflected
in what we record below. Ignore evergreen explainers, opinion, and anything that merely restates a
known rule.

What we already record for ${entry.name} (absence is not evidence a route does not exist):
${JSON.stringify(compactContext(context))}
${rssExcerpts.length ? `\nRecent discovery leads to check (verify independently):\n${rssExcerpts.map(text => `- ${text}`).join('\n')}` : ''}

Return ONLY a JSON array (no prose, no code fences). Return [] if nothing new. Each entry:
{"iso_n3":"${entry.iso_n3}","claim":"one precise, factual sentence on what changed (for the record)",
"status":"confirmed|proposed|rumour|not_found","primary_urls":["https://official-source"],
"effective_date":"YYYY-MM-DD or null","affects_dataset":boolean,
"category":"ancestry|naturalization|birth|investment|visa|residency|cbi",
"headline":"a punchy, specific 4-9 word hook — the change as it matters to a globally mobile reader",
"brief":"1-2 tight sentences a subscriber wants to read: what changed, why it matters, and one concrete number, date, or detail"}
Voice for headline and brief: plain, confident, and specific; lead with the change or the number; no clickbait,
no hype, no exclamation marks, and never legal advice. Put ONLY official/primary URLs in primary_urls — never
blogs or aggregators. Use status "confirmed" only when a primary source supports it.`;
}

// Normalize the model's raw JSON for one jurisdiction into validated findings.
// The grounded result is the proof-of-search gate: if the model did not actually
// search (no citations and no queries), every finding from that call is dropped
// as unverifiable rather than trusted.
export function normalizeFindings(
  raw: unknown[],
  entry: RegistryEntry,
  grounded: Pick<GroundedResult, 'citations' | 'searchQueries'>,
): Finding[] {
  const searched = grounded.citations.length > 0 || grounded.searchQueries.length > 0;
  if (!searched) return [];
  const seen = new Set<string>();
  return raw.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const status = String(item.status ?? '');
    if (!FINDING_STATUSES.includes(status as FindingStatus) || status === 'not_found') return [];
    const claim = String(item.claim ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!claim || seen.has(claim)) return [];
    const primaryUrls = Array.isArray(item.primary_urls)
      ? [...new Set(item.primary_urls.map(String).map(url => url.trim())
          .filter(url => /^https?:\/\//i.test(url)))]
      : [];
    // A confirmed change must carry a primary source; without one it is at best a rumour.
    if (status === 'confirmed' && primaryUrls.length === 0) return [];
    seen.add(claim);
    const effectiveRaw = item.effective_date;
    const effectiveDate = typeof effectiveRaw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(effectiveRaw)
      ? effectiveRaw.slice(0, 10)
      : null;
    const headline = String(item.headline ?? claim).trim().replace(/\s+/g, ' ').slice(0, 120) || claim;
    return [{
      iso_n3: entry.iso_n3,
      jurisdiction: entry.name,
      claim,
      headline,
      status: status as Finding['status'],
      primary_urls: primaryUrls,
      effective_date: effectiveDate,
      affects_dataset: item.affects_dataset === true,
      category: String(item.category ?? '').trim().slice(0, 40) || 'residency',
      brief: String(item.brief ?? claim).trim().replace(/\s+/g, ' ').slice(0, 500),
      citations: grounded.citations,
      search_queries: grounded.searchQueries,
    }];
  });
}

// A dataset-affecting finding with a primary source becomes a Lead so the
// existing issue renderer/opener handles it unchanged. The synthesized signal
// carries the sources + effective date in its excerpt so the reviewer sees the
// evidence inline, and its id drives the <!-- signal:… --> dedup marker.
export function findingToLead(finding: Finding): Lead | null {
  const url = finding.primary_urls[0];
  if (!url) return null;
  const excerpt = [
    finding.brief,
    finding.effective_date ? `Effective: ${finding.effective_date}.` : '',
    `Sources: ${finding.primary_urls.join(' ')}`,
  ].filter(Boolean).join(' ');
  const signal: Signal = makeSignal({
    sourceId: 'ai-sweep',
    tier: 'verification',
    jurisdiction: finding.iso_n3,
    externalId: `${finding.iso_n3}:${finding.claim}`,
    url,
    title: finding.claim,
    excerpt,
  });
  return {
    signal_id: signal.id,
    jurisdiction: finding.jurisdiction,
    impact_type: impactTypeForCategory(finding.category),
    summary: finding.claim,
    needs_primary_source: finding.primary_urls.length === 0,
    confidence: CONFIDENCE_BY_STATUS[finding.status],
    signal,
  };
}

// Choose which jurisdictions to sweep this run. An explicit --only list bypasses
// rotation. Otherwise jurisdictions with fresh RSS signals are always swept, and
// the remaining budget rotates through the rest by run index, so all jurisdictions
// are covered over several runs with no persisted cursor.
export function selectJurisdictions(
  registry: RegistryEntry[],
  options: {
    only: string[] | null;
    rssFlagged: Set<string>;
    maxCalls: number;
    rotationIndex: number;
    mode?: 'discovery' | 'rotation';
  },
): RegistryEntry[] {
  if (options.only) {
    const wanted = new Set(options.only);
    return registry.filter(entry => wanted.has(entry.iso_n3)).slice(0, options.maxCalls);
  }
  const flagged = registry.filter(entry => options.rssFlagged.has(entry.iso_n3));
  // Discovery mode: only verify jurisdictions surfaced by fresh discovery signals —
  // no grounded call happens on a day with no relevant news. Rotation is the backstop.
  if (options.mode === 'discovery') return flagged.slice(0, options.maxCalls);
  const rest = registry.filter(entry => !options.rssFlagged.has(entry.iso_n3));
  const budgetForRest = Math.max(0, options.maxCalls - flagged.length);
  if (budgetForRest === 0 || rest.length === 0) return flagged.slice(0, options.maxCalls);
  const slices = Math.ceil(rest.length / budgetForRest);
  const slice = ((options.rotationIndex % slices) + slices) % slices;
  const rotated = rest.slice(slice * budgetForRest, slice * budgetForRest + budgetForRest);
  return [...flagged, ...rotated].slice(0, options.maxCalls);
}

// Run an async mapper over items with a bounded number of concurrent workers,
// preserving input order in the results.
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}

const FIXTURE_GROUNDED: Pick<GroundedResult, 'citations' | 'searchQueries'> = {
  citations: [{ uri: 'https://fixture.example', title: 'fixture' }],
  searchQueries: ['fixture'],
};

// Free, pre-AI relevance gate: a discovery signal only flags its jurisdiction for
// a (costly) grounded verify if its text mentions a mobility topic. Keeps daily
// runs cheap — no grounded call for off-topic news.
const MOBILITY_KEYWORDS = [
  'visa', 'residence', 'residency', 'citizenship', 'nationality', 'naturaliz', 'permit',
  'immigration', 'immigrant', 'migration', 'passport', 'golden visa', 'investment migration',
  'citizenship by investment', 'cbi', 'rbi', 'descent', 'ancestry', 'work permit',
  'digital nomad', 'asylum', 'deportation', 'expat', 'green card',
];

function isMobilityRelevant(signal: Signal): boolean {
  const haystack = `${signal.title} ${signal.excerpt}`.toLowerCase();
  return MOBILITY_KEYWORDS.some(keyword => haystack.includes(keyword));
}

export async function runSweep(
  options: SweepOptions,
): Promise<{ findings: Finding[]; leads: Lead[]; report: SweepReport }> {
  const registry = loadRegistry(JSON.parse(
    fs.readFileSync(path.resolve(ROOT, '..', 'data', 'registry.json'), 'utf8'),
  ));
  const citizenshipData = JSON.parse(
    fs.readFileSync(path.resolve(ROOT, '..', 'public', 'citizenship_routes.json'), 'utf8'),
  ) as CitizenshipData;
  const blocsData = JSON.parse(
    fs.readFileSync(path.resolve(ROOT, '..', 'public', 'blocs_data.json'), 'utf8'),
  ) as BlocsData;

  // Hybrid: fold in recent RSS discovery signals (if a collect ran) so flagged
  // jurisdictions are prioritized and their excerpts hint the grounded call.
  const rssByIso = new Map<string, string[]>();
  const signalsPath = path.join(ROOT, '.out', 'signals.json');
  if (fs.existsSync(signalsPath)) {
    const signals = JSON.parse(fs.readFileSync(signalsPath, 'utf8')) as Signal[];
    for (const signal of signals) {
      if (!isMobilityRelevant(signal)) continue;
      for (const iso of inferJurisdictions(signal, citizenshipData.jurisdictions)) {
        const excerpt = `${signal.title} — ${signal.excerpt}`.slice(0, 240);
        rssByIso.set(iso, [...(rssByIso.get(iso) ?? []), excerpt]);
      }
    }
  }

  // Weekly rotation index (stateless): distinct runs cover different slices.
  const rotationIndex = options.rotationIndex ?? Math.floor(Date.now() / (7 * 86_400_000));
  const capped = selectJurisdictions(registry, {
    only: options.only,
    rssFlagged: new Set(rssByIso.keys()),
    maxCalls: options.maxCalls,
    rotationIndex,
    mode: options.mode,
  });

  const fixtureRaw = options.fixtureResponse
    ? parseJsonArray(fs.readFileSync(options.fixtureResponse, 'utf8'))
    : null;
  const llm = llmConfigFromEnv();
  if (llm && process.env.MONITOR_SWEEP_MODEL) llm.model = process.env.MONITOR_SWEEP_MODEL.trim();

  let mode = fixtureRaw ? 'fixture' : llm ? 'grounded' : 'skipped-no-llm';
  const findings: Finding[] = [];
  let callsMade = 0;
  let groundedQueries = 0;
  let citationsSeen = 0;
  let skippedNoSearch = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const rawUsageTotals: Record<string, number> = {};

  if (!fixtureRaw && !llm) {
    console.warn('::warning title=Monitor sweep skipped::No monitoring LLM is configured');
  } else {
    const outcomes = await mapPool(capped, options.concurrency, async (entry) => {
      const context = datasetContextForJurisdiction(entry.iso_n3, citizenshipData, blocsData);
      const rssExcerpts = rssByIso.get(entry.iso_n3) ?? [];
      if (fixtureRaw) {
        const normalized = normalizeFindings(fixtureRaw, entry, FIXTURE_GROUNDED);
        console.log(`${entry.iso_n3} ${entry.name}: ${normalized.length} findings`);
        return { findings: normalized, made: 0, queries: 0, citations: 0, skipped: false, input: 0, output: 0, raw: {} as Record<string, number> };
      }
      let result: GroundedResult;
      try {
        result = await generateGroundedText(buildSweepPrompt(entry, context, rssExcerpts), llm!, { maxTokens: 8192 });
      } catch (error) {
        console.error(`::warning title=Sweep call failed::${entry.iso_n3}: ${error instanceof Error ? error.message : String(error)}`);
        return { findings: [] as Finding[], made: 0, queries: 0, citations: 0, skipped: false, input: 0, output: 0, raw: {} as Record<string, number> };
      }
      let normalized: Finding[] = [];
      try {
        normalized = normalizeFindings(parseJsonArray(result.text), entry, result);
      } catch (error) {
        console.error(`::warning title=Sweep parse failed::${entry.iso_n3}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const skipped = normalized.length === 0 && result.citations.length === 0 && result.searchQueries.length === 0;
      console.log(`${entry.iso_n3} ${entry.name}: ${normalized.length} findings`);
      return {
        findings: normalized, made: 1,
        queries: result.searchQueries.length, citations: result.citations.length, skipped,
        input: result.usage.input, output: result.usage.output, raw: result.usageRaw,
      };
    });
    for (const outcome of outcomes) {
      findings.push(...outcome.findings);
      callsMade += outcome.made;
      groundedQueries += outcome.queries;
      citationsSeen += outcome.citations;
      inputTokens += outcome.input;
      outputTokens += outcome.output;
      for (const [key, value] of Object.entries(outcome.raw)) {
        rawUsageTotals[key] = (rawUsageTotals[key] ?? 0) + (typeof value === 'number' ? value : 0);
      }
      if (outcome.skipped) skippedNoSearch += 1;
    }
  }

  // Data-change leads, deduped against changes that already have an open issue
  // (same signal-id marker convention as triage).
  const seen = fs.existsSync(options.existingIssues)
    ? seenSignalIds(JSON.parse(fs.readFileSync(options.existingIssues, 'utf8')))
    : new Set<string>();
  const leads = findings
    .filter(finding => finding.affects_dataset)
    .flatMap(finding => {
      const lead = findingToLead(finding);
      return lead && !seen.has(lead.signal_id) ? [lead] : [];
    });

  const byStatus: Record<string, number> = {};
  for (const finding of findings) byStatus[finding.status] = (byStatus[finding.status] ?? 0) + 1;

  // Rough per-run token cost (grounding searches are free within the daily tier).
  // Defaults ~gemini-3.5-flash-lite; override with the env rates if pricing changes.
  const inputRate = Number(process.env.MONITOR_COST_INPUT_USD_PER_M) || 0.10;
  const outputRate = Number(process.env.MONITOR_COST_OUTPUT_USD_PER_M) || 0.40;
  const estimatedCostUsd = Number(
    ((inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate).toFixed(4),
  );

  const report: SweepReport = {
    ran_at: new Date().toISOString(),
    mode,
    model: llm?.model ?? null,
    jurisdictions_selected: capped.length,
    calls_made: callsMade,
    grounded_queries: groundedQueries,
    citations_seen: citationsSeen,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: estimatedCostUsd,
    token_usage: rawUsageTotals,
    findings: findings.length,
    by_status: byStatus,
    affects_dataset: leads.length,
    skipped_no_search: skippedNoSearch,
  };

  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(findings, null, 2)}\n`);
    fs.writeFileSync(options.leadsOutput, `${JSON.stringify(leads, null, 2)}\n`);
    fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`${findings.length} findings (${leads.length} affect data) from ${capped.length} jurisdictions (${mode})`);
  return { findings, leads, report };
}

if (import.meta.main) {
  try {
    await runSweep(readArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

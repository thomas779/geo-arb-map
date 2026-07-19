#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSignal, type Signal } from '../schema/signal';
import { generateLlmText, llmConfigFromEnv } from '../llm/client';
import {
  buildDatasetContext,
  type BlocsData,
  type CitizenshipData,
  type DatasetContext,
} from './context';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const IMPACT_TYPES = [
  'eligibility',
  'status_or_right_granted',
  'physical_presence_requirement',
  'processing_time',
  'cost_or_investment_threshold',
  'quota_ballot_or_opening_closure',
  'document_requirement',
  'dependent_or_family_rule',
  'dual_citizenship_or_renunciation_rule',
  'source_only_editorial_change',
  'not_relevant',
] as const;
export type ImpactType = (typeof IMPACT_TYPES)[number];
export type LeadConfidence = 'low' | 'medium' | 'high';

export interface Lead {
  signal_id: string;
  jurisdiction: string;
  impact_type: Exclude<ImpactType, 'not_relevant'>;
  summary: string;
  needs_primary_source: boolean;
  confidence: LeadConfidence;
  signal: Signal;
}

interface TriageOptions {
  signals: string;
  existingIssues: string;
  output: string;
  report: string;
  fixtureResponse: string | null;
  batchSize: number;
  maxSignals: number;
  maxLeads: number;
}

interface ExistingIssue {
  body?: string | null;
}

interface TriageReport {
  ran_at: string;
  mode: string;
  input_signals: number;
  already_seen: number;
  triaged: number;
  leads: number;
  truncated_signals: number;
}

const CONFIDENCE = new Set<LeadConfidence>(['low', 'medium', 'high']);

function readArgs(argv: string[]): TriageOptions {
  const outDir = path.join(ROOT, '.out');
  const options: TriageOptions = {
    signals: path.join(outDir, 'signals.json'),
    existingIssues: path.join(outDir, 'existing-issues.json'),
    output: path.join(outDir, 'leads.json'),
    report: path.join(outDir, 'triage-report.json'),
    fixtureResponse: null,
    batchSize: Number(process.env.MONITOR_TRIAGE_BATCH_SIZE ?? 20),
    maxSignals: Number(process.env.MONITOR_MAX_SIGNALS ?? 100),
    maxLeads: Number(process.env.MONITOR_MAX_LEADS ?? 10),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--signals') options.signals = path.resolve(argv[++index]);
    else if (value === '--existing-issues') options.existingIssues = path.resolve(argv[++index]);
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--report') options.report = path.resolve(argv[++index]);
    else if (value === '--fixture-response') options.fixtureResponse = path.resolve(argv[++index]);
    else throw new Error(`Unknown triage option: ${value}`);
  }
  return options;
}

export function seenSignalIds(issues: ExistingIssue[]): Set<string> {
  return new Set(issues.flatMap(issue =>
    [...String(issue.body ?? '').matchAll(/<!-- signal:([a-f0-9]{12}) -->/g)]
      .map(match => match[1]),
  ));
}

export function parseJsonArray(text: string): unknown[] {
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = clean.indexOf('[');
  if (first < 0) throw new Error('Triage response did not contain a JSON array');
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = first; index < clean.length; index += 1) {
    const character = clean[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '[') depth += 1;
    if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('Triage response contained an incomplete JSON array');
  const parsed: unknown = JSON.parse(clean.slice(first, end));
  if (!Array.isArray(parsed)) throw new Error('Triage response must be a JSON array');
  return parsed;
}

export function normalizeRulings(
  rulings: unknown[],
  signals: Signal[],
  signalJurisdictions: Record<string, string[]>,
): Lead[] {
  const bySignalId = new Map(signals.map(signal => [signal.id, signal]));
  const seen = new Set<string>();
  return rulings.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const ruling = value as Record<string, unknown>;
    const signalId = typeof ruling.signal_id === 'string' ? ruling.signal_id : '';
    const signal = bySignalId.get(signalId);
    if (!signal || seen.has(signal.id) || ruling.impact_type === 'not_relevant') return [];
    if (!IMPACT_TYPES.includes(ruling.impact_type as ImpactType)) return [];
    if (!CONFIDENCE.has(ruling.confidence as LeadConfidence)) return [];
    const summary = String(ruling.summary ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!summary) return [];
    seen.add(signal.id);
    const inferred = signalJurisdictions[signal.id] ?? [];
    const jurisdiction = String(ruling.jurisdiction || inferred[0] || signal.jurisdiction)
      .trim()
      .replace(/[^\p{L}\p{N} .,'()/-]/gu, '')
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    return [{
      signal_id: signal.id,
      jurisdiction: jurisdiction || signal.jurisdiction,
      impact_type: ruling.impact_type as Lead['impact_type'],
      summary,
      needs_primary_source: signal.tier === 'discovery'
        ? true
        : Boolean(ruling.needs_primary_source),
      confidence: ruling.confidence as LeadConfidence,
      signal,
    }];
  });
}

export function buildPrompt(signals: Signal[], datasetContext: DatasetContext): string {
  return `You triage possible changes for a citizenship and cross-border mobility dataset.
Keep only signals that plausibly report a changed rule, programme, requirement, status,
deadline, quota, or official interpretation. Omit opinion, evergreen explainers,
personal anecdotes, and items that merely restate a known rule.

Current dataset context (absence is not evidence that no route exists):
${JSON.stringify(datasetContext)}

Signals:
${JSON.stringify(signals.map(signal => ({
  id: signal.id,
  source_id: signal.source_id,
  tier: signal.tier,
  jurisdiction: signal.jurisdiction,
  inferred_jurisdictions: datasetContext.signal_jurisdictions[signal.id] ?? [],
  title: signal.title,
  excerpt: signal.excerpt,
  url: signal.url,
  published_at: signal.published_at,
})))}

Return a JSON array only. Omit irrelevant signals. Each retained entry must be:
{"signal_id":"12-char id","jurisdiction":"ISO numeric code, multi, or a short country name",
"impact_type":one of ${JSON.stringify(IMPACT_TYPES)},"summary":"one factual sentence describing
what may have changed","needs_primary_source":boolean,"confidence":"low|medium|high"}.
Discovery sources can identify leads but never verify them.`;
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size));
}

export async function runTriage(
  options: TriageOptions,
): Promise<{ leads: Lead[]; report: TriageReport }> {
  for (const key of ['batchSize', 'maxSignals', 'maxLeads'] as const) {
    if (!Number.isInteger(options[key]) || options[key] < 1) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
  const rawSignals: unknown = JSON.parse(fs.readFileSync(options.signals, 'utf8'));
  if (!Array.isArray(rawSignals)) throw new Error('signals.json must contain an array');
  const signals = rawSignals.map(assertSignal);
  const existingIssues = fs.existsSync(options.existingIssues)
    ? JSON.parse(fs.readFileSync(options.existingIssues, 'utf8')) as ExistingIssue[]
    : [];
  const alreadySeen = seenSignalIds(existingIssues);
  const allUnseen = signals.filter(signal => !alreadySeen.has(signal.id));
  const unseen = allUnseen
    .sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')))
    .slice(0, options.maxSignals);

  const citizenshipData = JSON.parse(
    fs.readFileSync(path.resolve(ROOT, '..', 'public', 'citizenship_routes.json'), 'utf8'),
  ) as CitizenshipData;
  const blocsData = JSON.parse(
    fs.readFileSync(path.resolve(ROOT, '..', 'public', 'blocs_data.json'), 'utf8'),
  ) as BlocsData;
  const fixtureRulings = options.fixtureResponse
    ? parseJsonArray(fs.readFileSync(options.fixtureResponse, 'utf8'))
    : null;
  const llm = llmConfigFromEnv();

  let mode = llm?.provider ?? 'unconfigured';
  let leads: Lead[] = [];
  if (unseen.length === 0) {
    mode = 'no-new-signals';
  } else if (fixtureRulings) {
    mode = 'fixture';
    const context = buildDatasetContext(unseen, citizenshipData, blocsData);
    leads = normalizeRulings(fixtureRulings, unseen, context.signal_jurisdictions);
  } else if (!llm) {
    mode = 'skipped-no-llm';
    console.warn('::warning title=Monitor triage skipped::No monitoring LLM is configured');
  } else {
    for (const batch of chunks(unseen, options.batchSize)) {
      const context = buildDatasetContext(batch, citizenshipData, blocsData);
      const responseText = await generateLlmText(buildPrompt(batch, context), llm);
      leads.push(...normalizeRulings(parseJsonArray(responseText), batch, context.signal_jurisdictions));
    }
  }

  leads = leads.slice(0, options.maxLeads);
  const report: TriageReport = {
    ran_at: new Date().toISOString(),
    mode,
    input_signals: signals.length,
    already_seen: signals.length - allUnseen.length,
    triaged: unseen.length,
    leads: leads.length,
    truncated_signals: Math.max(0, allUnseen.length - unseen.length),
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(path.dirname(options.report), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(leads, null, 2)}\n`);
  fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${leads.length} leads from ${unseen.length} unseen signals (${mode})`);
  return { leads, report };
}

if (import.meta.main) {
  try {
    await runTriage(readArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

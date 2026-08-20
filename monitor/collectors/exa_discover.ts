#!/usr/bin/env bun
/**
 * Weekly Exa deep-search discovery for Flag Paths.
 *
 * DISCOVERY ONLY. This never verifies a legal fact or ships data. It produces a
 * structured lead list (JSON + markdown) for human triage, optionally opens one
 * umbrella GitHub issue, and never posts to Telegram.
 *
 * Usage:
 *   EXA_API_KEY=… bun run monitor:exa-discover
 *   bun run monitor:exa-discover -- --fixture tests/fixtures/monitor/exa-leads.json
 *   bun run monitor:exa-discover -- --regions caribbean,europe --open-issue
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROMPT_PATH = path.join(ROOT, 'monitor', 'prompts', 'exa-weekly-discovery.md');
const DEFAULT_COMPILED = path.join(ROOT, 'data', 'compiled', 'citizenship_routes.json');

export type ChangeKind =
  | 'threshold'
  | 'eligibility'
  | 'new_programme'
  | 'closure'
  | 'dual_nationality'
  | 'naturalisation'
  | 'other';

export type Timing =
  | 'in_force'
  | 'announced_not_yet_in_force'
  | 'rumour'
  | 'unclear';

export type Horizon = 'past_7_days' | 'upcoming_6_12_months';

export type Disposition =
  | 'verify_and_author'
  | 'pending_enactment'
  | 'needs_primary'
  | 'not_newsworthy'
  | 'already_held';

export interface ExaLead {
  jurisdiction: string;
  iso_n3: string | null;
  claim_summary: string;
  change_kind: ChangeKind;
  timing: Timing;
  effective_or_announced_date: string | null;
  horizon: Horizon;
  primary_url: string | null;
  discovery_url: string;
  quote: string | null;
  confidence: 'high' | 'medium' | 'low';
  affects_dataset: boolean;
  recommended_disposition: Disposition;
  why_not_noise: string;
  notes: string;
  /** Filled locally when a matching route/summary already exists in compiled data. */
  already_held?: boolean;
  matched_route_ids?: string[];
  region?: string;
}

export interface ExaDiscoverReport {
  retrieved_at: string;
  lookback_days: number;
  search_type: string;
  regions: string[];
  fixture_mode: boolean;
  cost_dollars_total: number | null;
  lead_count: number;
  backfill_count: number;
  leads: ExaLead[];
  coverage_backfill: ExaLead[];
  region_errors: Array<{ region: string; error: string }>;
}

interface RegionPack {
  id: string;
  label: string;
  queryHint: string;
}

const REGION_PACKS: RegionPack[] = [
  {
    id: 'europe',
    label: 'Europe + UK + Gibraltar + Malta + Cyprus',
    queryHint: 'Europe, United Kingdom, Gibraltar, Malta, Cyprus, EU member states',
  },
  {
    id: 'gulf',
    label: 'Gulf + Levant',
    queryHint: 'UAE, Saudi Arabia, Bahrain, Qatar, Oman, Kuwait, Jordan, Lebanon, Israel',
  },
  {
    id: 'caribbean',
    label: 'Caribbean CIP / OECS',
    queryHint:
      'Antigua and Barbuda, Dominica, Grenada, Saint Kitts and Nevis, Saint Lucia, '
      + 'Caribbean citizenship by investment',
  },
  {
    id: 'latam',
    label: 'Latin America',
    queryHint: 'Latin America, Mexico, Central America, South America residency citizenship',
  },
  {
    id: 'africa',
    label: 'Africa',
    queryHint: 'African countries residency citizenship golden visa investment migration',
  },
  {
    id: 'asia',
    label: 'Asia-Pacific',
    queryHint:
      'Asia Pacific residency citizenship: Japan, South Korea, Indonesia, Thailand, '
      + 'Singapore, Malaysia, Philippines, India, China, Kazakhstan, Australia, New Zealand',
  },
  {
    id: 'anglosphere_north',
    label: 'US / Canada (product routes only)',
    queryHint:
      'United States Canada residency citizenship: EB-5, E-2, extraordinary ability, '
      + 'investor immigration, nationality law — exclude student F/J, B-1/B-2, consular fees, '
      + 'public charge screens, litigation status',
  },
];

const LEAD_SCHEMA = {
  type: 'object',
  required: ['leads', 'coverage_backfill'],
  additionalProperties: false,
  properties: {
    leads: {
      type: 'array',
      description: 'Leads whose first public signal falls in the lookback window, plus upcoming announcements first seen recently.',
      items: leadItemSchema(),
    },
    coverage_backfill: {
      type: 'array',
      description: 'In-force items older than the lookback window that may still need atlas coverage refresh.',
      items: leadItemSchema(),
    },
  },
} as const;

function leadItemSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'jurisdiction',
      'iso_n3',
      'claim_summary',
      'change_kind',
      'timing',
      'effective_or_announced_date',
      'horizon',
      'primary_url',
      'discovery_url',
      'quote',
      'confidence',
      'affects_dataset',
      'recommended_disposition',
      'why_not_noise',
      'notes',
    ],
    properties: {
      jurisdiction: { type: 'string' },
      iso_n3: { type: ['string', 'null'] },
      claim_summary: { type: 'string' },
      change_kind: {
        type: 'string',
        enum: [
          'threshold',
          'eligibility',
          'new_programme',
          'closure',
          'dual_nationality',
          'naturalisation',
          'other',
        ],
      },
      timing: {
        type: 'string',
        enum: ['in_force', 'announced_not_yet_in_force', 'rumour', 'unclear'],
      },
      effective_or_announced_date: { type: ['string', 'null'] },
      horizon: { type: 'string', enum: ['past_7_days', 'upcoming_6_12_months'] },
      primary_url: { type: ['string', 'null'] },
      discovery_url: { type: 'string' },
      quote: { type: ['string', 'null'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      affects_dataset: { type: 'boolean' },
      recommended_disposition: {
        type: 'string',
        enum: [
          'verify_and_author',
          'pending_enactment',
          'needs_primary',
          'not_newsworthy',
          'already_held',
        ],
      },
      why_not_noise: { type: 'string' },
      notes: { type: 'string' },
    },
  };
}

interface CliOptions {
  fixture: string | null;
  regions: string[] | null;
  lookbackDays: number;
  searchType: string;
  compiled: string;
  output: string;
  summary: string;
  openIssue: boolean;
  dryRun: boolean;
}

function readArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    fixture: null,
    regions: null,
    lookbackDays: Number(process.env.EXA_LOOKBACK_DAYS ?? 7),
    searchType: process.env.EXA_SEARCH_TYPE || 'deep',
    compiled: process.env.EXA_COMPILED_PATH || DEFAULT_COMPILED,
    output: path.join(ROOT, '.out', 'exa-leads.json'),
    summary: path.join(ROOT, '.out', 'exa-leads.md'),
    openIssue: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture') options.fixture = path.resolve(argv[++i]!);
    else if (arg === '--regions') {
      options.regions = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--lookback-days') options.lookbackDays = Number(argv[++i]);
    else if (arg === '--type') options.searchType = String(argv[++i]);
    else if (arg === '--compiled') options.compiled = path.resolve(argv[++i]!);
    else if (arg === '--output') options.output = path.resolve(argv[++i]!);
    else if (arg === '--summary') options.summary = path.resolve(argv[++i]!);
    else if (arg === '--open-issue') options.openIssue = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.lookbackDays) || options.lookbackDays < 1) {
    throw new Error('--lookback-days must be a positive number');
  }
  return options;
}

function startPublishedIso(lookbackDays: number, now = new Date()): string {
  const start = new Date(now.getTime() - lookbackDays * 86_400_000);
  return start.toISOString();
}

function normalizeLead(raw: Record<string, unknown>, region: string): ExaLead | null {
  const claim = String(raw.claim_summary ?? '').trim();
  const discovery = String(raw.discovery_url ?? '').trim();
  if (!claim || !discovery) return null;
  const disposition = String(raw.recommended_disposition ?? 'needs_primary') as Disposition;
  return {
    jurisdiction: String(raw.jurisdiction ?? '').trim() || 'unknown',
    iso_n3: raw.iso_n3 == null || raw.iso_n3 === '' ? null : String(raw.iso_n3).padStart(3, '0'),
    claim_summary: claim,
    change_kind: (raw.change_kind as ChangeKind) || 'other',
    timing: (raw.timing as Timing) || 'unclear',
    effective_or_announced_date: raw.effective_or_announced_date
      ? String(raw.effective_or_announced_date).slice(0, 10)
      : null,
    horizon: (raw.horizon as Horizon) || 'past_7_days',
    primary_url: raw.primary_url ? String(raw.primary_url) : null,
    discovery_url: discovery,
    quote: raw.quote ? String(raw.quote) : null,
    confidence: (raw.confidence as ExaLead['confidence']) || 'low',
    affects_dataset: Boolean(raw.affects_dataset),
    recommended_disposition: disposition,
    why_not_noise: String(raw.why_not_noise ?? ''),
    notes: String(raw.notes ?? ''),
    region,
  };
}

function leadKey(lead: ExaLead): string {
  const url = (lead.primary_url || lead.discovery_url).toLowerCase().replace(/\/$/, '');
  return `${lead.iso_n3 ?? lead.jurisdiction.toLowerCase()}|${lead.change_kind}|${url}`;
}

function dedupeLeads(leads: ExaLead[]): ExaLead[] {
  const seen = new Set<string>();
  const out: ExaLead[] = [];
  for (const lead of leads) {
    const key = leadKey(lead);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lead);
  }
  return out;
}

interface CompiledCorpus {
  routes: Array<{ id: string; summary?: string; country?: { iso_n3?: string } }>;
  residence_routes?: Array<{ id: string; summary?: string; country?: { iso_n3?: string } }>;
}

/** Cheap corpus hint: mark already_held when iso matches and claim tokens overlap a summary. */
export function annotateAlreadyHeld(leads: ExaLead[], corpus: CompiledCorpus | null): ExaLead[] {
  if (!corpus) return leads;
  const all = [
    ...corpus.routes,
    ...(corpus.residence_routes ?? []),
  ];
  return leads.map(lead => {
    if (!lead.iso_n3) return lead;
    const tokens = lead.claim_summary
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 5)
      .slice(0, 12);
    if (tokens.length < 2) return lead;
    const matches = all.filter(route => {
      if (route.country?.iso_n3 !== lead.iso_n3) return false;
      const summary = (route.summary ?? '').toLowerCase();
      if (!summary) return false;
      const hits = tokens.filter(t => summary.includes(t)).length;
      return hits >= Math.min(3, tokens.length);
    });
    if (matches.length === 0) return lead;
    return {
      ...lead,
      already_held: true,
      matched_route_ids: matches.map(m => m.id).slice(0, 5),
      recommended_disposition: lead.recommended_disposition === 'verify_and_author'
        ? 'already_held'
        : lead.recommended_disposition,
      notes: `${lead.notes} [corpus hint: possible overlap with ${matches.map(m => m.id).join(', ')}]`.trim(),
    };
  });
}

interface ExaSearchResponse {
  requestId?: string;
  results?: unknown[];
  costDollars?: { total?: number };
  output?: { content?: unknown };
}

async function callExa(opts: {
  apiKey: string;
  query: string;
  systemPrompt: string;
  searchType: string;
  startPublishedDate: string | null;
  timeoutMs: number;
}): Promise<ExaSearchResponse> {
  const body: Record<string, unknown> = {
    query: opts.query,
    type: opts.searchType,
    numResults: 12,
    systemPrompt: opts.systemPrompt,
    outputSchema: LEAD_SCHEMA,
    contents: {
      highlights: { maxCharacters: 2000 },
    },
  };
  if (opts.startPublishedDate) body.startPublishedDate = opts.startPublishedDate;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Exa HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return JSON.parse(text) as ExaSearchResponse;
  } finally {
    clearTimeout(timer);
  }
}

function extractPack(content: unknown, region: string): { leads: ExaLead[]; backfill: ExaLead[] } {
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
    .filter((item): item is ExaLead => item !== null);
  const backfill = (obj.coverage_backfill ?? [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => normalizeLead(item, region))
    .filter((item): item is ExaLead => item !== null);
  return { leads, backfill };
}

function renderMarkdown(report: ExaDiscoverReport): string {
  const lines: string[] = [
    `# Exa weekly discovery — ${report.retrieved_at.slice(0, 10)}`,
    '',
    `- Lookback: **${report.lookback_days}** days`,
    `- Search type: \`${report.search_type}\``,
    `- Regions: ${report.regions.join(', ') || '(none)'}`,
    `- Leads: **${report.lead_count}** · backfill: **${report.backfill_count}**`,
    `- Estimated Exa cost: ${report.cost_dollars_total == null ? 'n/a' : `$${report.cost_dollars_total.toFixed(4)}`}`,
    '',
    'Discovery only — do not copy into the dataset without primary verification.',
    '',
  ];

  if (report.region_errors.length) {
    lines.push('## Region errors', '');
    for (const err of report.region_errors) {
      lines.push(`- **${err.region}**: ${err.error}`);
    }
    lines.push('');
  }

  const section = (title: string, leads: ExaLead[]) => {
    lines.push(`## ${title}`, '');
    if (!leads.length) {
      lines.push('_None._', '');
      return;
    }
    lines.push(
      '| Disposition | Conf | Jur | Kind | Timing | Claim | Primary |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const lead of leads) {
      const claim = lead.claim_summary.replace(/\|/g, '\\|').slice(0, 140);
      const primary = lead.primary_url
        ? `[link](${lead.primary_url})`
        : `_none_ · [discovery](${lead.discovery_url})`;
      const held = lead.already_held ? ' · already_held?' : '';
      lines.push(
        `| \`${lead.recommended_disposition}\`${held} | ${lead.confidence} | ${lead.jurisdiction}`
        + ` | ${lead.change_kind} | ${lead.timing} | ${claim} | ${primary} |`,
      );
    }
    lines.push('');
  };

  section('Leads', report.leads);
  section('Coverage backfill', report.coverage_backfill);

  lines.push('## Next actions', '');
  lines.push(
    '1. Fact-check `verify_and_author` with primary sources.',
    '2. Park `pending_enactment` with the `pending-enactment` label when opening issues.',
    '3. Ignore `not_newsworthy` / thin process leads.',
    '4. Treat `already_held` as refresh candidates against the matched route ids in JSON.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function runGh(args: string[]): string {
  const result = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `gh ${args.join(' ')} failed`);
  }
  return result.stdout.toString().trim();
}

function openUmbrellaIssue(report: ExaDiscoverReport, summaryMd: string): string {
  const date = report.retrieved_at.slice(0, 10);
  const title = `[Exa weekly] ${date} discovery (${report.lead_count} leads)`;
  const body = `${summaryMd}

---

Automated Exa discovery. Unverified. See \`monitor/README.md\` and \`monitor/prompts/exa-weekly-discovery.md\`.
`;
  runGh([
    'label', 'create', 'monitor-lead',
    '--color', 'BFDADC',
    '--description', 'Automated, unverified monitoring lead',
    '--force',
  ]);
  // Write body to a temp file to avoid shell escaping pain on long markdown.
  const tmp = path.join(ROOT, '.out', `exa-issue-body-${date}.md`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, body);
  return runGh([
    'issue', 'create',
    '--title', title,
    '--body-file', tmp,
    '--label', 'monitor-lead',
  ]);
}

export async function runExaDiscover(options: CliOptions): Promise<ExaDiscoverReport> {
  const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');
  const retrievedAt = new Date().toISOString();
  const packs = options.regions?.length
    ? REGION_PACKS.filter(pack => options.regions!.includes(pack.id))
    : REGION_PACKS;
  if (!packs.length) throw new Error('No matching region packs');

  let corpus: CompiledCorpus | null = null;
  if (fs.existsSync(options.compiled)) {
    corpus = JSON.parse(fs.readFileSync(options.compiled, 'utf8')) as CompiledCorpus;
  }

  if (options.fixture) {
    const fixture = JSON.parse(fs.readFileSync(options.fixture, 'utf8')) as {
      leads?: ExaLead[];
      coverage_backfill?: ExaLead[];
    };
    const leads = annotateAlreadyHeld(dedupeLeads(fixture.leads ?? []), corpus);
    const backfill = annotateAlreadyHeld(dedupeLeads(fixture.coverage_backfill ?? []), corpus);
    return {
      retrieved_at: retrievedAt,
      lookback_days: options.lookbackDays,
      search_type: 'fixture',
      regions: packs.map(p => p.id),
      fixture_mode: true,
      cost_dollars_total: 0,
      lead_count: leads.length,
      backfill_count: backfill.length,
      leads,
      coverage_backfill: backfill,
      region_errors: [],
    };
  }

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error('EXA_API_KEY is not set (or pass --fixture for offline runs)');
  }

  const timeoutMs = Number(process.env.EXA_TIMEOUT_MS ?? 180_000);
  const publishedAfter = startPublishedIso(options.lookbackDays);
  const allLeads: ExaLead[] = [];
  const allBackfill: ExaLead[] = [];
  const regionErrors: Array<{ region: string; error: string }> = [];
  let cost = 0;

  for (const pack of packs) {
    const query =
      `Flag Paths mobility-law discovery for REGION: ${pack.label}. `
      + `Focus on: ${pack.queryHint}. `
      + `Return structured leads for the last ${options.lookbackDays} days and upcoming `
      + `announced/rumoured changes (next 6–12 months). Prefer gazette/ministry/CIP primaries.`;
    try {
      if (options.dryRun) {
        console.log(`[dry-run] would search region=${pack.id} type=${options.searchType}`);
        continue;
      }
      console.log(`exa: searching ${pack.id} (${options.searchType})…`);
      const response = await callExa({
        apiKey,
        query,
        systemPrompt,
        searchType: options.searchType,
        // Deep synthesis uses the lookback as guidance; published-date filter still
        // helps news surfaces. Backfill items can arrive via synthesis anyway.
        startPublishedDate: publishedAfter,
        timeoutMs,
      });
      if (typeof response.costDollars?.total === 'number') {
        cost += response.costDollars.total;
      }
      const packOut = extractPack(response.output?.content, pack.id);
      allLeads.push(...packOut.leads);
      allBackfill.push(...packOut.backfill);
      console.log(
        `exa: ${pack.id} → ${packOut.leads.length} leads, ${packOut.backfill.length} backfill`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`exa: ${pack.id} failed: ${message}`);
      regionErrors.push({ region: pack.id, error: message });
    }
  }

  const leads = annotateAlreadyHeld(dedupeLeads(allLeads), corpus);
  const backfill = annotateAlreadyHeld(dedupeLeads(allBackfill), corpus);
  return {
    retrieved_at: retrievedAt,
    lookback_days: options.lookbackDays,
    search_type: options.searchType,
    regions: packs.map(p => p.id),
    fixture_mode: false,
    cost_dollars_total: cost || null,
    lead_count: leads.length,
    backfill_count: backfill.length,
    leads,
    coverage_backfill: backfill,
    region_errors: regionErrors,
  };
}

if (import.meta.main) {
  try {
    const options = readArgs(process.argv.slice(2));
    const report = await runExaDiscover(options);
    const markdown = renderMarkdown(report);
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(options.summary, markdown);
    console.log(`wrote ${options.output}`);
    console.log(`wrote ${options.summary}`);
    console.log(
      `leads=${report.lead_count} backfill=${report.backfill_count} `
      + `errors=${report.region_errors.length} cost=${report.cost_dollars_total ?? 'n/a'}`,
    );
    if (options.openIssue) {
      if (options.dryRun || options.fixture) {
        console.log('skipping --open-issue in dry-run/fixture mode');
      } else {
        const url = openUmbrellaIssue(report, markdown);
        console.log(`opened ${url}`);
      }
    }
    // Non-zero only when every region failed and we got nothing.
    if (
      !options.fixture
      && !options.dryRun
      && report.lead_count === 0
      && report.backfill_count === 0
      && report.region_errors.length === report.regions.length
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

#!/usr/bin/env bun
/**
 * Multi-provider weekly web discovery (Exa + Tavily + Firecrawl).
 *
 * DISCOVERY ONLY. Free-tier aware caps:
 *   - Exa: deep structured synthesis (best leads)
 *   - Tavily: basic search, 1 credit/region (no raw content)
 *   - Firecrawl: search without scrape by default (~2 credits / 10 results)
 *
 * Usage:
 *   bun run monitor:web-discover -- --providers exa,tavily,firecrawl
 *   bun run monitor:web-discover -- --fixture tests/fixtures/monitor/exa-leads.json
 *   bun run monitor:web-discover -- --regions caribbean --providers tavily --open-issue
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchExaRegion, loadExaSystemPrompt } from './web_providers/exa';
import { searchTavilyRegion } from './web_providers/tavily';
import { searchFirecrawlRegion } from './web_providers/firecrawl';
import {
  REGION_PACKS,
  annotateAlreadyHeld,
  dedupeLeads,
  leadChangeKey,
  renderMarkdown,
  type CompiledCorpus,
  type DiscoverLead,
  type DiscoverProvider,
  type RegionPack,
} from './web_providers/shared';
import { signalId } from '../schema/signal';
import { seenSignalIds } from '../triage/triage';
import { fetchText, norm, type Fetched } from '../../scripts/lib/quote-gate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_COMPILED = path.join(ROOT, 'data', 'compiled', 'citizenship_routes.json');

export interface WebDiscoverReport {
  retrieved_at: string;
  lookback_days: number;
  providers: DiscoverProvider[];
  regions: string[];
  fixture_mode: boolean;
  cost_dollars_total: number | null;
  credits_used: Partial<Record<DiscoverProvider, number | null>>;
  lead_count: number;
  backfill_count: number;
  /** Provider rows that arrived without a claim or a usable discovery URL. */
  dropped_incomplete: number;
  leads: DiscoverLead[];
  coverage_backfill: DiscoverLead[];
  provider_errors: Array<{ provider: string; region: string; error: string }>;
}

export interface CliOptions {
  fixture: string | null;
  providers: DiscoverProvider[];
  regions: string[] | null;
  lookbackDays: number;
  exaType: string;
  maxResults: number;
  firecrawlScrape: boolean;
  compiled: string;
  output: string;
  summary: string;
  openIssue: boolean;
  /** When opening issues, also file filtered per-lead monitor-leads (Exa quality only). */
  openLeadIssues: boolean;
  /** Hard ceiling on per-lead issues per run, in the style of MONITOR_MAX_LEADS. */
  maxIssues: number;
  /** `gh issue list --state all --json number,body` output, for signal-marker dedupe. */
  existingIssues: string;
  dryRun: boolean;
}

function parseProviders(raw: string | undefined): DiscoverProvider[] {
  const allowed = new Set<DiscoverProvider>(['exa', 'tavily', 'firecrawl']);
  const list = (raw || 'exa,tavily,firecrawl')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean) as DiscoverProvider[];
  const unique = [...new Set(list)].filter(p => allowed.has(p));
  if (!unique.length) throw new Error('--providers must include exa, tavily, and/or firecrawl');
  return unique;
}

function readArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    fixture: null,
    providers: parseProviders(process.env.WEB_DISCOVER_PROVIDERS),
    regions: null,
    lookbackDays: Number(process.env.WEB_DISCOVER_LOOKBACK_DAYS ?? process.env.EXA_LOOKBACK_DAYS ?? 7),
    // deep-lite is the free-tier-friendly structured default; override to deep when needed.
    exaType: process.env.EXA_SEARCH_TYPE || 'deep-lite',
    maxResults: Number(process.env.WEB_DISCOVER_MAX_RESULTS ?? 3),
    firecrawlScrape: process.env.FIRECRAWL_SCRAPE === '1',
    compiled: process.env.WEB_DISCOVER_COMPILED || DEFAULT_COMPILED,
    output: path.join(ROOT, '.out', 'web-leads.json'),
    summary: path.join(ROOT, '.out', 'web-leads.md'),
    openIssue: false,
    openLeadIssues: process.env.WEB_DISCOVER_OPEN_LEADS !== '0',
    maxIssues: Number(process.env.WEB_DISCOVER_MAX_ISSUES ?? 10),
    existingIssues: path.join(ROOT, '.out', 'existing-issues.json'),
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture') options.fixture = path.resolve(argv[++i]!);
    else if (arg === '--providers') options.providers = parseProviders(argv[++i]);
    else if (arg === '--regions') {
      options.regions = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--lookback-days') options.lookbackDays = Number(argv[++i]);
    else if (arg === '--exa-type') options.exaType = String(argv[++i]);
    else if (arg === '--max-results') options.maxResults = Number(argv[++i]);
    else if (arg === '--firecrawl-scrape') options.firecrawlScrape = true;
    else if (arg === '--compiled') options.compiled = path.resolve(argv[++i]!);
    else if (arg === '--output') options.output = path.resolve(argv[++i]!);
    else if (arg === '--summary') options.summary = path.resolve(argv[++i]!);
    else if (arg === '--open-issue') options.openIssue = true;
    else if (arg === '--open-leads') options.openLeadIssues = true;
    else if (arg === '--no-open-leads') options.openLeadIssues = false;
    else if (arg === '--max-issues') options.maxIssues = Number(argv[++i]);
    else if (arg === '--existing-issues') options.existingIssues = path.resolve(argv[++i]!);
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.lookbackDays) || options.lookbackDays < 1) {
    throw new Error('--lookback-days must be a positive number');
  }
  if (!Number.isInteger(options.maxIssues) || options.maxIssues < 1) {
    throw new Error('--max-issues / WEB_DISCOVER_MAX_ISSUES must be a positive integer');
  }
  return options;
}

function runGh(args: string[]): string {
  const result = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `gh ${args.join(' ')} failed`);
  }
  return result.stdout.toString().trim();
}

function ensureMonitorLabels(): void {
  runGh([
    'label', 'create', 'monitor-lead',
    '--color', 'BFDADC',
    '--description', 'Automated, unverified monitoring lead',
    '--force',
  ]);
  runGh([
    'label', 'create', 'pending-enactment',
    '--color', 'FBCA04',
    '--description', 'Verified as tabled/announced but not yet law; re-surface on gazette',
    '--force',
  ]);
}

/**
 * Only Exa-structured (or rare high-conf) rows become their own issues.
 * Raw Tavily/Firecrawl hits stay on the umbrella table.
 */
export function shouldOpenLeadIssue(lead: DiscoverLead): boolean {
  if (lead.already_held) return false;
  if (lead.recommended_disposition === 'not_newsworthy') return false;
  if (lead.confidence === 'low') return false;
  const actionable = lead.recommended_disposition === 'verify_and_author'
    || lead.recommended_disposition === 'pending_enactment';
  if (!actionable) return false;
  // Prefer Exa synthesis; allow non-Exa only if a primary URL is already attached.
  if (lead.provider !== 'exa' && !lead.primary_url) return false;
  return true;
}

/** The verdict of re-fetching a lead's cited primary and looking for its quote. */
export interface LeadQuoteGate {
  ok: boolean;
  reason: string;
}

/**
 * `pending-enactment` is what authorises Telegram publication of a change that is
 * not yet in force, so discovery may attach it only when the lead's quote has
 * been re-fetched and matched character-for-character against the primary it
 * cites. It used to follow from `timing === 'rumour'` alone, which meant an
 * unsourced rumour arrived in a publish-authorising queue by default.
 *
 * A 200 proves nothing: the shell check, the PDF header scan and the curl
 * fallback all live in scripts/lib/quote-gate.ts and are not re-litigated here.
 */
export async function gateLeadQuote(
  lead: DiscoverLead,
  fetcher: (url: string) => Promise<Fetched> = fetchText,
): Promise<LeadQuoteGate> {
  if (!lead.primary_url) return { ok: false, reason: 'no primary source cited' };
  if (!lead.quote) return { ok: false, reason: 'no verbatim quote supplied' };
  let fetched: Fetched;
  try {
    fetched = await fetcher(lead.primary_url);
  } catch (error) {
    return { ok: false, reason: `fetch threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!fetched.ok) {
    return { ok: false, reason: `primary returned HTTP ${fetched.status}${fetched.note ? ` — ${fetched.note}` : ''}` };
  }
  if (fetched.shell) {
    return { ok: false, reason: 'primary served an SPA shell, not the instrument text' };
  }
  if (!fetched.text.trim()) {
    return { ok: false, reason: fetched.note || 'primary had no extractable text' };
  }
  if (!norm(fetched.text).includes(norm(lead.quote))) {
    return {
      ok: false,
      reason: `quote not present in the fetched primary (${fetched.bytes} bytes`
        + `${fetched.isPdf ? ', PDF' : ''}) — paraphrase, wrong page, or fabrication`,
    };
  }
  return {
    ok: true,
    reason: `quote matched character-for-character in the fetched primary (${fetched.bytes} bytes`
      + `${fetched.isPdf ? ', PDF' : ''})${fetched.note ? `${fetched.note}` : ''}`,
  };
}

/**
 * The label set for a lead issue. `pending-enactment` requires a passing gate;
 * everything else still files as a plain `monitor-lead`, because a failed gate is
 * a reason to withhold publication authority, not to hide the lead.
 */
export function leadIssueLabels(lead: DiscoverLead, gate: LeadQuoteGate | null): string[] {
  const labels = ['monitor-lead'];
  if (lead.recommended_disposition === 'pending_enactment' && gate?.ok) {
    labels.push('pending-enactment');
  }
  return labels;
}

/**
 * The issue fingerprint, in the ONE format the reader understands
 * (`seenSignalIds` matches `<!-- signal:([a-f0-9]{12}) -->`). The previous marker
 * — `<!-- web-discover:provider:url -->` — could never match that pattern, so
 * nothing read it and every week re-filed the same leads.
 */
export function leadSignalId(lead: DiscoverLead): string {
  return signalId('web-discover', leadChangeKey(lead));
}

export function buildLeadIssueBody(
  lead: DiscoverLead,
  reportDate: string,
  gate: LeadQuoteGate | null,
): string {
  const primary = lead.primary_url
    ? `[Primary](${lead.primary_url})`
    : '_None yet — locate gazette / ministry / CIP PDF before authoring._';
  const pendingNote = lead.recommended_disposition === 'pending_enactment'
    ? (gate?.ok
      ? `
### Pending enactment / Telegram
Quote gate: **passed** — ${gate.reason}.
This lead is **not yet in force** but primary-verified, so it may be published to
Telegram: write the Public brief with explicit wording (\`not yet in force\`,
\`effective DATE\`, or \`bill / cabinet decision — awaits Gazette\`), then
\`publish-approved\`. Keep the \`pending-enactment\` label so the monitor
re-surfaces on commencement.
`
      : `
### Pending enactment — NOT publication-authorised
Quote gate: **failed** — ${gate?.reason ?? 'not run'}.
The \`pending-enactment\` label is withheld, so this lead carries no Telegram
publication authority. To restore it, cite the primary instrument and a verbatim
quote from it, re-run the gate, then add the label by hand.
`)
    : '';
  return `## Possible change

${lead.claim_summary}

| Field | Discovery result |
| --- | --- |
| Jurisdiction | ${lead.jurisdiction}${lead.iso_n3 ? ` (${lead.iso_n3})` : ''} |
| Provider | ${lead.provider ?? 'unknown'} |
| Change kind | ${lead.change_kind} |
| Timing | ${lead.timing} |
| Instrument | ${lead.instrument || '_none cited_'} |
| Effective / announced | ${lead.effective_or_announced_date ?? '_unknown_'} |
| Confidence | ${lead.confidence} |
| Affects dataset | ${lead.affects_dataset === null || lead.affects_dataset === undefined
  ? '_not stated by the provider_'
  : String(lead.affects_dataset)} |
| Disposition hint | \`${lead.recommended_disposition}\` |
| Region pack | ${lead.region ?? '_n/a_'} |
| Weekly run | ${reportDate} |

## Discovery source

[Discovery](${lead.discovery_url})

${lead.quote ? lead.quote.split('\n').map(line => `> ${line}`).join('\n') : '> No quote supplied.'}

## Primary

${primary}

${lead.notes ? `${lead.notes}\n` : ''}${pendingNote}
## Reviewer checklist

- [ ] Locate and cite the current primary legal or government source.
- [ ] Classify this as editorial/navigation, operational guidance, or a substantive legal change.
- [ ] Confirm the effective date and any transition / commencement rules.
- [ ] Identify the exact dataset entities and fields affected (or confirm pending-only).
- [ ] Add or update a regression invariant with any data correction.
- [ ] Cross-check every sentence in the public brief against the evidence below.
- [ ] If publishing while not yet in force: brief explicitly says so.

## Verified evidence

<!-- Add the primary source URL, effective date, and the relevant passage. -->

## Public brief

<!-- Replace this with the exact concise text that may be published to Telegram. -->

This issue is an unverified monitoring lead. It must not be copied into the public
dataset until the reviewer checklist is satisfied. See
\`monitor/README.md\`.

<!-- signal:${leadSignalId(lead)} -->
`;
}

function openUmbrellaIssue(report: WebDiscoverReport, summaryMd: string): string {
  const date = report.retrieved_at.slice(0, 10);
  const title = `[Web weekly] ${date} discovery (${report.lead_count} leads · ${report.providers.join('+')})`;
  const body = `${summaryMd}

---

Automated multi-provider discovery (Exa / Tavily / Firecrawl). Unverified.
Filtered Exa leads may also be filed as separate \`monitor-lead\` issues.
See \`monitor/README.md\` and \`monitor/prompts/exa-weekly-discovery.md\`.
`;
  ensureMonitorLabels();
  const tmp = path.join(ROOT, '.out', `web-issue-body-${date}.md`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, body);
  return runGh([
    'issue', 'create',
    '--title', title,
    '--body-file', tmp,
    '--label', 'monitor-lead',
  ]);
}

/** Issue markers already on GitHub, so a lead is filed once and not every week. */
function loadSeenSignalIds(file: string): Set<string> {
  if (!fs.existsSync(file)) {
    console.warn(`web-discover: no existing-issues file at ${file} — cannot dedupe against open issues`);
    return new Set();
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${file} must contain a JSON array of issues`);
  return seenSignalIds(parsed as Array<{ body?: string | null }>);
}

/**
 * Choose which leads become issues: filter, drop what is already filed, then cap.
 *
 * Split out from the opening loop so the selection is testable without gh, and so
 * the truncation is REPORTED. A silent slice reads as "that was everything",
 * which is the same failure mode as a swallowed parse error.
 */
export function selectLeadIssues(
  report: Pick<WebDiscoverReport, 'leads' | 'coverage_backfill'>,
  maxIssues: number,
  seen: Set<string> = new Set(),
): { selected: DiscoverLead[]; alreadyFiled: DiscoverLead[]; dropped: DiscoverLead[] } {
  const candidates = [...report.leads, ...report.coverage_backfill].filter(shouldOpenLeadIssue);
  const alreadyFiled = candidates.filter(lead => seen.has(leadSignalId(lead)));
  const fresh = candidates.filter(lead => !seen.has(leadSignalId(lead)));
  return {
    selected: fresh.slice(0, maxIssues),
    alreadyFiled,
    dropped: fresh.slice(maxIssues),
  };
}

/**
 * What the cap threw away, as log lines. Returned rather than printed so the
 * truncation is verifiable in a test: the point of the cap is that it is never
 * silent, and "we logged it" is only a claim until something reads the line.
 */
export function capDropWarnings(dropped: DiscoverLead[], maxIssues: number): string[] {
  if (!dropped.length) return [];
  return [
    `::warning title=web-discover cap::${dropped.length} lead(s) over `
    + `WEB_DISCOVER_MAX_ISSUES=${maxIssues} were NOT filed`,
    ...dropped.map(lead =>
      `web-discover: dropped by cap (signal ${leadSignalId(lead)}): `
      + `${lead.jurisdiction} — ${lead.claim_summary.slice(0, 90)}`),
  ];
}

async function openFilteredLeadIssues(
  report: WebDiscoverReport,
  options: Pick<CliOptions, 'maxIssues' | 'existingIssues'>,
): Promise<string[]> {
  ensureMonitorLabels();
  const date = report.retrieved_at.slice(0, 10);
  const urls: string[] = [];
  const seen = loadSeenSignalIds(options.existingIssues);
  const { selected, alreadyFiled, dropped } = selectLeadIssues(report, options.maxIssues, seen);
  for (const lead of alreadyFiled) {
    console.log(
      `web-discover: already filed (signal ${leadSignalId(lead)}): `
      + `${lead.jurisdiction} — ${lead.claim_summary.slice(0, 90)}`,
    );
  }
  for (const line of capDropWarnings(dropped, options.maxIssues)) console.warn(line);
  for (const lead of selected) {
    // The gate only runs on the leads that actually become issues — a small set,
    // so one re-fetch each is proportionate.
    const gate = lead.recommended_disposition === 'pending_enactment'
      ? await gateLeadQuote(lead)
      : null;
    if (gate && !gate.ok) {
      console.warn(
        `web-discover: pending-enactment withheld (${gate.reason}): `
        + `${lead.jurisdiction} — ${lead.claim_summary.slice(0, 90)}`,
      );
    }
    const title = `[Monitor lead] ${lead.jurisdiction}: ${lead.claim_summary}`.slice(0, 200);
    const tmp = path.join(ROOT, '.out', `web-lead-${date}-${urls.length}.md`);
    fs.writeFileSync(tmp, buildLeadIssueBody(lead, date, gate));
    const args = [
      'issue', 'create',
      '--title', title,
      '--body-file', tmp,
    ];
    for (const label of leadIssueLabels(lead, gate)) {
      args.push('--label', label);
    }
    urls.push(runGh(args));
  }
  return urls;
}

async function runProviderRegion(
  provider: DiscoverProvider,
  pack: RegionPack,
  options: CliOptions,
  exaPrompt: string | null,
): Promise<{
  leads: DiscoverLead[];
  backfill: DiscoverLead[];
  credits: number | null;
  dollars: number | null;
  error?: string;
  droppedIncomplete?: number;
}> {
  if (provider === 'exa') {
    const key = process.env.EXA_API_KEY;
    if (!key) return { leads: [], backfill: [], credits: null, dollars: null, error: 'EXA_API_KEY missing' };
    const result = await searchExaRegion({
      apiKey: key,
      pack,
      lookbackDays: options.lookbackDays,
      searchType: options.exaType,
      systemPrompt: exaPrompt ?? loadExaSystemPrompt(),
      timeoutMs: Number(process.env.EXA_TIMEOUT_MS ?? 180_000),
    });
    return {
      leads: result.leads,
      backfill: result.backfill,
      credits: result.credits_used,
      dollars: result.cost_dollars,
      error: result.error,
      droppedIncomplete: result.dropped_incomplete,
    };
  }
  if (provider === 'tavily') {
    const key = process.env.TAVILY_API_KEY;
    if (!key) return { leads: [], backfill: [], credits: null, dollars: null, error: 'TAVILY_API_KEY missing' };
    const result = await searchTavilyRegion({
      apiKey: key,
      pack,
      lookbackDays: options.lookbackDays,
      maxResults: options.maxResults,
      timeoutMs: Number(process.env.TAVILY_TIMEOUT_MS ?? 60_000),
    });
    return {
      leads: result.leads,
      backfill: result.backfill,
      credits: result.credits_used,
      dollars: null,
      error: result.error,
    };
  }
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { leads: [], backfill: [], credits: null, dollars: null, error: 'FIRECRAWL_API_KEY missing' };
  const result = await searchFirecrawlRegion({
    apiKey: key,
    pack,
    lookbackDays: options.lookbackDays,
    maxResults: options.maxResults,
    timeoutMs: Number(process.env.FIRECRAWL_TIMEOUT_MS ?? 90_000),
    scrape: options.firecrawlScrape,
  });
  return {
    leads: result.leads,
    backfill: result.backfill,
    credits: result.credits_used,
    dollars: null,
    error: result.error,
  };
}

export async function runWebDiscover(options: CliOptions): Promise<WebDiscoverReport> {
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
      leads?: DiscoverLead[];
      coverage_backfill?: DiscoverLead[];
    };
    const leads = annotateAlreadyHeld(
      dedupeLeads((fixture.leads ?? []).map(l => ({ ...l, provider: l.provider ?? 'exa' }))),
      corpus,
    );
    const backfill = annotateAlreadyHeld(
      dedupeLeads((fixture.coverage_backfill ?? []).map(l => ({ ...l, provider: l.provider ?? 'exa' }))),
      corpus,
    );
    return {
      retrieved_at: retrievedAt,
      lookback_days: options.lookbackDays,
      providers: options.providers,
      regions: packs.map(p => p.id),
      fixture_mode: true,
      cost_dollars_total: 0,
      credits_used: { exa: 0, tavily: 0, firecrawl: 0 },
      lead_count: leads.length,
      backfill_count: backfill.length,
      dropped_incomplete: 0,
      leads,
      coverage_backfill: backfill,
      provider_errors: [],
    };
  }

  const exaPrompt = options.providers.includes('exa') ? loadExaSystemPrompt() : null;
  const allLeads: DiscoverLead[] = [];
  const allBackfill: DiscoverLead[] = [];
  const providerErrors: Array<{ provider: string; region: string; error: string }> = [];
  const credits: Partial<Record<DiscoverProvider, number>> = {};
  let dollars = 0;
  let droppedIncomplete = 0;

  for (const provider of options.providers) {
    for (const pack of packs) {
      if (options.dryRun) {
        console.log(`[dry-run] would run ${provider}/${pack.id}`);
        continue;
      }
      console.log(`web-discover: ${provider}/${pack.id}…`);
      const result = await runProviderRegion(provider, pack, options, exaPrompt);
      if (result.error) {
        console.error(`web-discover: ${provider}/${pack.id} failed: ${result.error}`);
        providerErrors.push({ provider, region: pack.id, error: result.error });
      } else {
        console.log(
          `web-discover: ${provider}/${pack.id} → ${result.leads.length} leads`
          + (result.backfill.length ? `, ${result.backfill.length} backfill` : '')
          + (result.droppedIncomplete ? `, ${result.droppedIncomplete} dropped as incomplete` : ''),
        );
      }
      droppedIncomplete += result.droppedIncomplete ?? 0;
      allLeads.push(...result.leads);
      allBackfill.push(...result.backfill);
      if (typeof result.credits === 'number') {
        credits[provider] = (credits[provider] ?? 0) + result.credits;
      }
      if (typeof result.dollars === 'number') dollars += result.dollars;
    }
  }

  const leads = annotateAlreadyHeld(dedupeLeads(allLeads), corpus);
  const backfill = annotateAlreadyHeld(dedupeLeads(allBackfill), corpus);
  return {
    retrieved_at: retrievedAt,
    lookback_days: options.lookbackDays,
    providers: options.providers,
    regions: packs.map(p => p.id),
    fixture_mode: false,
    cost_dollars_total: dollars || null,
    credits_used: credits,
    lead_count: leads.length,
    backfill_count: backfill.length,
    dropped_incomplete: droppedIncomplete,
    leads,
    coverage_backfill: backfill,
    provider_errors: providerErrors,
  };
}

if (import.meta.main) {
  try {
    const options = readArgs(process.argv.slice(2));
    const report = await runWebDiscover(options);
    const markdown = renderMarkdown(report);
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(options.summary, markdown);
    // Also write legacy exa filenames so existing local habits keep working.
    fs.writeFileSync(path.join(ROOT, '.out', 'exa-leads.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(ROOT, '.out', 'exa-leads.md'), markdown);
    console.log(`wrote ${options.output}`);
    console.log(`wrote ${options.summary}`);
    console.log(
      `leads=${report.lead_count} backfill=${report.backfill_count} `
      + `dropped=${report.dropped_incomplete} `
      + `errors=${report.provider_errors.length} `
      + `credits=${JSON.stringify(report.credits_used)} `
      + `exa$=${report.cost_dollars_total ?? 'n/a'}`,
    );
    // Decided BEFORE anything is filed. The check used to run last, so a run in
    // which every provider and region failed still opened an umbrella issue
    // announcing a quiet week, and only then failed the job.
    const everythingFailed = !options.fixture
      && !options.dryRun
      && report.lead_count === 0
      && report.backfill_count === 0
      && report.provider_errors.length > 0
      && report.provider_errors.length >= options.providers.length * report.regions.length;
    if (options.openIssue) {
      if (options.dryRun || options.fixture) {
        console.log('skipping --open-issue in dry-run/fixture mode');
      } else if (everythingFailed) {
        console.error(
          '::error title=web-discover::every provider/region failed — no issue opened, '
          + 'because "0 leads" here means the run learned nothing, not that nothing happened',
        );
      } else {
        const url = openUmbrellaIssue(report, markdown);
        console.log(`opened umbrella ${url}`);
        if (options.openLeadIssues) {
          const leadUrls = await openFilteredLeadIssues(report, options);
          console.log(`opened ${leadUrls.length} filtered lead issue(s)`);
          leadUrls.forEach(u => console.log(u));
        }
      }
    }
    if (everythingFailed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

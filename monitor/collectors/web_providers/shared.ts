/** Shared types + helpers for weekly web discovery providers (Exa / Tavily / Firecrawl). */

import { changeKey, normalizeInstrument } from '../../sweep/run';

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

export type DiscoverProvider = 'exa' | 'tavily' | 'firecrawl';

export interface DiscoverLead {
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
  /**
   * null means NOT RECORDED — the provider did not answer. Never inferred from
   * the disposition: "this is not obviously noise" and "a modelled field moves"
   * are different claims, and only the second one authorises dataset work.
   */
  affects_dataset: boolean | null;
  recommended_disposition: Disposition;
  why_not_noise: string;
  notes: string;
  /**
   * The official identifier of the law/decree/act the lead is about ("1/2026",
   * "PF-67"), when one is cited. This is the identity of the EVENT: one gazette
   * act reported by three outlets has three URLs and one instrument, so dedupe
   * and the issue fingerprint key on it first (see leadChangeKey).
   */
  instrument?: string | null;
  already_held?: boolean;
  matched_route_ids?: string[];
  region?: string;
  provider?: DiscoverProvider;
}

export interface RegionPack {
  id: string;
  label: string;
  queryHint: string;
}

export const REGION_PACKS: RegionPack[] = [
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
    // No exclusion prose. queryHint is interpolated into the Tavily/Firecrawl
    // KEYWORD query, where there is no negation: "exclude student F/J … public
    // charge … litigation status" simply added those words to the search. The
    // five US leads triaged away in the 2026-08-13 run were exactly those
    // topics. Topical exclusions belong in the Exa system prompt (which is read
    // by a model that can honour them); excludeDomains cannot express them.
    queryHint:
      'United States Canada residency citizenship: EB-5, E-2, extraordinary ability, '
      + 'investor immigration, nationality law',
  },
];

export interface ProviderPackResult {
  provider: DiscoverProvider;
  region: string;
  leads: DiscoverLead[];
  backfill: DiscoverLead[];
  credits_used: number | null;
  cost_dollars: number | null;
  error?: string;
  /** Rows the provider returned that were unusable (missing claim/discovery URL). */
  dropped_incomplete?: number;
}

/** The one URL test. `"N/A"`, `"see gazette"` and a bare hostname all fail it. */
export function isHttpUrl(value: string | null | undefined): boolean {
  return /^https?:\/\/[^\s]+$/i.test(String(value ?? '').trim());
}

export function hostOf(url: string): string {
  return (/^https?:\/\/([^/?#]+)/i.exec(url.trim())?.[1] ?? '').toLowerCase().replace(/^www\./, '');
}

/**
 * Hosts that are pointers, never authority — a URL here is not a primary source
 * however confident the model sounds.
 *
 * Deliberately short, in the style of HTTP_ONLY_OFFICIAL in
 * tests/data_invariants.test.ts: every entry is named in
 * monitor/prompts/exa-weekly-discovery.md as a tier-3/4 discovery pointer or has
 * actually turned up in this pipeline's output. It must not grow into a general
 * media blocklist — tier 2 (a state news agency restating a gazette act) is
 * legitimate, and a long list would start rejecting those.
 */
export const NON_PRIMARY_HOSTS = [
  // Trade press. Named in the prompt's source hierarchy tier 3: "ONLY as a
  // pointer to a primary".
  'imidaily.com',
  // Agency/marketing sites. immigrantinvest.com is the discovery_url in this
  // repo's own Exa fixture, cited there for a Grenada parliament bill.
  'immigrantinvest.com',
  'henleyglobal.com',
  // Firm alerts. Named verbatim in the prompt's Exclude list: "Firm newsletters
  // alone (Fragomen, BAL, EY, etc.) without a primary URL".
  'fragomen.com',
  'bal.com',
  'ey.com',
] as const;

export function isNonPrimaryHost(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return NON_PRIMARY_HOSTS.some(entry => host === entry || host.endsWith(`.${entry}`));
}

export interface CompiledCorpus {
  routes: Array<{ id: string; summary?: string; country?: { iso_n3?: string } }>;
  residence_routes?: Array<{ id: string; summary?: string; country?: { iso_n3?: string } }>;
}

/**
 * Keep queries short (Tavily recommends <1500 chars; shorter also ranks better).
 * Do not stuff long prompts here — Exa gets the long system prompt separately.
 */
export function mobilityQuery(pack: RegionPack, lookbackDays: number): string {
  return (
    `Official citizenship residency golden visa CBI RBI naturalisation dual nationality `
    + `law change last ${lookbackDays} days: ${pack.queryHint}`
  );
}

/** Domains that burn free-tier credits without yielding atlas-grade primaries. */
export { SOCIAL_NOISE_DOMAINS as NOISE_EXCLUDE_DOMAINS } from '../../lib/web-clients';

/**
 * The identity of the CHANGE a lead reports, shared by dedupe and the issue
 * fingerprint so both agree on what "the same thing" is.
 *
 * Reuses changeKey from the sweep — a law is one event however many outlets
 * report it — but keeps the URL as the fallback rather than changeKey's
 * iso|category|date. Raw Tavily/Firecrawl hits are all `multi` + `other` + no
 * date, so that fallback would collapse a whole week of unrelated hits into one.
 */
export function leadChangeKey(lead: DiscoverLead): string {
  const iso = lead.iso_n3 ?? lead.jurisdiction.trim().toLowerCase();
  if (normalizeInstrument(lead.instrument ?? '')) {
    return changeKey({
      iso_n3: iso,
      category: lead.change_kind,
      effective_date: lead.effective_or_announced_date,
      legal_instrument: lead.instrument ?? '',
    });
  }
  const url = (lead.primary_url || lead.discovery_url).toLowerCase().replace(/\/$/, '');
  return `${iso}|${url}`;
}

/** Cross-provider dedupe prefers Exa structured rows, then anything with a primary_url. */
export function dedupeLeads(leads: DiscoverLead[]): DiscoverLead[] {
  const byUrl = new Map<string, DiscoverLead>();
  const rank = (lead: DiscoverLead) => {
    let score = 0;
    if (lead.provider === 'exa') score += 3;
    if (lead.primary_url) score += 2;
    if (lead.confidence === 'high') score += 2;
    if (lead.confidence === 'medium') score += 1;
    if (lead.quote) score += 1;
    return score;
  };
  for (const lead of leads) {
    const key = leadChangeKey(lead);
    const existing = byUrl.get(key);
    if (!existing || rank(lead) > rank(existing)) byUrl.set(key, lead);
  }
  return [...byUrl.values()];
}

export function annotateAlreadyHeld(
  leads: DiscoverLead[],
  corpus: CompiledCorpus | null,
): DiscoverLead[] {
  if (!corpus) return leads;
  const all = [...corpus.routes, ...(corpus.residence_routes ?? [])];
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

/** Map a raw search hit into a triage lead (low confidence until structured). */
export function searchHitToLead(opts: {
  provider: DiscoverProvider;
  region: string;
  title: string;
  url: string;
  snippet: string | null;
  published?: string | null;
}): DiscoverLead | null {
  const title = opts.title.trim();
  const url = opts.url.trim();
  if (!title || !url) return null;
  if (!isHttpUrl(url)) return null;
  const lower = `${title} ${opts.snippet ?? ''}`.toLowerCase();
  // Cheap relevance gate so free-tier noise does not flood the umbrella issue.
  const relevant = /(citizen|nationalit|residenc|visa|immigra|naturalis|naturaliz|passport|golden|cbi|rbi|dual.?nation)/i
    .test(lower);
  if (!relevant) return null;
  return {
    jurisdiction: 'multi',
    iso_n3: null,
    claim_summary: title.slice(0, 280),
    change_kind: 'other',
    timing: 'unclear',
    effective_or_announced_date: opts.published ? opts.published.slice(0, 10) : null,
    horizon: 'past_7_days',
    primary_url: null,
    discovery_url: url,
    quote: opts.snippet ? opts.snippet.slice(0, 400) : null,
    confidence: 'low',
    // NOT RECORDED. A keyword match on a headline says nothing about whether a
    // modelled field moves; only a reviewer or a structured provider can answer.
    affects_dataset: null,
    recommended_disposition: 'needs_primary',
    why_not_noise: `Search hit from ${opts.provider}; mobility keywords matched title/snippet.`,
    notes:
      `Raw ${opts.provider} search hit — not Exa-structured. Verify primary before authoring.`,
    instrument: null,
    region: opts.region,
    provider: opts.provider,
  };
}

/**
 * Split raw keyword hits into this-window leads and older coverage_backfill.
 *
 * The providers' time filters are coarse (Tavily `time_range`, Firecrawl `tbs`)
 * and routinely return items published before the window, so the backfill list
 * existed but nothing ever reached it. Undated hits stay in `leads`: an absent
 * publication date is not evidence of age.
 */
export function splitByLookback(
  leads: DiscoverLead[],
  lookbackDays: number,
  now: number = Date.now(),
): { leads: DiscoverLead[]; backfill: DiscoverLead[] } {
  const cutoff = now - lookbackDays * 86_400_000;
  const fresh: DiscoverLead[] = [];
  const backfill: DiscoverLead[] = [];
  for (const lead of leads) {
    const published = lead.effective_or_announced_date
      ? Date.parse(lead.effective_or_announced_date)
      : Number.NaN;
    if (!Number.isNaN(published) && published < cutoff) {
      backfill.push({
        ...lead,
        notes: `${lead.notes} [first public signal ${lead.effective_or_announced_date} — older than the `
          + `${lookbackDays}-day window; coverage refresh candidate]`.trim(),
      });
    } else {
      fresh.push(lead);
    }
  }
  return { leads: fresh, backfill };
}

export function renderMarkdown(report: {
  retrieved_at: string;
  lookback_days: number;
  providers: string[];
  regions: string[];
  lead_count: number;
  backfill_count: number;
  cost_dollars_total: number | null;
  credits_used: Record<string, number | null>;
  leads: DiscoverLead[];
  coverage_backfill: DiscoverLead[];
  provider_errors: Array<{ provider: string; region: string; error: string }>;
  dropped_incomplete?: number;
}): string {
  const lines: string[] = [
    `# Weekly web discovery — ${report.retrieved_at.slice(0, 10)}`,
    '',
    `- Providers: ${report.providers.join(', ') || '(none)'}`,
    `- Lookback: **${report.lookback_days}** days`,
    `- Regions: ${report.regions.join(', ') || '(none)'}`,
    `- Leads: **${report.lead_count}** · backfill: **${report.backfill_count}**`,
    // A row the provider returned and we could not use is a different fact from
    // a quiet week, so it is stated rather than left to the logs.
    `- Dropped as incomplete (no claim / no usable discovery URL): **${report.dropped_incomplete ?? 0}**`,
    `- Exa $ estimate: ${report.cost_dollars_total == null ? 'n/a' : `$${report.cost_dollars_total.toFixed(4)}`}`,
    `- Credits: ${Object.entries(report.credits_used).map(([k, v]) => `${k}=${v ?? 'n/a'}`).join(', ') || 'n/a'}`,
    '',
    'Discovery only — do not copy into the dataset without primary verification.',
    '',
  ];

  if (report.provider_errors.length) {
    lines.push('## Provider / region errors', '');
    for (const err of report.provider_errors) {
      lines.push(`- **${err.provider}/${err.region}**: ${err.error}`);
    }
    lines.push('');
  }

  const section = (title: string, leads: DiscoverLead[]) => {
    lines.push(`## ${title}`, '');
    if (!leads.length) {
      lines.push('_None._', '');
      return;
    }
    lines.push(
      '| Provider | Disposition | Conf | Jur | Claim | Link |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const lead of leads) {
      const claim = lead.claim_summary.replace(/\|/g, '\\|').slice(0, 120);
      const link = lead.primary_url
        ? `[primary](${lead.primary_url})`
        : `[discovery](${lead.discovery_url})`;
      const held = lead.already_held ? ' · held?' : '';
      lines.push(
        `| ${lead.provider ?? '?'} | \`${lead.recommended_disposition}\`${held} | ${lead.confidence}`
        + ` | ${lead.jurisdiction} | ${claim} | ${link} |`,
      );
    }
    lines.push('');
  };

  section('Leads', report.leads);
  section('Coverage backfill', report.coverage_backfill);
  lines.push(
    '## Next actions',
    '',
    '1. Prefer Exa-structured high/medium rows with primary_url.',
    '2. Treat Tavily/Firecrawl raw hits as pointers — fetch primary before authoring.',
    '3. Park pending_enactment; ignore not_newsworthy / thin process noise.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

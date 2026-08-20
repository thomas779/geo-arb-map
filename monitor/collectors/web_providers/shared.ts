/** Shared types + helpers for weekly web discovery providers (Exa / Tavily / Firecrawl). */

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
  affects_dataset: boolean;
  recommended_disposition: Disposition;
  why_not_noise: string;
  notes: string;
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
    queryHint:
      'United States Canada residency citizenship: EB-5, E-2, extraordinary ability, '
      + 'investor immigration, nationality law — exclude student F/J, B-1/B-2, consular fees, '
      + 'public charge screens, litigation status',
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

export function leadKey(lead: DiscoverLead): string {
  const url = (lead.primary_url || lead.discovery_url).toLowerCase().replace(/\/$/, '');
  return `${lead.provider ?? ''}|${lead.iso_n3 ?? lead.jurisdiction.toLowerCase()}|${lead.change_kind}|${url}`;
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
    const url = (lead.primary_url || lead.discovery_url).toLowerCase().replace(/\/$/, '');
    const key = `${lead.iso_n3 ?? lead.jurisdiction.toLowerCase()}|${url}`;
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
  if (!/^https?:\/\//i.test(url)) return null;
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
    affects_dataset: true,
    recommended_disposition: 'needs_primary',
    why_not_noise: `Search hit from ${opts.provider}; mobility keywords matched title/snippet.`,
    notes:
      `Raw ${opts.provider} search hit — not Exa-structured. Verify primary before authoring.`,
    region: opts.region,
    provider: opts.provider,
  };
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
}): string {
  const lines: string[] = [
    `# Weekly web discovery — ${report.retrieved_at.slice(0, 10)}`,
    '',
    `- Providers: ${report.providers.join(', ') || '(none)'}`,
    `- Lookback: **${report.lookback_days}** days`,
    `- Regions: ${report.regions.join(', ') || '(none)'}`,
    `- Leads: **${report.lead_count}** · backfill: **${report.backfill_count}**`,
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

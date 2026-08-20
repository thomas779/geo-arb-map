/** Shared types + helpers for weekly web discovery providers (Exa / Tavily / Firecrawl). */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { changeKey, normalizeInstrument, officialSourcesByJurisdiction } from '../../sweep/run';

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
  /**
   * Which weekly pass surfaced the lead. `official_allowlist` means the query
   * was restricted to the region's known official publishers, so the hit came
   * from a gazette/ministry host we already trust — a stronger PROVENANCE signal
   * than a bare web hit, and nothing more. It has not been fetched or
   * quote-checked, so the confidence and disposition are unchanged by it.
   * Absent means the ordinary open pass, which is the default everywhere.
   */
  source_pass?: 'open_web' | 'official_allowlist';
}

export interface RegionPack {
  id: string;
  label: string;
  queryHint: string;
  /**
   * M49 codes for the jurisdictions this pack covers, used to look the pack's
   * official publishers up in monitor/sources/manifest.json. The prose above is
   * what a search engine reads; this is what the manifest can be joined on.
   *
   * Every code here is derived from a jurisdiction the label or queryHint
   * already names — either directly ("Gibraltar") or by enumerating a named
   * grouping ("EU member states", "African countries", "OECS"). Nothing is added
   * because it seemed adjacent: the constrained pass is meant to cover the same
   * ground as the open query, and widening one without the other would make the
   * two passes answer different questions.
   *
   * Known gaps, stated rather than quietly filled: no pack names Russia,
   * Belarus, Turkey or the Caucasus, and none names the non-CIP Caribbean or
   * most of the Pacific, so no constrained pass reaches them. Widening the
   * packs' prose is the way to fix that, not widening this list alone.
   */
  isos: string[];
}

// EU-27, by accession, so a reviewer can check the list against a single fact.
const EU_MEMBER_STATES = [
  '056', // Belgium
  '250', // France
  '276', // Germany
  '380', // Italy
  '442', // Luxembourg
  '528', // Netherlands
  '208', // Denmark
  '372', // Ireland
  '300', // Greece
  '620', // Portugal
  '724', // Spain
  '040', // Austria
  '246', // Finland
  '752', // Sweden
  '196', // Cyprus
  '203', // Czechia
  '233', // Estonia
  '348', // Hungary
  '428', // Latvia
  '440', // Lithuania
  '470', // Malta
  '616', // Poland
  '703', // Slovakia
  '705', // Slovenia
  '100', // Bulgaria
  '642', // Romania
  '191', // Croatia
];

/**
 * The 54 UN member states in Africa. "African countries" in the pack's
 * queryHint is a category, so it is enumerated in full rather than sampled —
 * most of these have no manifest source yet, which costs nothing here (they
 * simply contribute no hosts) and means the allowlist grows on its own as the
 * official-source programme fills them in.
 *
 * Excludes Western Sahara (a disputed M49 "special" entry) and Somaliland (in
 * the registry, unrecognised), and excludes African territories of European
 * states (Saint Helena, Mayotte, Réunion) — a pack of sovereign nationality
 * regimes stays easier to reason about than one mixing in metropolitan law.
 */
const AFRICAN_STATES = [
  '012', '024', '072', '108', '120', '132', '140', '148', '174', '178',
  '180', '204', '226', '231', '232', '262', '266', '270', '288', '324',
  '384', '404', '426', '430', '434', '450', '454', '466', '478', '480',
  '504', '508', '516', '562', '566', '624', '646', '678', '686', '690',
  '694', '706', '710', '716', '728', '729', '748', '768', '788', '800',
  '818', '834', '854', '894',
];

export const REGION_PACKS: RegionPack[] = [
  {
    id: 'europe',
    label: 'Europe + UK + Gibraltar + Malta + Cyprus',
    queryHint: 'Europe, United Kingdom, Gibraltar, Malta, Cyprus, EU member states',
    // EU-27 (Malta and Cyprus among them), plus the rest of what "Europe" means
    // for mobility law: EFTA/EEA, the UK with its Crown Dependencies and
    // Gibraltar, the four microstates, the Western Balkans and the eastern
    // neighbourhood, and the three Nordic autonomies that legislate their own
    // right of residence (Åland, Faroes, Greenland) and carry their own
    // manifest sources.
    isos: [
      ...EU_MEMBER_STATES,
      '352', '578', '438', '756', // Iceland, Norway, Liechtenstein, Switzerland
      '826', '292', '831', '832', '833', // UK, Gibraltar, Guernsey, Jersey, Isle of Man
      '020', '492', '674', '336', // Andorra, Monaco, San Marino, Vatican
      '008', '070', '499', '807', '688', 'XKX', // Albania, Bosnia, Montenegro, N. Macedonia, Serbia, Kosovo
      '498', '804', // Moldova, Ukraine
      '248', '234', '304', // Åland, Faroe Islands, Greenland
    ],
  },
  {
    id: 'gulf',
    label: 'Gulf + Levant',
    queryHint: 'UAE, Saudi Arabia, Bahrain, Qatar, Oman, Kuwait, Jordan, Lebanon, Israel',
    // Exactly the nine states the queryHint names, in that order.
    isos: ['784', '682', '048', '634', '512', '414', '400', '422', '376'],
  },
  {
    id: 'caribbean',
    label: 'Caribbean CIP / OECS',
    queryHint:
      'Antigua and Barbuda, Dominica, Grenada, Saint Kitts and Nevis, Saint Lucia, '
      + 'Caribbean citizenship by investment',
    // The five named CIP states, plus the rest of the OECS the label names:
    // Montserrat and St Vincent complete the full membership, Anguilla and the
    // BVI are associate members. Barbados, the Bahamas and Trinidad are neither
    // CIP nor OECS and no pack names them.
    isos: ['028', '212', '308', '659', '662', '500', '670', '660', '092'],
  },
  {
    id: 'latam',
    label: 'Latin America',
    queryHint: 'Latin America, Mexico, Central America, South America residency citizenship',
    // Mexico, the seven Central American states (Belize included — the pack is
    // geographic, not linguistic), the twelve South American states, and the
    // Greater Antilles republics, which sit here because the Caribbean pack is
    // scoped to CIP/OECS and would otherwise leave them in no pack at all.
    isos: [
      '484', // Mexico
      '084', '188', '222', '320', '340', '558', '591', // Central America
      '032', '068', '076', '152', '170', '218', '328', '600', '604', '740', '858', '862',
      '192', '214', '332', // Cuba, Dominican Republic, Haiti
    ],
  },
  {
    id: 'africa',
    label: 'Africa',
    queryHint: 'African countries residency citizenship golden visa investment migration',
    isos: [...AFRICAN_STATES],
  },
  {
    id: 'asia',
    label: 'Asia-Pacific',
    queryHint:
      'Asia Pacific residency citizenship: Japan, South Korea, Indonesia, Thailand, '
      + 'Singapore, Malaysia, Philippines, India, China, Kazakhstan, Australia, New Zealand',
    // The twelve the queryHint names and no more. "Asia-Pacific" is the label,
    // but the hint is an explicit list, so Hong Kong, Macao, Taiwan, Vietnam and
    // the Pacific states stay out even though several have manifest sources —
    // the constrained pass should not quietly search jurisdictions the open pass
    // never asks about.
    isos: ['392', '410', '360', '764', '702', '458', '608', '356', '156', '398', '036', '554'],
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
    // The two the queryHint names. US insular areas are left out because the
    // nationality and immigration law that moves for them is federal and
    // published on the same federal hosts this pack already allows.
    isos: ['840', '124'],
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

const MONITOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One manifest read per process, not one per region. */
let officialSourceCache: Map<string, Array<{ title: string; url: string }>> | null = null;
let officialSourceCacheRoot: string | null = null;

function officialSources(root: string): Map<string, Array<{ title: string; url: string }>> {
  if (officialSourceCache && officialSourceCacheRoot === root) return officialSourceCache;
  officialSourceCache = officialSourcesByJurisdiction(root);
  officialSourceCacheRoot = root;
  return officialSourceCache;
}

/**
 * The official publishers we already trust for a region, as bare hostnames.
 *
 * DERIVED, never authored. There is exactly one list of official sources in this
 * repo — monitor/sources/manifest.json — and officialSourcesByJurisdiction
 * already does the hard parts: active verification-tier rows only, aggregator
 * hosts (constituteproject and friends) dropped, six sources per jurisdiction
 * max. A second hand-maintained domain map would drift from it within a month.
 *
 * citations.ts::manifestHosts flattens the same manifest but has no jurisdiction
 * dimension and keeps every tier including the aggregators, so it answers "do we
 * already subscribe to this host" and not "which hosts speak for this region".
 *
 * An empty result is meaningful: it means we know of no official publisher for
 * any jurisdiction in the pack, and the caller must skip the constrained pass
 * rather than send an empty allowlist, which every provider reads as no filter.
 */
export function regionOfficialHosts(pack: RegionPack, root: string = MONITOR_ROOT): string[] {
  const byIso = officialSources(root);
  const hosts = new Set<string>();
  for (const iso of pack.isos) {
    for (const source of byIso.get(iso) ?? []) {
      const host = hostOf(source.url);
      if (host) hosts.add(host);
    }
  }
  return [...hosts].sort();
}

/**
 * The constrained pass's query. Positive terms only — same rule as
 * mobilityQuery: the allowlist does the narrowing, so the words never need to
 * say what to leave out.
 *
 * Shorter than the open query because the domain filter is already carrying most
 * of the specificity: on a gazette host, "citizenship residence permit
 * naturalisation decree" is the whole question.
 */
export function gazetteQuery(pack: RegionPack, lookbackDays: number): string {
  return (
    `Citizenship nationality residence permit naturalisation visa decree, law, `
    + `regulation or notice published in the last ${lookbackDays} days — ${pack.label}`
  );
}

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
    // Ranks the REPRESENTATION, not the claim: when the open and constrained
    // passes return the same URL, the surviving row should be the one that says
    // it came off a publisher we already trust. Deliberately the smallest
    // increment — provenance is not verification, and this must not lift a
    // keyword hit above an Exa-structured row.
    if (lead.source_pass === 'official_allowlist') score += 1;
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
  /**
   * Defaults to the open pass. Setting `official_allowlist` records HOW the hit
   * was found and changes nothing else: the row still comes back `low` /
   * `needs_primary`, because a gazette host that has not been fetched and
   * quote-matched is a better pointer, not a verified one.
   */
  pass?: 'open_web' | 'official_allowlist';
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
  const pass = opts.pass ?? 'open_web';
  const constrained = pass === 'official_allowlist';
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
    why_not_noise: constrained
      ? `Search hit from ${opts.provider} restricted to ${opts.region}'s known official `
        + `publishers (${hostOf(url) || 'unknown host'}); mobility keywords matched title/snippet.`
      : `Search hit from ${opts.provider}; mobility keywords matched title/snippet.`,
    notes: constrained
      ? `Raw ${opts.provider} search hit from the official-publisher pass — the host is one the `
        + 'manifest already trusts for this region, which raises provenance and not verification. '
        + 'Nothing here has been fetched or quote-matched; verify the primary before authoring.'
      : `Raw ${opts.provider} search hit — not Exa-structured. Verify primary before authoring.`,
    instrument: null,
    region: opts.region,
    provider: opts.provider,
    source_pass: pass,
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
  gazette_pass?: boolean;
  gazette_pass_skipped?: string[];
}): string {
  const gazetteLeads = [...report.leads, ...report.coverage_backfill]
    .filter(lead => lead.source_pass === 'official_allowlist').length;
  const lines: string[] = [
    `# Weekly web discovery — ${report.retrieved_at.slice(0, 10)}`,
    '',
    `- Providers: ${report.providers.join(', ') || '(none)'}`,
    `- Lookback: **${report.lookback_days}** days`,
    `- Regions: ${report.regions.join(', ') || '(none)'}`,
    `- Leads: **${report.lead_count}** · backfill: **${report.backfill_count}**`,
    // The whole point of the constrained pass is that its yield is measurable
    // against the open pass, so the count is stated even when it is zero.
    `- Official-publisher pass: ${report.gazette_pass === false ? '**off**' : '**on**'}`
    + ` · rows from it: **${gazetteLeads}**`
    + (report.gazette_pass_skipped?.length
      ? ` · skipped (no manifest hosts): ${report.gazette_pass_skipped.join(', ')}`
      : ''),
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
      '| Provider | Pass | Disposition | Conf | Jur | Claim | Link |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const lead of leads) {
      const claim = lead.claim_summary.replace(/\|/g, '\\|').slice(0, 120);
      const link = lead.primary_url
        ? `[primary](${lead.primary_url})`
        : `[discovery](${lead.discovery_url})`;
      const held = lead.already_held ? ' · held?' : '';
      // The provenance of the row, in its own column: "official publisher" says
      // the host is one the manifest already trusts for this region. It does not
      // say the claim is verified — the disposition column still does that.
      const pass = lead.source_pass === 'official_allowlist' ? '**official publisher**' : 'open web';
      lines.push(
        `| ${lead.provider ?? '?'} | ${pass} | \`${lead.recommended_disposition}\`${held}`
        + ` | ${lead.confidence} | ${lead.jurisdiction} | ${claim} | ${link} |`,
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
    '3. An **official publisher** row is a better pointer, not a verified one: the host is',
    '   already in the manifest, so the primary is usually one click away — but it has not',
    '   been fetched or quote-matched, so it still needs one.',
    '4. Park pending_enactment; ignore not_newsworthy / thin process noise.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

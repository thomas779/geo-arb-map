/**
 * Driving-licence exchange layer (#171, #210).
 *
 * The corpus lives in data/compiled/licence_exchange.json — a BUILD INPUT, not a
 * served file. What ships is an index (/licence_exchange.json: disclaimer,
 * agreements, destination summaries, origin picker) plus one slice per origin
 * (/licence-exchange/<origin>.json), which is the same index-plus-slices shape the
 * citizenship corpus already uses. See buildLicenceIndex / buildOriginSlice below.
 *
 * This module is pure helpers so UI, emitters and tests share the same lookup logic.
 */

/**
 * Who may use this listing, by the holder's NATIONALITY rather than by the licence.
 *
 * RTA Dubai's annex is the case that forced this: its table has a Nationality column
 * with three values, and they decide the answer. A German licence held by an Indian
 * national exchanges in Dubai; a Portuguese one held by the same person does not,
 * because Portugal is listed "Nationals only". Before this field that fact survived
 * only in free-text `note`, i.e. it would have been lost the moment the row was
 * authored, and the layer would have told a reader a swap was available that the
 * counter will refuse.
 *
 * - `all`            — the licence alone qualifies, whatever passport the holder has.
 * - `nationals_only` — only nationals of the issuing country may use this listing.
 * - `gcc`            — RTA's third value, "All exception countries", carried by its
 *                      five GCC origins: the holder must be a national of one of the
 *                      states on the destination's own exception list. Narrower than
 *                      `all` and wider than `nationals_only`, so it cannot be folded
 *                      into either.
 */
export type NationalityGate = 'all' | 'nationals_only' | 'gcc';

export interface LicenceExchangeEntry {
  /**
   * The authority's own name for the origin, in its language ("Albanien",
   * "Bosnien und Herzegowina"). Present ONLY when it differs from the English
   * label — carrying both for all 419 rows duplicated ~12KB and pushed the served
   * file past the 200KB public-surface cap. Read through `originLabel()`.
   */
  origin_label?: string;
  origin_label_en: string;
  origin_iso_n3: string | null;
  parent_iso_n3: string | null;
  subnational: boolean;
  subnational_label: string | null;
  classes: string | null;
  theory_test_required: boolean | null;
  practical_test_required: boolean | null;
  no_retest: boolean;
  /** Country-level row that still varies by sub-unit (e.g. Canada under UK SI). */
  varies_by_subnational?: boolean;
  /**
   * NULL/absent means NOT RECORDED, never "open to all".
   *
   * Most destinations state no nationality rule anywhere in their instrument. That is
   * SILENCE, and silence is not a permission: defaulting it to `all` would invent a
   * right for every one of the 45 destinations from the fact that nobody wrote a
   * restriction down. Read it through `nationalityGateLabel`, which says "not
   * recorded" for null and never borrows a friendlier word — the same rule that
   * governs theory_test_required, max_age and work_rights elsewhere in the atlas.
   */
  nationality_gate?: NationalityGate | null;
  /**
   * Months from taking up residence (or from the licence's arrival) within which the
   * exchange must be CLAIMED, after which the right lapses and the holder is back to
   * a full test. Deliberately NOT the same field as `foreign_licence_grace_months` —
   * see the comment there.
   *
   * Lives on the entry as well as the destination because Italy's window varies by
   * origin: four years for Albania, Argentina, Switzerland and Ukraine, six for the
   * rest. An entry value overrides the destination's; `resolveExchangeWindow` does it.
   */
  exchange_deadline_months?: number | null;
  /** See LicenceExchangeDestination.foreign_licence_grace_months. */
  foreign_licence_grace_months?: number | null;
  note?: string | null;
}

export interface LicenceExchangeDestination {
  iso_n3: string;
  name: string;
  instrument: string;
  source_url: string;
  source_urls?: string[];
  notes?: string[];
  /**
   * The arrangement this list rests on. Held on the destination rather than on each
   * entry: there is one agreement per list, and stamping it onto all 419 rows was
   * denormalisation that pushed the served file past the 200KB public-surface cap.
   */
  agreement_id?: string;
  /**
   * A deadline to CLAIM a right before it lapses: apply within N months of taking up
   * residence or lose the exchange and sit the full test.
   */
  exchange_deadline_months?: number | null;
  /**
   * The opposite clock, and the reason there are two fields rather than one with a
   * direction flag. Türkiye's Karayolları Trafik Yönetmeliği m.88(b) gives a foreign
   * national six months FROM THE DATE OF ENTRY during which they may keep driving on
   * the foreign licence, at the end of which exchange becomes COMPULSORY. Nothing
   * lapses; an obligation begins.
   *
   * Six under one reading means "hurry or you lose it", under the other "you have
   * time before you must". One `exchange_window_months` carrying both — which is what
   * the research files hand over — is a field whose value cannot be read without
   * reading its prose, so it is not carried into the model at all. Two names that
   * cannot be confused for each other is the whole point.
   */
  foreign_licence_grace_months?: number | null;
  entries: LicenceExchangeEntry[];
}

/**
 * How a destination's exchange list is legally constituted.
 *
 * This distinction is the point of the agreement layer, and the data flattened it
 * before: Spain's list is titled "Paises con convenio de canjes" — countries with a
 * negotiated exchange agreement — while Germany's Anlage 11 FeV is a domestic annex
 * Germany maintains alone. Both rendered as an identical list of countries, which
 * hides the thing that matters. A treaty binds a counterparty; an annex can be
 * amended by one ministry on a Tuesday.
 *
 * `unknown` is a first-class value and must stay visible. Typing an arrangement from
 * the title of the page that publishes it is a hypothesis, not a reading.
 */
export type LicenceAgreementKind =
  | 'multilateral_instrument'
  | 'bilateral_agreement'
  | 'unilateral_recognition'
  | 'unknown';

export interface LicenceAgreement {
  id: string;
  name: string;
  kind: LicenceAgreementKind;
  directionality: 'symmetric' | 'asymmetric' | 'unknown';
  instrument: string;
  source_url: string;
  /** States that grant the exchange. */
  destinations: string[];
  /** States whose licences the arrangement covers. */
  beneficiaries: string[];
  /** Why the kind was assigned, quoting the authority where possible. */
  basis?: string;
  /**
   * False means the KIND is unconfirmed against the instrument, NOT that the
   * arrangement is doubtful. Mirrors BLOC_RIGHTS.verified in the canonical corpus.
   */
  kind_verified?: boolean;
  /**
   * What the instrument actually confers. Recognition (you may drive on the licence
   * you hold) and exchange (you may swap it for a domestic one) are different
   * rights, and Directive 2006/126/EC puts them in different articles — 2(1) and 11
   * respectively. Conflating them would overstate every EU row.
   *
   * `not_established` is a first-class value, for the same reason `kind: 'unknown'`
   * is. Six of the destinations researched for #210 came back `cannot_determine` —
   * the authority's list could not be read at all (Saudi's moi.gov.sa times out,
   * Belgium's mobilit.belgium.be serves a bot challenge) — and the shape had no way
   * to say so: the row had to pick one of the three affirmative values and then
   * contradict it in prose. A destination that asserts nothing must say nothing.
   */
  grants?: 'recognition' | 'exchange' | 'recognition_and_exchange' | 'not_established';
  /** The provision governing exchange, where it differs from the recognition one. */
  exchange_article?: string;
  /** The residence test, which gates almost every exchange in practice. */
  residence_condition?: string;
  /**
   * The rule that stops a third-country licence being laundered into bloc-wide
   * validity by swapping it in one member state. Under art. 11(6) the exchange is
   * recorded on the new licence, the original is surrendered, and a later member
   * state "need not apply the principle of mutual recognition". Without this the
   * atlas would imply an arbitrage the Directive explicitly forecloses.
   */
  third_country_carve_out?: string;
  /** The one-licence rule and how it is enforced between member states. */
  exclusivity?: string;
  /**
   * Who is and is not a party, where that is counterintuitive. The Nordic 1985
   * agreement excludes Iceland even though Iceland is in the Nordic Passport Union
   * and the common labour market — a member list assembled for movement is wrong
   * for licences.
   */
  membership_note?: string;
  /** ISO date from which a successor instrument replaces this one. */
  superseded_from?: string;
  superseded_note?: string;
}

export interface LicenceExchangeDisclaimer {
  normal_residence: string;
  scope: string;
  coverage: string;
  /**
   * What holding a licence actually tells you. The one-licence rule, residence-gated
   * issuance and surrender-on-exchange together make a licence a residence artefact
   * rather than something to accumulate — which is why it is widely accepted as proof
   * of address. Framed as the layer's purpose, not as a caveat.
   */
  what_a_licence_evidences?: string;
}

export interface LicenceExchangeData {
  schema_version: number;
  generated_at: string;
  disclaimer: LicenceExchangeDisclaimer;
  destinations: LicenceExchangeDestination[];
  agreements?: LicenceAgreement[];
}

export interface OriginOption {
  /** Stable key for grouping (iso or label). */
  key: string;
  label: string;
  iso_n3: string | null;
  /** True when any entry for this origin is sub-national. */
  varies_by_subnational: boolean;
  entry_count: number;
}

export interface ExchangeMatch {
  destination: LicenceExchangeDestination;
  entries: LicenceExchangeEntry[];
  /** True if every matched entry needs neither theory nor practical. */
  any_no_retest: boolean;
  any_theory: boolean;
  any_practical: boolean;
  varies_by_subnational: boolean;
  /**
   * The distinct nationality gates across the matched entries, null included, so the
   * UI can say "only if you are a national" instead of implying an open door. Never
   * collapsed to a single value: a match can hold both an `all` row and a
   * `nationals_only` one (Dubai lists the USA except Texas as `all` and Texas as
   * `nationals_only`), and picking one of the two would be wrong for half the readers.
   */
  nationality_gates: Array<NationalityGate | null>;
  /** True when at least one matched entry is gated on something other than `all`. */
  nationality_restricted: boolean;
}

/** The local-language label where the authority gives one, else the English name. */
export function originLabel(entry: LicenceExchangeEntry): string {
  return entry.origin_label ?? entry.origin_label_en;
}

/** Unique origins across all destinations, sorted by English label. */
export function listOrigins(data: LicenceExchangeData): OriginOption[] {
  const map = new Map<string, OriginOption>();
  for (const dest of data.destinations) {
    for (const e of dest.entries) {
      // originLabel(), not e.origin_label: the local-language label is present only
      // where it DIFFERS from the English one, so keying on it raw produced
      // "nat:undefined" for any ISO-less origin that has no local label — an option
      // in the picker that matched nothing. Kosovo (no M49 code, English label only)
      // is the row that surfaced it; entryMatchesKey has always compared against
      // originLabel(), so this makes the two ends agree.
      const key = e.subnational
        ? `sub:${e.parent_iso_n3 ?? 'x'}:${e.subnational_label ?? originLabel(e)}`
        : `nat:${e.origin_iso_n3 ?? originLabel(e)}`;
      // Group subnational under parent for the picker when parent iso known.
      const pickerKey = e.subnational && e.parent_iso_n3
        ? `nat:${e.parent_iso_n3}`
        : key;
      const label = e.subnational && e.parent_iso_n3
        ? parentLabel(e.parent_iso_n3, e.origin_label_en)
        : e.origin_label_en;
      const existing = map.get(pickerKey);
      if (existing) {
        existing.entry_count += 1;
        if (e.subnational || e.varies_by_subnational) existing.varies_by_subnational = true;
      } else {
        map.set(pickerKey, {
          key: pickerKey,
          label,
          iso_n3: e.subnational ? e.parent_iso_n3 : e.origin_iso_n3,
          varies_by_subnational: Boolean(e.subnational || e.varies_by_subnational),
          entry_count: 1,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const PARENT_NAMES: Record<string, string> = {
  '840': 'United States',
  '124': 'Canada',
  '036': 'Australia',
};

function parentLabel(iso: string, fallback: string): string {
  return PARENT_NAMES[iso] ?? fallback;
}

/**
 * Matches for a picker key from listOrigins.
 * National keys: all non-subnational entries with that iso/label, plus all
 * subnational rows under that parent when the origin is US/CA/AU.
 */
export function matchesForOrigin(data: LicenceExchangeData, originKey: string): ExchangeMatch[] {
  const matches: ExchangeMatch[] = [];
  for (const dest of data.destinations) {
    const entries = dest.entries.filter(e => entryMatchesKey(e, originKey));
    if (entries.length === 0) continue;
    matches.push({
      destination: dest,
      entries,
      any_no_retest: entries.some(e => e.no_retest),
      any_theory: entries.some(e => e.theory_test_required === true),
      any_practical: entries.some(e => e.practical_test_required === true),
      varies_by_subnational: entries.some(e => e.subnational || e.varies_by_subnational),
      nationality_gates: nationalityGates(entries),
      nationality_restricted: entries.some(e => (e.nationality_gate ?? null) !== null
        && e.nationality_gate !== 'all'),
    });
  }
  return matches;
}

/** Country-page summary: destination annex and/or origin listings. */
export interface CountryLicenceSummary {
  iso_n3: string;
  as_destination: {
    name: string;
    instrument: string;
    source_url: string;
    origin_count: number;
    no_retest_count: number;
  } | null;
  as_origin_destinations: Array<{
    iso_n3: string;
    name: string;
    no_retest: boolean;
    theory_test_required: boolean | null;
    practical_test_required: boolean | null;
    varies_by_subnational: boolean;
    source_url: string;
  }>;
}

export function summariseCountry(data: LicenceExchangeData, iso: string): CountryLicenceSummary {
  const asDest = data.destinations.find(d => d.iso_n3 === iso) ?? null;
  const as_origin_destinations: CountryLicenceSummary['as_origin_destinations'] = [];
  for (const dest of data.destinations) {
    const entries = dest.entries.filter(
      e => e.origin_iso_n3 === iso || e.parent_iso_n3 === iso,
    );
    if (!entries.length) continue;
    as_origin_destinations.push({
      iso_n3: dest.iso_n3,
      name: dest.name,
      no_retest: entries.some(e => e.no_retest),
      theory_test_required: entries.some(e => e.theory_test_required === true)
        ? true
        : entries.every(e => e.theory_test_required === false)
          ? false
          : null,
      practical_test_required: entries.some(e => e.practical_test_required === true)
        ? true
        : entries.every(e => e.practical_test_required === false)
          ? false
          : null,
      varies_by_subnational: entries.some(e => e.subnational || e.varies_by_subnational),
      source_url: dest.source_url,
    });
  }
  as_origin_destinations.sort((a, b) => a.name.localeCompare(b.name));
  return {
    iso_n3: iso,
    as_destination: asDest
      ? {
          name: asDest.name,
          instrument: asDest.instrument,
          source_url: asDest.source_url,
          origin_count: asDest.entries.length,
          no_retest_count: asDest.entries.filter(e => e.no_retest).length,
        }
      : null,
    as_origin_destinations,
  };
}

export function countryHasLicenceData(summary: CountryLicenceSummary): boolean {
  return Boolean(summary.as_destination || summary.as_origin_destinations.length);
}

function entryMatchesKey(e: LicenceExchangeEntry, originKey: string): boolean {
  if (originKey.startsWith('nat:')) {
    const id = originKey.slice(4);
    if (e.subnational) return e.parent_iso_n3 === id;
    return e.origin_iso_n3 === id || originLabel(e) === id || e.origin_label_en === id;
  }
  if (originKey.startsWith('sub:')) {
    const parts = originKey.split(':');
    const parent = parts[1];
    const sub = parts.slice(2).join(':');
    return e.subnational && (e.parent_iso_n3 === parent || parent === 'x')
      && (e.subnational_label === sub || originLabel(e) === sub);
  }
  return false;
}

/** Distinct gates over a set of entries, null preserved, in first-seen order. */
export function nationalityGates(
  entries: LicenceExchangeEntry[],
): Array<NationalityGate | null> {
  const seen: Array<NationalityGate | null> = [];
  for (const entry of entries) {
    const gate = entry.nationality_gate ?? null;
    if (!seen.includes(gate)) seen.push(gate);
  }
  return seen;
}

/**
 * Human label for a nationality gate.
 *
 * null is the load-bearing case. It renders as an explicit "not recorded", NEVER as
 * "open to all" or as an empty string that a reader completes optimistically — a user
 * told a swap is available who is then refused at the counter for holding the wrong
 * passport is the worst outcome this layer can produce.
 */
export function nationalityGateLabel(gate: NationalityGate | null | undefined): string {
  switch (gate ?? null) {
    case 'all': return 'Any nationality';
    case 'nationals_only': return 'Nationals of the issuing country only';
    case 'gcc': return 'Nationals of the listed exception countries (GCC)';
    default: return 'Nationality rule not recorded';
  }
}

/** Human label for what an instrument confers; `not_established` says so. */
export function agreementGrantsLabel(
  grants: LicenceAgreement['grants'] | null | undefined,
): string {
  switch (grants ?? null) {
    case 'recognition': return 'Recognition only';
    case 'exchange': return 'Exchange';
    case 'recognition_and_exchange': return 'Recognition and exchange';
    case 'not_established': return 'Not established';
    default: return 'Not recorded';
  }
}

export interface ResolvedExchangeWindow {
  /** Deadline to claim the exchange before the right lapses. */
  deadline_months: number | null;
  /** Grace period on the foreign licence before exchange becomes compulsory. */
  grace_months: number | null;
}

/**
 * The two windows for one row, entry value winning over destination value.
 *
 * Returned as two separately named numbers rather than one number plus a direction,
 * so that no caller can render the wrong sentence by forgetting to read a second
 * field.
 */
export function resolveExchangeWindow(
  destination: Pick<LicenceExchangeDestination, 'exchange_deadline_months' | 'foreign_licence_grace_months'>,
  entry?: Pick<LicenceExchangeEntry, 'exchange_deadline_months' | 'foreign_licence_grace_months'>,
): ResolvedExchangeWindow {
  return {
    deadline_months: entry?.exchange_deadline_months ?? destination.exchange_deadline_months ?? null,
    grace_months: entry?.foreign_licence_grace_months ?? destination.foreign_licence_grace_months ?? null,
  };
}

/** Sentences for a resolved window. Empty when nothing is recorded — never a guess. */
export function exchangeWindowLabels(window: ResolvedExchangeWindow): string[] {
  const out: string[] = [];
  if (window.deadline_months !== null) {
    out.push(`Apply within ${months(window.deadline_months)} of taking up residence, or the exchange right lapses.`);
  }
  if (window.grace_months !== null) {
    out.push(`You may drive on the foreign licence for ${months(window.grace_months)} after arrival; after that the exchange is compulsory.`);
  }
  return out;
}

function months(value: number): string {
  return value === 1 ? '1 month' : `${value} months`;
}

export function testLabel(theory: boolean | null, practical: boolean | null): string {
  if (theory === false && practical === false) return 'No tests required';
  if (theory === true && practical === false) return 'Theory test required';
  if (theory === false && practical === true) return 'Practical test required';
  if (theory === true && practical === true) return 'Theory + practical required';
  return 'Confirm test requirements';
}


/**
 * ISO codes an agreement covers, for painting the world map.
 *
 * Deliberately mirrors `isosForRouteClass` in src/lib/route-classes.ts so the atlas
 * needs no new map machinery: a declarative list, a derivation to an ISO set, and the
 * existing paint path.
 *
 * `destinations` and `beneficiaries` are returned separately because the direction is
 * the interesting part. Under a symmetric instrument they are two ends of one right;
 * under a unilateral annex the destination grants and the beneficiaries receive, and
 * showing them in one undifferentiated blob would imply a reciprocity that does not
 * exist.
 */
export interface LicenceAgreementIsos {
  all: Set<string>;
  destinations: Set<string>;
  beneficiaries: Set<string>;
}

export function isosForAgreement(agreement: LicenceAgreement): LicenceAgreementIsos {
  const destinations = new Set(agreement.destinations);
  const beneficiaries = new Set(agreement.beneficiaries);
  return { all: new Set([...destinations, ...beneficiaries]), destinations, beneficiaries };
}

/**
 * Agreements, widest first, so the map facet leads with the ones that matter.
 *
 * Takes anything carrying agreements — the corpus at build time, the served index in
 * the browser — because the map facet is the one part of this layer that reads the
 * whole world at once and must work from the small file.
 */
export function listAgreements(data: { agreements?: LicenceAgreement[] }): LicenceAgreement[] {
  return [...(data.agreements ?? [])].sort(
    (a, b) => b.beneficiaries.length - a.beneficiaries.length || a.name.localeCompare(b.name),
  );
}

export function agreementById(
  data: { agreements?: LicenceAgreement[] },
  id: string | null | undefined,
): LicenceAgreement | null {
  if (!id) return null;
  return (data.agreements ?? []).find(agreement => agreement.id === id) ?? null;
}

/** Human label for a kind. `unknown` says so rather than guessing a friendlier word. */
export function agreementKindLabel(kind: LicenceAgreementKind): string {
  switch (kind) {
    case 'multilateral_instrument': return 'Multilateral instrument';
    case 'bilateral_agreement': return 'Bilateral agreement';
    case 'unilateral_recognition': return 'Unilateral recognition';
    default: return 'Basis not established';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Index + slices: how the layer is SERVED (#210)
//
// The corpus is a build input; what ships is one small index and one slice per
// origin. The reason is the shape of the question, not only the byte cap: the page
// answers "I hold a Colombian licence, where can I swap it", and shipping 45
// destinations of annex to answer it made the browser download every other
// country's list to read one. Identical reasoning to atlas-index.json plus
// /country/<slug>/data.json, and deliberately the same field names, so a reader
// moving between corpus, index and slice needs no second mental model.
// ─────────────────────────────────────────────────────────────────────────────

/** A destination without its entries: what the index and the slice headers carry. */
export interface LicenceDestinationSummary {
  iso_n3: string;
  name: string;
  instrument: string;
  source_url: string;
  source_urls?: string[];
  agreement_id?: string;
  exchange_deadline_months?: number | null;
  foreign_licence_grace_months?: number | null;
  entry_count: number;
  no_retest_count: number;
}

export interface LicenceOriginIndexEntry extends OriginOption {
  /** How many destination lists this origin appears on. */
  destination_count: number;
  /** Path of the slice that answers this origin, relative to the site root. */
  slice: string;
}

export interface LicenceExchangeIndex {
  schema_version: number;
  generated_at: string;
  shape: 'licence-exchange-index';
  detail: string;
  disclaimer: LicenceExchangeDisclaimer;
  agreements: LicenceAgreement[];
  destinations: LicenceDestinationSummary[];
  origins: LicenceOriginIndexEntry[];
}

export interface LicenceOriginMatch {
  /** The destination's own notes travel with the slice: they are the caveats. */
  destination: LicenceDestinationSummary & { notes?: string[] };
  entries: LicenceExchangeEntry[];
  any_no_retest: boolean;
  any_theory: boolean;
  any_practical: boolean;
  varies_by_subnational: boolean;
  nationality_gates: Array<NationalityGate | null>;
  nationality_restricted: boolean;
}

export interface LicenceOriginSlice {
  shape: 'licence-origin-slice';
  index: string;
  origin: OriginOption;
  matches: LicenceOriginMatch[];
}

/** URL-safe file stem for an origin key (`nat:840` → `nat-840`). */
export function originSliceSlug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function originSlicePath(key: string): string {
  return `/licence-exchange/${originSliceSlug(key)}.json`;
}

function summariseDestination(dest: LicenceExchangeDestination): LicenceDestinationSummary {
  return {
    iso_n3: dest.iso_n3,
    name: dest.name,
    instrument: dest.instrument,
    source_url: dest.source_url,
    ...(dest.source_urls ? { source_urls: dest.source_urls } : {}),
    ...(dest.agreement_id ? { agreement_id: dest.agreement_id } : {}),
    ...(dest.exchange_deadline_months != null
      ? { exchange_deadline_months: dest.exchange_deadline_months } : {}),
    ...(dest.foreign_licence_grace_months != null
      ? { foreign_licence_grace_months: dest.foreign_licence_grace_months } : {}),
    entry_count: dest.entries.length,
    no_retest_count: dest.entries.filter(e => e.no_retest).length,
  };
}

/**
 * The served index.
 *
 * Carries the agreements in full because the atlas map facet paints from them on
 * first load, and they are bounded by the number of instruments (tens), not by the
 * number of rows (hundreds). Destination `notes` are NOT here: they are per-list
 * caveats, sometimes several KB, and they belong beside the rows they qualify — so
 * they travel on the slices instead, where a reader who has actually asked about a
 * destination will see them.
 */
export function buildLicenceIndex(data: LicenceExchangeData): LicenceExchangeIndex {
  const destinationsByOrigin = new Map<string, number>();
  const origins = listOrigins(data);
  for (const origin of origins) {
    destinationsByOrigin.set(
      origin.key,
      data.destinations.filter(d => d.entries.some(e => entryMatchesKey(e, origin.key))).length,
    );
  }
  return {
    schema_version: data.schema_version,
    generated_at: data.generated_at,
    shape: 'licence-exchange-index',
    detail: 'Per-origin detail: /licence-exchange/<origin>.json (see origins[].slice)',
    disclaimer: data.disclaimer,
    agreements: [...(data.agreements ?? [])],
    destinations: data.destinations.map(summariseDestination),
    origins: origins.map(origin => ({
      ...origin,
      destination_count: destinationsByOrigin.get(origin.key) ?? 0,
      slice: originSlicePath(origin.key),
    })),
  };
}

/** One origin's answer: every destination that lists it, with only its own rows. */
export function buildOriginSlice(
  data: LicenceExchangeData,
  origin: OriginOption,
  indexPath = '/licence_exchange.json',
): LicenceOriginSlice {
  return {
    shape: 'licence-origin-slice',
    index: indexPath,
    origin,
    matches: matchesForOrigin(data, origin.key).map(match => ({
      destination: {
        ...summariseDestination(match.destination),
        ...(match.destination.notes ? { notes: match.destination.notes } : {}),
      },
      entries: match.entries,
      any_no_retest: match.any_no_retest,
      any_theory: match.any_theory,
      any_practical: match.any_practical,
      varies_by_subnational: match.varies_by_subnational,
      nationality_gates: match.nationality_gates,
      nationality_restricted: match.nationality_restricted,
    })),
  };
}

/**
 * Every slice, keyed by served path. Throws on a slug collision rather than letting
 * one origin silently overwrite another's answer.
 */
export function buildOriginSlices(data: LicenceExchangeData): Map<string, LicenceOriginSlice> {
  const out = new Map<string, LicenceOriginSlice>();
  for (const origin of listOrigins(data)) {
    const path = originSlicePath(origin.key);
    const clash = out.get(path);
    if (clash) {
      throw new Error(
        `licence origin slug collision at ${path}: "${clash.origin.key}" and "${origin.key}"`,
      );
    }
    out.set(path, buildOriginSlice(data, origin));
  }
  return out;
}

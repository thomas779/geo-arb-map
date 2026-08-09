/**
 * Driving-licence exchange layer (#171).
 *
 * Seed data lives in public/licence_exchange.json (Germany Anlage 11 FeV first).
 * This module is pure helpers so UI and tests share the same lookup logic.
 */

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
   */
  grants?: 'recognition' | 'exchange' | 'recognition_and_exchange';
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
      const key = e.subnational
        ? `sub:${e.parent_iso_n3 ?? 'x'}:${e.subnational_label ?? originLabel(e)}`
        : `nat:${e.origin_iso_n3 ?? e.origin_label}`;
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

export function testLabel(theory: boolean | null, practical: boolean | null): string {
  if (theory === false && practical === false) return 'No retest';
  if (theory === true && practical === false) return 'Theory only';
  if (theory === false && practical === true) return 'Practical only';
  if (theory === true && practical === true) return 'Theory + practical';
  return 'Tests unknown';
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

/** Agreements, widest first, so the map facet leads with the ones that matter. */
export function listAgreements(data: LicenceExchangeData): LicenceAgreement[] {
  return [...(data.agreements ?? [])].sort(
    (a, b) => b.beneficiaries.length - a.beneficiaries.length || a.name.localeCompare(b.name),
  );
}

export function agreementById(
  data: LicenceExchangeData,
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

import type { CountryLicenceSummary } from '@/lib/licence-exchange';

export interface Member {
  name: string;
  iso_n3: string;
}

export interface BlocRights {
  TR: string;
  PR: string;
  CIT: string;
}

export interface SubBloc {
  name: string;
  members_iso: string[];
}

export interface ExcludedArrangement {
  name: string;
  reason: string;
}

export interface Bloc {
  id: string;
  name: string;
  category: 'full' | 'partial' | 'hub_spoke' | 'one_way' | 'closed' | 'proto';
  strength: number;
  color: string;
  members: Member[];
  former_members?: Member[];
  /**
   * Whether the arrangement's rights run both ways.
   *
   * Absent on the legacy remainder, which is most of them: only 3 of 46
   * arrangements are canonical. Absent means UNKNOWN, not symmetric. Anything
   * counting settle-by-right peers must refuse to credit an arrangement whose
   * direction it cannot establish, or it inflates the UK on BN(O) and the
   * Overseas Territories, and the US on the Compact of Free Association.
   */
  directionality?: 'symmetric' | 'asymmetric';
  /** Where an asymmetric right runs TO. Empty/absent on symmetric arrangements. */
  destinations?: Member[];
  /** Who an asymmetric right runs FROM. Empty/absent on symmetric arrangements. */
  beneficiaries?: Member[];
  rights: BlocRights;
  fastest_entry: string;
  notes: string;
  sub_bloc?: SubBloc;
}

export interface BilateralLane {
  id: string;
  name: string;
  color: string;
  destination: Member;
  beneficiaries: Member[];
  beneficiaries_note?: string;
  grants: string;
  limits: string;
  leads_to_settlement: boolean;
  /** How access is allocated. Absent = 'right' (entitlement if criteria met). */
  allocation?: 'right' | 'ballot' | 'quota_queue' | 'discretionary';
  /** True when naturalizing at the destination requires renouncing prior citizenship. */
  renounces_previous?: boolean;
  confidence?: string;
  volatility?: string;
  sources?: string[];
}

export interface DualCitizenshipTreaty {
  id: string;
  name: string;
  parties: Member[];
  effect: string;
  status: string;
  confidence?: string;
  sources?: string[];
  last_checked?: string;
}

export interface PendingArrangement {
  id: string;
  name: string;
  proposed_shape: string;
  confidence: string;
  reason: string;
  volatility?: string;
  sources?: string[];
  record?: unknown;
}

export interface StackingPlay {
  passport: string;
  timeline: string;
  blocs: string[];
  footprint: string;
}

export interface BlocsData {
  meta: {
    title: string;
    last_verified: string;
    disclaimer: string;
    tier_legend: Record<string, string>;
    excluded?: ExcludedArrangement[];
  };
  blocs: Bloc[];
  bilateral_lanes: BilateralLane[];
  stacking_plays: StackingPlay[];
  /** Audited child-birth accelerators (from data/manual_edges.json) */
  generational_events?: Array<{
    id: string;
    country: Member;
    child: string;
    parent: string;
    sources?: string[];
  }>;
  /** Researched but below confidence bar - stored, never rendered. */
  pending_verification?: PendingArrangement[];
  /**
   * Conflict-of-laws treaties only. The per-country `countries` map that used to
   * sit here was a rival model of the same fact the canonical corpus records on
   * `jurisdictions[].dual_nationality`, on its own enum (`banned` where canonical
   * says `prohibited`), and it was the copy the product actually read. #144
   * retired it: every row was migrated to the canonical field and the product
   * repointed there, so there is one vocabulary for one fact.
   */
  dual_citizenship?: {
    treaty_exceptions: DualCitizenshipTreaty[];
  };
}

export type CitizenshipAcquisitionMode = 'ancestry' | 'naturalization' | 'birth' | 'investment';
export type CitizenshipRouteStatus = 'active' | 'inactive' | 'verified_negative' | 'pending_verification';
export type CitizenshipCoverageState = 'reviewed' | 'partial' | 'pending' | 'unchecked';

export interface CitizenshipRouteSource {
  title: string;
  url: string;
}

export interface CitizenshipRoutePathway {
  id: string;
  label: string;
  allocation: 'right' | 'discretionary' | 'ballot' | 'quota_queue';
  eligibility_months: number | null;
  note?: string;
}

export interface NationalityEligibility {
  kind: 'open' | 'treaty_list' | 'exclusions';
  included_iso_n3: string[];
  excluded_iso_n3: string[];
  detail: string;
}

export interface ParentResidenceRight {
  exists: boolean;
  wait_months: number | null;
  leads_to_citizenship: boolean;
  instrument: string;
}

export interface TransmissionAbroad {
  kind: 'unlimited' | 'registration_required' | 'first_generation_only' | 'unknown';
  detail: string;
}

/**
 * Which ancestral relations a descent route records as qualifying, re-encoded from
 * the eligibility field names that `pathways` drops. Positive-only: `relations`
 * lists what qualifies and never what fails, so `limit_recorded: false` means the
 * cutoff is unknown rather than absent. See `scripts/lib/descent-relations.ts`.
 */
export interface DescentRelations {
  relations: Array<'parent' | 'grandparent' | 'great_grandparent' | 'ancestor_unspecified'>;
  deepest_recorded_degree: number | null;
  maximum_degree: number | null;
  limit_recorded: boolean;
  /**
   * Qualifies on ethnic or national ORIGIN rather than descent from a citizen.
   * Not a degree, because it is not a generation: the Law of Return and
   * Spätaussiedler recognition ask what you are, not how many generations back a
   * citizen sits. See scripts/lib/descent-relations.ts.
   */
  origin_based?: boolean;
  /** Set when part of the finding was authored from prose rather than derived. */
  authored_basis?: string;
}

/**
 * How far back a descent route reaches, as one bucket — the axis the ancestry
 * facet selects on (#191). A flat "has an ancestry route" filter highlighted 232
 * of 240 jurisdictions, because every country transmits to the child of a citizen.
 *
 * `not_recorded` is first-class and must never be shown as `parent_only`: most
 * routes sit at degree 1 because nobody authored a deeper limb, not because one
 * was checked for and ruled out.
 *
 * The union is duplicated from `DESCENT_REACH` in scripts/lib/descent-relations.ts,
 * which is the source of truth — src never imports from scripts. The two are pinned
 * together by a test in tests/descent_relations.test.ts.
 */
export type DescentReach =
  | 'origin_based'
  | 'unlimited'
  | 'grandparent_or_deeper'
  | 'parent_only'
  | 'not_recorded';

/**
 * Browser-side projection of the canonical `dual_nationality` field. Mirrors
 * DualNationalitySchema in scripts/lib/canonical-schema.ts minus `source_refs`.
 *
 * `status` is the lossy headline; the limbs are what a consumer should read.
 * A jurisdiction with no row at all renders nothing — absence is NOT RECORDED,
 * never "no restriction".
 */
export type PluralityRetentionEffect =
  | 'permitted'
  | 'non_recognition'
  | 'automatic_loss'
  | 'discretionary_loss'
  | 'permission_required'
  | 'designated_list'
  | 'non_exercise'
  | 'unknown';

export type PluralityAcquisitionEffect =
  | 'no_renunciation'
  | 'renunciation_required'
  | 'renunciation_with_exceptions'
  | 'unknown';

export interface JurisdictionDualNationality {
  status: 'allowed' | 'conditional' | 'prohibited' | 'unknown';
  /** `legacy_import` rows carry a headline and prose only; every limb is unknown. */
  provenance: 'instrument' | 'legacy_import';
  retention: {
    by_birth: { effect: PluralityRetentionEffect; conditions: string[]; detail: string };
    by_naturalisation: { effect: PluralityRetentionEffect; conditions: string[]; detail: string };
  };
  acquisition: { effect: PluralityAcquisitionEffect; conditions: string[]; detail: string };
  asymmetry: { present: 'yes' | 'no' | 'unknown'; basis: string[]; note: string };
  detail: string;
}

export interface CitizenshipRoute extends CitizenshipRouteSummary {
  summary: string;
  facts: Record<string, unknown>;
  /** Explicit nationality limits for direct CBI; absent = not recorded. */
  nationality_eligibility?: NationalityEligibility | null;
  /** Residence consequences for a parent of a child born in-country. */
  parent_residence_right?: ParentResidenceRight | null;
  /** How citizenship is transmitted to children born abroad. */
  transmission_abroad?: TransmissionAbroad | null;
  /**
   * What the conditional jus soli label actually means, re-encoded from the
   * recorded condition and summary. Birth routes only. `openness: null` means
   * deliberately unscoreable (defers to a metropole, or unreviewed), never zero.
   */
  jus_soli_condition?: {
    family: string;
    openness: number | null;
    basis: string;
    defers_to?: string;
  } | null;
  /** Ancestral relations recorded as qualifying. Ancestry routes only. */
  descent?: DescentRelations | null;
  pathways?: CitizenshipRoutePathway[];
  confidence: 'high' | 'medium' | 'low';
  /**
   * The weakest of `confidence` and every claim below. Equals `confidence` when a
   * route carries no claims. Consumers ranking or scoring should read THIS, since
   * the badge alone can be high while a press-reported detail rides along.
   */
  effective_confidence?: 'high' | 'medium' | 'low';
  /** Separately-evidenced assertions with their own confidence. */
  claims?: Array<{ id: string; statement: string; confidence: 'high' | 'medium' | 'low' }>;
  last_checked: string;
  sources: CitizenshipRouteSource[];
}

export type ResidenceCategory =
  | 'investment'
  | 'digital_nomad'
  | 'digital_identity'
  | 'retirement_pension'
  | 'talent_skilled'
  | 'general_permanent_residence';

export interface ResidenceMoney {
  amount: number;
  currency: string;
}

export interface ResidenceRoute extends ResidenceRouteSummary {
  summary: string;
  min_investment: ResidenceMoney | null;
  min_income_monthly: ResidenceMoney | null;
  physical_presence_days_per_year: number | null;
  /** Local work access read from the instrument; null = not recorded (never inferred). */
  work_rights?: 'full' | 'employer_sponsored' | 'self_employment' | 'remote_only' | 'none' | null;
  /** One grant's validity in months; null = not recorded. */
  permit_duration_months?: number | null;
  /** Renewability as stated in the instrument; null = not stated (never false from silence). */
  permit_renewable?: boolean | null;
  /**
   * Applicant age gates read from the instrument. null = NOT RECORDED, which is
   * NOT the same as unrestricted: eligibility logic must refuse to confirm rather
   * than assume. Coverage is deliberately sparse until the verification sweep
   * fills it (see issue #136).
   */
  min_age?: number | null;
  max_age?: number | null;
  /** Permit eligibility by nationality; absent = not recorded. */
  nationality_eligibility?: NationalityEligibility | null;
  facts: Record<string, unknown>;
  pathways?: CitizenshipRoutePathway[];
  confidence: 'high' | 'medium' | 'low';
  last_checked: string;
  sources: CitizenshipRouteSource[];
}

/**
 * What the atlas itself needs from a route: enough to paint the map, filter by
 * class, list a country and label a panel row. The prose bodies (summary,
 * sources, facts, pathways) are NOT here, because the browser loads
 * atlas-index.json (27KB gzipped) rather than the full corpus (178KB), and
 * those bodies are served per country from /country/<slug>/data.json.
 *
 * `CitizenshipRoute` extends this, so anything typed on the summary accepts the
 * full corpus too: build-time code (country pages, comparison tables) keeps
 * using the richer type without a second code path.
 */
export interface CitizenshipRouteSummary {
  id: string;
  country: Member;
  mode: CitizenshipAcquisitionMode;
  status: CitizenshipRouteStatus;
  title: string;
  /**
   * How far the route reaches, for the ancestry facet. Ancestry routes only; null
   * or absent on every other mode. It rides in the index because the degree itself
   * only ever existed in `eligibility`, which the build drops before publication —
   * without this projection the browser cannot tell Ireland from Italy.
   */
  descent_reach?: DescentReach | null;
  confidence: 'high' | 'medium' | 'low';
  last_checked: string;
}

export interface ResidenceRouteSummary {
  id: string;
  country: Member;
  category: ResidenceCategory;
  status: CitizenshipRouteStatus;
  title: string;
  outcome: 'residence' | 'permanent_residence';
  counts_toward_permanent_residence: boolean;
  counts_toward_naturalization: boolean;
  /** Local work access; the panel's ladder chips read it, so it rides in the index. */
  work_rights?: 'full' | 'employer_sponsored' | 'self_employment' | 'remote_only' | 'none' | null;
  confidence: 'high' | 'medium' | 'low';
  last_checked: string;
}

/** The shape served at /country/<slug>/data.json: one jurisdiction, full detail. */
export interface CountrySliceData {
  meta: { shape: string; release_id?: string; last_updated: string; canonical: string; index: string };
  jurisdiction: CitizenshipRoutesData['jurisdictions'][number] | null;
  routes: CitizenshipRoute[];
  residence_routes: ResidenceRoute[];
  /**
   * Precomputed driving-licence summary, null when this country appears in no
   * exchange list. It rides on the slice because the corpus stopped being served
   * (#210) — the panel must not have to fetch 45 destinations of annex to draw one
   * card. Optional so a cached older slice still parses.
   */
  licence?: CountryLicenceSummary | null;
}

/** The shape served at /atlas-index.json: a strict projection of the corpus. */
export interface AtlasIndexData {
  meta: CitizenshipRoutesData['meta'];
  jurisdictions: Array<{
    iso_n3: string;
    name: string;
    coverage: Record<CitizenshipAcquisitionMode, CitizenshipCoverageState>;
  }>;
  routes: CitizenshipRouteSummary[];
  residence_routes?: ResidenceRouteSummary[];
}

export interface CitizenshipRoutesData {
  meta: {
    description: string;
    last_updated: string;
    acquisition_modes: Record<CitizenshipAcquisitionMode, string>;
    coverage_states: Record<CitizenshipCoverageState, string>;
    counts: {
      jurisdictions: number;
      routes: number;
      by_mode: Record<CitizenshipAcquisitionMode, number>;
      by_status: Partial<Record<CitizenshipRouteStatus, number>>;
      residence_routes?: number;
    };
  };
  jurisdictions: Array<{
    iso_n3: string;
    name: string;
    type: 'sovereign' | 'territory' | 'special';
    coverage: Record<CitizenshipAcquisitionMode, CitizenshipCoverageState>;
    route_ids: string[];
    residence_coverage?: Partial<Record<ResidenceCategory, CitizenshipCoverageState>>;
    residence_route_ids?: string[];
    dual_nationality?: JurisdictionDualNationality | null;
    registry_note?: string;
  }>;
  routes: CitizenshipRoute[];
  residence_routes?: ResidenceRoute[];
}

export interface DataReleaseMeta {
  release_id: string;
  selection_mode: string;
  generated_at: string;
}

export interface AppState {
  view: 'map' | 'stacking' | 'countries' | 'rights';
  /** Multi-select compare: countries in 2+ selected blocs render blended. */
  blocs: string[];
  lane: string | null;
  /** Route-class browse (#129): paints jurisdictions with an active route of the class. */
  routeClass: string | null;
  /**
   * Selected driving-licence exchange arrangement (#171). Paints its member set on
   * the map the way a bloc or route class does, keeping destinations and
   * beneficiaries visually distinct so a unilateral annex never reads as a treaty.
   */
  licenceAgreement: string | null;
  country: string | null;
  countryName: string | null;
}

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

export interface DualCitizenshipPolicy {
  status: 'allowed' | 'banned' | 'conditional';
  volatility?: string;
  note?: string;
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
  dual_citizenship?: {
    /** Keyed by iso_n3. Countries absent from the map are unverified, not 'allowed'. */
    countries: Record<string, DualCitizenshipPolicy>;
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

export interface CitizenshipRoute {
  id: string;
  country: Member;
  mode: CitizenshipAcquisitionMode;
  status: CitizenshipRouteStatus;
  title: string;
  summary: string;
  facts: Record<string, unknown>;
  pathways?: CitizenshipRoutePathway[];
  confidence: 'high' | 'medium' | 'low';
  last_checked: string;
  sources: CitizenshipRouteSource[];
}

export type ResidenceCategory =
  | 'investment'
  | 'digital_nomad'
  | 'retirement_pension'
  | 'talent_skilled'
  | 'general_permanent_residence';

export interface ResidenceMoney {
  amount: number;
  currency: string;
}

export interface ResidenceRoute {
  id: string;
  country: Member;
  category: ResidenceCategory;
  status: CitizenshipRouteStatus;
  title: string;
  summary: string;
  /** Best outcome across variants: permanent_residence if any variant reaches PR, else residence. */
  outcome: 'residence' | 'permanent_residence';
  counts_toward_permanent_residence: boolean;
  counts_toward_naturalization: boolean;
  min_investment: ResidenceMoney | null;
  min_income_monthly: ResidenceMoney | null;
  physical_presence_days_per_year: number | null;
  facts: Record<string, unknown>;
  pathways?: CitizenshipRoutePathway[];
  confidence: 'high' | 'medium' | 'low';
  last_checked: string;
  sources: CitizenshipRouteSource[];
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
  view: 'map' | 'stacking' | 'countries' | 'rights' | 'route';
  /** Multi-select compare: countries in 2+ selected blocs render blended. */
  blocs: string[];
  lane: string | null;
  country: string | null;
  countryName: string | null;
}

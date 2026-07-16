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
  /** Researched but below confidence bar - stored, never rendered. */
  pending_verification?: PendingArrangement[];
  dual_citizenship?: {
    /** Keyed by iso_n3. Countries absent from the map are unverified, not 'allowed'. */
    countries: Record<string, DualCitizenshipPolicy>;
    treaty_exceptions: DualCitizenshipTreaty[];
  };
}

export interface AppState {
  view: 'map' | 'stacking';
  bloc: string | null;
  lane: string | null;
  country: string | null;
  countryName: string | null;
}

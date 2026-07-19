import type { BilateralLane, Bloc, BlocsData } from '../types';
import {
  CBI_YEARS,
  DESCENT_YEARS,
  naturalizationRule,
  naturalizationYears,
  timelineBeneficiaryIsos,
} from './timeline-rules';

export { CBI_YEARS, DESCENT_YEARS } from './timeline-rules';

/**
 * "My Flags" planner engine.
 *
 * Honors the locked explorer-spec rules (docs/explorer-spec.md):
 *  - proto blocs never count toward footprints
 *  - one-way/asymmetric blocs are listed but excluded from country counts
 *  - work-only lanes are shown separately and never counted
 *  - ballot / quota / discretionary lanes are chance-based, not plans
 *  - identity (ancestry) lanes can't be recommended by nationality
 *  - acquiring a citizenship that bans dual shows the NET footprint after
 *    losing everything derived from the renounced flags
 */

/** Mirrors the dataset's own ladder; 'diaspora' = OCI/F-4-style quasi-status. */
export type FlagStatus = 'tr' | 'pr' | 'cit' | 'diaspora';

export interface PlantedFlag {
  iso_n3: string;
  name: string;
  status: FlagStatus;
}

export type GoalIntent = 'live' | 'work' | 'cit';

export interface Goal {
  iso_n3: string;
  intent: GoalIntent;
}

export type AlertChannel = 'none' | 'telegram';

export interface AlertPreferences {
  /** Delivery choice only; a real connection is established by the future alert service. */
  channel: AlertChannel;
  /** Legal-rule notifications are never sent before editorial verification. */
  verifiedOnly: true;
}

export interface Profile {
  /** Local persistence schema. Shared profile URLs intentionally omit private settings. */
  version: 2;
  flags: PlantedFlag[];
  /** iso_n3 of country of birth — unlocks birth-based lanes (e.g. Falklands→Argentina) */
  birthplace: string | null;
  /** iso_n3 of parents'/grandparents' birthplaces — unlocks descent lanes */
  ancestors: string[];
  /** self-attested heritage claims, keyed by lane id (Law of Return, Spätaussiedler...) */
  heritages: string[];
  /** partner's citizenships — household footprint derives from either spouse */
  partnerCitizenships: string[];
  /** declared destinations: what you WANT, path-solved by the engine */
  goals: Goal[];
  /** Stable goal keys (`intent:iso_n3`) selected for future rule-change monitoring. */
  watchedRoutes: string[];
  /** Private delivery preference; no contact handle is stored in the browser profile. */
  alerts: AlertPreferences;
}

export const EMPTY_PROFILE: Profile = {
  version: 2,
  flags: [], birthplace: null, ancestors: [], heritages: [],
  partnerCitizenships: [], goals: [],
  watchedRoutes: [],
  alerts: { channel: 'none', verifiedOnly: true },
};

export function goalKey(goal: Goal): string {
  return `${goal.intent}:${goal.iso_n3}`;
}

/** Defensive localStorage/URL migration: older partial profiles become schema-v2 profiles. */
export function normalizeProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PROFILE, alerts: { ...EMPTY_PROFILE.alerts } };
  const value = raw as Partial<Profile>;
  const flags = Array.isArray(value.flags) ? value.flags : [];
  const goals = Array.isArray(value.goals) ? value.goals : [];
  const validGoalKeys = new Set(goals.map(goalKey));
  const watchedRoutes = Array.isArray(value.watchedRoutes)
    ? value.watchedRoutes.filter(key => typeof key === 'string' && validGoalKeys.has(key))
    : [];
  return {
    version: 2,
    flags,
    birthplace: typeof value.birthplace === 'string' ? value.birthplace : null,
    ancestors: Array.isArray(value.ancestors) ? value.ancestors : [],
    heritages: Array.isArray(value.heritages) ? value.heritages : [],
    partnerCitizenships: Array.isArray(value.partnerCitizenships) ? value.partnerCitizenships : [],
    goals,
    watchedRoutes: [...new Set(watchedRoutes)],
    alerts: {
      channel: value.alerts?.channel === 'telegram' ? 'telegram' : 'none',
      verifiedOnly: true,
    },
  };
}

export function profileHasInput(profile: Profile): boolean {
  return profile.flags.length > 0
    || profile.birthplace !== null
    || profile.ancestors.length > 0
    || profile.heritages.length > 0
    || profile.partnerCitizenships.length > 0
    || profile.goals.length > 0;
}

/** Heritage claims that aren't captured by an ancestor's birthplace. */
export const HERITAGE_OPTIONS: Array<{ laneId: string; label: string }> = [
  { laneId: 'israel_law_of_return', label: 'Jewish heritage (Law of Return)' },
  { laneId: 'germany_spaetaussiedler', label: 'Ethnic German (Spätaussiedler)' },
  { laneId: 'kazakhstan_qandas', label: 'Ethnic Kazakh (Qandas)' },
  { laneId: 'russia_compatriot', label: "Russian 'compatriot' (cultural/historical tie)" },
];

/** Lanes whose qualifying class is birthplace, not nationality. */
const BIRTHPLACE_LANES: Record<string, string> = {
  '238': 'falklands_argentina',
};

/** Birthplace-conditional notes we can't fully verify from a birthplace alone. */
const BIRTHPLACE_HINTS: Record<string, string> = {
  '344': 'Born in Hong Kong: BN(O) eligibility (UK 5+1 route) depends on pre-handover birth or a BN(O) parent — check the UK-Hong Kong card.',
  '032': 'Born in Argentina: jus soli — you are likely already an Argentine citizen; plant it as a flag.',
  '076': 'Born in Brazil: jus soli — you are likely already a Brazilian citizen; plant it as a flag.',
  '484': 'Born in Mexico: jus soli — you are likely already a Mexican citizen; plant it as a flag.',
};

export interface CountryOption {
  iso_n3: string;
  name: string;
}

export interface UnlockResult {
  /** full / partial / hub_spoke / closed blocs the user belongs to */
  blocs: Bloc[];
  /** one_way blocs — real but directional; listed, never counted */
  asymmetric: Bloc[];
  /** settlement-grade, right-allocated lanes available by nationality */
  lanes: BilateralLane[];
  /** work-only lanes (informational) */
  workLanes: BilateralLane[];
  /** chance-based lanes: ballot / quota_queue / discretionary */
  chanceLanes: BilateralLane[];
  /** descent/heritage lanes this profile plausibly qualifies for (paths, not current rights) */
  ancestryLanes: BilateralLane[];
  /** birthplace-derived notes (jus soli hints, BN(O) conditionality) */
  birthHints: string[];
  /** deduped jurisdictions reachable beyond the held citizenships */
  countries: Set<string>;
}

export interface Recommendation {
  iso_n3: string;
  name: string;
  marginal: number;
  years: number | null;
  /** marginal countries per year (uses a conservative default when years unknown) */
  score: number;
  newBlocs: string[];
  lostBlocs: string[];
  lostCitizenships: string[];
  renouncesPrevious: boolean;
  via: 'naturalization' | 'cbi' | 'ancestry' | 'heritage';
}

const DEFAULT_YEARS = 6; // conservative assumption when no duration is parseable

/** Every country selectable as a flag: any jurisdiction in blocs or lanes. */
export function countryOptions(data: BlocsData): CountryOption[] {
  const seen = new Map<string, string>();
  for (const b of data.blocs) {
    for (const m of [...b.members, ...(b.former_members ?? [])]) {
      if (!seen.has(m.iso_n3)) seen.set(m.iso_n3, m.name);
    }
  }
  for (const l of data.bilateral_lanes) {
    if (!seen.has(l.destination.iso_n3)) seen.set(l.destination.iso_n3, l.destination.name);
    for (const m of l.beneficiaries) {
      if (!seen.has(m.iso_n3)) seen.set(m.iso_n3, m.name);
    }
  }
  return [...seen.entries()]
    .map(([iso_n3, name]) => ({ iso_n3, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function computeUnlocks(profile: Profile, data: BlocsData): UnlockResult {
  const held = new Set(profile.flags.filter(f => f.status === 'cit').map(f => f.iso_n3));
  const blocs: Bloc[] = [];
  const asymmetric: Bloc[] = [];
  const lanes: BilateralLane[] = [];
  const workLanes: BilateralLane[] = [];
  const chanceLanes: BilateralLane[] = [];
  const ancestryLanes: BilateralLane[] = [];
  const birthHints: string[] = [];
  const countries = new Set<string>();

  for (const b of data.blocs) {
    if (b.category === 'proto') continue;
    if (!b.members.some(m => held.has(m.iso_n3))) continue;
    if (b.category === 'one_way') {
      asymmetric.push(b);
      continue;
    }
    blocs.push(b);
    for (const m of b.members) countries.add(m.iso_n3);
  }

  for (const l of data.bilateral_lanes) {
    const byNationality = l.beneficiaries.some(m => held.has(m.iso_n3));
    const byBirth = profile.birthplace !== null && BIRTHPLACE_LANES[profile.birthplace] === l.id;
    if (!byNationality && !byBirth) continue;
    const allocation = l.allocation ?? 'right';
    if (allocation !== 'right') {
      chanceLanes.push(l);
      continue;
    }
    if (!l.leads_to_settlement) {
      workLanes.push(l);
      continue;
    }
    lanes.push(l);
    countries.add(l.destination.iso_n3);
  }

  // Descent + heritage lanes: qualifying is personal, not nationality-based.
  // A lane already consumed doesn't count as a path: holding citizenship at
  // the destination, or holding the diaspora status itself (e.g. India OCI),
  // removes it from "paths you may qualify for".
  const consumed = new Set(
    profile.flags.filter(f => f.status === 'cit' || f.status === 'diaspora').map(f => f.iso_n3),
  );
  const identityLanes = data.bilateral_lanes.filter(l => l.beneficiaries.length === 0);
  const heritageIds = new Set(profile.heritages);
  const ancestorIsos = new Set(profile.ancestors);
  for (const l of identityLanes) {
    if (consumed.has(l.destination.iso_n3)) continue;
    if (heritageIds.has(l.id) || ancestorIsos.has(l.destination.iso_n3)) {
      ancestryLanes.push(l);
    }
  }

  if (profile.birthplace && BIRTHPLACE_HINTS[profile.birthplace]) {
    birthHints.push(BIRTHPLACE_HINTS[profile.birthplace]);
  }

  // PR / diaspora statuses: you can already live there — count the country,
  // even though it generates no bloc rights in this dataset.
  for (const f of profile.flags) {
    if (f.status === 'pr' || f.status === 'diaspora') countries.add(f.iso_n3);
  }

  for (const iso of held) countries.delete(iso);
  return { blocs, asymmetric, lanes, workLanes, chanceLanes, ancestryLanes, birthHints, countries };
}

/** Additional jurisdictions available through a partner, without double-counting either spouse's flags. */
export function householdExtraCountries(profile: Profile, data: BlocsData): number {
  if (!profile.partnerCitizenships.length) return 0;
  const partnerProfile: Profile = {
    ...profile,
    flags: profile.partnerCitizenships.map(iso => ({
      iso_n3: iso,
      name: iso,
      status: 'cit' as const,
    })),
    partnerCitizenships: [],
    goals: [],
  };
  const ours = new Set(computeUnlocks(profile, data).countries);
  profile.flags
    .filter(f => f.status === 'cit')
    .forEach(f => ours.add(f.iso_n3));

  const theirs = computeUnlocks(partnerProfile, data).countries;
  const householdAdditions = new Set(theirs);
  profile.partnerCitizenships.forEach(iso => householdAdditions.add(iso));

  let extra = 0;
  for (const iso of householdAdditions) {
    if (!ours.has(iso)) extra++;
  }
  return extra;
}

/**
 * Canonical ordinary naturalization durations. The `data` parameter remains
 * for API compatibility; arrangement prose is deliberately not inspected.
 */
export function acquisitionYears(_data: BlocsData): Map<string, number> {
  return naturalizationYears();
}

export function recommend(
  profile: Profile,
  data: BlocsData,
  limit = 5,
): Recommendation[] {
  const heldIsos = profile.flags.filter(f => f.status === 'cit').map(f => f.iso_n3);
  const current = computeUnlocks(profile, data);
  const currentSize = current.countries.size;
  const currentBlocIds = new Set(current.blocs.map(b => b.id));
  const held = new Set(heldIsos);
  const durations = acquisitionYears(data);
  const bans = data.dual_citizenship?.countries ?? {};
  const yearsForProfile = (iso: string): number | null => {
    const rule = naturalizationRule(iso);
    if (!rule) return durations.get(iso) ?? null;
    const conditional = rule.conditional?.find(condition =>
      timelineBeneficiaryIsos(data, condition).some(beneficiary => held.has(beneficiary)));
    return conditional
      ? conditional.minimum_months / 12
      : rule.ordinary_months / 12;
  };

  const withCitizenship = (iso: string): Profile => ({
    ...profile,
    flags: [...profile.flags, { iso_n3: iso, name: iso, status: 'cit' }],
  });
  const onlyCitizenship = (iso: string): Profile => ({
    ...profile,
    flags: [
      ...profile.flags.filter(f => f.status !== 'cit'),
      { iso_n3: iso, name: iso, status: 'cit' },
    ],
  });

  const evaluate = (
    iso: string, name: string,
    years: number | null,
    via: Recommendation['via'],
  ): Recommendation | null => {
    if (held.has(iso)) return null;
    const renounces = bans[iso]?.status === 'banned';
    // Renunciation destinations: net footprint per explorer-spec part B.
    const next = computeUnlocks(renounces ? onlyCitizenship(iso) : withCitizenship(iso), data);
    const nextCountries = new Set(next.countries);
    nextCountries.add(iso);
    for (const h of held) nextCountries.delete(h);
    const marginal = nextCountries.size - currentSize;
    if (marginal <= 0) return null;
    return {
      iso_n3: iso, name, marginal, years,
      score: marginal / Math.max(years ?? DEFAULT_YEARS, 0.75),
      newBlocs: next.blocs.filter(b => !currentBlocIds.has(b.id)).map(b => b.name),
      lostBlocs: current.blocs.filter(b => !next.blocs.some(n => n.id === b.id)).map(b => b.name),
      lostCitizenships: renounces
        ? profile.flags.filter(f => f.status === 'cit').map(f => f.name)
        : [],
      renouncesPrevious: renounces,
      via,
    };
  };

  const recs: Recommendation[] = [];

  // Descent/heritage paths the profile qualifies for — usually the best moves.
  for (const lane of current.ancestryLanes) {
    if (!lane.leads_to_settlement) continue;
    const via = profile.heritages.includes(lane.id) ? 'heritage' : 'ancestry';
    const r = evaluate(
      lane.destination.iso_n3, lane.destination.name,
      DESCENT_YEARS[lane.id] ?? 2, via,
    );
    if (r) recs.push(r);
  }
  const ancestryIsos = new Set(recs.map(r => r.iso_n3));

  // Ordinary naturalization/CBI candidates.
  for (const opt of countryOptions(data)) {
    if (ancestryIsos.has(opt.iso_n3)) continue;
    const cbiYears = CBI_YEARS[opt.iso_n3];
    const r = evaluate(
      opt.iso_n3,
      opt.name,
      cbiYears ?? yearsForProfile(opt.iso_n3),
      cbiYears === undefined ? 'naturalization' : 'cbi',
    );
    if (r) recs.push(r);
  }

  recs.sort((a, b) => b.score - a.score || b.marginal - a.marginal);
  return recs.slice(0, limit);
}

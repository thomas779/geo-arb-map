import type { BilateralLane, Bloc, BlocsData, JurisdictionDualNationality } from '../types';
import {
  CBI_YEARS,
  DESCENT_PATHS,
  DESCENT_YEARS,
  descentGateSatisfied,
  descentRelationLabel,
  naturalizationRule,
  naturalizationYears,
  timelineBeneficiaryIsos,
} from './timeline-rules';

export { CBI_YEARS, DESCENT_YEARS, DESCENT_PATHS } from './timeline-rules';

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
  /** self-attested personal claims (Law of Return, Spätaussiedler, Qandas, compatriot) — not a separate badge layer */
  heritages: string[];
  /** partner's citizenships — household footprint derives from either spouse */
  partnerCitizenships: string[];
  /**
   * Self-attested intentions the graph may gate on, e.g. `child_abroad` for the
   * child-birth accelerator edges. Read by the `intent` predicate attribute
   * (src/lib/predicates.ts); before it existed those edges were gated by a
   * `willing_child_abroad` string the interpreter hard-answered `false`, so
   * they could never fire.
   */
  intents: string[];
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
  partnerCitizenships: [], intents: [], goals: [],
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
    intents: Array.isArray(value.intents)
      ? value.intents.filter(intent => typeof intent === 'string')
      : [],
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

/**
 * Personal claims that aren't captured by an ancestor ISO alone.
 * claimId is stable for URL/profile storage; destination is the country page.
 */
export const HERITAGE_OPTIONS: Array<{ claimId: string; label: string; iso_n3: string }> = [
  { claimId: 'israel_law_of_return', label: 'Jewish heritage (Law of Return)', iso_n3: '376' },
  { claimId: 'germany_spaetaussiedler', label: 'Ethnic German (Spätaussiedler)', iso_n3: '276' },
  { claimId: 'kazakhstan_qandas', label: 'Ethnic Kazakh (Qandas / kandas)', iso_n3: '398' },
  { claimId: 'russia_compatriot', label: "Russian 'compatriot' (cultural/historical tie)", iso_n3: '643' },
];

/** @deprecated use claimId — kept so older profile JSON still type-checks at call sites */
export type HeritageOption = (typeof HERITAGE_OPTIONS)[number];

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
  /** descent/diaspora paths this profile plausibly qualifies for (paths, not current rights) */
  ancestryPaths: Array<{
    id: string;
    name: string;
    iso_n3: string;
    route_id: string;
    /** Relation the corpus records as qualifying, e.g. "parent or grandparent". */
    qualifyingRelation?: string | null;
    /** False/absent means the generational cutoff is UNKNOWN, not unlimited. */
    limitRecorded?: boolean;
  }>;
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
  via: 'naturalization' | 'cbi' | 'ancestry';
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

  // Descent / diaspora claim paths: personal eligibility, not nationality-based.
  // Holding citizenship (or diaspora status) at the destination consumes the path.
  const consumed = new Set(
    profile.flags.filter(f => f.status === 'cit' || f.status === 'diaspora').map(f => f.iso_n3),
  );
  const ancestryPaths: UnlockResult['ancestryPaths'] = [];
  const nameOf = (iso: string): string => {
    for (const b of data.blocs) {
      const m = b.members.find(x => x.iso_n3 === iso);
      if (m) return m.name;
    }
    for (const l of data.bilateral_lanes) {
      if (l.destination.iso_n3 === iso) return l.destination.name;
      const m = l.beneficiaries.find(x => x.iso_n3 === iso);
      if (m) return m.name;
    }
    return iso;
  };
  for (const path of DESCENT_PATHS) {
    if (consumed.has(path.iso_n3)) continue;
    if (!descentGateSatisfied(path.gate, profile, path.iso_n3)) continue;
    ancestryPaths.push({
      id: path.route_id,
      name: path.route_id.replace(/-/g, ' '),
      iso_n3: path.iso_n3,
      route_id: path.route_id,
      qualifyingRelation: descentRelationLabel(path),
      limitRecorded: path.limit_recorded ?? false,
    });
    // Prefer human labels for claim-gated paths
    const claim = HERITAGE_OPTIONS.find(h => path.gate === `claim:${h.claimId}`);
    if (claim) ancestryPaths[ancestryPaths.length - 1].name = claim.label;
    else ancestryPaths[ancestryPaths.length - 1].name = `${nameOf(path.iso_n3)} descent / diaspora path`;
    countries.add(path.iso_n3);
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
  return { blocs, asymmetric, lanes, workLanes, chanceLanes, ancestryPaths, birthHints, countries };
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

/**
 * Plurality positions the planner reads, keyed by iso_n3.
 *
 * Built from `jurisdictions[].dual_nationality` in the compiled corpus — the
 * canonical field the coverage audit measures. Until #144 the planner read a
 * rival 25-row model in public/blocs_data.json on its own enum (`banned`), so the
 * audit measured one thing and the product served another. That model is retired.
 */
export type PluralityIndex = Map<string, JurisdictionDualNationality>;

export function pluralityIndex(
  routes: { jurisdictions: Array<{ iso_n3: string; dual_nationality?: JurisdictionDualNationality | null }> } | null,
): PluralityIndex {
  const index: PluralityIndex = new Map();
  for (const jurisdiction of routes?.jurisdictions ?? []) {
    if (jurisdiction.dual_nationality) index.set(jurisdiction.iso_n3, jurisdiction.dual_nationality);
  }
  return index;
}

/**
 * Does taking this citizenship cost you the ones you hold?
 *
 * Reads the INBOUND limb, which is the one the question is actually about; the
 * outbound retention limbs describe what happens to THIS nationality when its
 * holder acquires another and answer a different question entirely.
 *
 * A `legacy_import` row has no limbs at all — it is an unsourced claim carried
 * over from the retired model — so its headline `prohibited` is the only thing it
 * can offer, and it is honoured rather than dropped, because dropping it would
 * silently remove a renunciation warning the product has been showing. No row,
 * or a row that says `unknown` both ways, warns nobody: absence is NOT RECORDED,
 * never "no restriction".
 */
export function renouncesOnAcquiring(row: JurisdictionDualNationality | undefined): boolean {
  if (!row) return false;
  if (row.acquisition.effect === 'renunciation_required') return true;
  // `renunciation_with_exceptions` deliberately does NOT flag. Whether it bites
  // depends on which nationality the applicant already holds — Spain's art. 23(b)
  // exempts the Ibero-American states, the Netherlands exempts Second Protocol
  // states and spouses — and this model has no way to evaluate that. The planner's
  // renunciation branch DELETES the user's other citizenships from the footprint,
  // so guessing wrong here tells someone they will lose a passport they would keep.
  // The exceptions are spelled out in the limb's detail.
  return row.acquisition.effect === 'unknown' && row.status === 'prohibited';
}

export function recommend(
  profile: Profile,
  data: BlocsData,
  limit = 5,
  plurality: PluralityIndex = new Map(),
): Recommendation[] {
  const heldIsos = profile.flags.filter(f => f.status === 'cit').map(f => f.iso_n3);
  const current = computeUnlocks(profile, data);
  const currentSize = current.countries.size;
  const currentBlocIds = new Set(current.blocs.map(b => b.id));
  const held = new Set(heldIsos);
  const durations = acquisitionYears(data);
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
    const renounces = renouncesOnAcquiring(plurality.get(iso));
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

  // Descent / diaspora claim paths — usually the best moves (all fold into "ancestry").
  for (const path of current.ancestryPaths) {
    const name = countryOptions(data).find(c => c.iso_n3 === path.iso_n3)?.name
      ?? path.name;
    const r = evaluate(
      path.iso_n3,
      name,
      DESCENT_YEARS[path.iso_n3] ?? 2,
      'ancestry',
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

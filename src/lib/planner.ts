import type { BilateralLane, Bloc, BlocsData } from '../types';

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

export interface Profile {
  flags: PlantedFlag[];
  /** iso_n3 of country of birth — unlocks birth-based lanes (e.g. Falklands→Argentina) */
  birthplace: string | null;
  /** iso_n3 of parents'/grandparents' birthplaces — unlocks descent lanes */
  ancestors: string[];
  /** self-attested heritage claims, keyed by lane id (Law of Return, Spätaussiedler...) */
  heritages: string[];
}

export const EMPTY_PROFILE: Profile = { flags: [], birthplace: null, ancestors: [], heritages: [] };

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

/** Rough years-to-citizenship for descent/heritage routes (processing, not residence). */
export const DESCENT_YEARS: Record<string, number> = {
  ireland_fbr: 1.5,
  italy_jure_sanguinis: 1.5,
  uk_ancestry: 6, // 5-yr visa -> ILR -> citizenship
  poland_karta_polaka: 2,
  hungary_simplified: 1,
  armenia_ethnic: 1,
  korea_f4: 4,
  japan_nikkei: 5,
  israel_law_of_return: 0.5,
  germany_spaetaussiedler: 1,
  kazakhstan_qandas: 1,
  russia_compatriot: 1.5,
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
  renouncesPrevious: boolean;
  via: 'naturalization' | 'ancestry' | 'heritage';
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

/**
 * Best-effort acquisition durations parsed from the dataset's own text
 * ("Argentina: 2 yrs...", "Bolivia or Ecuador: 3 yrs", "6-12 months").
 * Countries without a parseable duration rank with a conservative default
 * and display "time unknown".
 */
export function acquisitionYears(data: BlocsData): Map<string, number> {
  const years = new Map<string, number>();
  const nameToIso = new Map<string, string>();
  for (const opt of countryOptions(data)) nameToIso.set(opt.name.toLowerCase(), opt.iso_n3);

  const consider = (iso: string, y: number) => {
    const prev = years.get(iso);
    if (prev === undefined || y < prev) years.set(iso, y);
  };

  const texts: string[] = [
    ...data.blocs.map(b => b.fastest_entry),
    ...data.stacking_plays.map(p => `${p.passport}: ${p.timeline}`),
  ];
  for (const text of texts) {
    for (const segment of text.split(/[;.]/)) {
      // All durations in the segment, with positions — a segment like
      // "Brazil: 1 yr (child) + 2 yrs Spain" carries different values for
      // different countries, so each name takes its NEAREST number.
      const nums: Array<{ value: number; index: number }> = [];
      for (const m of segment.matchAll(/~?\s*(\d+)(?:\s*-\s*\d+)?\s*(yrs?|years?|months?)/gi)) {
        const value = m[2].toLowerCase().startsWith('month')
          ? Math.max(0.5, parseInt(m[1], 10) / 12)
          : parseInt(m[1], 10);
        nums.push({ value, index: m.index ?? 0 });
      }
      if (!nums.length) continue;
      const seg = segment.toLowerCase();
      for (const [name, iso] of nameToIso) {
        const at = seg.indexOf(name);
        if (at === -1) continue;
        let best = nums[0];
        for (const n of nums) {
          if (Math.abs(n.index - at) < Math.abs(best.index - at)) best = n;
        }
        consider(iso, best.value);
      }
    }
  }
  return years;
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

  const withCitizenship = (iso: string): Profile => ({
    ...profile,
    flags: [...profile.flags, { iso_n3: iso, name: iso, status: 'cit' }],
  });
  const onlyCitizenship = (iso: string): Profile => ({
    ...profile,
    flags: [{ iso_n3: iso, name: iso, status: 'cit' }],
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
    const r = evaluate(opt.iso_n3, opt.name, durations.get(opt.iso_n3) ?? null, 'naturalization');
    if (r) recs.push(r);
  }

  recs.sort((a, b) => b.score - a.score || b.marginal - a.marginal);
  return recs.slice(0, limit);
}

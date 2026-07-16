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

export interface PlantedFlag {
  iso_n3: string;
  name: string;
  status: 'citizen' | 'resident';
}

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
}

const COUNTED_CATEGORIES = new Set(['full', 'partial', 'hub_spoke', 'closed']);
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

export function computeUnlocks(citizenIsos: string[], data: BlocsData): UnlockResult {
  const held = new Set(citizenIsos);
  const blocs: Bloc[] = [];
  const asymmetric: Bloc[] = [];
  const lanes: BilateralLane[] = [];
  const workLanes: BilateralLane[] = [];
  const chanceLanes: BilateralLane[] = [];
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
    if (!l.beneficiaries.some(m => held.has(m.iso_n3))) continue; // identity lanes never match
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

  for (const iso of held) countries.delete(iso);
  return { blocs, asymmetric, lanes, workLanes, chanceLanes, countries };
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
      const num = segment.match(/~?\s*(\d+)(?:\s*-\s*\d+)?\s*(yrs?|years?|months?)/i);
      if (!num) continue;
      const value = num[2].toLowerCase().startsWith('month')
        ? Math.max(0.5, parseInt(num[1], 10) / 12)
        : parseInt(num[1], 10);
      const seg = segment.toLowerCase();
      for (const [name, iso] of nameToIso) {
        if (seg.includes(name)) consider(iso, value);
      }
    }
  }
  return years;
}

export function recommend(
  flags: PlantedFlag[],
  data: BlocsData,
  limit = 5,
): Recommendation[] {
  const heldIsos = flags.filter(f => f.status === 'citizen').map(f => f.iso_n3);
  const current = computeUnlocks(heldIsos, data);
  const currentSize = current.countries.size;
  const currentBlocIds = new Set(current.blocs.map(b => b.id));
  const held = new Set(heldIsos);
  const durations = acquisitionYears(data);
  const bans = data.dual_citizenship?.countries ?? {};

  const recs: Recommendation[] = [];
  for (const opt of countryOptions(data)) {
    if (held.has(opt.iso_n3)) continue;

    const renounces = bans[opt.iso_n3]?.status === 'banned';
    // Renunciation destinations: net footprint = what X alone gives, minus
    // everything the current flags gave (per explorer-spec part B).
    const next = renounces
      ? computeUnlocks([opt.iso_n3], data)
      : computeUnlocks([...heldIsos, opt.iso_n3], data);
    const nextCountries = new Set(next.countries);
    nextCountries.add(opt.iso_n3); // the new home country itself
    for (const iso of held) nextCountries.delete(iso);

    const marginal = nextCountries.size - currentSize;
    if (marginal <= 0) continue;

    const years = durations.get(opt.iso_n3) ?? null;
    recs.push({
      iso_n3: opt.iso_n3,
      name: opt.name,
      marginal,
      years,
      score: marginal / Math.max(years ?? DEFAULT_YEARS, 0.75),
      newBlocs: next.blocs.filter(b => !currentBlocIds.has(b.id)).map(b => b.name),
      renouncesPrevious: renounces,
    });
  }

  recs.sort((a, b) => b.score - a.score || b.marginal - a.marginal);
  return recs.slice(0, limit);
}

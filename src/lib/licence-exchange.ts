/**
 * Driving-licence exchange layer (#171).
 *
 * Seed data lives in public/licence_exchange.json (Germany Anlage 11 FeV first).
 * This module is pure helpers so UI and tests share the same lookup logic.
 */

export interface LicenceExchangeEntry {
  origin_label: string;
  origin_label_en: string;
  origin_iso_n3: string | null;
  parent_iso_n3: string | null;
  subnational: boolean;
  subnational_label: string | null;
  classes: string | null;
  theory_test_required: boolean | null;
  practical_test_required: boolean | null;
  no_retest: boolean;
}

export interface LicenceExchangeDestination {
  iso_n3: string;
  name: string;
  instrument: string;
  source_url: string;
  entries: LicenceExchangeEntry[];
}

export interface LicenceExchangeDisclaimer {
  normal_residence: string;
  scope: string;
  coverage: string;
}

export interface LicenceExchangeData {
  schema_version: number;
  generated_at: string;
  disclaimer: LicenceExchangeDisclaimer;
  destinations: LicenceExchangeDestination[];
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

/** Unique origins across all destinations, sorted by English label. */
export function listOrigins(data: LicenceExchangeData): OriginOption[] {
  const map = new Map<string, OriginOption>();
  for (const dest of data.destinations) {
    for (const e of dest.entries) {
      const key = e.subnational
        ? `sub:${e.parent_iso_n3 ?? 'x'}:${e.subnational_label ?? e.origin_label}`
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
        if (e.subnational) existing.varies_by_subnational = true;
      } else {
        map.set(pickerKey, {
          key: pickerKey,
          label,
          iso_n3: e.subnational ? e.parent_iso_n3 : e.origin_iso_n3,
          varies_by_subnational: e.subnational,
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
      varies_by_subnational: entries.some(e => e.subnational),
    });
  }
  return matches;
}

function entryMatchesKey(e: LicenceExchangeEntry, originKey: string): boolean {
  if (originKey.startsWith('nat:')) {
    const id = originKey.slice(4);
    if (e.subnational) return e.parent_iso_n3 === id;
    return e.origin_iso_n3 === id || e.origin_label === id || e.origin_label_en === id;
  }
  if (originKey.startsWith('sub:')) {
    const parts = originKey.split(':');
    const parent = parts[1];
    const sub = parts.slice(2).join(':');
    return e.subnational && (e.parent_iso_n3 === parent || parent === 'x')
      && (e.subnational_label === sub || e.origin_label === sub);
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

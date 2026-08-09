import type { AtlasIndexData, DescentReach, ResidenceCategory } from '@/types';

/**
 * Route-class browse (issue #129): paint jurisdictions that have at least one
 * ACTIVE route of a class, using only fields the data already ships — no new
 * data classes, no revival of the dissolved heritage-lane badge category.
 *
 * Citizenship classes match `routes[].mode`; residence classes match
 * `residence_routes[].category`. `verified_negative` and `inactive` rows never
 * paint: the map answers "where can I do this today".
 */
export interface RouteClass {
  id: string;
  label: string;
  kind: 'citizenship' | 'residence';
  match: string; // mode (citizenship) or category (residence)
  description: string;
  /**
   * Narrows a citizenship class to routes of a given reach (#191). Only the
   * ancestry classes set it, and it is the whole fix: `mode: 'ancestry'` alone
   * matched 232 of 240 jurisdictions, because every country transmits citizenship
   * to the child of a citizen. A facet that selects 97% of the map renders as
   * "everywhere", which is both useless and, worse, true.
   */
  descent_reach?: readonly DescentReach[];
  /**
   * Extra words the sidebar search matches, for classes whose label and
   * description use the legal term rather than the one people type. "Ancestry",
   * "heritage" and "blood" appear in no ancestry label — the owner's own words
   * for this returned nothing — so they are recorded here rather than smuggled
   * into a description, which is prose the UI shows and must stay readable.
   */
  keywords?: readonly string[];
}

/**
 * Ancestry is deliberately absent as a single flat class.
 *
 * The three buckets below are the axis people actually search on — can I qualify
 * through ethnic/diaspora ORIGIN, through a GRANDPARENT, or through an ancestor
 * with no generation limit stated — and each selects a set small
 * enough to read. `parent_only` and `not_recorded` get no facet at all: the first
 * is near-universal and carries no information, and the second is an absence of
 * evidence that must never be painted as a finding. Both remain visible on the
 * country and route pages, where a route is read rather than compared.
 */
export const ROUTE_CLASSES: readonly RouteClass[] = [
  // Origin leads the three. It is the class that does not require an ancestor who
  // held the citizenship at all — the Law of Return, Spätaussiedler, the Armenian
  // and Kyrgyz origin routes — so it qualifies people no degree facet reaches, and
  // it must not sit below the narrower grandparent bucket.
  { id: 'ancestry-origin', label: 'Ethnic or diaspora origin', kind: 'citizenship', match: 'ancestry',
    descent_reach: ['origin_based'],
    keywords: ['ancestry', 'heritage', 'blood', 'bloodline', 'ethnicity', 'right of return', 'repatriation', 'jewish', 'aliyah'],
    description: 'Qualifies on ethnic or national origin rather than descent from a citizen — the Law of Return, Spätaussiedler, the Armenian and Kyrgyz origin routes.' },
  // Keeps the `ancestry` id so existing /?class=ancestry links stay live; what
  // changed is what the id MEANS, from "has any descent route" to "reaches past a
  // parent", which is the question the old facet was failing to answer.
  { id: 'ancestry', label: 'Grandparent or deeper', kind: 'citizenship', match: 'ancestry',
    descent_reach: ['grandparent_or_deeper'],
    keywords: ['ancestry', 'heritage', 'blood', 'bloodline', 'descent', 'family'],
    description: 'A grandparent or further back qualifies, as recorded in the instrument.' },
  { id: 'ancestry-unlimited', label: 'No stated generation limit', kind: 'citizenship', match: 'ancestry',
    descent_reach: ['unlimited'],
    keywords: ['ancestry', 'heritage', 'blood', 'bloodline', 'great-grandparent', 'distant ancestor'],
    description: 'The instrument names an ancestor without fixing a generation, and states no cutoff.' },
  { id: 'cbi', label: 'Citizenship by investment', kind: 'citizenship', match: 'investment',
    description: 'Direct citizenship for a qualifying investment or contribution.' },
  { id: 'naturalization', label: 'Naturalization', kind: 'citizenship', match: 'naturalization',
    description: 'Citizenship after qualifying residence.' },
  { id: 'golden-visa', label: 'Golden visa (RBI)', kind: 'residence', match: 'investment',
    description: 'Residence for a qualifying investment. Not citizenship — check each card’s ladder badges.' },
  { id: 'digital-nomad', label: 'Digital nomad', kind: 'residence', match: 'digital_nomad',
    description: 'Remote-work residence permits.' },
  { id: 'retirement', label: 'Retirement', kind: 'residence', match: 'retirement_pension',
    description: 'Passive-income and pensioner residence.' },
  { id: 'talent', label: 'Talent & skilled', kind: 'residence', match: 'talent_skilled',
    description: 'Residence for designated skills or achievement.' },
  { id: 'digital-identity', label: 'Digital identity', kind: 'residence', match: 'digital_identity',
    description: 'Government digital ID only — not a right to live in the country.' },
];

export function routeClassById(id: string | null | undefined): RouteClass | null {
  return ROUTE_CLASSES.find(c => c.id === id) ?? null;
}

/**
 * The promoted classes: the sidebar's "Start with a route" tiles, above the
 * collapsed "Route types" accordion.
 *
 * It was four tiles and only one was ancestry — "Through a grandparent", the
 * NARROWEST of the three reaches — which left the origin route reachable only by
 * expanding an accordion. Someone arriving for the Law of Return or the Armenian
 * or Kyrgyz origin route saw a grandparent tile and concluded the atlas did not
 * cover them. All three reaches are promoted now, origin first, because the split
 * IS the answer: they are three different questions, not three depths of one, and
 * a single "Through ancestry" tile could only be honest by re-merging them into
 * the 232-of-240 paint the reach split exists to prevent.
 *
 * Labels are the words someone types, not the reach terms the accordion rows
 * carry: heritage before "origin_based", a distant ancestor before "no stated
 * generation limit". The tile's tooltip is the class `description`, which stays
 * the precise sentence. Keep the count even — the grid is two columns.
 */
export const QUICK_ROUTE_CLASSES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'ancestry-origin', label: 'Through ethnic heritage' },
  { id: 'ancestry', label: 'Through a grandparent' },
  { id: 'ancestry-unlimited', label: 'Through a distant ancestor' },
  { id: 'cbi', label: 'Invest for citizenship' },
  { id: 'golden-visa', label: 'Invest for residence' },
  { id: 'digital-nomad', label: 'Work remotely' },
];

const ROUTE_CLASS_PAGE: Record<string, string> = {
  cbi: '/routes/citizenship-by-investment/',
  'golden-visa': '/routes/golden-visas/',
  'digital-nomad': '/routes/digital-nomad-visas/',
  retirement: '/routes/retirement-visas/',
  talent: '/routes/talent-skilled-visas/',
  'digital-identity': '/routes/digital-identities/',
};

/** Country-first discovery pages for route families with structured coverage. */
export function routeClassPageHref(id: string): string | null {
  return ROUTE_CLASS_PAGE[id] ?? null;
}

const RESIDENCE_CATEGORY_PAGE: Partial<Record<ResidenceCategory, string>> = {
  investment: ROUTE_CLASS_PAGE['golden-visa'],
  digital_nomad: ROUTE_CLASS_PAGE['digital-nomad'],
  retirement_pension: ROUTE_CLASS_PAGE.retirement,
  talent_skilled: ROUTE_CLASS_PAGE.talent,
  digital_identity: ROUTE_CLASS_PAGE['digital-identity'],
};

/** Reciprocal link from a country programme back to its all-country index. */
export function residenceCategoryPageHref(category: ResidenceCategory): string | null {
  return RESIDENCE_CATEGORY_PAGE[category] ?? null;
}

/**
 * Painted sets for a class: the country's BEST outcome across its active
 * routes, as three mutually exclusive tiers matching the Access levels
 * glossary. The palette cannot carry three lightness steps (validated: every
 * candidate third blue lands within dE 9 of the land grey or its ramp
 * neighbour), so the third distinction uses TEXTURE, the dataviz-sanctioned
 * secondary channel: TR = light solid, PR = strong 45-degree hatch, CIT =
 * strong solid. The hatch reads as "almost the strongest", which is what PR is.
 */
export interface RouteClassIsos {
  all: Set<string>;
  cit: Set<string>;
  pr: Set<string>;
  tr: Set<string>;
}

export function isosForRouteClass(
  routeClass: RouteClass,
  data: AtlasIndexData,
): RouteClassIsos {
  const best = new Map<string, 'tr' | 'pr' | 'cit'>();
  const rank = { tr: 0, pr: 1, cit: 2 } as const;
  const raise = (iso: string, tier: 'tr' | 'pr' | 'cit') => {
    const current = best.get(iso);
    if (!current || rank[tier] > rank[current]) best.set(iso, tier);
  };
  if (routeClass.kind === 'citizenship') {
    for (const route of data.routes) {
      if (route.mode !== routeClass.match || route.status !== 'active') continue;
      // An unprojected reach reads as `not_recorded`, never as a match: a reach
      // facet must paint a recorded finding, and an older index that predates the
      // field should paint nothing rather than everything.
      if (routeClass.descent_reach
        && !routeClass.descent_reach.includes(route.descent_reach ?? 'not_recorded')) continue;
      raise(route.country.iso_n3, 'cit');
    }
  } else {
    for (const route of data.residence_routes ?? []) {
      if (route.category !== routeClass.match || route.status !== 'active') continue;
      if (route.counts_toward_naturalization) raise(route.country.iso_n3, 'cit');
      else if (route.counts_toward_permanent_residence) raise(route.country.iso_n3, 'pr');
      else raise(route.country.iso_n3, 'tr');
    }
  }
  const sets: RouteClassIsos = { all: new Set(best.keys()), cit: new Set(), pr: new Set(), tr: new Set() };
  for (const [iso, tier] of best) sets[tier].add(iso);
  return sets;
}

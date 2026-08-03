import type { AtlasIndexData, ResidenceCategory } from '@/types';

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
}

export const ROUTE_CLASSES: readonly RouteClass[] = [
  { id: 'ancestry', label: 'Ancestry & descent', kind: 'citizenship', match: 'ancestry',
    description: 'Citizenship through parents, grandparents, or ethnic/diaspora ties.' },
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
      if (route.mode === routeClass.match && route.status === 'active') raise(route.country.iso_n3, 'cit');
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

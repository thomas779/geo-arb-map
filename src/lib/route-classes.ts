import type { CitizenshipRoutesData } from '@/types';

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

/**
 * Painted sets for a class. TWO tiers, not three — validated, not felt: the
 * palette validator puts every 3-tone candidate below ΔE 9 against either the
 * land grey or its ramp neighbour (the PR↔land corridor is only ~ΔE 15 wide),
 * so a third tone would be indistinguishable for a meaningful share of
 * readers. The legend keeps all three Access-level rows; PR and CIT share the
 * solid swatch, which is the truthful statement that the map cannot split
 * them further.
 *
 * `accruing`: at least one active route of the class counts toward PR or
 * naturalization (the flags the cards' ladder badges render). Citizenship
 * classes are all-accruing by definition. `accruing` ⊆ `all`.
 */
export interface RouteClassIsos {
  all: Set<string>;
  accruing: Set<string>;
}

export function isosForRouteClass(
  routeClass: RouteClass,
  data: CitizenshipRoutesData,
): RouteClassIsos {
  const all = new Set<string>();
  const accruing = new Set<string>();
  if (routeClass.kind === 'citizenship') {
    for (const route of data.routes) {
      if (route.mode === routeClass.match && route.status === 'active') {
        all.add(route.country.iso_n3);
        accruing.add(route.country.iso_n3);
      }
    }
  } else {
    for (const route of data.residence_routes ?? []) {
      if (route.category === routeClass.match && route.status === 'active') {
        all.add(route.country.iso_n3);
        if (route.counts_toward_permanent_residence || route.counts_toward_naturalization) {
          accruing.add(route.country.iso_n3);
        }
      }
    }
  }
  return { all, accruing };
}

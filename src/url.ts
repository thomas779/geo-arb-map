import type { AppState } from './types';
import type { FlagStatus, PlantedFlag, Profile } from './lib/planner';

const MAP_PARAMS = ['view', 'blocs', 'bloc', 'lane', 'country'];
const PROFILE_PARAMS = ['flags', 'born', 'ancestors', 'heritage', 'partner', 'goals'];
const TRUST_SECTIONS = ['methodology', 'privacy', 'limitations'] as const;
export type TrustSection = typeof TRUST_SECTIONS[number];
const URL_STATUS: Record<string, FlagStatus> = {
  t: 'tr',
  p: 'pr',
  c: 'cit',
  d: 'diaspora',
  r: 'pr',
};

export function readProfile(params = new URLSearchParams(window.location.search)): Profile | null {
  if (!PROFILE_PARAMS.some(key => params.has(key))) return null;

  const flags: PlantedFlag[] = (params.get('flags') ?? '')
    .split(',')
    .filter(Boolean)
    .map(tok => {
      const suffix = tok.slice(-1);
      const status = URL_STATUS[suffix] ?? 'cit';
      const iso = (URL_STATUS[suffix] ? tok.slice(0, -1) : tok).padStart(3, '0');
      return { iso_n3: iso, name: iso, status };
    });

  return {
    version: 2,
    flags,
    birthplace: params.get('born')?.padStart(3, '0') ?? null,
    ancestors: (params.get('ancestors') ?? '')
      .split(',')
      .filter(Boolean)
      .map(iso => iso.padStart(3, '0')),
    heritages: (params.get('heritage') ?? '').split(',').filter(Boolean),
    partnerCitizenships: (params.get('partner') ?? '')
      .split(',')
      .filter(Boolean)
      .map(iso => iso.padStart(3, '0')),
    goals: (params.get('goals') ?? '')
      .split(',')
      .filter(Boolean)
      .map(tok => ({
        iso_n3: tok.slice(0, -1).padStart(3, '0'),
        intent: ({ w: 'work', l: 'live', c: 'cit' } as const)[tok.slice(-1) as 'w' | 'l' | 'c'] ?? 'live',
      })),
    watchedRoutes: [],
    alerts: { channel: 'none', verifiedOnly: true },
  };
}

/** Route is the pathname: / = atlas, /planner = planner, /country = country list. */
export function viewFromPath(pathname = window.location.pathname): AppState['view'] {
  if (pathname === '/planner' || pathname.startsWith('/planner/')) return 'stacking';
  if (pathname === '/country' || pathname.startsWith('/country')) return 'countries';
  return 'map';
}

function pathForView(view: AppState['view'], currentPath = window.location.pathname): string {
  if (view === 'stacking') return '/planner';
  if (view === 'countries') {
    // Preserve a specific /country/<slug> detail path; only the list is bare /country.
    return /^\/country\/[^/]+/.test(currentPath) ? currentPath : '/country';
  }
  return '/';
}

export function read(): Partial<AppState> {
  const params = new URLSearchParams(window.location.search);
  const state: Partial<AppState> = {};

  state.view = viewFromPath();
  // Back-compat: old ?view=stacking links (before path routing).
  if (state.view === 'map' && params.get('view') === 'stacking') state.view = 'stacking';

  const blocs = params.get('blocs');
  if (blocs) {
    state.blocs = blocs.split(',').filter(Boolean);
  } else {
    // Back-compat: pre-multi-select links used ?bloc=<id>
    const bloc = params.get('bloc');
    if (bloc) state.blocs = [bloc];
  }

  const lane = params.get('lane');
  if (lane) state.lane = lane;

  const country = params.get('country');
  if (country) state.country = country;

  return state;
}

export function readInfo(params = new URLSearchParams(window.location.search)): TrustSection | null {
  const value = params.get('info');
  return TRUST_SECTIONS.includes(value as TrustSection) ? value as TrustSection : null;
}

export function sync(state: AppState): void {
  // Preserve tooling/profile/theme parameters; this function owns route + map
  // state only. The route lives in the pathname (/ , /planner, /country).
  const params = paramsForState(new URLSearchParams(window.location.search), state);
  const qs = params.toString();
  history.replaceState(null, '', `${pathForView(state.view)}${qs ? `?${qs}` : ''}${location.hash}`);
}

export function paramsForState(current: URLSearchParams, state: AppState): URLSearchParams {
  const params = new URLSearchParams(current);
  MAP_PARAMS.forEach(key => params.delete(key));
  // Profile-shaped query parameters are accepted as a one-time tooling import,
  // then removed so they cannot be copied, retained in history, or forwarded.
  PROFILE_PARAMS.forEach(key => params.delete(key));
  // Map sub-state (selected country / blocs / lane) only applies on the atlas.
  if (state.view === 'map') {
    if (state.blocs.length) params.set('blocs', state.blocs.join(','));
    if (state.lane) params.set('lane', state.lane);
    if (state.country) params.set('country', state.country);
  }
  return params;
}

export function setInfo(section: TrustSection | null): void {
  const params = new URLSearchParams(window.location.search);
  if (section) params.set('info', section);
  else params.delete('info');
  const qs = params.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}

/** A user edit takes ownership from a tooling/demo profile URL. */
export function clearProfileParams(): void {
  const params = new URLSearchParams(window.location.search);
  PROFILE_PARAMS.forEach(key => params.delete(key));
  const qs = params.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}

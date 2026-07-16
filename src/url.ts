import type { AppState } from './types';

export function read(): Partial<AppState> {
  const params = new URLSearchParams(window.location.search);
  const state: Partial<AppState> = {};

  const view = params.get('view');
  if (view === 'stacking') state.view = 'stacking';

  const bloc = params.get('bloc');
  if (bloc) state.bloc = bloc;

  const lane = params.get('lane');
  if (lane) state.lane = lane;

  const country = params.get('country');
  if (country) state.country = country;

  return state;
}

export function sync(state: AppState): void {
  const params = new URLSearchParams();
  if (state.view === 'stacking') params.set('view', 'stacking');
  if (state.bloc) params.set('bloc', state.bloc);
  if (state.lane) params.set('lane', state.lane);
  if (state.country) params.set('country', state.country);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

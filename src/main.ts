import './style.css';
import type { AppState, BlocsData } from './types';
import * as url from './url';
import { init as initSidebar, render as renderSidebar } from './sidebar';
import { init as initMap, render as renderMap } from './map';
import { render as renderDetail } from './detail';
import { render as renderStacking } from './stacking';

let state: AppState = {
  view: 'map',
  bloc: null,
  lane: null,
  country: null,
  countryName: null,
};

let globalData: BlocsData | null = null;

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  url.sync(state);
  renderAll();
}

function renderAll(): void {
  if (!globalData) return;
  renderSidebar(state);
  renderMap(state, globalData);
  renderDetail(state, globalData, () => setState({ country: null, countryName: null }));
  renderStacking(state, globalData, (blocId) => {
    if (blocId === '__back__') {
      setState({ view: 'map' });
    } else {
      setState({ view: 'map', bloc: blocId, lane: null, country: null, countryName: null });
    }
  });
}

async function main(): Promise<void> {
  // Restore from URL before anything renders
  const urlState = url.read();
  state = { ...state, ...urlState };

  const res = await fetch(import.meta.env.BASE_URL + 'blocs_data.json');
  const data: BlocsData = await res.json();
  globalData = data;

  // Inject last-verified + disclaimer into header
  const meta = document.getElementById('header-meta');
  if (meta) {
    meta.innerHTML =
      `Where one status unlocks many countries — TR / PR / CIT rights per bloc.` +
      `<span class="verified">Last verified: ${data.meta.last_verified} · ${data.meta.disclaimer}</span>`;
  }

  // Init modules (sidebar and map are stateful and only called once)
  initSidebar(data, {
    onBloc: (id) => setState({ bloc: id, lane: null, country: null, countryName: null }),
    onLane: (id) => setState({ lane: id, bloc: null, country: null, countryName: null }),
    onView: (v) => setState({ view: v }),
  });

  initMap(data, (iso, name) => {
    setState({ country: iso, countryName: name });
  });

  renderAll();
}

main().catch(err => console.error('Failed to start:', err));

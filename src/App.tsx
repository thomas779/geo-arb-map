import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { AppState, BlocsData } from './types';
import * as url from './url';
import { Button } from '@/components/ui/button';
import { Sidebar } from '@/components/Sidebar';
import { WorldMap } from '@/components/WorldMap';
import { DetailPanel } from '@/components/DetailPanel';
import { StackingView } from '@/components/StackingView';
import { useTheme } from '@/components/theme-provider';

const initialState: AppState = {
  view: 'map',
  bloc: null,
  lane: null,
  country: null,
  countryName: null,
  ...url.read(),
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [data, setData] = useState<BlocsData | null>(null);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'blocs_data.json')
      .then(res => res.json())
      .then((d: BlocsData) => setData(d))
      .catch(err => console.error('Failed to load blocs_data.json:', err));
  }, []);

  useEffect(() => {
    url.sync(state);
  }, [state]);

  const patch = useCallback((p: Partial<AppState>) => {
    setState(s => ({ ...s, ...p }));
  }, []);

  const selectBloc = useCallback((id: string | null) =>
    patch({ bloc: id, lane: null, country: null, countryName: null }), [patch]);
  const selectLane = useCallback((id: string | null) =>
    patch({ lane: id, bloc: null, country: null, countryName: null }), [patch]);
  const selectView = useCallback((v: 'map' | 'stacking') =>
    patch({ view: v }), [patch]);
  const selectCountry = useCallback((iso: string, name: string) =>
    patch({ country: iso, countryName: name }), [patch]);
  const closeDetail = useCallback(() =>
    patch({ country: null, countryName: null }), [patch]);
  const backToMapWithBloc = useCallback((blocId: string | null) => {
    if (blocId === null) {
      patch({ view: 'map' });
    } else {
      patch({ view: 'map', bloc: blocId, lane: null, country: null, countryName: null });
    }
  }, [patch]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-baseline gap-4 border-b px-5 py-3">
        <h1 className="text-[22px] font-bold tracking-[0.2px]">Settlement Blocs</h1>
        <span className="text-xs text-muted-foreground">
          Where one status unlocks many countries — TR / PR / CIT rights per bloc.
          {data && (
            <span className="ml-1.5 text-[11px] opacity-80">
              Last verified <span className="font-mono">{data.meta.last_verified}</span> · {data.meta.disclaimer}
            </span>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto self-center text-muted-foreground"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </header>
      <main className="flex min-h-0 flex-1">
        {data && (
          <Sidebar
            data={data}
            state={state}
            onBloc={selectBloc}
            onLane={selectLane}
            onView={selectView}
          />
        )}
        <div id="map-wrap" className="relative min-w-0 flex-1 overflow-hidden">
          <WorldMap data={data} state={state} theme={theme} onSelect={selectCountry} />
          {data && state.view === 'stacking' && (
            <StackingView data={data} onBlocSelect={backToMapWithBloc} />
          )}
        </div>
        {data && state.country && (
          <DetailPanel data={data} state={state} onClose={closeDetail} />
        )}
      </main>
    </div>
  );
}

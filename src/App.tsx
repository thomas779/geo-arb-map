import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { AppState, BlocsData } from './types';
import * as url from './url';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
      <header className="flex shrink-0 items-center gap-4 border-b px-5 py-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="whitespace-nowrap text-[22px] font-bold tracking-[0.2px]">Settlement Blocs</h1>
          <span className="hidden truncate text-xs text-muted-foreground md:inline">
            Where one status unlocks many countries
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {data && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="cursor-help text-[10px] text-muted-foreground">
                    TR · PR · CIT
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px]">
                  <div className="flex flex-col gap-1 text-xs">
                    <span><b>TR</b> — {data.meta.tier_legend.TR}</span>
                    <span><b>PR</b> — {data.meta.tier_legend.PR}</span>
                    <span><b>CIT</b> — {data.meta.tier_legend.CIT}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive" className="cursor-help text-[10px]">
                    ⚠ Not legal advice
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px] text-xs">
                  {data.meta.disclaimer}
                </TooltipContent>
              </Tooltip>
              <span className="hidden font-mono text-[10.5px] text-muted-foreground lg:inline">
                verified {data.meta.last_verified}
              </span>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
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

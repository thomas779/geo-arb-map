import { useCallback, useEffect, useState } from 'react';
import { Info, List, Map as MapIcon, Moon, Sun } from 'lucide-react';
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
import { EMPTY_PROFILE, type FlagStatus, type PlantedFlag, type Profile } from '@/lib/planner';
import type { EdgesFile, GraphEdge } from '@/lib/pathfinder';

const PROFILE_KEY = 'geo-arb-profile';
const LEGACY_FLAGS_KEY = 'geo-arb-flags';

const URL_STATUS: Record<string, FlagStatus> = { t: 'tr', p: 'pr', c: 'cit', d: 'diaspora', r: 'pr' };

function initialProfile(): Profile {
  // Tooling/demo override: ?flags=372c,840p,356d&born=344&ancestors=380,616&heritage=israel_law_of_return
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('flags') ?? params.get('born') ?? params.get('ancestors') ?? params.get('heritage');
  if (fromUrl !== null) {
    const flags: PlantedFlag[] = (params.get('flags') ?? '').split(',').filter(Boolean).map(tok => {
      const suffix = tok.slice(-1);
      const status = URL_STATUS[suffix] ?? 'cit';
      const iso = (URL_STATUS[suffix] ? tok.slice(0, -1) : tok).padStart(3, '0');
      return { iso_n3: iso, name: iso, status };
    });
    return {
      flags,
      birthplace: params.get('born')?.padStart(3, '0') ?? null,
      ancestors: (params.get('ancestors') ?? '').split(',').filter(Boolean).map(a => a.padStart(3, '0')),
      heritages: (params.get('heritage') ?? '').split(',').filter(Boolean),
      partnerCitizenships: (params.get('partner') ?? '').split(',').filter(Boolean).map(a => a.padStart(3, '0')),
      // ?goals=840w,724l,372c  (w=work, l=live, c=citizenship)
      goals: (params.get('goals') ?? '').split(',').filter(Boolean).map(tok => ({
        iso_n3: tok.slice(0, -1).padStart(3, '0'),
        intent: ({ w: 'work', l: 'live', c: 'cit' } as const)[tok.slice(-1) as 'w' | 'l' | 'c'] ?? 'live',
      })),
    };
  }
  try {
    const stored = localStorage.getItem(PROFILE_KEY);
    if (stored) return { ...EMPTY_PROFILE, ...JSON.parse(stored) };
    // Migrate v1 (flat flag array with citizen/resident statuses)
    const legacy = localStorage.getItem(LEGACY_FLAGS_KEY);
    if (legacy) {
      const flags = (JSON.parse(legacy) as Array<{ iso_n3: string; name: string; status: string }>)
        .map(f => ({ ...f, status: (f.status === 'citizen' ? 'cit' : f.status === 'resident' ? 'pr' : f.status) as FlagStatus }));
      return { ...EMPTY_PROFILE, flags };
    }
  } catch { /* fall through */ }
  return EMPTY_PROFILE;
}

const initialState: AppState = {
  view: 'map',
  blocs: [],
  lane: null,
  country: null,
  countryName: null,
  ...url.read(),
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [data, setData] = useState<BlocsData | null>(null);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [edges, setEdges] = useState<GraphEdge[] | null>(null);
  // Portrait phones browse a LIST first; the map is on demand. Shared links
  // with a selection land straight on the framed map.
  const [mobileList, setMobileList] = useState<boolean>(
    initialState.blocs.length === 0 && !initialState.lane && !initialState.country,
  );
  const { theme, setTheme } = useTheme();

  const changeProfile = useCallback((next: Profile) => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    setProfile(next);
  }, []);

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'blocs_data.json')
      .then(res => res.json())
      .then((d: BlocsData) => {
        setData(d);
        setProfile(p => ({
          ...p,
          flags: p.flags.map(f => {
            if (f.name !== f.iso_n3) return f;
            const m = d.blocs.flatMap(b => b.members)
              .concat(d.bilateral_lanes.flatMap(l => [l.destination, ...l.beneficiaries]))
              .find(x => x.iso_n3 === f.iso_n3);
            return m ? { ...f, name: m.name } : f;
          }),
        }));
      })
      .catch(err => console.error('Failed to load blocs_data.json:', err));
    fetch(import.meta.env.BASE_URL + 'edges.json')
      .then(res => res.json())
      .then((e: EdgesFile) => setEdges(e.edges))
      .catch(err => console.error('Failed to load edges.json:', err));
  }, []);

  useEffect(() => {
    url.sync(state);
  }, [state]);

  const patch = useCallback((p: Partial<AppState>) => {
    setState(s => ({ ...s, ...p }));
  }, []);

  /** Toggle a bloc in the compare set; null clears the whole selection. */
  const toggleBloc = useCallback((id: string | null) => {
    setMobileList(false);
    setState(s => ({
      ...s,
      view: 'map', // selecting from the sidebar always shows the map
      blocs: id === null
        ? []
        : s.blocs.includes(id) ? s.blocs.filter(b => b !== id) : [...s.blocs, id],
      lane: null,
      country: null,
      countryName: null,
    }));
  }, []);
  const selectLane = useCallback((id: string | null) => {
    setMobileList(false);
    patch({ view: 'map', lane: id, blocs: [], country: null, countryName: null });
  }, [patch]);
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
      patch({ view: 'map', blocs: [blocId], lane: null, country: null, countryName: null });
    }
  }, [patch]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="whitespace-nowrap text-[22px] font-bold tracking-[0.2px]">Settlement Blocs</h1>
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">
            Your Path to Global Citizenship
          </span>
        </div>
        <nav aria-label="View" className="flex shrink-0 overflow-hidden rounded-md border">
          {([['map', 'Map'], ['stacking', 'Planner']] as const).map(([v, label]) => (
            <button
              key={v}
              aria-current={state.view === v ? 'page' : undefined}
              className={
                state.view === v
                  ? 'bg-secondary px-3 py-1.5 text-[12px] font-semibold text-secondary-foreground'
                  : 'px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
              }
              onClick={() => selectView(v)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {data && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="hidden cursor-help text-[10px] text-muted-foreground sm:inline-flex">
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
                  <Badge variant="outline" className="cursor-help gap-1 text-[10px] text-muted-foreground">
                    <Info className="size-3" aria-hidden />
                    <span className="hidden sm:inline">Research atlas — not legal advice</span>
                    <span className="sm:hidden">Not legal advice</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px] text-xs">
                  {data.meta.disclaimer}
                </TooltipContent>
              </Tooltip>
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
          <div className="hidden w-[265px] shrink-0 border-r md:block">
            <Sidebar
              data={data}
              state={state}
              onBloc={toggleBloc}
              onLane={selectLane}
            />
          </div>
        )}
        <div id="map-wrap" className="relative min-w-0 flex-1 overflow-hidden">
          <WorldMap data={data} state={state} theme={theme} profile={profile} onSelect={selectCountry} />
          {data && state.view === 'map' && mobileList && (
            <div className="absolute inset-0 z-10 bg-background md:hidden">
              <Sidebar
                data={data}
                state={state}
                onBloc={toggleBloc}
                onLane={selectLane}
              />
            </div>
          )}
          {data && state.view === 'map' && (
            <Button
              variant="secondary"
              size="sm"
              className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 shadow-lg md:hidden"
              onClick={() => setMobileList(v => !v)}
            >
              {mobileList ? <MapIcon /> : <List />}
              {mobileList ? 'Map' : 'List'}
            </Button>
          )}
          {data && state.view === 'stacking' && (
            <StackingView data={data} edges={edges} onBlocSelect={backToMapWithBloc} profile={profile} onProfileChange={changeProfile} />
          )}
          {data && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="absolute right-3 bottom-3 z-10 flex size-5 cursor-help items-center justify-center"
                  aria-label={`Dataset verified ${data.meta.last_verified}`}
                >
                  <span className="absolute size-2.5 rounded-full bg-emerald-500/40 motion-safe:animate-ping" />
                  <span className="relative size-2 rounded-full bg-emerald-500" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                Dataset verified {data.meta.last_verified}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {data && state.country && (
          <DetailPanel data={data} state={state} onClose={closeDetail} />
        )}
      </main>
    </div>
  );
}

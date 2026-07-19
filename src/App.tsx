import { useCallback, useEffect, useState } from 'react';
import { List, Map as MapIcon, Moon, ShieldCheck, Sun } from 'lucide-react';
import type { AppState, BlocsData, CitizenshipRoutesData } from './types';
import * as url from './url';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sidebar } from '@/components/Sidebar';
import { WorldMap } from '@/components/WorldMap';
import { DetailPanel } from '@/components/DetailPanel';
import { StackingView } from '@/components/StackingView';
import { TrustCenter } from '@/components/TrustCenter';
import { useTheme } from '@/components/theme-provider';
import { EMPTY_PROFILE, normalizeProfile, type Profile } from '@/lib/planner';
import type { EdgesFile, GraphEdge } from '@/lib/pathfinder';
import { clearStoredProfile, LEGACY_FLAGS_KEY, PROFILE_KEY } from '@/lib/profile-storage';
import type { TrustSection } from './url';

function initialProfile(): Profile {
  // Tooling/demo override: ?flags=372c,840p,356d&born=344&ancestors=380,616&heritage=israel_law_of_return
  const fromUrl = import.meta.env.DEV ? url.readProfile() : null;
  if (fromUrl) return normalizeProfile(fromUrl);
  try {
    const stored = localStorage.getItem(PROFILE_KEY);
    if (stored) return normalizeProfile(JSON.parse(stored));
    // Migrate v1 (flat flag array with citizen/resident statuses)
    const legacy = localStorage.getItem(LEGACY_FLAGS_KEY);
    if (legacy) {
      const flags = (JSON.parse(legacy) as Array<{ iso_n3: string; name: string; status: string }>)
        .map(f => ({
          ...f,
          status: (f.status === 'citizen' ? 'cit' : f.status === 'resident' ? 'pr' : f.status) as Profile['flags'][number]['status'],
        }));
      return normalizeProfile({ flags });
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
  const [citizenshipRoutes, setCitizenshipRoutes] = useState<CitizenshipRoutesData | null>(null);
  const [infoSection, setInfoSection] = useState<TrustSection | null>(() => url.readInfo());
  // Portrait phones browse a LIST first; the map is on demand. Shared links
  // with a selection land straight on the framed map.
  const [mobileList, setMobileList] = useState<boolean>(
    initialState.blocs.length === 0 && !initialState.lane && !initialState.country,
  );
  const { theme, setTheme } = useTheme();

  const changeProfile = useCallback((next: Profile) => {
    url.clearProfileParams();
    const normalized = normalizeProfile(next);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
    setProfile(normalized);
  }, []);

  const changeInfo = useCallback((section: TrustSection | null) => {
    url.setInfo(section);
    setInfoSection(section);
  }, []);

  const clearProfile = useCallback(() => {
    clearStoredProfile(localStorage);
    url.clearProfileParams();
    setProfile(EMPTY_PROFILE);
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
    fetch(import.meta.env.BASE_URL + 'citizenship_routes.json')
      .then(res => res.json())
      .then((routes: CitizenshipRoutesData) => setCitizenshipRoutes(routes))
      .catch(err => console.error('Failed to load citizenship_routes.json:', err));
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
  const clearMapSelection = useCallback(() => {
    patch({ blocs: [], lane: null, country: null, countryName: null });
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
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-1.5 border-b bg-card/80 px-2.5 py-2 backdrop-blur-sm sm:gap-3 sm:px-5 sm:py-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="whitespace-nowrap text-xl font-bold tracking-tight sm:text-2xl">
            Flag Paths
          </h1>
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">
            Your Path to Global Mobility
          </span>
        </div>
        <nav aria-label="View" className="flex shrink-0 overflow-hidden rounded-md border">
          {([['map', 'Map'], ['stacking', 'Planner']] as const).map(([v, label]) => (
            <button
              key={v}
              aria-current={state.view === v ? 'page' : undefined}
              className={
                state.view === v
                  ? 'min-h-9 bg-secondary px-2 text-xs font-semibold text-secondary-foreground sm:min-h-0 sm:px-3 sm:py-1.5'
                  : 'min-h-9 px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground sm:min-h-0 sm:px-3 sm:py-1.5'
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
                  <Badge variant="outline" className="hidden cursor-help text-xs text-muted-foreground sm:inline-flex">
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
              <Button
                variant="outline"
                size="sm"
                className="size-9 gap-1.5 p-0 text-xs text-muted-foreground sm:h-7 sm:w-auto sm:px-2"
                aria-label="Open trust and data"
                onClick={() => changeInfo('methodology')}
              >
                <ShieldCheck className="size-3" aria-hidden />
                <span className="hidden sm:inline">Trust &amp; data</span>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden text-muted-foreground min-[360px]:inline-flex min-[360px]:size-9 sm:size-7"
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
              onClear={clearMapSelection}
            />
          </div>
        )}
        <div id="map-wrap" className="cartographic-surface relative min-w-0 flex-1 overflow-hidden">
          <WorldMap data={data} state={state} theme={theme} profile={profile} onSelect={selectCountry} />
          {data && state.view === 'map' && mobileList && (
            <div className="absolute inset-0 z-10 bg-background md:hidden">
              <Sidebar
                data={data}
                state={state}
                onBloc={toggleBloc}
                onLane={selectLane}
                onClear={clearMapSelection}
              />
            </div>
          )}
          {data && state.view === 'map' && (
            <Button
              variant="secondary"
              size="sm"
              className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-20 min-h-11 -translate-x-1/2 gap-2 px-4 shadow-lg md:hidden"
              onClick={() => setMobileList(v => !v)}
            >
              {mobileList ? <MapIcon /> : <List />}
              {mobileList ? 'Map' : 'List'}
            </Button>
          )}
          {data && state.view === 'stacking' && (
            <StackingView
              data={data}
              edges={edges}
              citizenshipRoutes={citizenshipRoutes}
              onBlocSelect={backToMapWithBloc}
              profile={profile}
              onProfileChange={changeProfile}
              onOpenPrivacy={() => changeInfo('privacy')}
            />
          )}
          {data && (
            <button
              className="absolute right-3 bottom-3 z-10 hidden rounded-full border bg-background/90 px-2.5 py-1 font-mono text-xs text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground sm:block"
              aria-label={`Dataset reviewed through ${data.meta.last_verified}. Open methodology.`}
              onClick={() => changeInfo('methodology')}
            >
              reviewed&nbsp;·&nbsp;{data.meta.last_verified}
            </button>
          )}
        </div>
        {data && state.country && (
          <DetailPanel
            data={data}
            citizenshipRoutes={citizenshipRoutes}
            state={state}
            onClose={closeDetail}
          />
        )}
      </main>
      {data && (
        <TrustCenter
          open={infoSection !== null}
          section={infoSection ?? 'methodology'}
          lastReviewed={data.meta.last_verified}
          hasProfile={
            profile.flags.length > 0
            || profile.birthplace !== null
            || profile.ancestors.length > 0
            || profile.heritages.length > 0
            || profile.partnerCitizenships.length > 0
            || profile.goals.length > 0
            || profile.watchedRoutes.length > 0
            || profile.alerts.channel !== 'none'
          }
          onOpenChange={open => {
            if (!open) changeInfo(null);
          }}
          onSectionChange={changeInfo}
          onClearProfile={clearProfile}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  Layers3,
  List,
  Map as MapIcon,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Send,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import type { AppState, BlocsData, CitizenshipRoutesData } from './types';
import * as url from './url';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sidebar } from '@/components/Sidebar';
import { WorldMap } from '@/components/WorldMap';
import { DetailPanel } from '@/components/DetailPanel';
import { RouteDetailPanel } from '@/components/RouteDetailPanel';
import { StackingView } from '@/components/StackingView';
import { TrustCenter } from '@/components/TrustCenter';
import { useTheme } from '@/components/theme-provider';
import { EMPTY_PROFILE, normalizeProfile, type Profile } from '@/lib/planner';
import type { EdgesFile, GraphEdge } from '@/lib/pathfinder';
import { clearStoredProfile, LEGACY_FLAGS_KEY, PROFILE_KEY } from '@/lib/profile-storage';
import { cn } from '@/lib/utils';
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
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [detailPanelOpen, setDetailPanelOpen] = useState(Boolean(initialState.country));
  const [routePanelOpen, setRoutePanelOpen] = useState(false);
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

  useEffect(() => {
    if (state.blocs.length === 0 && !state.lane) setRoutePanelOpen(false);
  }, [state.blocs.length, state.lane]);

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
    setRoutePanelOpen(false);
    patch({ blocs: [], lane: null, country: null, countryName: null });
  }, [patch]);
  const selectView = useCallback((v: 'map' | 'stacking') =>
    patch({ view: v }), [patch]);
  const selectCountry = useCallback((iso: string, name: string) => {
    setRoutePanelOpen(false);
    setDetailPanelOpen(true);
    patch({ country: iso, countryName: name });
  }, [patch]);
  const closeDetail = useCallback(() => {
    setDetailPanelOpen(false);
    patch({ country: null, countryName: null });
  }, [patch]);
  const backToMapWithBloc = useCallback((blocId: string | null) => {
    if (blocId === null) {
      patch({ view: 'map' });
    } else {
      patch({ view: 'map', blocs: [blocId], lane: null, country: null, countryName: null });
    }
  }, [patch]);
  const inspectRouteSelection = useCallback(() => {
    setMobileList(false);
    setRoutePanelOpen(true);
  }, []);

  const hasRouteSelection = state.blocs.length > 0 || Boolean(state.lane);
  const rightPanelOpen = state.country ? detailPanelOpen : hasRouteSelection && routePanelOpen;

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
        <div className="ml-auto flex shrink-0 items-center rounded-xl border bg-background/65 p-0.5 shadow-sm backdrop-blur-md">
          {data && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hidden text-muted-foreground sm:inline-flex"
                    aria-label="Show access-level key"
                  >
                    <Layers3 aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px]">
                  <div className="flex flex-col gap-1.5 text-xs">
                    <span><b>TR</b> — {data.meta.tier_legend.TR}</span>
                    <span><b>PR</b> — {data.meta.tier_legend.PR}</span>
                    <span><b>CIT</b> — {data.meta.tier_legend.CIT}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="sm"
                className="size-9 gap-1.5 p-0 text-xs text-muted-foreground sm:h-7 sm:w-auto sm:px-2"
                aria-label="Open trust and data"
                onClick={() => changeInfo('methodology')}
              >
                <ShieldCheck className="size-3" aria-hidden />
                <span className="hidden sm:inline">Trust</span>
              </Button>
            </>
          )}
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="size-9 gap-1.5 p-0 text-xs text-muted-foreground sm:h-7 sm:w-auto sm:px-2"
          >
            <a
              href="https://t.me/flagpaths"
              target="_blank"
              rel="noreferrer"
              aria-label="Join Flag Paths updates on Telegram"
            >
              <Send className="size-3" aria-hidden />
              <span className="hidden sm:inline">Updates</span>
            </a>
          </Button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground max-sm:size-9"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {data && (
          <div
            className={cn(
              'absolute inset-y-0 left-0 z-20 hidden w-[280px] overflow-hidden border-r bg-sidebar shadow-xl transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none md:block',
              !leftPanelOpen && '-translate-x-full',
            )}
            aria-hidden={!leftPanelOpen}
            inert={!leftPanelOpen}
          >
            <Sidebar
              data={data}
              state={state}
              onBloc={toggleBloc}
              onLane={selectLane}
              onClear={clearMapSelection}
              onInspect={inspectRouteSelection}
            />
          </div>
        )}
        <div id="map-wrap" className="cartographic-surface relative min-w-0 flex-1 overflow-hidden">
          <WorldMap data={data} state={state} theme={theme} profile={profile} onSelect={selectCountry} />
          {data && state.view === 'map' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={cn(
                    'absolute top-3 left-3 z-30 hidden bg-background/85 text-muted-foreground shadow-sm backdrop-blur-md transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none md:inline-flex',
                    leftPanelOpen && 'translate-x-[280px]',
                  )}
                  aria-label={leftPanelOpen ? 'Hide route browser' : 'Show route browser'}
                  aria-expanded={leftPanelOpen}
                  onClick={() => setLeftPanelOpen(open => !open)}
                >
                  {leftPanelOpen ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {leftPanelOpen ? 'Hide route browser' : 'Show route browser'}
              </TooltipContent>
            </Tooltip>
          )}
          {data && state.view === 'map' && mobileList && (
            <div className="absolute inset-0 z-10 bg-background md:hidden">
              <Sidebar
                data={data}
                state={state}
                onBloc={toggleBloc}
                onLane={selectLane}
                onClear={clearMapSelection}
                onInspect={inspectRouteSelection}
              />
            </div>
          )}
          {data && state.view === 'map' && (
            <div
              className={cn(
                'absolute left-1/2 z-20 flex -translate-x-1/2 gap-2 transition-[bottom] md:hidden',
                mobileList && hasRouteSelection
                  ? 'bottom-[max(4.75rem,calc(env(safe-area-inset-bottom)+4.25rem))]'
                  : 'bottom-[max(1rem,env(safe-area-inset-bottom))]',
              )}
            >
              <Button
                variant="secondary"
                size="sm"
                className="min-h-11 gap-2 px-4 shadow-lg"
                onClick={() => setMobileList(v => !v)}
              >
                {mobileList ? <MapIcon /> : <List />}
                {mobileList ? 'Map' : 'List'}
              </Button>
              {!mobileList && hasRouteSelection && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-2 bg-background/90 px-4 shadow-lg backdrop-blur-sm"
                  onClick={inspectRouteSelection}
                >
                  <PanelRightOpen aria-hidden />
                  Details
                </Button>
              )}
            </div>
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
          {data && state.view === 'map' && (
            (state.country && !detailPanelOpen)
            || (!state.country && hasRouteSelection && !routePanelOpen)
          ) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-3 right-3 z-20 hidden gap-1.5 bg-background/85 text-muted-foreground shadow-sm backdrop-blur-md md:inline-flex"
                  onClick={() => {
                    if (state.country) setDetailPanelOpen(true);
                    else inspectRouteSelection();
                  }}
                >
                  <PanelRightOpen aria-hidden />
                  Details
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {state.country ? 'Show country details' : 'Show selected route details'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {data && state.view === 'map' && (state.country || hasRouteSelection) && (
          <>
            {rightPanelOpen && (
              <div className="absolute inset-0 z-40 bg-background md:hidden">
                {state.country ? (
                  <DetailPanel
                    data={data}
                    citizenshipRoutes={citizenshipRoutes}
                    state={state}
                    onClose={closeDetail}
                  />
                ) : (
                  <RouteDetailPanel
                    data={data}
                    blocIds={state.blocs}
                    laneId={state.lane}
                    onClose={() => setRoutePanelOpen(false)}
                  />
                )}
              </div>
            )}
            <div
              className={cn(
                'absolute inset-y-0 right-0 z-30 hidden w-[370px] overflow-hidden border-l bg-background shadow-xl transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none md:block xl:w-[390px]',
                !rightPanelOpen && 'translate-x-full',
              )}
              aria-hidden={!rightPanelOpen}
              inert={!rightPanelOpen}
            >
              {state.country ? (
                <DetailPanel
                  data={data}
                  citizenshipRoutes={citizenshipRoutes}
                  state={state}
                  onClose={closeDetail}
                  onCollapse={() => setDetailPanelOpen(false)}
                />
              ) : (
                <RouteDetailPanel
                  data={data}
                  blocIds={state.blocs}
                  laneId={state.lane}
                  onClose={() => setRoutePanelOpen(false)}
                />
              )}
            </div>
          </>
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

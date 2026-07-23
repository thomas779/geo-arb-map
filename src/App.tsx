import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
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
import type { AppState, BlocsData, CitizenshipRoutesData, DataReleaseMeta } from './types';
import * as url from './url';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sidebar } from '@/components/Sidebar';
import { WorldMap } from '@/components/WorldMap';
import { DetailPanel } from '@/components/DetailPanel';
import { RouteDetailPanel } from '@/components/RouteDetailPanel';
import { PlannerPreview } from '@/components/PlannerPreview';
import { TrustCenter } from '@/components/TrustCenter';
import { useTheme } from '@/components/theme-provider';
import { EMPTY_PROFILE, normalizeProfile, type Profile } from '@/lib/planner';
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

function BrandMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      className="size-8 shrink-0"
      fill="none"
    >
      <path
        d="M5.5 24.5c0-7.2 4.1-9.8 9.1-9.8 5.8 0 6.1-7.2 11.9-7.2"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="5.5" cy="24.5" r="3" className="fill-card stroke-foreground" strokeWidth="1.5" />
      <circle cx="26.5" cy="7.5" r="3" className="fill-primary stroke-card" strokeWidth="1.5" />
    </svg>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [data, setData] = useState<BlocsData | null>(null);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [citizenshipRoutes, setCitizenshipRoutes] = useState<CitizenshipRoutesData | null>(null);
  const [dataRelease, setDataRelease] = useState<DataReleaseMeta | null>(null);
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

  const dataStatus = useMemo(() => {
    const evidenceDates = [
      data?.meta.last_verified,
      citizenshipRoutes?.meta.last_updated,
      dataRelease?.generated_at.slice(0, 10),
      ...((citizenshipRoutes?.routes ?? []).map(route => route.last_checked)),
    ].filter((date): date is string => Boolean(date));
    evidenceDates.sort();
    const updatedAt = evidenceDates[evidenceDates.length - 1] ?? '—';
    const jurisdictions = citizenshipRoutes?.meta.counts.jurisdictions ?? 0;
    // Uninhabited entries with no permanent population confer no nationality, so
    // they are excluded from the coverage denominator (not from the tracked map).
    const NON_APPLICABLE_JURISDICTIONS = new Set(['086', '239', '260', '334']);
    const applicableJurisdictions = citizenshipRoutes?.jurisdictions.filter(jurisdiction =>
      !NON_APPLICABLE_JURISDICTIONS.has(jurisdiction.iso_n3),
    ).length ?? 0;
    const reviewedJurisdictions = citizenshipRoutes?.jurisdictions.filter(jurisdiction =>
      Object.values(jurisdiction.coverage).every(state => state === 'reviewed'),
    ).length ?? 0;
    const reviewedModes = citizenshipRoutes?.jurisdictions.reduce(
      (count, jurisdiction) => count
        + Object.values(jurisdiction.coverage).filter(state => state === 'reviewed').length,
      0,
    ) ?? 0;

    return {
      updatedAt,
      jurisdictions,
      applicableJurisdictions,
      reviewedJurisdictions,
      reviewedModes,
      totalModes: jurisdictions * 4,
      countryRules: citizenshipRoutes?.meta.counts.routes ?? 0,
    };
  }, [citizenshipRoutes, data, dataRelease]);

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
    fetch(import.meta.env.BASE_URL + 'citizenship_routes.json')
      .then(res => res.json())
      .then((routes: CitizenshipRoutesData) => setCitizenshipRoutes(routes))
      .catch(err => console.error('Failed to load citizenship_routes.json:', err));
    fetch(import.meta.env.BASE_URL + 'data_release.json')
      .then(res => res.json())
      .then((release: DataReleaseMeta) => setDataRelease(release))
      .catch(err => console.error('Failed to load data_release.json:', err));
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
    if (state.country === iso) {
      setDetailPanelOpen(open => !open);
      return;
    }
    setDetailPanelOpen(true);
    patch({ country: iso, countryName: name });
  }, [patch, state.country]);
  const closeDetail = useCallback(() => {
    setDetailPanelOpen(false);
    patch({ country: null, countryName: null });
  }, [patch]);
  const inspectRouteSelection = useCallback(() => {
    setMobileList(false);
    setRoutePanelOpen(true);
  }, []);
  const backToRouteSelection = useCallback(() => {
    setDetailPanelOpen(false);
    setRoutePanelOpen(true);
    patch({ country: null, countryName: null });
  }, [patch]);

  const hasRouteSelection = state.blocs.length > 0 || Boolean(state.lane);
  const rightPanelOpen = state.country ? detailPanelOpen : hasRouteSelection && routePanelOpen;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b bg-card/90 px-2.5 backdrop-blur-sm sm:h-16 sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark />
          <div className="hidden min-w-0 sm:block">
            <h1 className="whitespace-nowrap font-heading text-xl font-bold tracking-[-0.035em] sm:text-[1.45rem]">
              Flag Paths
              <span className="sr-only"> — citizenship and residency paths atlas</span>
            </h1>
            <span className="hidden font-mono text-[8px] font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:block">
              Mobility atlas
            </span>
          </div>
        </div>
        <nav aria-label="Primary" className="flex shrink-0 items-center gap-4 sm:gap-6">
          {([['map', 'Atlas'], ['stacking', 'Planner']] as const).map(([v, label]) => (
            <button
              key={v}
              aria-current={state.view === v ? 'page' : undefined}
              aria-label={v === 'stacking' ? 'Planner — coming soon' : label}
              className={cn(
                'relative flex h-9 items-center justify-center text-xs font-semibold outline-none transition-colors focus-visible:text-primary',
                state.view === v ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => selectView(v)}
            >
              {label}
              {state.view === v && (
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {data && (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hidden h-8 min-w-8 gap-1.5 px-2 text-xs text-muted-foreground sm:inline-flex"
                    aria-label="Open access levels"
                  >
                    <Layers3 aria-hidden />
                    <span className="hidden lg:inline">Rights</span>
                    <ChevronDown className="hidden size-3 lg:block" aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(360px,calc(100vw-24px))] overflow-hidden p-0">
                  <div className="border-b px-4 py-3.5">
                    <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-primary">
                      Map legend
                    </p>
                    <div className="mt-1 flex items-baseline justify-between gap-4">
                      <p className="font-heading text-lg font-semibold">Access levels</p>
                      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Less → more</p>
                    </div>
                  </div>
                  <div className="divide-y">
                    {([
                      ['TR', 'Temporary residence', 'Time-limited residence and attached work rights.'],
                      ['PR', 'Permanent residence', 'Durable settlement rights without citizenship.'],
                      ['CIT', 'Citizenship', 'Nationality, passport, and political rights.'],
                    ] as const).map(([tier, title, detail], index) => (
                      <div key={tier} className="grid grid-cols-[34px_48px_1fr] items-center gap-3 px-4 py-3.5">
                        <span className="font-mono text-[11px] font-semibold text-foreground">
                          {tier}
                        </span>
                        <span className="flex gap-1" aria-label={`Level ${index + 1} of 3`}>
                          {[0, 1, 2].map(step => (
                            <span
                              key={step}
                              aria-hidden
                              className={cn(
                                'h-1.5 w-3 rounded-full',
                                step <= index ? 'bg-primary' : 'bg-muted',
                              )}
                            />
                          ))}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-foreground">{title}</span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{detail}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="border-t bg-muted/25 px-4 py-2.5 text-[10px] text-muted-foreground">
                    Exact rights vary by country and permit.
                  </p>
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="sm"
                className="size-9 gap-1.5 p-0 text-xs text-muted-foreground sm:h-8 sm:w-[78px] sm:px-2"
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
            className="size-9 gap-1.5 p-0 text-xs text-muted-foreground sm:h-8 sm:w-[88px] sm:px-2"
          >
            <a
              href="https://t.me/flagpaths"
              target="_blank"
              rel="noreferrer"
              aria-label="Join Flag Paths updates on Telegram"
            >
              <Send className="size-3" aria-hidden />
              <span className="hidden items-center gap-1 sm:flex">
                Updates
                <ExternalLink className="size-2.5" aria-hidden />
              </span>
            </a>
          </Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
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
        {data && state.view === 'map' && (
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
                  ? 'bottom-[max(7rem,calc(env(safe-area-inset-bottom)+6.5rem))]'
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
                  Route guide
                </Button>
              )}
            </div>
          )}
          {data && state.view === 'stacking' && (
            <PlannerPreview data={data} onBackToAtlas={() => selectView('map')} />
          )}
          {data && (
            <button
              className="absolute right-3 bottom-3 z-10 hidden items-center gap-1.5 rounded-full border bg-background/90 px-2.5 py-1 font-mono text-xs text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground sm:inline-flex"
              aria-label={`Data evidence updated ${dataStatus.updatedAt}. Open methodology.`}
              onClick={() => changeInfo('methodology')}
            >
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-verified/55 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-verified" />
              </span>
              <span>updated&nbsp;·&nbsp;{dataStatus.updatedAt}</span>
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
                  {state.country ? 'Country guide' : 'Route guide'}
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
                    onBackToRoutes={hasRouteSelection ? backToRouteSelection : undefined}
                  />
                ) : (
                  <RouteDetailPanel
                    data={data}
                    blocIds={state.blocs}
                    laneId={state.lane}
                    onClose={() => setRoutePanelOpen(false)}
                    onSelectCountry={selectCountry}
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
                  onBackToRoutes={hasRouteSelection ? backToRouteSelection : undefined}
                />
              ) : (
                <RouteDetailPanel
                  data={data}
                  blocIds={state.blocs}
                  laneId={state.lane}
                  onClose={() => setRoutePanelOpen(false)}
                  onSelectCountry={selectCountry}
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
          dataStatus={dataStatus}
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

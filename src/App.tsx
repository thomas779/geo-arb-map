import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
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
import type { AppState, BlocsData, AtlasIndexData, CountrySliceData, DataReleaseMeta } from './types';
import * as url from './url';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sidebar } from '@/components/Sidebar';
import { ROUTE_CLASSES, isosForRouteClass, routeClassById } from '@/lib/route-classes';
import { WorldMap } from '@/components/WorldMap';
import { DetailPanel } from '@/components/DetailPanel';
import { RouteDetailPanel } from '@/components/RouteDetailPanel';
import { MobileDetailSheet } from '@/components/MobileDetailSheet';
import { PlannerPreview } from '@/components/PlannerPreview';
import { CountriesList } from '@/components/CountriesList';
import { CountryProfile, deriveCountryProfile } from '@/components/CountryProfile';
import {
  RightsProfile,
  RightsList,
  deriveBlocProfile,
} from '@/components/RightsProfile';
import { buildSlugToIso, buildEntitySlugToId } from '@/lib/slug';
import { isNonApplicableJurisdiction } from '@/lib/country';
import { TrustCenter } from '@/components/TrustCenter';
import { useTheme } from '@/components/theme-provider';
import { EMPTY_PROFILE, normalizeProfile, type Profile } from '@/lib/planner';
import { clearStoredProfile, LEGACY_FLAGS_KEY, PROFILE_KEY } from '@/lib/profile-storage';
import { cn } from '@/lib/utils';
import { SiteHeader } from '@/components/SiteHeader';
import { AtlasGuide } from '@/components/AtlasGuide';
import { AtlasTour } from '@/components/AtlasTour';
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
  routeClass: null,
  country: null,
  countryName: null,
  ...url.read(),
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [data, setData] = useState<BlocsData | null>(null);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [citizenshipRoutes, setCitizenshipRoutes] = useState<AtlasIndexData | null>(null);
  const [countrySlice, setCountrySlice] = useState<CountrySliceData | null>(null);
  const [dataRelease, setDataRelease] = useState<DataReleaseMeta | null>(null);
  const [infoSection, setInfoSection] = useState<TrustSection | null>(() => url.readInfo());
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(Boolean(initialState.country));
  // Open on load when a shared/deep-linked selection is present (there's no
  // separate "open panel" affordance now — selection and panel are one).
  const [routePanelOpen, setRoutePanelOpen] = useState(
    Boolean(initialState.lane) || Boolean(initialState.routeClass) || initialState.blocs.length > 0,
  );
  const [tourOpen, setTourOpen] = useState(false);
  // Portrait phones browse a LIST first; the map is on demand. Shared links
  // with a selection land straight on the framed map.
  const [mobileList, setMobileList] = useState<boolean>(
    initialState.blocs.length === 0 && !initialState.lane && !initialState.routeClass && !initialState.country,
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
    const applicableJurisdictions = citizenshipRoutes?.jurisdictions.filter(jurisdiction =>
      !isNonApplicableJurisdiction(jurisdiction.iso_n3),
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
    // A missing JSON is served as index.html (HTTP 200) by the SPA fallback, so
    // check status + content-type — otherwise a failed data upload silently
    // renders a blank-but-plausible atlas instead of surfacing an error.
    const fetchJson = async <T,>(file: string): Promise<T> => {
      const res = await fetch(import.meta.env.BASE_URL + file);
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('json')) throw new Error(`${file}: ${res.status} (${type || 'no content-type'})`);
      return res.json() as Promise<T>;
    };
    fetchJson<BlocsData>('blocs_data.json')
      .then((d) => {
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
      .catch(err => { console.error('Failed to load blocs_data.json:', err); setLoadError(true); });
    fetchJson<AtlasIndexData>('atlas-index.json')
      .then((routes) => setCitizenshipRoutes(routes))
      .catch(err => { console.error('Failed to load atlas-index.json:', err); setLoadError(true); });
    fetchJson<DataReleaseMeta>('data_release.json')
      .then((release) => setDataRelease(release))
      .catch(err => { console.error('Failed to load data_release.json:', err); setLoadError(true); });
  }, []);

  // The country profile is the only view that needs prose bodies, so it pulls
  // that one country's slice (~3KB gzipped) instead of the browser preloading
  // all 240 jurisdictions of detail up front.
  const countrySlug = state.view === 'countries'
    ? /^\/country\/([^/]+)\/?$/.exec(window.location.pathname)?.[1] ?? null
    : null;
  useEffect(() => {
    if (!countrySlug) {
      setCountrySlice(null);
      return;
    }
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}country/${countrySlug}/data.json`)
      .then(res => {
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.includes('json')) throw new Error(`slice ${countrySlug}: ${res.status}`);
        return res.json() as Promise<CountrySliceData>;
      })
      .then(slice => { if (!cancelled) setCountrySlice(slice); })
      .catch(err => { if (!cancelled) { console.error('Failed to load country slice:', err); setCountrySlice(null); } });
    return () => { cancelled = true; };
  }, [countrySlug]);

  useEffect(() => {
    url.sync(state);
  }, [state]);

  useEffect(() => {
    if (state.blocs.length === 0 && !state.lane && !state.routeClass) setRoutePanelOpen(false);
  }, [state.blocs.length, state.lane, state.routeClass]);

  const patch = useCallback((p: Partial<AppState>) => {
    setState(s => ({ ...s, ...p }));
  }, []);

  /** Toggle a bloc in the compare set; null clears the whole selection. */
  const toggleBloc = useCallback((id: string | null) => {
    setMobileList(false);
    // Picking a route auto-opens the detail panel (desktop: docks instantly;
    // mobile: the bottom sheet slides up after the map's zoom, see the sheet's
    // transition delay) so the details are never hidden behind a second click.
    if (id !== null) setRoutePanelOpen(true);
    setState(s => ({
      ...s,
      view: 'map', // selecting from the sidebar always shows the map
      blocs: id === null
        ? []
        : s.blocs.includes(id) ? s.blocs.filter(b => b !== id) : [...s.blocs, id],
      lane: null,
      routeClass: null,
      country: null,
      countryName: null,
    }));
  }, []);
  const selectLane = useCallback((id: string | null) => {
    setMobileList(false);
    if (id !== null) setRoutePanelOpen(true);
    patch({ view: 'map', lane: id, blocs: [], routeClass: null, country: null, countryName: null });
  }, [patch]);
  /** Route-class browse (#129). Single-select; re-picking the active class clears it. */
  const selectRouteClass = useCallback((id: string | null) => {
    setMobileList(false);
    if (id !== null) setRoutePanelOpen(true);
    setState(s => ({
      ...s,
      view: 'map',
      routeClass: id === null || s.routeClass === id ? null : id,
      blocs: [],
      lane: null,
      country: null,
      countryName: null,
    }));
  }, []);
  const clearMapSelection = useCallback(() => {
    setRoutePanelOpen(false);
    patch({ blocs: [], lane: null, routeClass: null, country: null, countryName: null });
  }, [patch]);
  const selectView = useCallback((v: AppState['view']) =>
    patch({ view: v }), [patch]);
  const selectCountry = useCallback((iso: string, name: string) => {
    setMobileList(false);
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

  // Route-class browse (#129): the painted ISO set and per-class country counts,
  // derived from the same public data the country pages render.
  const routeClassIsos = useMemo(() => {
    const cls = routeClassById(state.routeClass);
    return cls && citizenshipRoutes ? isosForRouteClass(cls, citizenshipRoutes) : null;
  }, [state.routeClass, citizenshipRoutes]);
  const routeClassCounts = useMemo(() => {
    if (!citizenshipRoutes) return new Map<string, number>();
    return new Map(ROUTE_CLASSES.map(cls => [cls.id, isosForRouteClass(cls, citizenshipRoutes).all.size]));
  }, [citizenshipRoutes]);

  const hasRouteSelection = state.blocs.length > 0 || Boolean(state.lane) || Boolean(state.routeClass);
  const rightPanelOpen = state.country ? detailPanelOpen : hasRouteSelection && routePanelOpen;
  const startCountrySearch = useCallback(() => {
    setLeftPanelOpen(true);
    setMobileList(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const search = Array.from(document.querySelectorAll<HTMLInputElement>('[data-atlas-search]'))
          .find(input => input.getClientRects().length > 0);
        search?.focus();
      });
    });
  }, []);
  const prepareTourStep = useCallback((step: number) => {
    if (step < 2) {
      setLeftPanelOpen(true);
      setMobileList(true);
    } else {
      setMobileList(false);
    }
  }, []);

  const selectionPrompt = useMemo(() => {
    if (state.routeClass) {
      const routeClass = routeClassById(state.routeClass);
      const count = routeClassIsos?.all.size ?? 0;
      return routeClass ? `${routeClass.label} · ${count} highlighted` : null;
    }
    if (state.blocs.length) {
      const selected = data?.blocs.filter(bloc => state.blocs.includes(bloc.id)) ?? [];
      const members = new Set(selected.flatMap(bloc => bloc.members.map(member => member.iso_n3))).size;
      return `${selected.length === 1 ? selected[0].name : `${selected.length} regional systems`} · ${members} highlighted`;
    }
    if (state.lane) {
      const lane = data?.bilateral_lanes.find(item => item.id === state.lane);
      return lane ? `${lane.name} · destination highlighted` : null;
    }
    return null;
  }, [data, routeClassIsos, state.blocs, state.lane, state.routeClass]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {loadError && (
        <div role="alert" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          Some map data failed to load.{' '}
          <button type="button" onClick={() => window.location.reload()} className="underline">Reload</button>
        </div>
      )}
      <SiteHeader
        active={
          state.view === 'stacking' ? 'planner'
            : state.view === 'countries' ? 'countries'
              : state.view === 'rights' ? 'rights'
                : 'atlas'
        }
        onSelectView={selectView}
        right={(
          <>
          {data && (
            <>
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
          {state.view === 'map' && (
            <AtlasGuide
              autoOpen={!state.country && !hasRouteSelection}
              onSearchCountry={startCountrySearch}
              onStartTour={() => setTourOpen(true)}
            />
          )}
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
          </>
        )}
      />
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
              onRouteClass={selectRouteClass}
              routeClassCounts={routeClassCounts}
              citizenshipRoutes={citizenshipRoutes}
              onCountry={selectCountry}
            />
          </div>
        )}
        <div id="map-wrap" data-tour="map" className="cartographic-surface relative min-w-0 flex-1 overflow-hidden">
          <WorldMap
            data={data}
            state={state}
            theme={theme}
            profile={profile}
            onSelect={selectCountry}
            routeClassIsos={routeClassIsos}
            dataUpdatedAt={dataStatus.updatedAt}
            onOpenInfo={() => changeInfo('methodology')}
          />
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
          {data && state.view === 'map' && selectionPrompt && !state.country && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-[19] hidden -translate-x-1/2 md:block">
              <div className="rounded-lg border bg-background/92 px-3 py-2 text-center shadow-md backdrop-blur-md">
                <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">Next</p>
                <p className="mt-0.5 text-xs font-semibold text-foreground">Choose a highlighted country</p>
                <p className="mt-0.5 max-w-64 truncate text-[10px] text-muted-foreground">{selectionPrompt}</p>
              </div>
            </div>
          )}
          {data && state.view === 'map' && mobileList && (
            <div className="absolute inset-0 z-10 bg-background md:hidden">
              <Sidebar
                data={data}
                state={state}
                onBloc={toggleBloc}
                onLane={selectLane}
                onRouteClass={selectRouteClass}
                routeClassCounts={routeClassCounts}
                citizenshipRoutes={citizenshipRoutes}
                onCountry={selectCountry}
              />
            </div>
          )}
          {data && state.view === 'map' && (
            // Bottom-LEFT so it never overlaps the bottom-right Map Key.
            <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 z-20 md:hidden">
              <Button
                variant="secondary"
                size="sm"
                className="min-h-11 gap-2 px-4 shadow-lg"
                onClick={() => setMobileList(v => !v)}
              >
                {mobileList ? <MapIcon /> : <List />}
                {mobileList ? 'Map' : 'List'}
              </Button>
            </div>
          )}
          {data && state.view === 'stacking' && (
            <PlannerPreview data={data} />
          )}
          {state.view === 'countries' && (() => {
            // Rebuild the corpus shape deriveCountryProfile expects from the
            // index meta plus this one country's slice.
            const jurisdiction = countrySlice?.jurisdiction ?? null;
            const profile = jurisdiction && citizenshipRoutes && data
              ? deriveCountryProfile(jurisdiction.iso_n3, {
                  meta: citizenshipRoutes.meta,
                  jurisdictions: [jurisdiction],
                  routes: countrySlice!.routes,
                  residence_routes: countrySlice!.residence_routes,
                }, data)
              : null;
            return (
              <div className="absolute inset-0 z-30 overflow-y-auto bg-background">
                {profile
                  ? <CountryProfile data={profile} />
                  : <CountriesList citizenshipRoutes={citizenshipRoutes} />}
              </div>
            );
          })()}
          {state.view === 'rights' && data && (() => {
            const slug = /^\/rights\/([^/]+)\/?$/.exec(window.location.pathname)?.[1] ?? null;
            const id = slug ? buildEntitySlugToId(data.blocs).get(slug) : null;
            const profile = id && citizenshipRoutes ? deriveBlocProfile(id, data, citizenshipRoutes) : null;
            return (
              <div className="absolute inset-0 z-30 overflow-y-auto bg-background">
                {profile ? <RightsProfile data={profile} /> : <RightsList mobility={data} />}
              </div>
            );
          })()}
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
              <MobileDetailSheet onDismiss={clearMapSelection}>
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
                    routeClassId={state.routeClass}
                    citizenshipRoutes={citizenshipRoutes}
                    onClose={clearMapSelection}
                    onSelectCountry={selectCountry}
                  />
                )}
              </MobileDetailSheet>
            )}
            <div
              className={cn(
                'absolute inset-y-0 right-0 z-30 hidden w-[400px] overflow-hidden border-l bg-background shadow-xl transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none md:block xl:w-[420px]',
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
                  routeClassId={state.routeClass}
                  citizenshipRoutes={citizenshipRoutes}
                  onClose={clearMapSelection}
                  onSelectCountry={selectCountry}
                />
              )}
            </div>
          </>
        )}
      </main>
      <AtlasTour open={tourOpen && state.view === 'map'} onOpenChange={setTourOpen} onStepChange={prepareTourStep} />
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

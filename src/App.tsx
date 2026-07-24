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
import type { AppState, BlocsData, CitizenshipRoutesData, DataReleaseMeta } from './types';
import * as url from './url';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sidebar } from '@/components/Sidebar';
import { WorldMap } from '@/components/WorldMap';
import { DetailPanel } from '@/components/DetailPanel';
import { RouteDetailPanel } from '@/components/RouteDetailPanel';
import { PlannerPreview } from '@/components/PlannerPreview';
import { CountriesList } from '@/components/CountriesList';
import { CountryProfile, deriveCountryProfile } from '@/components/CountryProfile';
import {
  RightsProfile,
  RightsList,
  RouteList,
  deriveBlocProfile,
  deriveRouteProfile,
} from '@/components/RightsProfile';
import { buildSlugToIso, buildEntitySlugToId } from '@/lib/slug';
import { TrustCenter } from '@/components/TrustCenter';
import { useTheme } from '@/components/theme-provider';
import { EMPTY_PROFILE, normalizeProfile, type Profile } from '@/lib/planner';
import { clearStoredProfile, LEGACY_FLAGS_KEY, PROFILE_KEY } from '@/lib/profile-storage';
import { cn } from '@/lib/utils';
import { SiteHeader } from '@/components/SiteHeader';
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
      country: null,
      countryName: null,
    }));
  }, []);
  const selectLane = useCallback((id: string | null) => {
    setMobileList(false);
    if (id !== null) setRoutePanelOpen(true);
    patch({ view: 'map', lane: id, blocs: [], country: null, countryName: null });
  }, [patch]);
  const clearMapSelection = useCallback(() => {
    setRoutePanelOpen(false);
    patch({ blocs: [], lane: null, country: null, countryName: null });
  }, [patch]);
  const selectView = useCallback((v: AppState['view']) =>
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
      <SiteHeader
        active={
          state.view === 'stacking' ? 'planner'
            : state.view === 'countries' ? 'countries'
              : state.view === 'rights' ? 'rights'
                : state.view === 'route' ? 'route'
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
            />
          </div>
        )}
        <div id="map-wrap" className="cartographic-surface relative min-w-0 flex-1 overflow-hidden">
          <WorldMap
            data={data}
            state={state}
            theme={theme}
            profile={profile}
            onSelect={selectCountry}
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
            </div>
          )}
          {data && state.view === 'stacking' && (
            <PlannerPreview data={data} />
          )}
          {state.view === 'countries' && (() => {
            const slug = /^\/country\/([^/]+)\/?$/.exec(window.location.pathname)?.[1] ?? null;
            const iso = slug && citizenshipRoutes
              ? buildSlugToIso(citizenshipRoutes.jurisdictions).get(slug)
              : null;
            const profile = iso && citizenshipRoutes && data
              ? deriveCountryProfile(iso, citizenshipRoutes, data)
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
          {state.view === 'route' && data && (() => {
            const slug = /^\/route\/([^/]+)\/?$/.exec(window.location.pathname)?.[1] ?? null;
            const id = slug ? buildEntitySlugToId(data.bilateral_lanes).get(slug) : null;
            const profile = id && citizenshipRoutes ? deriveRouteProfile(id, data, citizenshipRoutes) : null;
            return (
              <div className="absolute inset-0 z-30 overflow-y-auto bg-background">
                {profile ? <RightsProfile data={profile} /> : <RouteList mobility={data} />}
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
            {/* Mobile: a bottom sheet — the map (zoomed to the selection) peeks
                above a light scrim, and the sheet slides up after a short beat
                so the zoom reads first. Tap the map / scrim to dismiss. */}
            {rightPanelOpen && (
              <div className="absolute inset-0 z-40 md:hidden">
                <button
                  type="button"
                  aria-label="Close details"
                  className="absolute inset-0 bg-background/30 animate-in fade-in duration-200 motion-reduce:animate-none"
                  onClick={clearMapSelection}
                />
                <div className="absolute inset-x-0 bottom-0 top-[36%] flex flex-col overflow-hidden rounded-t-2xl border-t bg-background shadow-2xl animate-in slide-in-from-bottom fill-mode-both delay-150 duration-300 motion-reduce:animate-none motion-reduce:delay-0">
                  <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" aria-hidden />
                  <div className="min-h-0 flex-1 overflow-hidden">
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
                        onClose={clearMapSelection}
                        onSelectCountry={selectCountry}
                      />
                    )}
                  </div>
                </div>
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
                  onClose={clearMapSelection}
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

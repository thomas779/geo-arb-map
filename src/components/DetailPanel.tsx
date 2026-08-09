import { ArrowLeft, ChevronRight, ExternalLink, PanelRightClose, X } from 'lucide-react';
import type {
  AppState,
  BilateralLane,
  BlocsData,
  CitizenshipAcquisitionMode,
  CitizenshipCoverageState,
  CitizenshipRoute,
  CitizenshipRouteSummary,
  ResidenceRouteSummary,
  AtlasIndexData,
  ResidenceRoute,
} from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { countryFlag } from '@/lib/country';
import { displayRouteTitle } from '@/lib/display-title';
import { dataCorrectionUrl } from '@/lib/trust';
import { buildCountrySlugMap, entitySlug } from '@/lib/slug';
import { RESIDENCE_CATEGORY_SHORT, residenceCardRoutes, residenceLadderBadges } from '@/lib/residence';

/*
 * The country panel is a SUMMARY companion to the map — a quick look that funnels
 * to the full page for depth. It shows the coverage grid, compact route titles,
 * and regional/treaty chips (linking to their own pages). Full descriptions,
 * sources, residence detail, and rights ladders live on the standalone pages
 * (CountryProfile / RightsProfile), so the two don't duplicate each other.
 */

interface Props {
  data: BlocsData;
  citizenshipRoutes: AtlasIndexData | null;
  state: AppState;
  onClose: () => void;
  onCollapse?: () => void;
  onBackToRoutes?: () => void;
}

const MODE_LABELS: Record<CitizenshipAcquisitionMode, string> = {
  ancestry: 'Ancestry',
  naturalization: 'Naturalization',
  birth: 'Birth',
  investment: 'Investment',
};

const COVERAGE_LABELS: Record<CitizenshipCoverageState, string> = {
  reviewed: 'reviewed',
  partial: 'partial',
  pending: 'pending',
  unchecked: 'not reviewed',
};

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <div id={id} className="mb-2 mt-6 scroll-mt-36">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function CoverageStrip({
  coverage,
}: {
  coverage: Record<CitizenshipAcquisitionMode, CitizenshipCoverageState>;
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
      {(Object.keys(MODE_LABELS) as CitizenshipAcquisitionMode[]).map(mode => {
        const state = coverage[mode];
        return (
          <div key={mode} className="flex items-center justify-between gap-2 bg-card px-2.5 py-2 text-xs">
            <span>{MODE_LABELS[mode]}</span>
            <span className={state === 'unchecked' ? 'text-muted-foreground/65' : 'font-medium text-foreground'}>
              {COVERAGE_LABELS[state]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The badge earns attention only when it carries a caveat. 592 of 872 routes are
 * high-confidence and active, and stamping "verified" on that majority trained
 * readers to skip the badge — so the 278 medium and 2 low ones, the rows that
 * actually need a second look, stopped landing. Returning null renders nothing.
 */
function statusLabel(route: CitizenshipRouteSummary): string | null {
  if (route.status === 'inactive') return 'ended';
  if (route.status === 'pending_verification') return 'verification pending';
  return route.confidence === 'high' ? null : `${route.confidence} confidence`;
}

/** Compact, non-expandable route row — title + mode + status; detail lives on the page. */
function RouteRow({ route, countrySlug }: { route: CitizenshipRouteSummary; countrySlug?: string }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {MODE_LABELS[route.mode]}
        </span>
        <span className="block truncate text-sm font-medium leading-snug">{displayRouteTitle(route.title)}</span>
      </span>
      {statusLabel(route) && (
        <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[9px]">
          {statusLabel(route)}
        </Badge>
      )}
      {countrySlug && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );
  return countrySlug ? (
    <a
      href={`/country/${countrySlug}/#route-${encodeURIComponent(route.id)}`}
      className="flex min-h-12 items-center gap-2 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-primary/55 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      aria-label={`Read requirements and sources for ${displayRouteTitle(route.title)}`}
    >
      {body}
    </a>
  ) : (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">{body}</div>
  );
}

function ResidenceRow({ route, countrySlug }: { route: ResidenceRouteSummary; countrySlug?: string }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {RESIDENCE_CATEGORY_SHORT[route.category]}
        </span>
        <span className="block truncate text-sm font-medium leading-snug">{route.title}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {residenceLadderBadges(route, { variant: 'short' }).map(badge => (
          <Badge
            key={badge.key}
            variant={badge.tone === 'positive' ? 'verified' : 'outline'}
            className="h-4 px-1.5 text-[9px]"
          >
            {badge.label}
          </Badge>
        ))}
      </span>
      {countrySlug && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );
  return countrySlug ? (
    <a
      href={`/country/${countrySlug}/#residence-${encodeURIComponent(route.id)}`}
      className="flex min-h-12 items-center gap-2 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-primary/55 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      aria-label={`Read requirements and sources for ${route.title}`}
    >
      {body}
    </a>
  ) : (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">{body}</div>
  );
}

const chipClass = 'rounded-full border bg-card px-3 py-1.5 text-xs hover:border-primary';

export function DetailPanel({
  data,
  citizenshipRoutes,
  state,
  onClose,
  onCollapse,
  onBackToRoutes,
}: Props) {
  const iso = state.country!;
  const blocs = data.blocs.filter(b => b.members.some(m => m.iso_n3 === iso));
  const formerBlocs = data.blocs.filter(b => b.former_members?.some(m => m.iso_n3 === iso));
  const lanes: BilateralLane[] = [
    ...data.bilateral_lanes.filter(l => l.destination.iso_n3 === iso),
    ...data.bilateral_lanes.filter(l => l.beneficiaries.some(m => m.iso_n3 === iso)),
  ];
  const jurisdiction = citizenshipRoutes?.jurisdictions.find(row => row.iso_n3 === iso);
  const routes = citizenshipRoutes?.routes.filter(route => route.country.iso_n3 === iso) ?? [];
  const residenceRoutes = citizenshipRoutes?.residence_routes?.filter(
    route => route.country.iso_n3 === iso,
  ) ?? [];
  const countrySlug = citizenshipRoutes
    ? buildCountrySlugMap(citizenshipRoutes.jurisdictions).get(iso)
    : undefined;

  const nameFromData = jurisdiction?.name ?? data.blocs
    .flatMap(b => [...b.members, ...(b.former_members ?? [])])
    .find(m => m.iso_n3 === iso)?.name;
  const countryName = state.countryName ?? nameFromData ?? iso;
  const flag = countryFlag(iso);
  const regionalCount = blocs.length + formerBlocs.length;
  const laneCount = lanes.length;

  return (
    <section className="h-full w-full overflow-y-auto bg-background px-3 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-4 md:pb-8">
      <header className="sticky top-0 z-10 -mx-3 border-b bg-background/95 px-3 pb-2.5 pt-2.5 backdrop-blur-md sm:-mx-4 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 font-heading text-xl font-semibold tracking-tight">
            {flag && <span aria-hidden>{flag}</span>}
            <span className="truncate">{countryName}</span>
          </h2>
          <div className="-mr-1 flex shrink-0 items-center gap-0.5">
            {countrySlug && (
              <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-muted-foreground">
                <a href={`/country/${countrySlug}/`}>
                  Full guide <ExternalLink className="size-3" aria-hidden />
                </a>
              </Button>
            )}
            {onCollapse && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden text-muted-foreground md:inline-flex"
                aria-label="Hide country details"
                onClick={onCollapse}
              >
                <PanelRightClose aria-hidden />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-11 text-muted-foreground md:size-8"
              aria-label="Clear country selection"
              onClick={onClose}
            >
              <X className="size-5" />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {routes.length} citizenship rule{routes.length === 1 ? '' : 's'} · {residenceRoutes.length} residence route{residenceRoutes.length === 1 ? '' : 's'} · {regionalCount + laneCount} connected right{regionalCount + laneCount === 1 ? '' : 's'}
        </p>
        <nav aria-label={`${countryName} guide sections`} className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border">
          <a href="#panel-citizenship" className="bg-card px-2 py-1.5 text-center text-[10px] font-semibold text-muted-foreground hover:text-foreground">
            Citizenship <span className="font-mono">{routes.length}</span>
          </a>
          <a href="#panel-residence" className="bg-card px-2 py-1.5 text-center text-[10px] font-semibold text-muted-foreground hover:text-foreground">
            Residence <span className="font-mono">{residenceRoutes.length}</span>
          </a>
          <a href="#panel-rights" className="bg-card px-2 py-1.5 text-center text-[10px] font-semibold text-muted-foreground hover:text-foreground">
            Rights <span className="font-mono">{regionalCount + laneCount}</span>
          </a>
        </nav>
      </header>

      <div className="mb-3 mt-3">
        {onBackToRoutes && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={onBackToRoutes}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {state.blocs.length > 1 ? 'Back to comparison' : 'Back to route guide'}
          </Button>
        )}
      </div>

      <SectionHeading
        id="panel-citizenship"
        title="Citizenship paths"
        description="The main legal routes we have reviewed. Open a row for its requirements and sources."
      />
      {jurisdiction && <CoverageStrip coverage={jurisdiction.coverage} />}
      {routes.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {routes.map(route => <RouteRow key={route.id} route={route} countrySlug={countrySlug} />)}
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-dashed px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          Country law has not been reviewed at route level yet. This is a coverage gap, not a claim that no path exists.
        </div>
      )}

      {residenceRoutes.length > 0 && (
        <>
          <SectionHeading
            id="panel-residence"
            title="Residence & settlement"
            description="Permits to live here. The badges show whether their time advances toward PR or citizenship."
          />
          <div className="space-y-1.5">
            {residenceCardRoutes(residenceRoutes).map(route => <ResidenceRow key={route.id} route={route} countrySlug={countrySlug} />)}
          </div>
        </>
      )}

      {regionalCount > 0 && (
        <>
          <SectionHeading
            id="panel-rights"
            title="Regional rights"
            description="Systems whose rights citizenship or qualifying status here can unlock. Open one for the full ladder."
          />
          <div className="flex flex-wrap gap-2">
            {blocs.map(b => (
              <a key={b.id} href={`/rights/${entitySlug(b.id)}/`} className={chipClass}>
                {displayRouteTitle(b.name)}
              </a>
            ))}
            {formerBlocs.map(b => (
              <a key={b.id} href={`/rights/${entitySlug(b.id)}/`} className={`${chipClass} text-muted-foreground`}>
                {displayRouteTitle(b.name)} · former
              </a>
            ))}
          </div>
        </>
      )}

      {laneCount > 0 && (
        <>
          <SectionHeading
            id={regionalCount > 0 ? 'panel-treaties' : 'panel-rights'}
            title="Treaty & country paths"
            description="Nationality-specific access that can be useful without general free movement."
          />
          <div className="flex flex-wrap gap-2">
            {lanes.map(lane => (
              <span key={lane.id} className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                {displayRouteTitle(lane.name)}
              </span>
            ))}
          </div>
        </>
      )}

      {regionalCount === 0 && laneCount === 0 && (
        <p id="panel-rights" className="mt-5 scroll-mt-36 text-xs leading-relaxed text-muted-foreground">
          No regional settlement system or nationality-specific treaty path is mapped for this country yet.
        </p>
      )}

      {countrySlug && (
        <Button asChild className="mt-6 w-full">
          <a href={`/country/${countrySlug}/`}>
            Read the full {countryName} guide <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </Button>
      )}

      <a
        href={dataCorrectionUrl(countryName, `country:${iso}`)}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex min-h-10 items-center text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-0"
      >
        Suggest a correction for {countryName}
      </a>
    </section>
  );
}

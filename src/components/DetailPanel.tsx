import { ArrowLeft, PanelRightClose, X } from 'lucide-react';
import type {
  AppState,
  BilateralLane,
  BlocsData,
  CitizenshipAcquisitionMode,
  CitizenshipCoverageState,
  CitizenshipRoute,
  CitizenshipRoutesData,
  ResidenceCategory,
  ResidenceRoute,
} from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { countryFlag } from '@/lib/country';
import { displayRouteTitle } from '@/lib/display-title';
import { dataCorrectionUrl } from '@/lib/trust';
import { buildCountrySlugMap, entitySlug } from '@/lib/slug';

/*
 * The country panel is a SUMMARY companion to the map — a quick look that funnels
 * to the full page for depth. It shows the coverage grid, compact route titles,
 * and regional/treaty chips (linking to their own pages). Full descriptions,
 * sources, residence detail, and rights ladders live on the standalone pages
 * (CountryProfile / RightsProfile), so the two don't duplicate each other.
 */

interface Props {
  data: BlocsData;
  citizenshipRoutes: CitizenshipRoutesData | null;
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

const RESIDENCE_CATEGORY_LABELS: Record<ResidenceCategory, string> = {
  investment: 'Investment',
  digital_nomad: 'Digital nomad',
  retirement_pension: 'Retirement',
  talent_skilled: 'Talent',
  general_permanent_residence: 'Permanent residence',
};

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-2 mt-5">
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

function statusLabel(route: CitizenshipRoute): string {
  if (route.status === 'inactive') return 'ended';
  if (route.status === 'verified_negative') return 'does not qualify';
  if (route.status === 'pending_verification') return 'verification pending';
  return route.confidence === 'high' ? 'verified' : `${route.confidence} confidence`;
}

/** Compact, non-expandable route row — title + mode + status; detail lives on the page. */
function RouteRow({ route }: { route: CitizenshipRoute }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {MODE_LABELS[route.mode]}
        </span>
        <span className="block truncate text-sm font-medium leading-snug">{displayRouteTitle(route.title)}</span>
      </span>
      <Badge
        variant={route.status === 'active' && route.confidence === 'high' ? 'verified' : 'outline'}
        className="h-4 shrink-0 px-1.5 text-[9px]"
      >
        {statusLabel(route)}
      </Badge>
    </div>
  );
}

function ResidenceRow({ route }: { route: ResidenceRoute }) {
  const [variant, label] = route.counts_toward_naturalization
    ? (['verified', '→ citizenship'] as const)
    : route.counts_toward_permanent_residence
      ? (['outline', '→ permanent residence'] as const)
      : (['outline', 'renewable'] as const);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {RESIDENCE_CATEGORY_LABELS[route.category]}
        </span>
        <span className="block truncate text-sm font-medium leading-snug">{route.title}</span>
      </span>
      <Badge variant={variant} className="h-4 shrink-0 px-1.5 text-[9px]">{label}</Badge>
    </div>
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
      <div className="sticky top-0 z-10 -mx-3 flex items-center justify-between gap-2 border-b bg-background px-3 py-2.5 sm:-mx-4 sm:px-4">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold">
          {flag && <span aria-hidden>{flag}</span>}
          <span className="truncate">{countryName}</span>
        </h2>
        <div className="-mr-1 flex shrink-0 items-center gap-0.5">
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
        <p className="text-xs text-muted-foreground">
          {routes.length} country rule{routes.length === 1 ? '' : 's'}{residenceRoutes.length > 0 ? ` · ${residenceRoutes.length} residence route${residenceRoutes.length === 1 ? '' : 's'}` : ''} · {regionalCount} regional system{regionalCount === 1 ? '' : 's'} · {laneCount} treaty path{laneCount === 1 ? '' : 's'}
        </p>
        {countrySlug && (
          <a
            href={`/country/${countrySlug}/`}
            className="mt-2.5 block rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground hover:brightness-105"
          >
            Full country profile →
          </a>
        )}
      </div>

      <SectionHeading
        title="Citizenship paths"
        description="How this country grants citizenship. Open the full profile for requirements and sources."
      />
      {jurisdiction && <CoverageStrip coverage={jurisdiction.coverage} />}
      {routes.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {routes.map(route => <RouteRow key={route.id} route={route} />)}
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-dashed px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          Country law has not been reviewed at route level yet. This is a coverage gap, not a claim that no path exists.
        </div>
      )}

      {residenceRoutes.length > 0 && (
        <>
          <SectionHeading
            title="Residence & settlement"
            description="Live-here routes (golden visas, digital-nomad, retirement, talent)."
          />
          <div className="space-y-1.5">
            {residenceRoutes.map(route => <ResidenceRow key={route.id} route={route} />)}
          </div>
        </>
      )}

      {regionalCount > 0 && (
        <>
          <SectionHeading
            title="Regional rights"
            description="Systems whose rights citizenship or qualifying status here can unlock. Open one for the full ladder."
          />
          <div className="flex flex-wrap gap-2">
            {blocs.map(b => (
              <a key={b.id} href={`/rights/${entitySlug(b.id)}`} className={chipClass}>
                {displayRouteTitle(b.name)}
              </a>
            ))}
            {formerBlocs.map(b => (
              <a key={b.id} href={`/rights/${entitySlug(b.id)}`} className={`${chipClass} text-muted-foreground`}>
                {displayRouteTitle(b.name)} · former
              </a>
            ))}
          </div>
        </>
      )}

      {laneCount > 0 && (
        <>
          <SectionHeading
            title="Treaty & country paths"
            description="Nationality-specific access that can be useful without general free movement."
          />
          <div className="flex flex-wrap gap-2">
            {lanes.map(lane =>
              lane.beneficiaries.length === 0 ? (
                <a key={lane.id} href={`/route/${entitySlug(lane.id)}`} className={chipClass}>
                  {displayRouteTitle(lane.name)}
                </a>
              ) : (
                <span key={lane.id} className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                  {displayRouteTitle(lane.name)}
                </span>
              ),
            )}
          </div>
        </>
      )}

      {regionalCount === 0 && laneCount === 0 && (
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          No regional settlement system or nationality-specific treaty path is mapped for this country yet.
        </p>
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

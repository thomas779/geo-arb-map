import { ChevronDown, ExternalLink, X } from 'lucide-react';
import type {
  AppState,
  BilateralLane,
  Bloc,
  BlocsData,
  CitizenshipAcquisitionMode,
  CitizenshipCoverageState,
  CitizenshipRoute,
  CitizenshipRoutesData,
} from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { displayColor } from '@/lib/color';
import { useTheme } from '@/components/theme-provider';
import { countryFlag } from '@/lib/country';
import { dataCorrectionUrl, sourceUrl } from '@/lib/trust';

interface Props {
  data: BlocsData;
  citizenshipRoutes: CitizenshipRoutesData | null;
  state: AppState;
  onClose: () => void;
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

function Rung({ tier, text }: { tier: string; text: string }) {
  return (
    <div className="rung">
      <span className="tier">{tier}</span>
      <p>{text}</p>
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-2 mt-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
        {title}
      </h3>
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

function factLabels(route: CitizenshipRoute): string[] {
  const facts = route.facts;
  const labels: string[] = [];
  if (typeof facts.ordinary_residence_years === 'number') {
    labels.push(`${facts.ordinary_residence_years} years`);
  }
  if (typeof facts.reduced_residence_years === 'number') {
    labels.push(`reduced: ${facts.reduced_residence_years} years`);
  }
  if (typeof facts.residence_years === 'number') {
    labels.push(`${facts.residence_years} years`);
  }
  if (typeof facts.property_threshold_usd === 'number') {
    labels.push(`property: $${Number(facts.property_threshold_usd).toLocaleString()}`);
  }
  if (typeof facts.holding_period_years === 'number') {
    labels.push(`${facts.holding_period_years}-year hold`);
  }
  if (facts.automatic === false || facts.discretionary_decision === true) {
    labels.push('not automatic');
  }
  return labels.slice(0, 3);
}

function RouteCard({ route }: { route: CitizenshipRoute }) {
  const facts = factLabels(route);
  return (
    <details className="group overflow-hidden rounded-lg border bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-start gap-2.5 px-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {MODE_LABELS[route.mode]}
            </span>
            <Badge
              variant={route.status === 'active' && route.confidence === 'high' ? 'verified' : 'outline'}
              className="h-4 px-1.5 text-[9px]"
            >
              {statusLabel(route)}
            </Badge>
          </div>
          <span className="block text-sm font-medium leading-snug">{route.title}</span>
        </div>
        <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t px-3 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{route.summary}</p>
        {facts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {facts.map(fact => (
              <Badge key={fact} variant="secondary" className="text-[10px]">{fact}</Badge>
            ))}
          </div>
        )}
        <div className="mt-3 border-t border-dashed pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Official sources
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {route.sources.map(source => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-start gap-1 text-xs leading-snug text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
                >
                  <span>{source.title}</span>
                  <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

function BlocCard({ bloc, iso, former }: { bloc: Bloc; iso: string; former: boolean }) {
  const dark = useTheme().theme === 'dark';
  const inSubBloc = !former && bloc.sub_bloc?.members_iso.includes(iso);
  return (
    <details className="group overflow-hidden rounded-lg border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        <span className="chip" style={{ background: displayColor(bloc.color, dark) }} />
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug">{bloc.name}</span>
          <span className="text-[10px] text-muted-foreground">
            {former ? 'Former membership' : 'Regional rights after qualifying status'}
          </span>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t px-3 py-3">
        {inSubBloc && (
          <div className="mb-2 rounded-md bg-secondary px-2 py-1.5 text-xs text-secondary-foreground">
            {bloc.sub_bloc!.name}: full free movement among these members
          </div>
        )}
        <Rung tier="TR" text={bloc.rights.TR} />
        <Rung tier="PR" text={bloc.rights.PR} />
        <Rung tier="CIT" text={bloc.rights.CIT} />
        <div className="mt-2 border-t pt-2 text-xs leading-relaxed text-muted-foreground">
          <b className="font-semibold text-foreground">Across this group:</b> {bloc.fastest_entry}
        </div>
        {bloc.notes && (
          <div className="mt-2 border-t border-dashed pt-2 text-xs italic leading-relaxed text-muted-foreground">
            {bloc.notes}
          </div>
        )}
        <a
          href={dataCorrectionUrl(bloc.name, `bloc:${bloc.id}`)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex min-h-10 items-center text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-0"
        >
          Report this arrangement
        </a>
      </div>
    </details>
  );
}

function LaneCard({ lane, inbound, countryName }: { lane: BilateralLane; inbound: boolean; countryName: string }) {
  const dark = useTheme().theme === 'dark';
  return (
    <details className="group overflow-hidden rounded-lg border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        <span className="chip" style={{ background: displayColor(lane.color, dark) }} />
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug">{lane.name}</span>
          <span className="text-[10px] text-muted-foreground">
            {inbound ? `Into ${countryName}` : `From ${countryName}`} · {lane.leads_to_settlement ? 'settlement path' : 'temporary access'}
          </span>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t px-3 py-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {lane.allocation && lane.allocation !== 'right' && (
            <Badge variant="outline" className="text-xs">
              Not guaranteed · {lane.allocation.replace('_', ' ')}
            </Badge>
          )}
          {lane.renounces_previous && (
            <Badge variant="destructive" className="text-xs">
              May require renunciation
            </Badge>
          )}
        </div>
        <Rung tier="GET" text={lane.grants} />
        <Rung tier="BUT" text={lane.limits} />
        {lane.beneficiaries_note && (
          <div className="mt-2 border-t border-dashed pt-2 text-xs italic leading-relaxed text-muted-foreground">
            {lane.beneficiaries_note}
          </div>
        )}
        {lane.sources && lane.sources.length > 0 && (
          <div className="mt-2 border-t border-dashed pt-2 text-xs leading-relaxed text-muted-foreground/80">
            <span className="font-semibold text-muted-foreground">Sources</span>
            <ul className="mt-1 list-disc space-y-1.5 pl-4 [overflow-wrap:anywhere]">
              {lane.sources.map(source => {
                const href = sourceUrl(source);
                return (
                  <li key={source}>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                        {source}
                      </a>
                    ) : source}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <a
          href={dataCorrectionUrl(lane.name, `lane:${lane.id}`)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex min-h-10 items-center text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-0"
        >
          Report this route
        </a>
      </div>
    </details>
  );
}

export function DetailPanel({ data, citizenshipRoutes, state, onClose }: Props) {
  const iso = state.country!;
  const blocs = data.blocs.filter(b => b.members.some(m => m.iso_n3 === iso));
  const formerBlocs = data.blocs.filter(b => b.former_members?.some(m => m.iso_n3 === iso));
  const lanesIn = data.bilateral_lanes.filter(l => l.destination.iso_n3 === iso);
  const lanesOut = data.bilateral_lanes.filter(l => l.beneficiaries.some(m => m.iso_n3 === iso));
  const jurisdiction = citizenshipRoutes?.jurisdictions.find(row => row.iso_n3 === iso);
  const routes = citizenshipRoutes?.routes.filter(route => route.country.iso_n3 === iso) ?? [];

  const nameFromData = jurisdiction?.name ?? data.blocs
    .flatMap(b => [...b.members, ...(b.former_members ?? [])])
    .find(m => m.iso_n3 === iso)?.name;
  const countryName = state.countryName ?? nameFromData ?? iso;
  const flag = countryFlag(iso);
  const regionalCount = blocs.length + formerBlocs.length;
  const laneCount = lanesIn.length + lanesOut.length;

  return (
    <section className="w-full overflow-y-auto border-l px-3 pb-[max(2rem,env(safe-area-inset-bottom))] max-md:absolute max-md:inset-0 max-md:z-30 max-md:bg-background sm:px-4 md:w-[370px] md:shrink-0 md:pt-4 md:pb-8 xl:w-[390px]">
      <div className="sticky top-0 z-10 -mx-3 mb-3 flex items-start justify-between gap-2 border-b bg-background/95 px-3 py-3 backdrop-blur-sm sm:-mx-4 sm:px-4 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            {flag && <span aria-hidden>{flag}</span>}
            <span className="truncate">{countryName}</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {routes.length} country rule{routes.length === 1 ? '' : 's'} · {regionalCount} regional system{regionalCount === 1 ? '' : 's'} · {laneCount} treaty path{laneCount === 1 ? '' : 's'}
          </p>
        </div>
        <Button variant="ghost" size="icon-lg" className="-mr-1 -mt-1 size-11 shrink-0 text-muted-foreground md:size-8" aria-label="Close country details" onClick={onClose}>
          <X className="size-5" />
        </Button>
      </div>

      <SectionHeading
        title="Citizenship paths"
        description="How this country grants citizenship. Regional membership does not replace domestic nationality law."
      />
      {jurisdiction && <CoverageStrip coverage={jurisdiction.coverage} />}
      <div className="mt-2 space-y-2">
        {routes.map(route => <RouteCard key={route.id} route={route} />)}
      </div>
      {routes.length === 0 && (
        <div className="mt-2 rounded-lg border border-dashed px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          Country law has not been reviewed at route level yet. This is a coverage gap, not a claim that no path exists.
        </div>
      )}

      {regionalCount > 0 && (
        <>
          <SectionHeading
            title="Regional rights"
            description="What citizenship or qualifying status here can unlock across member countries."
          />
          <div className="space-y-2">
            {blocs.map(b => <BlocCard key={b.id} bloc={b} iso={iso} former={false} />)}
            {formerBlocs.map(b => <BlocCard key={b.id} bloc={b} iso={iso} former={true} />)}
          </div>
        </>
      )}

      {laneCount > 0 && (
        <>
          <SectionHeading
            title="Treaty & country paths"
            description="Nationality-specific access. These can be useful without creating general free movement."
          />
          <div className="space-y-2">
            {lanesIn.map(l => <LaneCard key={`in-${l.id}`} lane={l} inbound={true} countryName={countryName} />)}
            {lanesOut.map(l => <LaneCard key={`out-${l.id}`} lane={l} inbound={false} countryName={countryName} />)}
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

import {
  ChevronDown,
  ExternalLink,
  PanelRightClose,
  Route,
  X,
} from 'lucide-react';
import type { BilateralLane, Bloc, BlocsData } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { countryFlag } from '@/lib/country';
import { displayColor } from '@/lib/color';
import { displayRouteTitle } from '@/lib/display-title';
import { dataCorrectionUrl, sourceUrl } from '@/lib/trust';

interface Props {
  data: BlocsData;
  blocIds: string[];
  laneId: string | null;
  onClose: () => void;
}

const CATEGORY_LABEL: Record<Bloc['category'], string> = {
  full: 'Established rights',
  closed: 'Established rights',
  partial: 'Limited framework',
  hub_spoke: 'Hub-and-spoke',
  one_way: 'One-way access',
  proto: 'Emerging framework',
};

function Rights({ bloc }: { bloc: Bloc }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border bg-border">
      {([
        ['TR', bloc.rights.TR],
        ['PR', bloc.rights.PR],
        ['CIT', bloc.rights.CIT],
      ] as const).map(([tier, text]) => (
        <div key={tier} className="grid grid-cols-[34px_1fr] gap-2 bg-card px-3 py-2.5">
          <span className="pt-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
            {tier}
          </span>
          <p className="text-xs leading-relaxed">{text}</p>
        </div>
      ))}
    </div>
  );
}

function MemberList({
  members,
  overlapCounts,
}: {
  members: Bloc['members'];
  overlapCounts?: Map<string, number>;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {members.map(member => {
        const overlapCount = overlapCounts?.get(member.iso_n3) ?? 0;
        return (
          <div key={member.iso_n3} className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="shrink-0 text-sm" aria-hidden>{countryFlag(member.iso_n3)}</span>
            <span className="truncate">{member.name}</span>
            {overlapCount > 1 && (
              <span
                className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground"
                title={`Included in ${overlapCount} selected systems`}
              >
                ×{overlapCount}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BlocDetail({
  bloc,
  compact = false,
}: {
  bloc: Bloc;
  compact?: boolean;
}) {
  const dark = useTheme().theme === 'dark';
  const body = (
    <div className={compact ? 'border-t px-3 pb-3 pt-3' : 'space-y-3'}>
      <Rights bloc={bloc} />
      <div className="rounded-lg bg-muted/55 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Entry context
        </p>
        <p className="mt-1 text-xs leading-relaxed">{bloc.fastest_entry}</p>
      </div>
      {bloc.notes && (
        <p className="text-xs leading-relaxed text-muted-foreground">{bloc.notes}</p>
      )}
      <details className="group rounded-lg border bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium">
          <span>{bloc.members.length} countries in scope</span>
          <ChevronDown className="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t px-3 py-3">
          <MemberList members={bloc.members} />
        </div>
      </details>
      <a
        href={dataCorrectionUrl(bloc.name, `bloc:${bloc.id}`)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-10 items-center text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-0"
      >
        Report this arrangement
      </a>
    </div>
  );

  if (!compact) return body;

  return (
    <details className="group overflow-hidden rounded-lg border bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2.5 px-3 py-2.5">
        <span
          className="size-3 shrink-0 rounded-[3px]"
          style={{ background: displayColor(bloc.color, dark) }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {displayRouteTitle(bloc.name)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {CATEGORY_LABEL[bloc.category]} · {bloc.members.length} countries
          </span>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      {body}
    </details>
  );
}

function LaneDetail({ lane }: { lane: BilateralLane }) {
  const originLabel = lane.beneficiaries.length > 0
    ? `${lane.beneficiaries.length} eligible countr${lane.beneficiaries.length === 1 ? 'y' : 'ies'}`
    : 'Eligibility-based heritage route';
  const allocation = lane.allocation ?? 'right';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Destination
          </p>
          <p className="mt-0.5 truncate text-sm font-medium">
            <span className="mr-1.5" aria-hidden>{countryFlag(lane.destination.iso_n3)}</span>
            {lane.destination.name}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {lane.leads_to_settlement ? 'Settlement path' : 'Temporary access'}
        </Badge>
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border bg-border">
        <div className="grid grid-cols-[44px_1fr] gap-2 bg-card px-3 py-2.5">
          <span className="pt-0.5 font-mono text-[10px] font-semibold text-muted-foreground">GET</span>
          <p className="text-xs leading-relaxed">{lane.grants}</p>
        </div>
        <div className="grid grid-cols-[44px_1fr] gap-2 bg-card px-3 py-2.5">
          <span className="pt-0.5 font-mono text-[10px] font-semibold text-muted-foreground">LIMIT</span>
          <p className="text-xs leading-relaxed">{lane.limits}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[10px]">{originLabel}</Badge>
        {allocation !== 'right' && (
          <Badge variant="outline" className="text-[10px]">
            {allocation.replace('_', ' ')}
          </Badge>
        )}
        {lane.renounces_previous && (
          <Badge variant="destructive" className="text-[10px]">May require renunciation</Badge>
        )}
      </div>

      {lane.beneficiaries_note && (
        <p className="text-xs leading-relaxed text-muted-foreground">{lane.beneficiaries_note}</p>
      )}

      {lane.beneficiaries.length > 0 && (
        <details className="group rounded-lg border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium">
            <span>Eligible countries</span>
            <ChevronDown className="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t px-3 py-3">
            <MemberList members={lane.beneficiaries} />
          </div>
        </details>
      )}

      {lane.sources && lane.sources.length > 0 && (
        <div className="rounded-lg border bg-card px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Sources
          </p>
          <ul className="mt-2 space-y-2">
            {lane.sources.map(source => {
              const href = sourceUrl(source);
              return (
                <li key={source} className="text-xs leading-relaxed text-muted-foreground">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-start gap-1 underline underline-offset-2 hover:text-foreground"
                    >
                      <span>{source}</span>
                      <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
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
        className="inline-flex min-h-10 items-center text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-0"
      >
        Report this route
      </a>
    </div>
  );
}

export function RouteDetailPanel({ data, blocIds, laneId, onClose }: Props) {
  const blocs = data.blocs.filter(bloc => blocIds.includes(bloc.id));
  const lane = laneId
    ? data.bilateral_lanes.find(candidate => candidate.id === laneId) ?? null
    : null;
  const selectedCount = blocs.length + Number(Boolean(lane));

  const overlapCounts = new Map<string, number>();
  blocs.forEach(bloc => {
    bloc.members.forEach(member => {
      overlapCounts.set(member.iso_n3, (overlapCounts.get(member.iso_n3) ?? 0) + 1);
    });
  });
  const uniqueMembers = Array.from(
    blocs.flatMap(bloc => bloc.members).reduce(
      (members, member) => members.set(member.iso_n3, member),
      new Map<string, Bloc['members'][number]>(),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const overlapMembers = uniqueMembers.filter(member => (overlapCounts.get(member.iso_n3) ?? 0) > 1);

  const singleBloc = blocs.length === 1 && !lane ? blocs[0] : null;
  const title = lane
    ? displayRouteTitle(lane.name)
    : singleBloc
      ? displayRouteTitle(singleBloc.name)
      : 'Selected routes';
  const subtitle = lane
    ? (lane.beneficiaries.length > 0
      ? `${lane.beneficiaries.length} origins · 1 destination`
      : 'Heritage eligibility · 1 destination')
    : `${selectedCount} system${selectedCount === 1 ? '' : 's'} · ${uniqueMembers.length} distinct countries`;

  return (
    <section className="h-full w-full overflow-y-auto bg-background px-3 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-4 md:pt-4 md:pb-8">
      <div className="sticky top-0 z-10 -mx-3 mb-4 flex items-start justify-between gap-2 border-b bg-background/95 px-3 py-3 backdrop-blur-sm sm:-mx-4 sm:px-4 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Route className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <h2 className="truncate text-xl font-semibold">{title}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11 shrink-0 text-muted-foreground md:size-8"
          aria-label="Hide route details"
          onClick={onClose}
        >
          <PanelRightClose className="hidden md:block" aria-hidden />
          <X className="size-5 md:hidden" aria-hidden />
        </Button>
      </div>

      {singleBloc && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {CATEGORY_LABEL[singleBloc.category]}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {singleBloc.members.length} members
            </Badge>
          </div>
          <BlocDetail bloc={singleBloc} />
        </>
      )}

      {lane && <LaneDetail lane={lane} />}

      {!singleBloc && !lane && (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Compare each system on its own terms. Rights do not combine automatically, even where the highlighted countries overlap.
          </p>
          {overlapMembers.length > 0 && (
            <div className="rounded-lg border bg-muted/45 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Shared coverage
              </p>
              <p className="mt-1 text-xs leading-relaxed">
                {overlapMembers.length} countr{overlapMembers.length === 1 ? 'y appears' : 'ies appear'} in more than one selected system.
              </p>
            </div>
          )}
          <div className="space-y-2">
            {blocs.map(bloc => <BlocDetail key={bloc.id} bloc={bloc} compact />)}
          </div>
          <details className="group rounded-lg border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium">
              <span>All {uniqueMembers.length} countries in scope</span>
              <ChevronDown className="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t px-3 py-3">
              <MemberList members={uniqueMembers} overlapCounts={overlapCounts} />
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

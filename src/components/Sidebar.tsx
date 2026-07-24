import { useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { AppState, BilateralLane, Bloc, BlocsData } from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { displayColor } from '@/lib/color';
import { useTheme } from '@/components/theme-provider';
import { countryFlag } from '@/lib/country';
import { displayRouteTitle } from '@/lib/display-title';

const REGIONAL_GROUPS: Array<{
  id: string;
  label: string;
  description: string;
  categories: Bloc['category'][];
}> = [
  {
    id: 'established',
    label: 'Established rights',
    description: 'Regional systems with current residence or citizenship-linked rights.',
    categories: ['full', 'closed'],
  },
  {
    id: 'conditional',
    label: 'Limited or one-way',
    description: 'Access depends on nationality, direction, profession, or domestic implementation.',
    categories: ['partial', 'hub_spoke', 'one_way'],
  },
  {
    id: 'emerging',
    label: 'Emerging frameworks',
    description: 'Cooperation exists, but it does not yet create a dependable settlement right.',
    categories: ['proto'],
  },
];

/*
 * Row selection uses the shadcn check-item idiom: the bloc's color swatch
 * becomes a checked box (white ✓ over the bloc color) and the row fills with
 * the neutral accent tint. One treatment, used only for selection.
 */
const rowBase =
  'h-11 w-full justify-start gap-2 rounded-md px-2 text-left text-sm font-medium md:h-8';
const rowSelected = 'bg-accent';

interface Props {
  data: BlocsData;
  state: AppState;
  onBloc: (id: string | null) => void;
  onLane: (id: string | null) => void;
}

function Swatch({ color, selected }: { color: string; selected: boolean }) {
  // Own layout classes (no .chip): inline-block + fixed w/h fought the flex
  // centering, leaving the check pinned to a corner.
  return (
    <span
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] transition-transform duration-150"
      style={{ background: color, transform: selected ? 'scale(1.12)' : undefined }}
    >
      {selected && <Check className="size-2.5 text-white" strokeWidth={3.5} aria-hidden />}
    </span>
  );
}

const catTrigger =
  'min-h-11 justify-start gap-2 px-1.5 py-2 text-xs font-semibold text-foreground hover:no-underline md:min-h-0';
const headingCount =
  'font-mono text-[9px] font-normal tabular-nums text-muted-foreground/70';

function RowTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function laneQualifier(lane: BilateralLane): string | null {
  if (lane.allocation === 'ballot') return 'Ballot';
  if (lane.allocation === 'quota_queue') return 'Queue';
  if (lane.allocation === 'discretionary') return 'Review';
  return null;
}

function laneGroupId(lane: BilateralLane): 'settlement' | 'work' | 'limited' {
  if ((lane.allocation ?? 'right') !== 'right') return 'limited';
  return lane.leads_to_settlement ? 'settlement' : 'work';
}

function LaneDirection({ lane }: { lane: BilateralLane }) {
  const origins = lane.beneficiaries
    .slice(0, 2)
    .map(member => countryFlag(member.iso_n3))
    .filter(Boolean);

  if (origins.length === 0) {
    return (
      <span
        className="flex w-5 shrink-0 items-center justify-center text-sm leading-none"
        aria-hidden
      >
        {countryFlag(lane.destination.iso_n3)}
      </span>
    );
  }

  return (
    <span
      className="flex w-[52px] shrink-0 items-center justify-end gap-0.5 text-sm leading-none"
      aria-hidden
    >
      {origins.map((flag, index) => (
        <span key={`${flag}-${index}`}>{flag}</span>
      ))}
      {lane.beneficiaries.length > 2 && (
        <span className="text-[9px] text-muted-foreground">+{lane.beneficiaries.length - 2}</span>
      )}
      <span className="px-0.5 text-[10px] text-muted-foreground">→</span>
      <span>{countryFlag(lane.destination.iso_n3)}</span>
    </span>
  );
}

export function Sidebar({ data, state, onBloc, onLane }: Props) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const isFiltering = Boolean(q);

  const blocMatches = (bloc: Bloc) => {
    if (!q) return true;
    const searchable = [
      bloc.name,
      ...bloc.members.map(member => member.name),
      bloc.rights.TR,
      bloc.rights.PR,
      bloc.rights.CIT,
      bloc.fastest_entry,
      bloc.notes,
    ];
    return searchable.some(value => value.toLowerCase().includes(q));
  };

  const laneMatches = (lane: BilateralLane) => {
    if (!q) return true;
    const searchable = [
      lane.name,
      lane.destination.name,
      ...lane.beneficiaries.map(member => member.name),
      lane.beneficiaries_note ?? '',
      lane.grants,
      lane.limits,
    ];
    return searchable.some(value => value.toLowerCase().includes(q));
  };

  const regionalGroups = REGIONAL_GROUPS.map(group => ({
    ...group,
    blocs: data.blocs.filter(bloc =>
      group.categories.includes(bloc.category) && blocMatches(bloc)),
  })).filter(group => group.blocs.length > 0);
  const countryLaneGroups: Array<{
    id: string;
    label: string;
    description: string;
    lanes: BilateralLane[];
  }> = [
    {
      id: 'settlement',
      label: 'Residence & citizenship',
      description: 'Country-specific paths that can lead to long-term residence or citizenship.',
      lanes: data.bilateral_lanes.filter(lane =>
        lane.beneficiaries.length > 0
        && lane.leads_to_settlement
        && (lane.allocation ?? 'right') === 'right'
        && laneMatches(lane)),
    },
    {
      id: 'work',
      label: 'Work access',
      description: 'Professional or treaty access that does not itself create a settlement path.',
      lanes: data.bilateral_lanes.filter(lane =>
        lane.beneficiaries.length > 0
        && !lane.leads_to_settlement
        && (lane.allocation ?? 'right') === 'right'
        && laneMatches(lane)),
    },
    {
      id: 'limited',
      label: 'Ballots, queues & review',
      description: 'Useful possibilities, but not deterministic rights.',
      lanes: data.bilateral_lanes.filter(lane =>
        lane.beneficiaries.length > 0
        && (lane.allocation ?? 'right') !== 'right'
        && laneMatches(lane)),
    },
  ];
  const visibleCountryLaneGroups = countryLaneGroups.filter(group => group.lanes.length > 0);
  const heritageLanes = data.bilateral_lanes.filter(lane =>
    lane.beneficiaries.length === 0 && laneMatches(lane));
  const regionalCount = regionalGroups.reduce((count, group) => count + group.blocs.length, 0);
  const countryLaneCount = visibleCountryLaneGroups.reduce((count, group) => count + group.lanes.length, 0);
  const selectedLane = state.lane
    ? data.bilateral_lanes.find(lane => lane.id === state.lane)
    : null;
  const selectedBlocs = data.blocs.filter(bloc => state.blocs.includes(bloc.id));

  const allSections = ['regional', 'country', 'heritage'];
  const [openSections, setOpenSections] = useState<string[]>(() => {
    if (selectedLane) {
      return [selectedLane.beneficiaries.length === 0 ? 'heritage' : 'country'];
    }
    return ['regional'];
  });
  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    if (selectedLane && selectedLane.beneficiaries.length > 0) {
      return [laneGroupId(selectedLane)];
    }
    const selectedCategories = new Set(selectedBlocs.map(bloc => bloc.category));
    const selectedGroupIds = REGIONAL_GROUPS
      .filter(group => group.categories.some(category => selectedCategories.has(category)))
      .map(group => group.id);
    return selectedGroupIds.length > 0 ? selectedGroupIds : ['established'];
  });

  const blocRows = (blocs: Bloc[]) => blocs.map(bloc => (
    <RowTooltip key={bloc.id} label={displayRouteTitle(bloc.name)}>
      <Button
        variant="ghost"
        size="sm"
        className={cn(rowBase, state.blocs.includes(bloc.id) && rowSelected)}
        onClick={() => onBloc(bloc.id)}
      >
        <Swatch color={displayColor(bloc.color, dark)} selected={state.blocs.includes(bloc.id)} />
        <span className="min-w-0 flex-1 truncate">{displayRouteTitle(bloc.name)}</span>
        <Badge variant="outline" className="text-xs tabular-nums text-muted-foreground">
          {bloc.members.length}
        </Badge>
      </Button>
    </RowTooltip>
  ));

  const laneRows = (lanes: BilateralLane[]) => lanes.map(lane => {
    const qualifier = laneQualifier(lane);
    return (
      <Button
        key={lane.id}
        variant="ghost"
        size="sm"
        className={cn(
          rowBase,
          'gap-1.5 px-1.5',
          state.lane === lane.id && rowSelected,
        )}
        aria-pressed={state.lane === lane.id}
        onClick={() => onLane(state.lane === lane.id ? null : lane.id)}
      >
        <LaneDirection lane={lane} />
        <span className="min-w-0 flex-1 truncate">
          {displayRouteTitle(lane.name)}
        </span>
        {qualifier && (
          <Badge variant="outline" className="shrink-0 px-1.5 text-[10px] text-muted-foreground">
            {qualifier}
          </Badge>
        )}
      </Button>
    );
  });

  const subgroup = (
    id: string,
    label: string,
    description: string,
    count: number,
    rows: React.ReactNode,
  ) => (
    <details
      key={id}
      className="group/sub"
      open={isFiltering ? true : openGroups.includes(id)}
    >
      <summary
        className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-1.5 text-xs text-muted-foreground hover:text-foreground md:min-h-8"
        title={description}
        onClick={event => {
          event.preventDefault();
          if (isFiltering) return;
          setOpenGroups(current =>
            current.includes(id)
              ? current.filter(groupId => groupId !== id)
              : [...current, id]);
        }}
      >
        <span className="font-medium">{label}</span>
        <span className={headingCount}>{count}</span>
        <ChevronDown className="ml-auto size-3.5 transition-transform group-open/sub:rotate-180" aria-hidden />
      </summary>
      <div className="pb-1">{rows}</div>
    </details>
  );

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden bg-sidebar">
      <div className="shrink-0 border-b border-sidebar-border px-3 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search countries, routes, or rights…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-11 w-full pl-8 text-base placeholder:text-[13px] md:h-8 md:text-sm md:placeholder:text-sm"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <Accordion
        type="multiple"
        value={isFiltering ? allSections : openSections}
        onValueChange={setOpenSections}
        className="w-full"
      >
        {/*
          * Lead with regional systems: blocs like EU/EEA and Mercosur paint
          * settlement rights across whole regions — the strongest, most
          * visible cross-border routes on the map — before the country- and
          * heritage-specific lanes.
          */}
        {regionalCount > 0 && (
          <AccordionItem value="regional" className="border-b">
            <AccordionTrigger className={catTrigger}>
              <span>Regional access</span>
              <span className={headingCount}>
                {regionalCount}
              </span>
            </AccordionTrigger>
            <AccordionContent className="h-auto pb-1">
              {regionalGroups.map(group =>
                subgroup(
                  group.id,
                  group.label,
                  group.description,
                  group.blocs.length,
                  blocRows(group.blocs),
                ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {countryLaneCount > 0 && (
          <AccordionItem value="country" className="border-b">
            <AccordionTrigger className={catTrigger}>
              <span>Country paths</span>
              <span className={headingCount}>
                {countryLaneCount}
              </span>
            </AccordionTrigger>
            <AccordionContent className="h-auto pb-1">
              {visibleCountryLaneGroups.map(group =>
                subgroup(
                  group.id,
                  group.label,
                  group.description,
                  group.lanes.length,
                  laneRows(group.lanes),
                ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {heritageLanes.length > 0 && (
          <AccordionItem value="heritage" className="border-b">
            <AccordionTrigger className={catTrigger}>
              <span>Heritage paths</span>
              <span className={headingCount}>
                {heritageLanes.length}
              </span>
            </AccordionTrigger>
            <AccordionContent className="h-auto pb-1">
              <div className="px-1.5 pb-1 text-[11px] leading-snug text-muted-foreground">
                Ancestry, ethnicity, and diaspora routes.
              </div>
              {laneRows(heritageLanes)}
            </AccordionContent>
          </AccordionItem>
        )}
        </Accordion>

        {isFiltering && regionalCount === 0 && countryLaneCount === 0 && heritageLanes.length === 0 && (
          <p className="mx-2 mt-4 text-xs text-muted-foreground">
            No routes match your search.
          </p>
        )}
      </div>
    </aside>
  );
}

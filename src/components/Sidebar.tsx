import { useState } from 'react';
import { Check, ChevronDown, Fingerprint } from 'lucide-react';
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
  'min-h-11 px-1.5 py-2 text-xs font-semibold text-foreground hover:no-underline md:min-h-0';

function RowTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function laneQualifier(lane: BilateralLane): string {
  if (lane.allocation === 'ballot') return 'Ballot';
  if (lane.allocation === 'quota_queue') return 'Queue';
  if (lane.allocation === 'discretionary') return 'Review';
  return lane.leads_to_settlement ? 'Settle' : 'Work';
}

function LaneDirection({ lane }: { lane: BilateralLane }) {
  const origins = lane.beneficiaries
    .slice(0, 2)
    .map(member => countryFlag(member.iso_n3))
    .filter(Boolean);
  return (
    <span
      className="flex w-[52px] shrink-0 items-center justify-end gap-0.5 text-sm leading-none"
      aria-hidden
    >
      {origins.length > 0 ? origins.map((flag, index) => (
        <span key={`${flag}-${index}`}>{flag}</span>
      )) : <Fingerprint className="size-3.5 text-muted-foreground" />}
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
  const blocMatches = (bloc: Bloc) =>
    !q
    || bloc.name.toLowerCase().includes(q)
    || bloc.members.some(member => member.name.toLowerCase().includes(q));
  const laneMatches = (lane: BilateralLane) =>
    !q
    || lane.name.toLowerCase().includes(q)
    || lane.destination.name.toLowerCase().includes(q)
    || lane.beneficiaries.some(member => member.name.toLowerCase().includes(q));

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

  const allSections = ['regional', 'country', 'heritage'];
  const [openSections, setOpenSections] = useState<string[]>(['regional']);
  const [openGroups, setOpenGroups] = useState<string[]>(['established']);

  const blocRows = (blocs: Bloc[]) => blocs.map(bloc => (
    <RowTooltip key={bloc.id} label={bloc.name}>
      <Button
        variant="ghost"
        size="sm"
        className={cn(rowBase, state.blocs.includes(bloc.id) && rowSelected)}
        onClick={() => onBloc(bloc.id)}
      >
        <Swatch color={displayColor(bloc.color, dark)} selected={state.blocs.includes(bloc.id)} />
        <span className="min-w-0 flex-1 truncate">{bloc.name}</span>
        <Badge variant="outline" className="text-xs tabular-nums text-muted-foreground">
          {bloc.members.length}
        </Badge>
      </Button>
    </RowTooltip>
  ));

  const laneRows = (lanes: BilateralLane[], allowWrap = false) => lanes.map(lane => (
    <RowTooltip
      key={lane.id}
      label={`${lane.name}: ${lane.beneficiaries.length || 'heritage'} → ${lane.destination.name}. ${
        lane.leads_to_settlement ? 'Can lead to settlement.' : 'Work access only.'
      } Timeline not yet structured.`}
    >
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          rowBase,
          'gap-1.5 px-1.5',
          allowWrap && 'h-auto min-h-11 py-1.5',
          state.lane === lane.id && rowSelected,
        )}
        onClick={() => onLane(state.lane === lane.id ? null : lane.id)}
      >
        <LaneDirection lane={lane} />
        <span className={cn(
          'min-w-0 flex-1',
          allowWrap ? 'whitespace-normal break-words text-xs leading-tight' : 'truncate',
        )}>
          {lane.name}
        </span>
        <Badge variant="outline" className="shrink-0 px-1.5 text-[10px] text-muted-foreground">
          {laneQualifier(lane)}
        </Badge>
      </Button>
    </RowTooltip>
  ));

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
      open={q ? true : openGroups.includes(id)}
    >
      <summary
        className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-1.5 text-xs text-muted-foreground hover:text-foreground md:min-h-8"
        title={description}
        onClick={event => {
          event.preventDefault();
          if (q) return;
          setOpenGroups(current =>
            current.includes(id)
              ? current.filter(groupId => groupId !== id)
              : [...current, id]);
        }}
      >
        <ChevronDown className="size-3.5 transition-transform group-open/sub:rotate-180" aria-hidden />
        <span className="font-medium">{label}</span>
        <span className="ml-auto font-mono text-[10px] tabular-nums">{count}</span>
      </summary>
      <div className="pb-1">{rows}</div>
    </details>
  );

  return (
    <aside className="h-full w-full overflow-y-auto bg-sidebar px-3 pt-2 pb-24 md:pt-3 md:pb-6">
      <div className="sticky top-0 z-10 -mx-1 bg-sidebar px-1 pt-1 pb-2">
        <Input
          type="search"
          placeholder="Filter groups and paths…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="h-11 text-base md:h-8 md:text-sm"
        />
      </div>

      <Accordion
        type="multiple"
        value={q ? allSections : openSections}
        onValueChange={setOpenSections}
        className="w-full"
      >
        {regionalCount > 0 && (
          <AccordionItem value="regional" className="border-b">
            <AccordionTrigger className={catTrigger}>
              <span>Regional access</span>
              <span className="ml-auto mr-1 font-mono text-[10px] font-normal text-muted-foreground">
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
              <span className="ml-auto mr-1 font-mono text-[10px] font-normal text-muted-foreground">
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
              <span className="ml-auto mr-1 font-mono text-[10px] font-normal text-muted-foreground">
                {heritageLanes.length}
              </span>
            </AccordionTrigger>
            <AccordionContent className="h-auto pb-1">
              <p className="px-1.5 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                Routes triggered by ancestry, cultural connection, or diaspora status.
              </p>
              {laneRows(heritageLanes, true)}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {q && regionalCount === 0 && countryLaneCount === 0 && heritageLanes.length === 0 && (
          <p className="mx-2 mt-4 text-xs text-muted-foreground">
            No groups or paths match “{query}”.
          </p>
        )}

      <Button
        variant="outline"
        size="sm"
        className="mt-4 min-h-10 w-full text-muted-foreground md:mx-1.5 md:min-h-0 md:w-auto"
        onClick={() => onBloc(null)}
      >
        Clear selection
      </Button>
    </aside>
  );
}

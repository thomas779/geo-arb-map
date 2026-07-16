import { useState } from 'react';
import { Check } from 'lucide-react';
import type { AppState, BilateralLane, Bloc, BlocsData } from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { displayColor } from '@/lib/color';
import { useTheme } from '@/components/theme-provider';

const CATEGORIES: Array<[Bloc['category'], string]> = [
  ['full', 'Full blocs'],
  ['partial', 'Partial blocs'],
  ['hub_spoke', 'Hub & spoke'],
  ['one_way', 'One-way / asymmetric'],
  ['closed', 'Closed to entry'],
  ['proto', 'Proto-blocs'],
];

/*
 * Row selection uses the shadcn check-item idiom: the bloc's color swatch
 * becomes a checked box (white ✓ over the bloc color) and the row fills with
 * the neutral accent tint. One treatment, used only for selection.
 */
const rowBase =
  'h-8 w-full justify-start gap-2 rounded-md px-2 text-left text-[13px] font-medium';
const rowSelected = 'bg-accent';

/**
 * Destination badge: always "→ " + a label guaranteed short enough not to
 * truncate. Long country names get a fixed short code — never a mid-word cut.
 */
const DEST_SHORT: Record<string, string> = {
  'United States of America': 'US',
  'United Kingdom': 'UK',
  'Netherlands': 'NL',
  'New Zealand': 'NZ',
  'South Korea': 'KR',
  'Kazakhstan': 'KZ',
  'Argentina': 'ARG',
  'Australia': 'AUS',
};

function destShort(l: BilateralLane): string {
  const name = l.destination.name;
  return DEST_SHORT[name] ?? (name.length <= 7 ? name : name.slice(0, 3).toUpperCase());
}

interface Props {
  data: BlocsData;
  state: AppState;
  onBloc: (id: string | null) => void;
  onLane: (id: string | null) => void;
  onView: (v: 'map' | 'stacking') => void;
}

function Swatch({ color, selected }: { color: string; selected: boolean }) {
  return (
    <span
      className="chip flex items-center justify-center transition-transform duration-150"
      style={{ background: color, transform: selected ? 'scale(1.15)' : undefined }}
    >
      {selected && <Check className="size-2.5 text-white" strokeWidth={3.5} />}
    </span>
  );
}

function CatLabel({ children }: { children: string }) {
  return (
    <div className="mx-1.5 mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </div>
  );
}

function RowTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ data, state, onBloc, onLane, onView }: Props) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);

  const laneGroups: Array<[string, BilateralLane[]]> = [
    ['Bilateral fast lanes', data.bilateral_lanes.filter(l => l.beneficiaries.length > 0 && matches(l.name))],
    ['Ancestry & diaspora routes', data.bilateral_lanes.filter(l => l.beneficiaries.length === 0 && matches(l.name))],
  ];

  return (
    <aside className="w-[265px] shrink-0 overflow-y-auto border-r px-3 pt-3 pb-6">
      <Button
        variant="ghost"
        className={cn(rowBase, 'h-9', state.view === 'stacking' && rowSelected)}
        onClick={() => onView('stacking')}
      >
        ⚑ My Flags & Stacking Plays
      </Button>
      <p className="mx-2 mt-1 mb-2 text-[11px] leading-snug text-muted-foreground">
        Plant the statuses you hold; see what they unlock and the best next flag.
      </p>

      <div className="sticky top-0 z-10 -mx-1 bg-background px-1 pt-1 pb-2">
        <Input
          type="search"
          placeholder="Filter blocs & lanes…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="h-8 text-[13px]"
        />
      </div>

      {CATEGORIES.map(([cat, label]) => {
        const blocs = data.blocs.filter(b => b.category === cat && matches(b.name));
        if (!blocs.length) return null;
        return (
          <div key={cat}>
            <CatLabel>{label}</CatLabel>
            {blocs.map(b => (
              <RowTooltip key={b.id} label={b.name}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(rowBase, state.blocs.includes(b.id) && rowSelected)}
                  onClick={() => onBloc(b.id)}
                >
                  <Swatch color={displayColor(b.color, dark)} selected={state.blocs.includes(b.id)} />
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  <Badge variant="outline" className="text-[10px] tabular-nums text-muted-foreground">
                    {b.members.length}
                  </Badge>
                </Button>
              </RowTooltip>
            ))}
          </div>
        );
      })}

      {laneGroups.map(([label, lanes]) =>
        lanes.length ? (
          <div key={label}>
            <CatLabel>{label}</CatLabel>
            {lanes.map(l => (
              <RowTooltip key={l.id} label={`${l.name} → ${l.destination.name}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(rowBase, state.lane === l.id && rowSelected)}
                  onClick={() => onLane(state.lane === l.id ? null : l.id)}
                >
                  <Swatch color={displayColor(l.color, dark)} selected={state.lane === l.id} />
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <Badge variant="outline" className="whitespace-nowrap text-[10px] text-muted-foreground">
                    → {destShort(l)}
                  </Badge>
                </Button>
              </RowTooltip>
            ))}
          </div>
        ) : null,
      )}

      {q &&
        !CATEGORIES.some(([cat]) => data.blocs.some(b => b.category === cat && matches(b.name))) &&
        laneGroups.every(([, lanes]) => !lanes.length) && (
          <p className="mx-2 mt-4 text-xs text-muted-foreground">
            No blocs or lanes match “{query}”.
          </p>
        )}

      <Button
        variant="outline"
        size="sm"
        className="mx-1.5 mt-4 text-muted-foreground"
        onClick={() => onBloc(null)}
      >
        Clear selection (count overlay)
      </Button>
    </aside>
  );
}

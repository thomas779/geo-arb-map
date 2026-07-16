import type { AppState, BilateralLane, Bloc, BlocsData } from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const CATEGORIES: Array<[Bloc['category'], string]> = [
  ['full', 'Full blocs'],
  ['partial', 'Partial blocs'],
  ['hub_spoke', 'Hub & spoke'],
  ['one_way', 'One-way / asymmetric'],
  ['closed', 'Closed to entry'],
  ['proto', 'Proto-blocs'],
];

/*
 * Row selection uses ONE dedicated treatment: an ink cursor bar (left border)
 * plus the neutral accent tint. Never amber/gold — that belongs to bloc
 * colors and map accents — and never anything else in the sidebar.
 */
const rowBase =
  'h-8 w-full justify-start gap-2 rounded-sm border-l-2 border-l-transparent px-2 text-left text-[13px] font-medium';
const rowSelected = 'border-l-foreground/80 bg-accent';

interface Props {
  data: BlocsData;
  state: AppState;
  onBloc: (id: string | null) => void;
  onLane: (id: string | null) => void;
  onView: (v: 'map' | 'stacking') => void;
}

function CatLabel({ children }: { children: string }) {
  return (
    <div className="mx-1.5 mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </div>
  );
}

function shortDest(l: BilateralLane): string {
  return l.destination.name === 'United States of America' ? 'US' : l.destination.name;
}

export function Sidebar({ data, state, onBloc, onLane, onView }: Props) {
  const laneGroups: Array<[string, BilateralLane[]]> = [
    ['Bilateral fast lanes', data.bilateral_lanes.filter(l => l.beneficiaries.length > 0)],
    ['Ancestry & diaspora routes', data.bilateral_lanes.filter(l => l.beneficiaries.length === 0)],
  ];

  return (
    <aside className="w-[265px] shrink-0 overflow-y-auto border-r px-3 pt-3 pb-6">
      <Button
        variant="ghost"
        className={cn(rowBase, 'h-9', state.view === 'stacking' && rowSelected)}
        onClick={() => onView('stacking')}
      >
        ⊕ Stacking Plays
      </Button>
      <p className="mx-2 mt-1 mb-2 text-[11px] leading-snug text-muted-foreground">
        Passports that unlock two or more blocs at once.
      </p>

      {CATEGORIES.map(([cat, label]) => {
        const blocs = data.blocs.filter(b => b.category === cat);
        if (!blocs.length) return null;
        return (
          <div key={cat}>
            <CatLabel>{label}</CatLabel>
            {blocs.map(b => (
              <Button
                key={b.id}
                variant="ghost"
                size="sm"
                title={b.name}
                className={cn(rowBase, state.bloc === b.id && rowSelected)}
                onClick={() => onBloc(state.bloc === b.id ? null : b.id)}
              >
                <span className="chip" style={{ background: b.color }} />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <Badge variant="outline" className="text-[10px] tabular-nums text-muted-foreground">
                  {b.members.length}
                </Badge>
              </Button>
            ))}
          </div>
        );
      })}

      {laneGroups.map(([label, lanes]) =>
        lanes.length ? (
          <div key={label}>
            <CatLabel>{label}</CatLabel>
            {lanes.map(l => (
              <Button
                key={l.id}
                variant="ghost"
                size="sm"
                title={`${l.name} → ${l.destination.name}`}
                className={cn(rowBase, state.lane === l.id && rowSelected)}
                onClick={() => onLane(state.lane === l.id ? null : l.id)}
              >
                <span className="chip" style={{ background: l.color }} />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <Badge variant="outline" className="max-w-[72px] truncate text-[10px] text-muted-foreground">
                  →{shortDest(l)}
                </Badge>
              </Button>
            ))}
          </div>
        ) : null,
      )}

      <Button
        variant="outline"
        size="sm"
        className="mx-1.5 mt-4 text-muted-foreground"
        onClick={() => onBloc(null)}
      >
        Show all (count overlay)
      </Button>
    </aside>
  );
}

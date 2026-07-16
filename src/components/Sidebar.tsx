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

interface Props {
  data: BlocsData;
  state: AppState;
  onBloc: (id: string | null) => void;
  onLane: (id: string | null) => void;
  onView: (v: 'map' | 'stacking') => void;
}

function CatLabel({ children }: { children: string }) {
  return (
    <div className="mx-1.5 mt-4 mb-1.5 font-mono text-[10.5px] uppercase tracking-[1.4px] text-muted-foreground">
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
        variant="outline"
        className={cn(
          'mx-1.5 mb-2 w-[calc(100%-12px)] justify-start',
          state.view === 'stacking' && 'border-primary text-primary',
        )}
        onClick={() => onView('stacking')}
      >
        ⊕ Stacking Plays
      </Button>

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
                className={cn(
                  'h-auto w-full justify-start gap-2 px-2 py-1.5 text-left text-[13px] font-medium whitespace-normal',
                  state.bloc === b.id && 'border border-primary bg-primary/10',
                )}
                onClick={() => onBloc(state.bloc === b.id ? null : b.id)}
              >
                <span className="chip" style={{ background: b.color }} />
                <span className="min-w-0 flex-1">{b.name}</span>
                <Badge variant="outline" className="font-mono text-[10.5px] text-muted-foreground">
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
                className={cn(
                  'h-auto w-full justify-start gap-2 px-2 py-1.5 text-left text-[13px] font-medium whitespace-normal',
                  state.lane === l.id && 'border border-primary bg-primary/10',
                )}
                onClick={() => onLane(state.lane === l.id ? null : l.id)}
              >
                <span className="chip" style={{ background: l.color }} />
                <span className="min-w-0 flex-1">{l.name}</span>
                <Badge variant="outline" className="font-mono text-[10.5px] text-muted-foreground">
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

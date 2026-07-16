import { useMemo, useRef, useState } from 'react';
import { Flag, X } from 'lucide-react';
import type { BlocsData } from '../types';
import {
  computeUnlocks, countryOptions, recommend,
  type PlantedFlag,
} from '@/lib/planner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { displayColor } from '@/lib/color';
import { useTheme } from '@/components/theme-provider';

interface Props {
  data: BlocsData;
  flags: PlantedFlag[];
  onChange: (flags: PlantedFlag[]) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </div>
  );
}

export function MyFlags({ data, flags, onChange }: Props) {
  const dark = useTheme().theme === 'dark';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<PlantedFlag['status']>('citizen');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => countryOptions(data), [data]);
  const held = new Set(flags.map(f => f.iso_n3));
  const q = query.trim().toLowerCase();
  const suggestions = q
    ? options.filter(o => o.name.toLowerCase().includes(q) && !held.has(o.iso_n3)).slice(0, 8)
    : [];

  const citizenIsos = flags.filter(f => f.status === 'citizen').map(f => f.iso_n3);
  const unlocked = useMemo(
    () => computeUnlocks(citizenIsos, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [citizenIsos.join(','), data],
  );
  const recs = useMemo(
    () => (citizenIsos.length ? recommend(flags, data, 5) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [citizenIsos.join(','), data],
  );
  const [top, ...rest] = recs;

  const plant = (iso: string, name: string) => {
    onChange([...flags, { iso_n3: iso, name, status }]);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };
  const uproot = (iso: string) => onChange(flags.filter(f => f.iso_n3 !== iso));

  return (
    <div className="max-w-[860px]">
      {/* ── Input + tray ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[260px]">
          <Input
            ref={inputRef}
            placeholder="Add a citizenship or residency…"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className="h-9"
          />
          {open && suggestions.length > 0 && (
            <div className="absolute top-10 z-20 w-full overflow-hidden rounded-md border bg-popover shadow-md">
              {suggestions.map(o => (
                <button
                  key={o.iso_n3}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-accent"
                  onMouseDown={e => { e.preventDefault(); plant(o.iso_n3, o.name); }}
                >
                  <Flag className="size-3 text-muted-foreground" />
                  {o.name}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {status === 'citizen' ? 'citizen' : 'resident'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex overflow-hidden rounded-md border">
          {(['citizen', 'resident'] as const).map(s => (
            <button
              key={s}
              className={cn(
                'px-2.5 py-1.5 text-[11px] font-medium capitalize',
                status === s ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex min-h-9 flex-wrap items-center gap-2">
        {flags.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Plant the flags you already hold — the map pins them and the planner computes what they unlock.
          </p>
        )}
        {flags.map(f => (
          <span
            key={f.iso_n3}
            className="animate-in zoom-in-50 fade-in inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pr-1.5 pl-2.5 text-[12.5px] font-medium duration-300"
          >
            <Flag className="size-3.5 text-primary" />
            {f.name}
            {f.status === 'resident' && (
              <Badge variant="secondary" className="px-1 text-[9px] uppercase">PR</Badge>
            )}
            <button
              className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Remove ${f.name}`}
              onClick={() => uproot(f.iso_n3)}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      {flags.some(f => f.status === 'resident') && (
        <p className="mt-1 text-[10.5px] text-muted-foreground">
          Residencies are pinned for your inventory — bloc mobility in this dataset attaches to citizenship.
        </p>
      )}

      {citizenIsos.length > 0 && (
        <>
          {/* ── Already unlocked ── */}
          <SectionLabel>
            Already unlocked — {unlocked.blocs.length} bloc{unlocked.blocs.length !== 1 && 's'} ·{' '}
            {unlocked.countries.size} countries beyond your own
          </SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {unlocked.blocs.map(b => (
              <span
                key={b.id}
                className="rounded-[5px] px-2 py-0.5 text-[11px] font-medium text-white"
                style={{ background: displayColor(b.color, dark) }}
              >
                {b.name}
              </span>
            ))}
            {unlocked.lanes.map(l => (
              <span
                key={l.id}
                className="rounded-[5px] border px-2 py-0.5 text-[11px] font-medium"
                style={{ borderColor: displayColor(l.color, dark), color: displayColor(l.color, dark) }}
              >
                {l.name}
              </span>
            ))}
            {unlocked.asymmetric.map(b => (
              <span key={b.id} className="rounded-[5px] border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
                {b.name} (asymmetric — check card)
              </span>
            ))}
            {unlocked.blocs.length + unlocked.lanes.length + unlocked.asymmetric.length === 0 && (
              <p className="text-xs text-muted-foreground">
                None of your current flags belong to a mapped bloc or fast lane.
              </p>
            )}
          </div>
          {(unlocked.workLanes.length > 0 || unlocked.chanceLanes.length > 0) && (
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              Not counted: {[
                unlocked.workLanes.length ? `${unlocked.workLanes.map(l => l.name).join(', ')} (work-only)` : '',
                unlocked.chanceLanes.length ? `${unlocked.chanceLanes.map(l => l.name).join(', ')} (ballot/quota — not guaranteed)` : '',
              ].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* ── Next moves ── */}
          <SectionLabel>Next moves — ranked by new countries per year to acquire</SectionLabel>
          {recs.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nothing left to recommend — your flags already cover every mapped bloc.
            </p>
          )}
          {top && (
            <Card className="mb-3 gap-2 border-primary/50 py-4">
              <CardHeader className="px-4">
                <div className="flex items-center gap-2">
                  <Badge className="text-[9.5px] font-semibold uppercase">Recommended</Badge>
                  {top.renouncesPrevious && (
                    <Badge variant="destructive" className="text-[9.5px]">⚠ requires renouncing — net shown</Badge>
                  )}
                </div>
                <CardTitle className="text-lg">{top.name}</CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  <span><b className="text-primary">+{top.marginal}</b> countries</span>
                  <span className="text-muted-foreground">
                    {top.years !== null ? `~${top.years} yr${top.years !== 1 ? 's' : ''} to acquire` : 'time unknown'}
                  </span>
                  <span className="text-muted-foreground">≈ {top.score.toFixed(1)} countries/yr</span>
                </div>
                {top.newBlocs.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">Adds: {top.newBlocs.join(' · ')}</p>
                )}
              </CardContent>
            </Card>
          )}
          {rest.length > 0 && (
            <div className="flex flex-col gap-1">
              {rest.map((r, i) => (
                <div key={r.iso_n3} className="flex items-baseline gap-3 rounded-md border px-3 py-2 text-[13px]">
                  <span className="w-4 text-right text-[11px] tabular-nums text-muted-foreground">{i + 2}</span>
                  <span className="font-medium">{r.name}</span>
                  {r.renouncesPrevious && <span className="text-[10px] text-destructive">⚠ renounce</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    +{r.marginal} countries · {r.years !== null ? `~${r.years} yrs` : 'time unknown'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10.5px] text-muted-foreground">
            Assumes you can pursue naturalization/CBI at the destination; ancestry routes aren't scored
            (they depend on descent, not current nationality). Durations parsed from this dataset — not legal advice.
          </p>
        </>
      )}
    </div>
  );
}

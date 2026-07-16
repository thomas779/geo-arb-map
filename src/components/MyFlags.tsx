import { useMemo, useRef, useState } from 'react';
import { Flag, MapPin, X } from 'lucide-react';
import type { BlocsData } from '../types';
import {
  computeUnlocks, countryOptions, recommend, HERITAGE_OPTIONS,
  type CountryOption, type FlagStatus, type Profile,
} from '@/lib/planner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { displayColor } from '@/lib/color';
import { useTheme } from '@/components/theme-provider';

interface Props {
  data: BlocsData;
  profile: Profile;
  onChange: (profile: Profile) => void;
}

const STATUS_LABELS: Record<FlagStatus, string> = {
  tr: 'TR', pr: 'PR', cit: 'Citizen', diaspora: 'Diaspora',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </div>
  );
}

/** Autocomplete over the dataset's jurisdictions. */
function CountryPicker({ options, exclude, placeholder, onPick }: {
  options: CountryOption[];
  exclude: Set<string>;
  placeholder: string;
  onPick: (o: CountryOption) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const suggestions = q
    ? options.filter(o => o.name.toLowerCase().includes(q) && !exclude.has(o.iso_n3)).slice(0, 8)
    : [];
  return (
    <div className="relative w-[240px]">
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-8 text-[13px]"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute top-9 z-20 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {suggestions.map(o => (
            <button
              key={o.iso_n3}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-accent"
              onMouseDown={e => {
                e.preventDefault();
                onPick(o);
                setQuery('');
                setOpen(false);
                inputRef.current?.focus();
              }}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MyFlags({ data, profile, onChange }: Props) {
  const dark = useTheme().theme === 'dark';
  const [status, setStatus] = useState<FlagStatus>('cit');

  const options = useMemo(() => countryOptions(data), [data]);
  const heldIsos = new Set(profile.flags.map(f => f.iso_n3));
  const nameOf = (iso: string) => options.find(o => o.iso_n3 === iso)?.name ?? iso;

  const profileKey = JSON.stringify(profile);
  const unlocked = useMemo(
    () => computeUnlocks(profile, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileKey, data],
  );
  const hasInput = profile.flags.length > 0 || profile.birthplace || profile.ancestors.length > 0 || profile.heritages.length > 0;
  const recs = useMemo(
    () => (hasInput ? recommend(profile, data, 5) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileKey, data],
  );
  const [top, ...rest] = recs;

  const viaLabel = (via: 'naturalization' | 'ancestry' | 'heritage') =>
    via === 'naturalization' ? null : via === 'ancestry' ? 'via ancestry' : 'via heritage claim';

  return (
    <div className="max-w-[860px]">
      {/* ── Statuses ── */}
      <div className="flex flex-wrap items-center gap-2">
        <CountryPicker
          options={options}
          exclude={heldIsos}
          placeholder="Add a status you hold…"
          onPick={o => onChange({ ...profile, flags: [...profile.flags, { iso_n3: o.iso_n3, name: o.name, status }] })}
        />
        <div className="flex overflow-hidden rounded-md border">
          {(Object.keys(STATUS_LABELS) as FlagStatus[]).map(s => (
            <button
              key={s}
              className={cn(
                'px-2.5 py-1.5 text-[11px] font-medium',
                status === s ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
              title={s === 'diaspora' ? 'OCI / F-4-style quasi-status' : undefined}
              onClick={() => setStatus(s)}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex min-h-9 flex-wrap items-center gap-2">
        {profile.flags.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Plant the statuses you hold — TR, PR, citizenship, or a diaspora status like India's OCI.
          </p>
        )}
        {profile.flags.map(f => (
          <span
            key={f.iso_n3}
            className="animate-in zoom-in-50 fade-in inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pr-1.5 pl-2.5 text-[12.5px] font-medium duration-300"
          >
            <Flag className={cn('size-3.5', f.status === 'cit' ? 'text-primary' : 'text-muted-foreground')} />
            {f.name}
            {f.status !== 'cit' && (
              <Badge variant="secondary" className="px-1 text-[9px] uppercase">{STATUS_LABELS[f.status]}</Badge>
            )}
            <button
              className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Remove ${f.name}`}
              onClick={() => onChange({ ...profile, flags: profile.flags.filter(x => x.iso_n3 !== f.iso_n3) })}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>

      {/* ── Your story: birthplace, ancestry, heritage ── */}
      <SectionLabel>Your story — birthplace and descent open doors nationality can't</SectionLabel>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Born in</div>
          {profile.birthplace ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pr-1.5 pl-2.5 text-[12.5px] font-medium">
              <MapPin className="size-3.5 text-muted-foreground" />
              {nameOf(profile.birthplace)}
              <button
                className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Clear birthplace"
                onClick={() => onChange({ ...profile, birthplace: null })}
              >
                <X className="size-3" />
              </button>
            </span>
          ) : (
            <CountryPicker
              options={options}
              exclude={new Set()}
              placeholder="Country of birth…"
              onPick={o => onChange({ ...profile, birthplace: o.iso_n3 })}
            />
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Parents / grandparents born in</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {profile.ancestors.map(iso => (
              <span key={iso} className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-2 text-[12px]">
                {nameOf(iso)}
                <button
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Remove ${nameOf(iso)}`}
                  onClick={() => onChange({ ...profile, ancestors: profile.ancestors.filter(a => a !== iso) })}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <CountryPicker
              options={options}
              exclude={new Set(profile.ancestors)}
              placeholder="Add ancestor birthplace…"
              onPick={o => onChange({ ...profile, ancestors: [...profile.ancestors, o.iso_n3] })}
            />
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Heritage claims (self-attested)</div>
          <div className="flex flex-col gap-1">
            {HERITAGE_OPTIONS.map(h => (
              <label key={h.laneId} className="flex cursor-pointer items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  className="accent-[var(--primary)]"
                  checked={profile.heritages.includes(h.laneId)}
                  onChange={e => onChange({
                    ...profile,
                    heritages: e.target.checked
                      ? [...profile.heritages, h.laneId]
                      : profile.heritages.filter(x => x !== h.laneId),
                  })}
                />
                {h.label}
              </label>
            ))}
          </div>
        </div>
      </div>
      {unlocked.birthHints.map(hint => (
        <p key={hint} className="mt-2 text-[11px] text-primary">{hint}</p>
      ))}

      {hasInput && (
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
                None of your current statuses belong to a mapped bloc or fast lane.
              </p>
            )}
          </div>
          {unlocked.ancestryLanes.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Descent/heritage paths you may qualify for:{' '}
              <span className="text-foreground">{unlocked.ancestryLanes.map(l => l.name).join(' · ')}</span>
              {' '}— scored under next moves.
            </p>
          )}
          {(unlocked.workLanes.length > 0 || unlocked.chanceLanes.length > 0) && (
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              Not counted: {[
                unlocked.workLanes.length ? `${unlocked.workLanes.map(l => l.name).join(', ')} (work-only)` : '',
                unlocked.chanceLanes.length ? `${unlocked.chanceLanes.map(l => l.name).join(', ')} (ballot/quota/discretionary — not guaranteed)` : '',
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
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="text-[9.5px] font-semibold uppercase">Recommended</Badge>
                  {viaLabel(top.via) && (
                    <Badge variant="outline" className="text-[9.5px] text-primary">{viaLabel(top.via)}</Badge>
                  )}
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
                  {viaLabel(r.via) && <span className="text-[10px] text-primary">{viaLabel(r.via)}</span>}
                  {r.renouncesPrevious && <span className="text-[10px] text-destructive">⚠ renounce</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    +{r.marginal} countries · {r.years !== null ? `~${r.years} yrs` : 'time unknown'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10.5px] text-muted-foreground">
            Descent/heritage paths use rough processing times and assume you can document the claim.
            Naturalization paths assume you can pursue residence/CBI at the destination. TR statuses
            and diaspora statuses confer no bloc mobility in this dataset (PR/diaspora count their own
            country as accessible). Durations parsed from this dataset — not legal advice.
          </p>
        </>
      )}
    </div>
  );
}

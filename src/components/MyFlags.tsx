import { useMemo, useRef, useState } from 'react';
import { Baby, Flag, Heart, MapPin, Target, X } from 'lucide-react';
import type { BlocsData } from '../types';
import {
  computeUnlocks, countryOptions, recommend, HERITAGE_OPTIONS,
  type CountryOption, type FlagStatus, type GoalIntent, type Profile,
} from '@/lib/planner';
import { describePath, recommendPaths, solveGoals, type GraphEdge, type PathRec } from '@/lib/pathfinder';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { displayColor } from '@/lib/color';
import { useTheme } from '@/components/theme-provider';

interface Props {
  data: BlocsData;
  edges: GraphEdge[] | null;
  profile: Profile;
  onChange: (profile: Profile) => void;
}

const STATUS_LABELS: Record<FlagStatus, string> = {
  tr: 'TR', pr: 'PR', cit: 'Citizen', diaspora: 'Diaspora',
};

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[11px] font-medium text-muted-foreground">
      {children}
    </label>
  );
}

/** Autocomplete over the dataset's jurisdictions. */
function CountryPicker({ id, options, exclude, placeholder, onPick }: {
  id?: string;
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
    <div className="relative w-full max-w-[280px]">
      <Input
        id={id}
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

function ChipButton({ onRemove, label, children }: {
  onRemove: () => void; label: string; children: React.ReactNode;
}) {
  return (
    <span className="animate-in zoom-in-50 fade-in inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pr-1.5 pl-2.5 text-[12.5px] font-medium duration-300">
      {children}
      <button
        className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={label}
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

export function MyFlags({ data, edges, profile, onChange }: Props) {
  const dark = useTheme().theme === 'dark';
  const [status, setStatus] = useState<FlagStatus>('cit');
  const [goalIntent, setGoalIntent] = useState<GoalIntent>('live');

  const options = useMemo(() => countryOptions(data), [data]);
  const heldIsos = new Set(profile.flags.map(f => f.iso_n3));
  const nameOf = (iso: string) => options.find(o => o.iso_n3 === iso)?.name ?? iso;

  const profileKey = JSON.stringify(profile);
  const unlocked = useMemo(
    () => computeUnlocks(profile, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileKey, data],
  );
  const hasInput = profile.flags.length > 0 || profile.birthplace || profile.ancestors.length > 0 || profile.heritages.length > 0 || profile.partnerCitizenships.length > 0;
  const recs = useMemo(() => {
    if (!hasInput) return [];
    // Multi-hop pathfinder + single-hop candidates (which assume ordinary
    // relocation), deduped by destination keeping the better score.
    const single = recommend(profile, data, 10).map(r => ({ ...r, plan: null as string | null, hops: 1 }));
    if (!edges) return single.slice(0, 5);
    const multi = recommendPaths(profile, data, edges, 10).map(r => ({
      ...r,
      plan: describePath(r.steps, data),
    }));
    const byIso = new Map<string, (typeof multi)[number] | (typeof single)[number]>();
    for (const r of [...multi, ...single]) {
      const prev = byIso.get(r.iso_n3);
      if (!prev || r.score > prev.score) byIso.set(r.iso_n3, r);
    }
    return [...byIso.values()].sort((a, b) => b.score - a.score || b.marginal - a.marginal).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey, data, edges]);
  const [top, ...rest] = recs;

  const goalAnswers = useMemo(
    () => (edges && profile.goals.length ? solveGoals(profile, data, edges) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileKey, data, edges],
  );
  const partnerExtra = useMemo(() => {
    if (!profile.partnerCitizenships.length) return 0;
    const partnerProfile: Profile = {
      ...profile,
      flags: profile.partnerCitizenships.map(iso => ({ iso_n3: iso, name: iso, status: 'cit' as const })),
      partnerCitizenships: [], goals: [],
    };
    const theirs = computeUnlocks(partnerProfile, data);
    const ours = new Set(unlocked.countries);
    let extra = 0;
    for (const c of theirs.countries) if (!ours.has(c)) extra++;
    for (const iso of profile.partnerCitizenships) if (!ours.has(iso)) extra++;
    return extra;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey, data]);

  const viaLabel = (via: PathRec['via'] | 'naturalization' | 'ancestry' | 'heritage') =>
    via === 'ancestry' ? 'via ancestry' : via === 'heritage' ? 'via heritage claim' : null;

  return (
    <div className="grid max-w-[1200px] items-start gap-6 lg:grid-cols-[minmax(340px,400px)_1fr]">
      {/* ── Left pane: your profile (sticky on wide screens) ── */}
      <Card className="gap-4 py-5 lg:sticky lg:top-4">
        <CardHeader className="px-5">
          <CardTitle className="font-sans text-sm">Your profile</CardTitle>
          <CardDescription className="text-xs">
            Statuses, birthplace, and descent — everything the planner reasons from.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 px-5">
          <div>
            <FieldLabel htmlFor="flag-picker">Add a status you hold</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <CountryPicker
                id="flag-picker"
                options={options}
                exclude={heldIsos}
                placeholder="Country…"
                onPick={o => onChange({ ...profile, flags: [...profile.flags, { iso_n3: o.iso_n3, name: o.name, status }] })}
              />
              <div className="flex overflow-hidden rounded-md border" role="radiogroup" aria-label="Status level">
                {(Object.keys(STATUS_LABELS) as FlagStatus[]).map(s => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={status === s}
                    className={cn(
                      'px-2 py-1.5 text-[11px] font-medium',
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
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {profile.flags.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Plant what you hold — TR, PR, citizenship, or a diaspora status like India's OCI.
                </p>
              )}
              {profile.flags.map(f => (
                <ChipButton
                  key={f.iso_n3}
                  label={`Remove ${f.name}`}
                  onRemove={() => onChange({ ...profile, flags: profile.flags.filter(x => x.iso_n3 !== f.iso_n3) })}
                >
                  <Flag className={cn('size-3.5', f.status === 'cit' ? 'text-primary' : 'text-muted-foreground')} />
                  {f.name}
                  {f.status !== 'cit' && (
                    <Badge variant="secondary" className="px-1 text-[9px] uppercase">{STATUS_LABELS[f.status]}</Badge>
                  )}
                </ChipButton>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="birthplace-picker">Born in</FieldLabel>
            {profile.birthplace ? (
              <ChipButton label="Clear birthplace" onRemove={() => onChange({ ...profile, birthplace: null })}>
                <MapPin className="size-3.5 text-muted-foreground" />
                {nameOf(profile.birthplace)}
              </ChipButton>
            ) : (
              <CountryPicker
                id="birthplace-picker"
                options={options}
                exclude={new Set()}
                placeholder="Country of birth…"
                onPick={o => onChange({ ...profile, birthplace: o.iso_n3 })}
              />
            )}
          </div>

          <div>
            <FieldLabel htmlFor="ancestor-picker">Parents / grandparents born in</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {profile.ancestors.map(iso => (
                <ChipButton
                  key={iso}
                  label={`Remove ${nameOf(iso)}`}
                  onRemove={() => onChange({ ...profile, ancestors: profile.ancestors.filter(a => a !== iso) })}
                >
                  {nameOf(iso)}
                </ChipButton>
              ))}
              <CountryPicker
                id="ancestor-picker"
                options={options}
                exclude={new Set(profile.ancestors)}
                placeholder="Add a birthplace…"
                onPick={o => onChange({ ...profile, ancestors: [...profile.ancestors, o.iso_n3] })}
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="partner-picker">Partner's citizenships</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {profile.partnerCitizenships.map(iso => (
                <ChipButton
                  key={iso}
                  label={`Remove ${nameOf(iso)}`}
                  onRemove={() => onChange({ ...profile, partnerCitizenships: profile.partnerCitizenships.filter(a => a !== iso) })}
                >
                  <Heart className="size-3 text-muted-foreground" />
                  {nameOf(iso)}
                </ChipButton>
              ))}
              <CountryPicker
                id="partner-picker"
                options={options}
                exclude={new Set(profile.partnerCitizenships)}
                placeholder="Partner's country…"
                onPick={o => onChange({ ...profile, partnerCitizenships: [...profile.partnerCitizenships, o.iso_n3] })}
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="goal-picker">Goals — where do you want to live or work?</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {profile.goals.map(g => (
                <ChipButton
                  key={`${g.iso_n3}-${g.intent}`}
                  label={`Remove goal ${nameOf(g.iso_n3)}`}
                  onRemove={() => onChange({ ...profile, goals: profile.goals.filter(x => !(x.iso_n3 === g.iso_n3 && x.intent === g.intent)) })}
                >
                  <Target className="size-3 text-primary" />
                  {g.intent === 'work' ? 'Work in' : g.intent === 'cit' ? 'Citizenship of' : 'Live in'} {nameOf(g.iso_n3)}
                </ChipButton>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <CountryPicker
                id="goal-picker"
                options={options}
                exclude={new Set(profile.goals.map(g => g.iso_n3))}
                placeholder="Add a destination…"
                onPick={o => onChange({ ...profile, goals: [...profile.goals, { iso_n3: o.iso_n3, intent: goalIntent }] })}
              />
              <div className="flex overflow-hidden rounded-md border" role="radiogroup" aria-label="Goal type">
                {(['live', 'work', 'cit'] as GoalIntent[]).map(i => (
                  <button
                    key={i}
                    role="radio"
                    aria-checked={goalIntent === i}
                    className={cn(
                      'px-2 py-1.5 text-[11px] font-medium capitalize',
                      goalIntent === i ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-accent',
                    )}
                    onClick={() => setGoalIntent(i)}
                  >
                    {i === 'cit' ? 'Citizenship' : i}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Accordion type="single" collapsible>
            <AccordionItem value="heritage" className="border-b-0">
              <AccordionTrigger className="py-1 text-[11px] font-medium text-muted-foreground hover:no-underline">
                Heritage claims (self-attested){profile.heritages.length ? ` — ${profile.heritages.length} active` : ''}
              </AccordionTrigger>
              <AccordionContent className="flex flex-col gap-1.5 pt-1 pb-0">
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
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {unlocked.birthHints.map(hint => (
            <p key={hint} className="text-[11px] leading-snug text-primary">{hint}</p>
          ))}
        </CardContent>
      </Card>

      {/* ── Right pane: results ── */}
      <div className="flex min-w-0 flex-col gap-6">
        {!hasInput ? (
          <Card className="py-10">
            <CardContent className="text-center text-sm text-muted-foreground">
              Plant a flag on the left — the planner computes what it unlocks and your best next move.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="gap-3 py-5">
              <CardHeader className="px-5">
                <CardTitle className="font-sans text-sm">Already unlocked</CardTitle>
                <CardDescription className="text-xs">
                  {unlocked.blocs.length} bloc{unlocked.blocs.length !== 1 && 's'} ·{' '}
                  {unlocked.countries.size} countries beyond your own
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-5">
                {unlocked.blocs.length + unlocked.lanes.length + unlocked.asymmetric.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    None of your current statuses belong to a mapped bloc or fast lane.
                  </p>
                ) : (
                  <>
                    {unlocked.blocs.length > 0 && (
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Blocs</span>
                        {unlocked.blocs.map(b => (
                          <span key={b.id} className="rounded-[5px] px-2 py-0.5 text-[11px] font-medium text-white"
                                style={{ background: displayColor(b.color, dark) }}>
                            {b.name} · {b.members.length}
                          </span>
                        ))}
                      </div>
                    )}
                    {unlocked.lanes.length > 0 && (
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lanes</span>
                        {unlocked.lanes.map(l => (
                          <span key={l.id} className="rounded-[5px] border px-2 py-0.5 text-[11px] font-medium"
                                style={{ borderColor: displayColor(l.color, dark), color: displayColor(l.color, dark) }}>
                            {l.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {unlocked.asymmetric.length > 0 && (
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">One-way</span>
                        {unlocked.asymmetric.map(b => (
                          <span key={b.id} className="rounded-[5px] border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
                            {b.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {partnerExtra > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    <Heart className="mr-1 inline size-3" aria-hidden />
                    Household: your partner's citizenship adds <b className="text-foreground">+{partnerExtra}</b> more
                    countries the family can typically derive residence in.
                  </p>
                )}
                {(unlocked.workLanes.length > 0 || unlocked.chanceLanes.length > 0) && (
                  <p className="text-[10.5px] text-muted-foreground">
                    Not counted: {[
                      unlocked.workLanes.length ? `${unlocked.workLanes.map(l => l.name).join(', ')} (work-only)` : '',
                      unlocked.chanceLanes.length ? `${unlocked.chanceLanes.map(l => l.name).join(', ')} (ballot/quota/discretionary)` : '',
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </CardContent>
            </Card>

            {goalAnswers.length > 0 && (
              <Card className="gap-3 py-5">
                <CardHeader className="px-5">
                  <CardTitle className="font-sans text-sm">Your goals</CardTitle>
                  <CardDescription className="text-xs">What you want, path-solved from what you have</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 px-5">
                  {goalAnswers.map(a => (
                    <div key={`${a.goal.iso_n3}-${a.goal.intent}`} className="rounded-md border px-3 py-2.5 text-[13px]">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <Target className="size-3.5 self-center text-primary" aria-hidden />
                        <span className="font-medium">
                          {a.goal.intent === 'work' ? 'Work in' : a.goal.intent === 'cit' ? 'Citizenship of' : 'Live in'} {nameOf(a.goal.iso_n3)}
                        </span>
                        {a.best && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {a.best.years === 0 ? 'unlocked today' : `~${a.best.years} yrs`}
                          </span>
                        )}
                      </div>
                      {a.best ? (
                        a.best.steps.length > 0 ? (
                          <p className="mt-0.5 pl-5 text-[11.5px] text-muted-foreground">
                            {describePath(a.best.steps, data)}
                            {a.reached?.startsWith('work:') && ' — work access (not settlement)'}
                            {a.best.renounces && ' · ⚠ requires renouncing'}
                          </p>
                        ) : (
                          <p className="mt-0.5 pl-5 text-[11.5px] text-muted-foreground">
                            Already covered by a citizenship you hold.
                          </p>
                        )
                      ) : (
                        <p className="mt-0.5 pl-5 text-[11.5px] text-muted-foreground">
                          No deterministic path with your current facts
                          {a.chance.length > 0 && <> — chance-based: {a.chance.join(', ')}</>}
                          {a.viaPartner && <> — but your partner's citizenship covers it (family derivation)</>}.
                        </p>
                      )}
                      {a.best && a.viaPartner && (
                        <p className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                          Also coverable via your partner (family derivation).
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card className="gap-3 py-5">
              <CardHeader className="px-5">
                <CardTitle className="font-sans text-sm">Next moves</CardTitle>
                <CardDescription className="text-xs">
                  Ranked by new countries per year to acquire
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-5">
                {unlocked.ancestryLanes.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Your descent/heritage may qualify you for:{' '}
                    <span className="text-foreground">{unlocked.ancestryLanes.map(l => l.name).join(' · ')}</span>
                    {' '}— scored below.
                  </p>
                )}
                {recs.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nothing left to recommend — your flags already cover every mapped bloc.
                  </p>
                )}
                {top && (
                  <div className="rounded-lg border border-primary/50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="text-[9.5px] font-semibold uppercase">Recommended</Badge>
                      {viaLabel(top.via) && (
                        <Badge variant="outline" className="text-[9.5px] text-primary">{viaLabel(top.via)}</Badge>
                      )}
                      {top.renouncesPrevious && (
                        <Badge variant="destructive" className="text-[9.5px]">⚠ requires renouncing — net shown</Badge>
                      )}
                    </div>
                    <h3 className="mt-1.5 text-lg font-semibold">{top.name}</h3>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                      <span><b className="text-primary">+{top.marginal}</b> countries</span>
                      <span className="text-muted-foreground">
                        {top.years !== null ? `~${top.years} yr${top.years !== 1 ? 's' : ''} to acquire` : 'time unknown'}
                      </span>
                      <span className="text-muted-foreground">≈ {top.score.toFixed(1)} countries/yr</span>
                    </div>
                    {'plan' in top && top.plan && (
                      <p className="mt-2 text-xs text-foreground/90">
                        <span className="text-muted-foreground">Plan: </span>{top.plan}
                      </p>
                    )}
                    {top.newBlocs.length > 0 && (
                      <p className="mt-1.5 text-xs text-muted-foreground">Adds: {top.newBlocs.join(' · ')}</p>
                    )}
                  </div>
                )}
                {rest.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {rest.map((r, i) => (
                      <div key={r.iso_n3} className="rounded-md border px-3 py-2 text-[13px]">
                        <div className="flex items-baseline gap-3">
                          <span className="w-4 text-right text-[11px] tabular-nums text-muted-foreground">{i + 2}</span>
                          <span className="font-medium">{r.name}</span>
                          {viaLabel(r.via) && <span className="text-[10px] text-primary">{viaLabel(r.via)}</span>}
                          {r.renouncesPrevious && <span className="text-[10px] text-destructive">⚠ renounce</span>}
                          <span className="ml-auto text-right text-xs text-muted-foreground">
                            +{r.marginal} countries · {r.years !== null ? `~${r.years} yrs` : 'time unknown'}
                          </span>
                        </div>
                        {'plan' in r && r.plan && (
                          <p className="mt-0.5 pl-7 text-[11px] text-muted-foreground">{r.plan}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {data.generational_events && data.generational_events.length > 0 && (
                  <div className="mt-1 border-t border-dashed pt-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Baby className="size-3.5" aria-hidden /> Generational moves — a child born here changes both your maps
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {data.generational_events
                        .filter(ev => !profile.flags.some(f => f.iso_n3 === ev.country.iso_n3 && f.status === 'cit'))
                        .map(ev => (
                          <div key={ev.id} className="rounded-md border border-dashed px-3 py-2 text-[12px] leading-snug">
                            <b className="font-semibold">{ev.country.name}</b>
                            <span className="text-muted-foreground"> — child: </span>{ev.child}
                            <span className="text-muted-foreground"> Parent: </span>{ev.parent}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                <p className="text-[10.5px] leading-snug text-muted-foreground">
                  Descent/heritage paths use rough processing times and assume you can document the claim.
                  Naturalization paths assume you can pursue residence/CBI at the destination. TR and diaspora
                  statuses confer no bloc mobility (PR/diaspora count their own country). Not legal advice.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

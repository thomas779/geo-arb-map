import { useMemo, useRef, useState } from 'react';
import {
  Baby, Bell, Check, ChevronDown, CircleDollarSign, Flag, Heart, LockKeyhole, MapPin, Send, Target, X,
} from 'lucide-react';
import type { BlocsData, CitizenshipRoutesData } from '../types';
import {
  computeUnlocks, countryOptions, goalKey, householdExtraCountries, profileHasInput, recommend, HERITAGE_OPTIONS,
  type CountryOption, type FlagStatus, type GoalIntent, type Profile, type Recommendation,
} from '@/lib/planner';
import { describePath, recommendPaths, solveGoals, type GraphEdge, type PathRec } from '@/lib/pathfinder';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { dataCorrectionUrl } from '@/lib/trust';
import { countryFlag, countryLabel } from '@/lib/country';
import { displayRouteTitle } from '@/lib/display-title';

interface Props {
  data: BlocsData;
  edges: GraphEdge[] | null;
  profile: Profile;
  onChange: (profile: Profile) => void;
  onOpenPrivacy: () => void;
  citizenshipRoutes: CitizenshipRoutesData | null;
}

const STATUS_LABELS: Record<FlagStatus, string> = {
  tr: 'TR', pr: 'PR', cit: 'Citizen', diaspora: 'Diaspora',
};

type PlannerPath = {
  iso_n3: string;
  name: string;
  marginal: number;
  years: number | null;
  score: number;
  newBlocs: string[];
  lostBlocs: string[];
  lostCitizenships: string[];
  renouncesPrevious: boolean;
  via: Recommendation['via'] | PathRec['via'];
  plan: string | null;
  hops: number;
  isInvestment: boolean;
};

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted-foreground">
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
    <div className="relative w-full sm:max-w-[280px]">
      <Input
        id={id}
        ref={inputRef}
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-10 text-base sm:h-8 sm:text-sm"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute top-11 z-20 w-full overflow-hidden rounded-md border bg-popover shadow-md sm:top-9">
          {suggestions.map(o => (
            <button
              key={o.iso_n3}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent sm:min-h-0 sm:py-1.5"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onPick(o);
                setQuery('');
                setOpen(false);
                inputRef.current?.focus();
              }}
            >
              <span className="w-5 shrink-0 text-base leading-none" aria-hidden>
                {countryFlag(o.iso_n3)}
              </span>
              <span className="min-w-0 truncate">{o.name}</span>
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
    <span className="animate-in zoom-in-50 fade-in inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-card py-1 pr-1 pl-2.5 text-xs font-medium duration-300">
      {children}
      <button
        className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={label}
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function RoutePassport({ profile }: { profile: Profile }) {
  const stages = [
    { label: 'Profile', detail: 'Your statuses', complete: profile.flags.length > 0 },
    { label: 'Goal', detail: 'Your destination', complete: profile.goals.length > 0 },
    { label: 'Watch', detail: 'Track a path', complete: profile.watchedRoutes.length > 0 },
  ];
  const complete = stages.filter(stage => stage.complete).length;
  return (
    <div
      className="rounded-lg border bg-background/45 px-3 py-3"
      aria-label={`Profile setup: ${complete} of ${stages.length} stages complete`}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Profile setup
        </span>
        <span className="font-mono text-xs text-muted-foreground">{complete}/{stages.length}</span>
      </div>
      <div className="grid grid-cols-3">
        {stages.map((stage, index) => (
          <div key={stage.label} className="relative min-w-0">
            {index < stages.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'absolute top-2 left-[calc(50%+10px)] h-px w-[calc(100%-20px)]',
                  stages[index + 1].complete ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
            <div className="relative flex flex-col items-center text-center">
              <span
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded-full border text-xs',
                  stage.complete
                    ? 'border-verified bg-verified text-verified-foreground'
                    : 'border-border bg-card text-muted-foreground',
                )}
              >
                {stage.complete ? <Check className="size-2.5" strokeWidth={3} /> : index + 1}
              </span>
              <span className={cn('mt-1.5 text-xs font-semibold', stage.complete ? 'text-foreground' : 'text-muted-foreground')}>
                {stage.label}
              </span>
              <span className="hidden truncate text-xs text-muted-foreground sm:block">{stage.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MyFlags({ data, edges, profile, onChange, onOpenPrivacy, citizenshipRoutes }: Props) {
  const dark = useTheme().theme === 'dark';
  const [status, setStatus] = useState<FlagStatus>('cit');
  const [goalIntent, setGoalIntent] = useState<GoalIntent>('live');

  const options = useMemo(() => {
    const byIso = new Map<string, CountryOption>();
    for (const jurisdiction of citizenshipRoutes?.jurisdictions ?? []) {
      byIso.set(jurisdiction.iso_n3, {
        iso_n3: jurisdiction.iso_n3,
        name: jurisdiction.name,
      });
    }
    // Prefer the hand-curated mobility name when both datasets contain a
    // jurisdiction; registry names are occasionally abbreviated for the map.
    for (const option of countryOptions(data)) byIso.set(option.iso_n3, option);
    return [...byIso.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [citizenshipRoutes, data]);
  const heldIsos = new Set(profile.flags.map(f => f.iso_n3));
  const nameOf = (iso: string) => options.find(o => o.iso_n3 === iso)?.name ?? iso;

  const profileKey = JSON.stringify(profile);
  const unlocked = useMemo(
    () => computeUnlocks(profile, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileKey, data],
  );
  const hasInput = profileHasInput(profile);
  const recs = useMemo(() => {
    if (!hasInput) return [] as PlannerPath[];
    // Multi-hop pathfinder + single-hop candidates (which assume ordinary
    // relocation), deduped by destination keeping the better score.
    const single: PlannerPath[] = recommend(profile, data, 30).map(r => ({
      ...r,
      plan: null,
      hops: 1,
      isInvestment: r.via === 'cbi',
    }));
    const multi: PlannerPath[] = edges ? recommendPaths(profile, data, edges, 30).map(r => ({
      ...r,
      plan: describePath(r.steps, data),
      isInvestment: r.steps.some(step => step.mechanism === 'cbi'),
    })) : [];
    const byIso = new Map<string, PlannerPath>();
    for (const r of [...multi, ...single]) {
      const prev = byIso.get(r.iso_n3);
      if (!prev || r.score > prev.score) byIso.set(r.iso_n3, r);
    }
    const candidates = [...byIso.values()].sort((a, b) =>
      b.score - a.score || b.marginal - a.marginal,
    );
    return candidates.filter(r => !r.isInvestment).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey, data, edges]);
  const investmentPrograms = useMemo(
    () => citizenshipRoutes?.routes
      .filter(route => route.mode === 'investment' && route.status === 'active')
      .sort((a, b) => a.country.name.localeCompare(b.country.name)) ?? [],
    [citizenshipRoutes],
  );
  const [top, ...rest] = recs;

  const goalAnswers = useMemo(
    () => (edges && profile.goals.length ? solveGoals(profile, data, edges) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileKey, data, edges],
  );
  const partnerExtra = useMemo(
    () => householdExtraCountries(profile, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileKey, data],
  );
  const removeGoal = (goal: Profile['goals'][number]) => {
    const key = goalKey(goal);
    onChange({
      ...profile,
      goals: profile.goals.filter(item => goalKey(item) !== key),
      watchedRoutes: profile.watchedRoutes.filter(item => item !== key),
    });
  };
  const toggleWatch = (goal: Profile['goals'][number]) => {
    const key = goalKey(goal);
    const watching = profile.watchedRoutes.includes(key);
    onChange({
      ...profile,
      watchedRoutes: watching
        ? profile.watchedRoutes.filter(item => item !== key)
        : [...profile.watchedRoutes, key],
    });
  };

  const viaLabel = (path: PlannerPath) =>
    path.isInvestment
      ? 'via investment'
      : path.via === 'ancestry'
      ? 'via ancestry'
      : path.via === 'heritage'
        ? 'via heritage claim'
        : null;

  const routeLabel = (path: PlannerPath) =>
    path.plan
      ?? (path.via === 'ancestry'
        ? 'Citizenship by descent'
        : path.via === 'heritage'
          ? 'Citizenship through a documented heritage claim'
          : path.isInvestment
            ? 'Citizenship by investment'
            : 'Residence followed by ordinary naturalization');

  return (
    <div className="grid max-w-[1200px] items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(340px,400px)_1fr]">
      {/* ── Left pane: your profile (sticky on wide screens) ── */}
      <Card className="gap-4 py-4 sm:py-5 lg:sticky lg:top-4">
        <CardHeader className="px-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="font-sans text-base">Your profile</CardTitle>
            <Badge variant="outline" className="gap-1 text-xs font-medium text-muted-foreground">
              <LockKeyhole className="size-2.5" aria-hidden />
              Private · this device
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Add only the facts that can change your citizenship or residence paths.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-4 sm:gap-5 sm:px-5">
          <RoutePassport profile={profile} />
          <div>
            <FieldLabel htmlFor="flag-picker">1 · Statuses you hold</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <CountryPicker
                id="flag-picker"
                options={options}
                exclude={heldIsos}
                placeholder="Country…"
                onPick={o => onChange({ ...profile, flags: [...profile.flags, { iso_n3: o.iso_n3, name: o.name, status }] })}
              />
              <div className="grid w-full grid-cols-4 overflow-hidden rounded-md border sm:flex sm:w-auto" role="radiogroup" aria-label="Status level">
                {(Object.keys(STATUS_LABELS) as FlagStatus[]).map(s => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={status === s}
                    className={cn(
                      'min-h-10 px-1 py-2 text-xs font-medium sm:min-h-0 sm:px-2 sm:py-1.5',
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
                  Add a citizenship, residence status, or recognized diaspora status such as India’s OCI.
                </p>
              )}
              {profile.flags.map(f => (
                <ChipButton
                  key={f.iso_n3}
                  label={`Remove ${f.name}`}
                  onRemove={() => onChange({ ...profile, flags: profile.flags.filter(x => x.iso_n3 !== f.iso_n3) })}
                >
                  <span className="text-base leading-none" aria-hidden>{countryFlag(f.iso_n3)}</span>
                  {f.name}
                  {f.status !== 'cit' && (
                    <Badge variant="secondary" className="px-1 text-xs uppercase">{STATUS_LABELS[f.status]}</Badge>
                  )}
                </ChipButton>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="goal-picker">2 · Your goal</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {profile.goals.map(g => (
                <ChipButton
                  key={`${g.iso_n3}-${g.intent}`}
                  label={`Remove goal ${nameOf(g.iso_n3)}`}
                  onRemove={() => removeGoal(g)}
                >
                  <Target className="size-3 text-muted-foreground" />
                  {g.intent === 'work' ? 'Work in' : g.intent === 'cit' ? 'Citizenship of' : 'Live in'}{' '}
                  {countryLabel(nameOf(g.iso_n3), g.iso_n3)}
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
              <div className="grid w-full grid-cols-3 overflow-hidden rounded-md border sm:flex sm:w-auto" role="radiogroup" aria-label="Goal type">
                {(['live', 'work', 'cit'] as GoalIntent[]).map(i => (
                  <button
                    key={i}
                    role="radio"
                    aria-checked={goalIntent === i}
                    className={cn(
                      'min-h-10 px-1 py-2 text-xs font-medium capitalize sm:min-h-0 sm:px-2 sm:py-1.5',
                      goalIntent === i ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-accent',
                    )}
                    onClick={() => setGoalIntent(i)}
                  >
                    {i === 'cit' ? 'Citizenship' : i}
                  </button>
                ))}
              </div>
            </div>
            {profile.goals.length === 0 && (
              <p className="mt-2 text-xs leading-snug text-muted-foreground">
                Choose one destination. The planner will trace the shortest mapped path from your profile.
              </p>
            )}
          </div>

          <Accordion type="single" collapsible>
            <AccordionItem value="leverage" className="border-y">
              <AccordionTrigger className="py-3 text-xs font-medium text-muted-foreground hover:no-underline">
                Family and household
                {(profile.birthplace || profile.ancestors.length || profile.partnerCitizenships.length || profile.heritages.length)
                  ? ` — ${Number(!!profile.birthplace) + profile.ancestors.length + profile.partnerCitizenships.length + profile.heritages.length} facts`
                  : ''}
              </AccordionTrigger>
              <AccordionContent className="flex flex-col gap-5 pt-1 pb-2">
                <div>
                  <FieldLabel htmlFor="birthplace-picker">Born in</FieldLabel>
                  {profile.birthplace ? (
                    <ChipButton label="Clear birthplace" onRemove={() => onChange({ ...profile, birthplace: null })}>
                      <MapPin className="size-3.5 text-muted-foreground" />
                      {countryLabel(nameOf(profile.birthplace), profile.birthplace)}
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
                        {countryLabel(nameOf(iso), iso)}
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
                        {countryLabel(nameOf(iso), iso)}
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
                  <FieldLabel>Heritage claims (self-attested)</FieldLabel>
                  <div className="flex flex-col gap-1.5">
                    {HERITAGE_OPTIONS.map(h => (
                      <label key={h.laneId} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm sm:min-h-0 sm:text-xs">
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
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {unlocked.birthHints.map(hint => (
            <p key={hint} className="text-xs leading-snug text-verified">{hint}</p>
          ))}
          <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
            <LockKeyhole className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              Your profile stays in this browser. Watched paths are local until
              monitoring is connected.{' '}
              <button className="font-medium text-foreground underline underline-offset-2" onClick={onOpenPrivacy}>
                How privacy works
              </button>
            </span>
          </p>
        </CardContent>
      </Card>

      {/* ── Right pane: results ── */}
      <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
        {!hasInput ? (
          <Card className="py-8 sm:py-12">
            <CardContent className="mx-auto max-w-md text-center">
              <Flag className="mx-auto size-6 text-muted-foreground" aria-hidden />
              <h3 className="mt-3 font-heading text-lg font-semibold">Start with one fact.</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Add a citizenship or status you hold. The atlas will show what it already unlocks before asking for anything else.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="gap-3 py-4 sm:py-5">
              <CardHeader className="px-4 sm:px-5">
                <CardTitle className="font-sans text-base">Current access</CardTitle>
                <CardDescription className="text-xs">
                  {unlocked.blocs.length} bloc{unlocked.blocs.length !== 1 && 's'} ·{' '}
                  {unlocked.countries.size} countries beyond your own
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-4 sm:px-5">
                {unlocked.blocs.length + unlocked.lanes.length + unlocked.asymmetric.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    None of your current statuses belong to a mapped bloc or fast lane.
                  </p>
                ) : (
                  <>
                    {unlocked.blocs.length > 0 && (
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Groups</span>
                        {unlocked.blocs.map(b => (
                          <span key={b.id} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs font-medium">
                            <span className="size-2 rounded-full" style={{ background: displayColor(b.color, dark) }} aria-hidden />
                            {b.name} · {b.members.length}
                          </span>
                        ))}
                      </div>
                    )}
                    {unlocked.lanes.length > 0 && (
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Paths</span>
                        {unlocked.lanes.map(l => (
                          <span key={l.id} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs font-medium">
                            <span className="size-2 rounded-full" style={{ background: displayColor(l.color, dark) }} aria-hidden />
                            {l.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {unlocked.asymmetric.length > 0 && (
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">One-way</span>
                        {unlocked.asymmetric.map(b => (
                          <span key={b.id} className="rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
                            {b.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {partnerExtra > 0 && (
                  <p className="text-xs text-muted-foreground">
                    <Heart className="mr-1 inline size-3" aria-hidden />
                    Household: your partner's citizenship adds <b className="text-foreground">+{partnerExtra}</b> more
                    countries the family can typically derive residence in.
                  </p>
                )}
                {(unlocked.workLanes.length > 0 || unlocked.chanceLanes.length > 0) && (
                  <p className="text-xs text-muted-foreground">
                    Not counted: {[
                      unlocked.workLanes.length ? `${unlocked.workLanes.map(l => l.name).join(', ')} (work-only)` : '',
                      unlocked.chanceLanes.length ? `${unlocked.chanceLanes.map(l => l.name).join(', ')} (ballot/quota/discretionary)` : '',
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </CardContent>
            </Card>

            {profile.flags.length > 0 && profile.goals.length === 0 && (
              <Card className="overflow-hidden border-primary/35 py-0">
                <div className="grid min-h-28 gap-4 px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">Next step</p>
                    <h3 className="mt-1 font-heading text-lg font-semibold">Give the planner a direction.</h3>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                      Add one place you want to live, work, or eventually become a citizen. You will get a path you can inspect and follow.
                    </p>
                  </div>
                  <Target className="size-8 text-muted-foreground" aria-hidden />
                </div>
              </Card>
            )}

            {goalAnswers.length > 0 && (
              <Card className="gap-3 py-4 sm:py-5">
                <CardHeader className="px-4 sm:px-5">
                  <CardTitle className="font-sans text-base">Paths to your goal</CardTitle>
                  <CardDescription className="text-xs">Mapped from the statuses and family facts in your profile</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 px-4 sm:px-5">
                  {goalAnswers.map(a => {
                    const key = goalKey(a.goal);
                    const watching = profile.watchedRoutes.includes(key);
                    return (
                      <div
                        key={key}
                        className={cn(
                          'rounded-md border px-3 py-3 text-sm transition-colors',
                          watching && 'border-primary/50 bg-primary/[0.035]',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Target className="size-3.5 text-muted-foreground" aria-hidden />
                          <span className="font-medium">
                            {a.goal.intent === 'work' ? 'Work in' : a.goal.intent === 'cit' ? 'Citizenship of' : 'Live in'}{' '}
                            {countryLabel(nameOf(a.goal.iso_n3), a.goal.iso_n3)}
                          </span>
                          {a.best && (
                            <span className="text-xs text-muted-foreground">
                              {a.best.years === 0 ? 'available now' : `about ${a.best.years} years`}
                            </span>
                          )}
                          <Button
                            variant={watching ? 'secondary' : 'outline'}
                            size="xs"
                            className="ml-auto min-h-9 px-2.5 sm:min-h-0"
                            aria-pressed={watching}
                            onClick={() => toggleWatch(a.goal)}
                          >
                            {watching ? <Check /> : <Bell />}
                            {watching ? 'Watching' : 'Watch route'}
                          </Button>
                        </div>
                        {a.best ? (
                          a.best.steps.length > 0 ? (
                            <p className="mt-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                              {describePath(a.best.steps, data)}
                              {a.reached?.startsWith('work:') && ' — work access (not settlement)'}
                              {a.best.renounces && ' · ⚠ requires renouncing'}
                            </p>
                          ) : (
                            <p className="mt-1 pl-5 text-xs text-muted-foreground">
                              Already covered by a citizenship you hold.
                            </p>
                          )
                        ) : (
                          <p className="mt-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                            No deterministic path with your current facts
                            {a.chance.length > 0 && <> — chance-based: {a.chance.join(', ')}</>}
                            {a.viaPartner && <> — but your partner's citizenship covers it (family derivation)</>}.
                          </p>
                        )}
                        {a.best && a.viaPartner && (
                          <p className="mt-0.5 pl-5 text-xs text-muted-foreground">
                            Also coverable via your partner (family derivation).
                          </p>
                        )}
                        {a.best && (a.best.lostCitizenships.length > 0 || a.best.lostBlocs.length > 0) && (
                          <p className="mt-1 pl-5 text-xs text-destructive">
                            Lose:{' '}
                            {[
                              ...a.best.lostCitizenships.map(nameOf),
                              ...a.best.lostBlocs,
                            ].join(' · ')}
                          </p>
                        )}
                        <a
                          href={dataCorrectionUrl(
                            `${a.goal.intent} route to ${nameOf(a.goal.iso_n3)}`,
                            `goal:${key}`,
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex min-h-9 items-center pl-5 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-0"
                        >
                          Report this route
                        </a>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {profile.watchedRoutes.length > 0 && (
              <Card className="gap-3 border-primary/30 py-4 sm:py-5">
                <CardHeader className="px-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Bell className="size-4 text-muted-foreground" aria-hidden />
                    <CardTitle className="font-sans text-base">Watched paths</CardTitle>
                    <Badge variant="verified" className="ml-auto text-xs">
                      {profile.watchedRoutes.length} active
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Saved on this device. Future alerts will match reviewed rule changes to the exact paths you watch.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 px-4 sm:px-5">
                  <div className="flex flex-wrap gap-1.5">
                    {profile.goals
                      .filter(goal => profile.watchedRoutes.includes(goalKey(goal)))
                      .map(goal => (
                        <span key={goalKey(goal)} className="rounded-full border bg-background px-2.5 py-1 text-xs">
                          {goal.intent === 'work' ? 'Work in' : goal.intent === 'cit' ? 'Citizenship of' : 'Live in'}{' '}
                          {countryLabel(nameOf(goal.iso_n3), goal.iso_n3)}
                        </span>
                      ))}
                  </div>
                  <div className="rounded-lg border bg-muted/35 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Send className="size-4 text-primary" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Public updates on Telegram</p>
                        <p className="text-xs leading-snug text-muted-foreground">
                          Join @flagpaths for reviewed policy changes and launch notes. Personalized path alerts are still in development.
                        </p>
                      </div>
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="min-h-10 w-full bg-background sm:min-h-0 sm:w-auto"
                      >
                        <a href="https://t.me/flagpaths" target="_blank" rel="noreferrer">
                          Join @flagpaths
                        </a>
                      </Button>
                    </div>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="size-3 text-verified" aria-hidden />
                    Data reviewed through {data.meta.last_verified}
                  </p>
                </CardContent>
              </Card>
            )}

            <Card className="gap-3 py-4 sm:py-5">
              <CardHeader className="px-4 sm:px-5">
                <CardTitle className="font-sans text-base">Other paths</CardTitle>
                <CardDescription className="text-xs">
                  Ranked by added access and estimated time
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 px-4 sm:px-5">
                {unlocked.ancestryLanes.length > 0 && (
                  <details className="group rounded-md border border-dashed">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2">
                      <Heart className="size-4 text-muted-foreground" aria-hidden />
                      <span className="text-sm font-medium">Family-based claims</span>
                      <Badge variant="outline" className="text-xs">{unlocked.ancestryLanes.length}</Badge>
                      <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">From your family facts</span>
                      <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="border-t border-dashed px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {unlocked.ancestryLanes.map(lane => (
                          <span key={lane.id} className="rounded-full border bg-background px-2.5 py-1 text-xs">
                            {displayRouteTitle(lane.name)}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        These are document-dependent claims, so they remain visible even when they add little mapped access.
                      </p>
                    </div>
                  </details>
                )}
                {recs.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No additional profile-supported paths found.
                  </p>
                )}
                {top && (
                  <div className="rounded-lg border border-primary/50 px-3 py-3 sm:px-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h3 className="font-heading text-lg font-semibold">
                            {countryLabel(top.name, top.iso_n3)}
                          </h3>
                          {viaLabel(top) && (
                            <span className="text-xs text-muted-foreground">{viaLabel(top)}</span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span><b className="text-primary">+{top.marginal}</b> countries</span>
                          <span>
                            {top.years !== null ? `~${top.years} yr${top.years !== 1 ? 's' : ''}` : 'time unknown'}
                          </span>
                          {top.renouncesPrevious && (
                            <span className="text-destructive">requires renouncing</span>
                          )}
                        </div>
                      </div>
                      <Badge className="shrink-0 text-xs font-semibold uppercase">Best fit</Badge>
                    </div>
                    <details className="group mt-2 border-t pt-2">
                      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                        Why this path
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
                      </summary>
                      <div className="space-y-1.5 pb-1 text-xs leading-relaxed">
                        <p><span className="text-muted-foreground">Route: </span>{routeLabel(top)}</p>
                        {top.newBlocs.length > 0 && (
                          <p className="text-muted-foreground">Adds: {top.newBlocs.join(' · ')}</p>
                        )}
                        {(top.lostCitizenships.length > 0 || top.lostBlocs.length > 0) && (
                          <p className="text-destructive">
                            Loses: {[...top.lostCitizenships, ...top.lostBlocs].join(' · ')}
                          </p>
                        )}
                      </div>
                    </details>
                  </div>
                )}
                {rest.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {rest.map((r, i) => (
                      <details key={r.iso_n3} className="group rounded-md border px-3 text-sm">
                        <summary className="grid min-h-12 cursor-pointer list-none grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 py-2">
                          <span className="pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{i + 2}</span>
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-medium">{countryLabel(r.name, r.iso_n3)}</span>
                            {viaLabel(r) && <span className="text-xs text-muted-foreground">{viaLabel(r)}</span>}
                            {r.renouncesPrevious && <span className="text-xs text-destructive">renounce</span>}
                          </span>
                          <span className="flex items-center gap-2 text-right text-xs whitespace-nowrap text-muted-foreground">
                            +{r.marginal} · {r.years !== null ? `~${r.years}y` : '?'}
                            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
                          </span>
                        </summary>
                        <div className="mr-5 space-y-1.5 border-t py-2 pl-7 text-xs leading-relaxed">
                          <p><span className="text-muted-foreground">Route: </span>{routeLabel(r)}</p>
                          {r.newBlocs.length > 0 && (
                            <p className="text-muted-foreground">Adds: {r.newBlocs.join(' · ')}</p>
                          )}
                          {(r.lostCitizenships.length > 0 || r.lostBlocs.length > 0) && (
                            <p className="text-destructive">
                              Loses: {[...r.lostCitizenships, ...r.lostBlocs].join(' · ')}
                            </p>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
                {investmentPrograms.length > 0 && (
                  <details className="group mt-1 rounded-md border border-dashed">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2">
                      <CircleDollarSign className="size-4 text-muted-foreground" aria-hidden />
                      <span className="text-sm font-medium">Investment routes</span>
                      <Badge variant="outline" className="text-xs">{investmentPrograms.length}</Badge>
                      <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Not ranked without a budget</span>
                      <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="border-t border-dashed px-3 py-3">
                      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                        Kept as reference, but excluded from “Best fit” because your profile does not include an investment preference or budget.
                        Capital requirements and fees vary by programme.
                      </p>
                      <div className="divide-y">
                        {investmentPrograms.map(route => (
                          <div key={route.id} className="flex items-baseline justify-between gap-3 py-2 text-xs">
                            <span className="min-w-0 font-medium">
                              {countryLabel(route.country.name, route.country.iso_n3)}
                              {route.confidence !== 'high' && (
                                <span className="ml-1.5 font-normal text-muted-foreground">needs stronger primary evidence</span>
                              )}
                            </span>
                            <a
                              href={route.sources[0]?.url}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                            >
                              Source
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                )}
                {data.generational_events && data.generational_events.length > 0 && (
                  <details className="group rounded-md border border-dashed">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2">
                      <Baby className="size-4 text-muted-foreground" aria-hidden />
                      <span className="text-sm font-medium">Birthright paths</span>
                      <Badge variant="outline" className="text-xs">
                        {data.generational_events.filter(ev =>
                          !profile.flags.some(f => f.iso_n3 === ev.country.iso_n3 && f.status === 'cit')).length}
                      </Badge>
                      <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Family-dependent scenarios</span>
                      <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="flex flex-col gap-1 border-t border-dashed p-2">
                      {data.generational_events
                        .filter(ev => !profile.flags.some(f => f.iso_n3 === ev.country.iso_n3 && f.status === 'cit'))
                        .map(ev => (
                          <details key={ev.id} className="group/event rounded-md border bg-background/45">
                            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
                              <span className="font-semibold">
                                {countryLabel(ev.country.name, ev.country.iso_n3)}
                              </span>
                              <span className="text-muted-foreground">child citizenship + parent route</span>
                              <ChevronDown className="ml-auto size-3.5 text-muted-foreground transition-transform group-open/event:rotate-180" aria-hidden />
                            </summary>
                            <div className="space-y-2 border-t px-3 py-3 text-xs leading-relaxed">
                              <p><span className="font-medium text-muted-foreground">Child: </span>{ev.child}</p>
                              <p><span className="font-medium text-muted-foreground">Parent: </span>{ev.parent}</p>
                            </div>
                          </details>
                        ))}
                    </div>
                  </details>
                )}
                <p className="text-xs leading-snug text-muted-foreground">
                  Timelines are comparative estimates; eligibility and documentation requirements vary. Not legal advice.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

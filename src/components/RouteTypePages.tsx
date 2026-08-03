import type { CitizenshipRoute, CitizenshipRoutesData, ResidenceCategory, ResidenceRoute } from '@/types';
import { buildCountrySlugMap } from '@/lib/slug';
import { countryFlag } from '@/lib/country';
import { isosForRouteClass, ROUTE_CLASSES, type RouteClass } from '@/lib/route-classes';

/**
 * Prerendered route discovery pages under /routes/. Country guides answer
 * “what is available here?”; these pages answer “where is this available?”.
 *
 * The hub uses route-family cards for discovery. Directory pages deliberately
 * stop at country shortlists: the country page owns conditions and evidence,
 * while the future planner owns personalized ranking.
 *
 * The signature element across hub and shortlists is the TIER BAR: each residence
 * family's routes split by how far they carry the holder, painted in the same
 * three tones the atlas legend uses (strong solid = citizenship, hatch = PR,
 * light = residence only). It is computed from the data, never decorative.
 */

function ladderTier(route: ResidenceRoute): number {
  if (route.counts_toward_naturalization) return 2;
  if (route.counts_toward_permanent_residence) return 1;
  return 0;
}

interface TierSplit { cit: number; pr: number; tr: number; total: number }

/** Compact money: EUR 250k, USD 1M, KHR 4bn. Reads at a glance in a dense column. */
export function fmtMoney(money: { amount: number; currency: string } | null): string | null {
  if (!money) return null;
  const { amount, currency } = money;
  const compact = amount >= 1_000_000_000 ? `${trimZero(amount / 1_000_000_000)}bn`
    : amount >= 1_000_000 ? `${trimZero(amount / 1_000_000)}M`
    : amount >= 1_000 ? `${trimZero(amount / 1_000)}k`
    : String(amount);
  return `${currency} ${compact}`;
}

function trimZero(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

/**
 * The tier bar: route counts by terminal tier, in the map legend's own tones.
 * sw-pr-hatch is the compiled hatch pattern the atlas uses for the PR tier.
 */
function TierBar({ split, height = 'h-1.5' }: { split: TierSplit; height?: string }) {
  if (!split.total) return null;
  const pct = (n: number) => `${(n / split.total) * 100}%`;
  return (
    <span className={`flex w-full overflow-hidden rounded-full ${height}`} aria-hidden>
      {split.cit > 0 && <span style={{ width: pct(split.cit), background: 'var(--map-strong)' }} />}
      {split.pr > 0 && <span className="sw-pr-hatch" style={{ width: pct(split.pr) }} />}
      {split.tr > 0 && <span style={{ width: pct(split.tr), background: 'var(--map-limited)' }} />}
    </span>
  );
}

function tierCaption(split: TierSplit): string {
  const parts: string[] = [];
  if (split.cit) parts.push(`${split.cit} count toward citizenship`);
  if (split.pr) parts.push(`${split.pr} toward PR`);
  if (split.tr) parts.push(`${split.tr} TR`);
  return parts.join(' · ');
}

interface CountryRouteGroup<T> {
  iso: string;
  name: string;
  slug: string | undefined;
  routes: T[];
}

function groupByCountry<T extends { country: { iso_n3: string; name: string } }>(
  routes: T[],
  slugByIso: Map<string, string>,
): CountryRouteGroup<T>[] {
  const grouped = new Map<string, CountryRouteGroup<T>>();
  for (const route of routes) {
    const existing = grouped.get(route.country.iso_n3);
    if (existing) existing.routes.push(route);
    else grouped.set(route.country.iso_n3, {
      iso: route.country.iso_n3,
      name: route.country.name,
      slug: slugByIso.get(route.country.iso_n3),
      routes: [route],
    });
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function CountryShortlist<T>({
  groups,
  detail,
}: {
  groups: CountryRouteGroup<T>[];
  detail: (group: CountryRouteGroup<T>) => string;
}) {
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map(group => {
        const content = (
          <>
            <span className="shrink-0 text-lg" aria-hidden>{countryFlag(group.iso)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{group.name}</span>
              <span className="block truncate font-mono text-[0.62rem] text-muted-foreground">{detail(group)}</span>
            </span>
            <span className="shrink-0 text-muted-foreground" aria-hidden>→</span>
          </>
        );
        return (
          <li key={group.iso}>
            {group.slug ? (
              <a href={`/country/${group.slug}/`} className="flex min-h-14 items-center gap-3 rounded-lg border bg-card px-3 py-2.5 hover:border-primary">
                {content}
              </a>
            ) : (
              <div className="flex min-h-14 items-center gap-3 rounded-lg border bg-card px-3 py-2.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ShortlistSection<T>({
  title,
  description,
  groups,
  detail,
}: {
  title: string;
  description?: string;
  groups: CountryRouteGroup<T>[];
  detail: (group: CountryRouteGroup<T>) => string;
}) {
  if (groups.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title} <span className="text-muted-foreground/60">{groups.length}</span>
      </h2>
      {description && <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{description}</p>}
      <CountryShortlist groups={groups} detail={detail} />
    </section>
  );
}

function PageShell({ eyebrow, title, lede, children }: {
  eyebrow: string; title: string; lede: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1060px] px-4 py-8 sm:px-6">
      <nav className="mb-6 font-mono text-xs text-muted-foreground">
        <a href="/" className="underline underline-offset-2">Flag Paths</a> › <a href="/routes/" className="underline underline-offset-2">Routes</a>
      </nav>
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
      <h1 className="mt-2 max-w-[760px] font-heading text-3xl font-bold tracking-[-0.02em] sm:text-4xl">{title}</h1>
      <div className="mb-8 mt-3 max-w-[68ch] leading-relaxed text-muted-foreground">{lede}</div>
      {children}
    </main>
  );
}

// ── /routes/ hub ──

const DIRECTORY_PAGE_BY_CLASS: Record<string, string> = {
  cbi: '/routes/citizenship-by-investment/',
  'golden-visa': '/routes/golden-visas/',
  'digital-nomad': '/routes/digital-nomad-visas/',
  retirement: '/routes/retirement-visas/',
  talent: '/routes/talent-skilled-visas/',
  'digital-identity': '/routes/digital-identities/',
};

// ROUTE_CLASSES descriptions are written for the atlas sidebar; the hub can
// afford a sentence more of voice.
const HUB_DESCRIPTION: Record<string, string> = {
  ancestry: 'Citizenship through parents, grandparents, or diaspora ties. Usually the cheapest route anyone qualifies for, if they qualify at all.',
  naturalization: 'Citizenship after qualifying years of residence. The default route everywhere, and the clock every residence permit below either feeds or wastes.',
  cbi: 'Direct citizenship for a qualifying investment or contribution. A short list that marketing sites stretch with closed and imaginary programmes.',
  'golden-visa': 'Residence for a qualifying investment. What matters is where each programme stops, not what it costs to enter.',
  'digital-nomad': 'Permits for remote workers on foreign income. Most are paid stays that lead nowhere; a handful genuinely climb.',
  retirement: 'Residence on passive income or a pension. The rentista family: prove the income, keep the permit.',
  talent: 'Residence for designated skills, achievement, or sponsored work.',
  'digital-identity': 'Government digital ID only. Useful for running a company remotely; not a right to live anywhere.',
};

export function routeClassCounts(data: CitizenshipRoutesData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cls of ROUTE_CLASSES) {
    counts.set(cls.id, isosForRouteClass(cls, data).all.size);
  }
  return counts;
}

function HubCard({ cls, data, count }: { cls: RouteClass; data: CitizenshipRoutesData; count: number }) {
  const directory = DIRECTORY_PAGE_BY_CLASS[cls.id];
  const primaryHref = directory ?? `/?class=${cls.id}`;
  const outcomes = isosForRouteClass(cls, data);
  // Digital identity grants no residence, so a "stops at residence" bar would
  // claim more than the routes do.
  const split = cls.kind === 'residence' && cls.id !== 'digital-identity'
    ? { cit: outcomes.cit.size, pr: outcomes.pr.size, tr: outcomes.tr.size, total: outcomes.all.size }
    : null;
  return (
    <article className="group flex h-full flex-col rounded-lg border bg-card px-4 py-3.5 transition-colors hover:border-primary">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-xl font-semibold leading-tight">
          <a href={primaryHref} className="decoration-primary underline-offset-4 group-hover:underline">
            {cls.label}
          </a>
        </h3>
        <span className="shrink-0 font-mono text-[0.66rem] text-muted-foreground">{count} countries</span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{HUB_DESCRIPTION[cls.id] ?? cls.description}</p>
      <div className="mt-auto pt-3.5">
        {split && split.total > 0 ? (
          <>
            <TierBar split={split} />
            <p className="mt-1.5 font-mono text-[0.6rem] leading-snug text-muted-foreground">{tierCaption(split)}</p>
          </>
        ) : cls.id === 'digital-identity' ? (
          <p className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Identity only · no residence rights
          </p>
        ) : (
          <p className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Citizenship outcome
          </p>
        )}
        {directory && (
          <a href={directory} className="mt-3 inline-block font-mono text-[0.68rem] font-medium text-primary hover:underline hover:underline-offset-2">
            Browse countries →
          </a>
        )}
      </div>
    </article>
  );
}

export function RouteTypesHub({ data }: { data: CitizenshipRoutesData }) {
  const counts = routeClassCounts(data);
  const shelves: Array<{ kind: RouteClass['kind']; label: string; intro: string }> = [
    {
      kind: 'citizenship',
      label: 'Ends in citizenship',
      intro: 'The route itself produces a passport. Nothing left to climb afterwards.',
    },
    {
      kind: 'residence',
      label: 'Starts with residence',
      intro: 'A permit first. The bar on each row shows what those permits become: strong for citizenship, hatched for permanent residence, light for permits that stop where they start.',
    },
  ];
  return (
    <main className="mx-auto max-w-[1060px] px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
        Citizenship &amp; residence routes
      </h1>
      <p className="mb-8 mt-3 max-w-[68ch] text-muted-foreground">
        Explore the main ways countries grant citizenship or residence. Each route family narrows the
        countries worth investigating; country guides carry the rules and evidence.
      </p>
      {shelves.map(shelf => (
        <section key={shelf.kind} className="mb-8">
          <h2 className="mb-1 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{shelf.label}</h2>
          <p className="mb-3 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{shelf.intro}</p>
          <div className="grid auto-rows-fr gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ROUTE_CLASSES.filter(cls => cls.kind === shelf.kind).map(cls => (
              <HubCard key={cls.id} cls={cls} data={data} count={counts.get(cls.id) ?? 0} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

// ── /routes/citizenship-by-investment/ ──

export function CbiPage({ data }: { data: CitizenshipRoutesData }) {
  const slugByIso = buildCountrySlugMap(data.jurisdictions);
  const rows = data.routes.filter(r => r.mode === 'investment');
  const active = groupByCountry(rows.filter(r => r.status === 'active'), slugByIso);
  const closed = groupByCountry(rows.filter(r => r.status === 'inactive'), slugByIso);
  const pending = groupByCountry(rows.filter(r => r.status === 'pending_verification'), slugByIso);
  const detail = (group: CountryRouteGroup<CitizenshipRoute>) => (
    `${group.routes.length} programme${group.routes.length === 1 ? '' : 's'} · direct citizenship`
  );

  return (
    <PageShell
      eyebrow="Citizenship by investment"
      title="Citizenship by investment, by country."
      lede={(
        <p>
          {active.length} countries currently grant citizenship directly for a qualifying investment
          or contribution. Start with the country; its guide carries the programme conditions,
          exclusions, confidence, and primary sources. Residence by investment is different and has{' '}
          <a href="/routes/golden-visas/" className="underline underline-offset-2 hover:text-foreground">its own page</a>.
        </p>
      )}
    >
      <ShortlistSection title="Active programmes" groups={active} detail={detail} />
      {closed.length > 0 && (
        <details className="group mt-8 rounded-lg border bg-card px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Closed programmes <span className="text-muted-foreground/60">{closed.length}</span>
          </summary>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Kept as historical context because closed programmes are still frequently marketed.
          </p>
          <CountryShortlist groups={closed} detail={group => `${group.routes.length} closed programme${group.routes.length === 1 ? '' : 's'}`} />
        </details>
      )}
      {pending.length > 0 && (
        <details className="group mt-3 rounded-lg border bg-card px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Pending verification <span className="text-muted-foreground/60">{pending.length}</span>
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">Statutory leads only—not recommendations.</p>
          <CountryShortlist groups={pending} detail={group => `${group.routes.length} lead${group.routes.length === 1 ? '' : 's'}`} />
        </details>
      )}
    </PageShell>
  );
}

// ── residence-route shortlists (golden visa / digital nomad) ──

function groupTier(group: CountryRouteGroup<ResidenceRoute>): number {
  return Math.max(...group.routes.map(ladderTier));
}

function residenceDetail(
  group: CountryRouteGroup<ResidenceRoute>,
  money: (route: ResidenceRoute) => string | null,
): string {
  const amounts = [...new Set(group.routes.map(money).filter((value): value is string => value !== null))];
  const programmes = `${group.routes.length} programme${group.routes.length === 1 ? '' : 's'}`;
  if (amounts.length === 1) return `${programmes} · from ${amounts[0]}`;
  if (amounts.length > 1) return `${programmes} · entry thresholds vary`;
  return programmes;
}

function ResidenceShortlistPage({ data, category, money, eyebrow, title, lede, endedLede }: {
  data: CitizenshipRoutesData;
  category: ResidenceCategory;
  money: (r: ResidenceRoute) => string | null;
  eyebrow: string;
  title: string;
  lede: (active: CountryRouteGroup<ResidenceRoute>[], split: TierSplit) => React.ReactNode;
  endedLede: string;
}) {
  const slugByIso = buildCountrySlugMap(data.jurisdictions);
  const rows = (data.residence_routes ?? []).filter(r => r.category === category);
  const active = groupByCountry(rows.filter(r => r.status === 'active'), slugByIso);
  const ended = groupByCountry(rows.filter(r => r.status === 'inactive'), slugByIso);
  const byTier = (tier: number) => active.filter(group => groupTier(group) === tier);
  const split = {
    cit: byTier(2).length,
    pr: byTier(1).length,
    tr: byTier(0).length,
    total: active.length,
  };
  const detail = (group: CountryRouteGroup<ResidenceRoute>) => residenceDetail(group, money);

  return (
    <PageShell eyebrow={eyebrow} title={title} lede={lede(active, split)}>
      <div className="max-w-[560px] rounded-lg border bg-card p-4">
        <TierBar split={split} height="h-2" />
        <p className="mt-2 font-mono text-[0.68rem] text-muted-foreground">{tierCaption(split)}</p>
      </div>
      <ShortlistSection
        title="Can feed citizenship"
        description="The permit itself is not citizenship; qualifying time can count toward ordinary naturalization."
        groups={byTier(2)}
        detail={detail}
      />
      <ShortlistSection
        title="Can lead to permanent residence"
        description="A recorded path reaches permanent residence, but its time is not currently recorded as counting toward citizenship."
        groups={byTier(1)}
        detail={detail}
      />
      <ShortlistSection
        title="Temporary stay only"
        description="No PR or citizenship credit is currently recorded for these programmes."
        groups={byTier(0)}
        detail={detail}
      />
      {ended.length > 0 && (
        <details className="group mt-8 rounded-lg border bg-card px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Ended programmes <span className="text-muted-foreground/60">{ended.length}</span>
          </summary>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{endedLede}</p>
          <CountryShortlist groups={ended} detail={detail} />
        </details>
      )}
    </PageShell>
  );
}

export function GoldenVisaPage({ data }: { data: CitizenshipRoutesData }) {
  return (
    <ResidenceShortlistPage
      data={data}
      category="investment"
      money={r => fmtMoney(r.min_investment)}
      eyebrow="Golden visas"
      title="Residence by investment, grouped by outcome."
      lede={(active, split) => (
        <p>
          {active.length} countries currently offer a mapped residence-by-investment route. Start
          with what the permit can become, then open a country guide for its investment options,
          presence rules, and sources. Direct citizenship for investment has{' '}
          <a href="/routes/citizenship-by-investment/" className="underline underline-offset-2 hover:text-foreground">its own page</a>.
        </p>
      )}
      endedLede="Golden visas churn. Programmes close under EU pressure, housing politics, or security review; a closed programme still being marketed is a red flag."
    />
  );
}

export function NomadVisaPage({ data }: { data: CitizenshipRoutesData }) {
  return (
    <ResidenceShortlistPage
      data={data}
      category="digital_nomad"
      money={r => {
        const amount = fmtMoney(r.min_income_monthly);
        return amount ? `${amount}/mo` : null;
      }}
      eyebrow="Digital nomad visas"
      title="Digital nomad visas, grouped by outcome."
      lede={(active, split) => (
        <p>
          {active.length} countries currently offer a mapped remote-work permit. Most are temporary
          stays; {split.cit + split.pr} have a recorded path beyond that. Use the shortlist to choose
          countries worth investigating, then read the country guide for the actual rules.
        </p>
      )}
      endedLede="Several pandemic-era nomad programmes have quietly lapsed. Each ended row's run dates live on the country profile."
    />
  );
}

export function RetirementVisaPage({ data }: { data: CitizenshipRoutesData }) {
  return (
    <ResidenceShortlistPage
      data={data}
      category="retirement_pension"
      money={r => {
        const amount = fmtMoney(r.min_income_monthly);
        return amount ? `${amount}/mo` : null;
      }}
      eyebrow="Retirement residence"
      title="Retirement and passive-income routes, grouped by outcome."
      lede={(active, split) => (
        <p>
          {active.length} countries currently offer a mapped retirement, pension, or passive-income
          residence route. {split.cit + split.pr} have a recorded path beyond temporary residence.
          Open a country guide for income rules, work restrictions, and official sources.
        </p>
      )}
      endedLede="Ended retirement and passive-income programmes remain listed as historical context, not current options."
    />
  );
}

export function TalentSkilledVisaPage({ data }: { data: CitizenshipRoutesData }) {
  return (
    <ResidenceShortlistPage
      data={data}
      category="talent_skilled"
      money={() => null}
      eyebrow="Talent and skilled routes"
      title="Talent and skilled routes, grouped by outcome."
      lede={(active, split) => (
        <p>
          {active.length} countries currently have a mapped route for designated talent, skills,
          achievement, or entrepreneurship. {split.cit + split.pr} have a recorded path beyond
          temporary residence. Country guides carry the actual eligibility tests and evidence.
        </p>
      )}
      endedLede="Ended talent and skilled programmes remain listed as historical context, not current options."
    />
  );
}

export function DigitalIdentityPage({ data }: { data: CitizenshipRoutesData }) {
  const slugByIso = buildCountrySlugMap(data.jurisdictions);
  const rows = (data.residence_routes ?? []).filter(route => route.category === 'digital_identity');
  const active = groupByCountry(rows.filter(route => route.status === 'active'), slugByIso);
  const pending = groupByCountry(rows.filter(route => route.status === 'pending_verification'), slugByIso);
  const inactive = groupByCountry(rows.filter(route => route.status === 'inactive'), slugByIso);

  return (
    <PageShell
      eyebrow="Digital identities"
      title="Government digital identities, by country."
      lede={(
        <p>
          {active.length} countries currently offer a mapped digital identity or e-residency
          programme for non-residents. These credentials can unlock remote government or business
          services; they do not grant residence, work rights, or citizenship.
        </p>
      )}
    >
      <ShortlistSection
        title="Available programmes"
        description="Open a country guide for eligibility, credential scope, and primary sources."
        groups={active}
        detail={group => `${group.routes.length} credential${group.routes.length === 1 ? '' : 's'} · no residence rights`}
      />
      {pending.length > 0 && (
        <details className="group mt-8 rounded-lg border bg-card px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Announced or pending <span className="text-muted-foreground/60">{pending.length}</span>
          </summary>
          <CountryShortlist groups={pending} detail={() => 'not yet verified as open'} />
        </details>
      )}
      {inactive.length > 0 && (
        <details className="group mt-3 rounded-lg border bg-card px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Paused or ended <span className="text-muted-foreground/60">{inactive.length}</span>
          </summary>
          <CountryShortlist groups={inactive} detail={() => 'not currently available'} />
        </details>
      )}
    </PageShell>
  );
}

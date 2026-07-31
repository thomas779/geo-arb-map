import type { CitizenshipRoute, CitizenshipRoutesData, ResidenceRoute } from '@/types';
import { buildCountrySlugMap } from '@/lib/slug';
import { countryFlag } from '@/lib/country';
import { ROUTE_CLASSES, type RouteClass } from '@/lib/route-classes';
import { WORK_RIGHTS_LABELS } from '@/lib/residence';

/**
 * Prerendered comparison pages for route types (/route-types/ hub +
 * /citizenship-by-investment, /golden-visas, /digital-nomad-visas).
 *
 * Tables, never card lists: the country page owns the prose, these pages own
 * the structured fields and the cross-country aggregates (tier splits, counts,
 * the closed-programme churn) that cannot live on any single country page.
 * Rendered via renderToStaticMarkup only; interactivity is limited to the
 * TABLE_SORT_JS script in build_country_pages, driven by data attributes.
 *
 * The signature element across hub and tables is the TIER BAR: each residence
 * family's routes split by how far they carry the holder, painted in the same
 * three tones the atlas legend uses (strong solid = citizenship, hatch = PR,
 * light = residence only). It is computed from the data, never decorative.
 */

const TIER_LABEL: Record<number, string> = { 0: 'TR', 1: 'Permanent residence', 2: 'Citizenship' };

/** Permit term: "5 yr · renews", "6 mo", or null when unrecorded. */
function fmtTerm(r: ResidenceRoute): string | null {
  const months = r.permit_duration_months;
  if (!months) return null;
  const base = months % 12 === 0 ? `${months / 12} yr` : `${months} mo`;
  return r.permit_renewable ? `${base} · renews` : base;
}

/**
 * First sentence only for table rows; the country page owns the full prose.
 * Splits only before a capital letter so legal citations survive intact
 * ("Ley 25.871 art. 51" must not end the sentence at "art.").
 */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s+[A-ZÀ-Ý"'“(]|$)/);
  return match ? match[0] : text;
}

function ladderTier(route: ResidenceRoute): number {
  if (route.counts_toward_naturalization) return 2;
  if (route.counts_toward_permanent_residence) return 1;
  return 0;
}

interface TierSplit { cit: number; pr: number; tr: number; total: number }

function tierSplit(routes: ResidenceRoute[]): TierSplit {
  const split = { cit: 0, pr: 0, tr: 0, total: routes.length };
  for (const r of routes) {
    const t = ladderTier(r);
    if (t === 2) split.cit += 1; else if (t === 1) split.pr += 1; else split.tr += 1;
  }
  return split;
}

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

/** Ladder pips on table rows: the same three-step vocabulary as the atlas Access levels. */
function LadderCell({ tier }: { tier: number }) {
  return (
    <span className="flex items-center gap-1.5" data-v={tier}>
      <span className="flex gap-0.5" aria-hidden>
        {[0, 1, 2].map(step => (
          <span key={step} className={`h-1 w-2.5 rounded-full ${step <= tier ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">{TIER_LABEL[tier]}</span>
    </span>
  );
}

function ConfidenceChip({ confidence }: { confidence: string }) {
  // House rule: the badge appears only below `high`. Labelling the majority
  // "verified" trains readers to ignore it exactly when it matters.
  if (confidence === 'high') return null;
  return (
    <span className="ml-1.5 rounded-full border px-1.5 py-px font-mono text-[0.6rem] text-muted-foreground">
      {confidence === 'low' ? 'unverified' : 'medium confidence'}
    </span>
  );
}

function CountryCell({ iso, name, slug }: { iso: string; name: string; slug?: string }) {
  const inner = (
    <>
      <span aria-hidden className="mr-1.5">{countryFlag(iso)}</span>
      {name}
    </>
  );
  return slug
    ? <a href={`/country/${slug}/`} className="font-medium hover:underline hover:underline-offset-2" data-v={name}>{inner}</a>
    : <span className="font-medium" data-v={name}>{inner}</span>;
}

function Th({ label, sortable = false, numeric = false }: { label: string; sortable?: boolean; numeric?: boolean }) {
  return (
    <th
      scope="col"
      {...(sortable ? { 'data-sort': numeric ? 'num' : 'text', tabIndex: 0, role: 'button' } : {})}
      className={`whitespace-nowrap border-b px-3 py-2 text-left font-mono text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground ${sortable ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
    >
      {label}
      {sortable && <span aria-hidden className="ml-1 opacity-60">↕</span>}
    </th>
  );
}

function Section({ title, lede, children }: { title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h2>
      {lede && <p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">{lede}</p>}
      {children}
    </section>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  // Wide content scrolls inside its own container; the page never scrolls sideways.
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[720px] border-collapse text-sm" data-sortable>
        {children}
      </table>
    </div>
  );
}

const CELL = 'border-b px-3 py-2.5 align-top';
const LAST_ROW_FIX = '[&>tr:last-child>td]:border-b-0';

function PageShell({ eyebrow, title, lede, children }: {
  eyebrow: string; title: string; lede: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1060px] px-4 py-10 sm:px-6">
      <nav className="mb-8 font-mono text-xs text-muted-foreground">
        <a href="/" className="underline underline-offset-2">Flag Paths</a> › <a href="/route-types/" className="underline underline-offset-2">Route types</a>
      </nav>
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
      <h1 className="mt-3 max-w-[720px] font-heading text-4xl font-bold leading-[1.1] sm:text-5xl">{title}</h1>
      <div className="mt-4 max-w-[68ch] text-base leading-relaxed text-muted-foreground">{lede}</div>
      {children}
      <p className="mt-10 max-w-[68ch] font-mono text-[0.68rem] leading-relaxed text-muted-foreground/80">
        Every row links to the country profile with its full conditions and primary sources.
        Confidence below high is flagged inline. Informational only, not legal advice.
      </p>
    </main>
  );
}

// ── /route-types/ hub ──

const TABLE_PAGE_BY_CLASS: Record<string, string> = {
  cbi: '/citizenship-by-investment/',
  'golden-visa': '/golden-visas/',
  'digital-nomad': '/digital-nomad-visas/',
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
    const n = cls.kind === 'citizenship'
      ? data.routes.filter(r => r.mode === cls.match && r.status === 'active').length
      : (data.residence_routes ?? []).filter(r => r.category === cls.match && r.status === 'active').length;
    counts.set(cls.id, n);
  }
  return counts;
}

function activeResidenceRoutes(data: CitizenshipRoutesData, cls: RouteClass): ResidenceRoute[] {
  return (data.residence_routes ?? []).filter(r => r.category === cls.match && r.status === 'active');
}

function HubRow({ cls, data, count }: { cls: RouteClass; data: CitizenshipRoutesData; count: number }) {
  const table = TABLE_PAGE_BY_CLASS[cls.id];
  const primaryHref = table ?? `/?class=${cls.id}`;
  // Digital identity grants no residence, so a "stops at residence" bar would
  // claim more than the routes do.
  const split = cls.kind === 'residence' && cls.id !== 'digital-identity'
    ? tierSplit(activeResidenceRoutes(data, cls))
    : null;
  return (
    <li className="border-b py-5 last:border-b-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-xl font-semibold leading-tight">
            <a href={primaryHref} className="hover:underline hover:underline-offset-4 hover:decoration-primary">
              {cls.label}
            </a>
          </h3>
          <p className="mt-1 max-w-[56ch] text-sm text-muted-foreground">{HUB_DESCRIPTION[cls.id] ?? cls.description}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
            {table && (
              <a href={table} className="text-primary hover:underline hover:underline-offset-2">Compare programmes →</a>
            )}
            <a href={`/?class=${cls.id}`} className="text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-2">
              Paint it on the atlas →
            </a>
          </p>
        </div>
        {split && split.total > 0 && (
          <div className="w-full shrink-0 sm:w-60">
            <TierBar split={split} />
            <p className="mt-1.5 font-mono text-[0.64rem] leading-snug text-muted-foreground">{tierCaption(split)}</p>
          </div>
        )}
        <div className="flex shrink-0 items-baseline gap-1.5 sm:w-24 sm:flex-col sm:items-end sm:gap-0 sm:text-right">
          <span className="font-heading text-3xl font-bold leading-none tabular-nums">{count}</span>
          <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">active</span>
        </div>
      </div>
    </li>
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
    <main className="mx-auto max-w-[1060px] px-4 py-10 sm:px-6">
      <nav className="mb-8 font-mono text-xs text-muted-foreground">
        <a href="/" className="underline underline-offset-2">Flag Paths</a> › Route types
      </nav>
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-primary">Route types</p>
      <h1 className="mt-3 max-w-[720px] font-heading text-4xl font-bold leading-[1.1] sm:text-5xl">
        Every way in, by the shape of the route.
      </h1>
      <p className="mt-4 max-w-[68ch] text-base leading-relaxed text-muted-foreground">
        Money, ancestry, residence, or skills going in. A permit, a settlement right, or a passport
        coming out. Pick a family to compare programmes line by line, or paint it on the atlas.
      </p>
      {shelves.map(shelf => (
        <section key={shelf.kind} className="mt-12">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{shelf.label}</h2>
          <p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">{shelf.intro}</p>
          <ul className="mt-2">
            {ROUTE_CLASSES.filter(cls => cls.kind === shelf.kind).map(cls => (
              <HubRow key={cls.id} cls={cls} data={data} count={counts.get(cls.id) ?? 0} />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

// ── /citizenship-by-investment/ ──

export function CbiPage({ data }: { data: CitizenshipRoutesData }) {
  const slugByIso = buildCountrySlugMap(data.jurisdictions);
  const rows = data.routes.filter(r => r.mode === 'investment');
  const byName = (a: CitizenshipRoute, b: CitizenshipRoute) => a.country.name.localeCompare(b.country.name);
  const active = rows.filter(r => r.status === 'active').sort(byName);
  const closed = rows.filter(r => r.status === 'inactive').sort(byName);
  const pending = rows.filter(r => r.status === 'pending_verification').sort(byName);

  const routeRow = (r: CitizenshipRoute) => (
    <tr key={r.id}>
      <td className={CELL}>
        <CountryCell iso={r.country.iso_n3} name={r.country.name} slug={slugByIso.get(r.country.iso_n3)} />
      </td>
      <td className={CELL}>
        <span className="font-medium">{r.title}</span>
        <ConfidenceChip confidence={r.confidence} />
        <span className="mt-1 block max-w-[52ch] text-xs leading-relaxed text-muted-foreground">{r.summary}</span>
      </td>
      <td className={`${CELL} whitespace-nowrap font-mono text-xs text-muted-foreground`} data-v={r.last_checked}>
        {r.last_checked}
      </td>
    </tr>
  );

  return (
    <PageShell
      eyebrow="Citizenship by investment"
      title="Passports you can buy. Every programme with a legal basis."
      lede={(
        <p>
          {active.length} jurisdictions currently grant citizenship directly for a qualifying
          investment or contribution. Marketing lists run much longer than this one because they
          count closed programmes, bills that never passed, and golden visas dressed up as
          passports. Residence by investment is a different product with{' '}
          <a href="/golden-visas/" className="underline underline-offset-2 hover:text-foreground">its own page</a>.
        </p>
      )}
    >
      <Section title={`Active programmes (${active.length})`}>
        <TableWrap>
          <thead><tr><Th label="Country" sortable /><Th label="Programme" /><Th label="Checked" sortable /></tr></thead>
          <tbody className={LAST_ROW_FIX}>{active.map(routeRow)}</tbody>
        </TableWrap>
        <p className="mt-2 max-w-[80ch] font-mono text-[0.68rem] text-muted-foreground/80">
          Eligibility can hinge on the passport you already hold: several programmes exclude
          specific nationalities. The country profile carries those conditions where recorded.
        </p>
      </Section>
      <Section
        title={`Closed programmes (${closed.length})`}
        lede="Programmes that ran and ended, kept visible because closure is the story: CBI is volatile, and a passport pitch built on a closed programme is the most common scam in this market."
      >
        <TableWrap>
          <thead><tr><Th label="Country" sortable /><Th label="What happened" /><Th label="Checked" sortable /></tr></thead>
          <tbody className={LAST_ROW_FIX}>{closed.map(routeRow)}</tbody>
        </TableWrap>
      </Section>
      {pending.length > 0 && (
        <Section
          title={`Statutory leads pending verification (${pending.length})`}
          lede="Law on the books, but current operation unverified against official sources. Not recommendations."
        >
          <TableWrap>
            <thead><tr><Th label="Country" sortable /><Th label="Status" /><Th label="Checked" sortable /></tr></thead>
            <tbody className={LAST_ROW_FIX}>{pending.map(routeRow)}</tbody>
          </TableWrap>
        </Section>
      )}
    </PageShell>
  );
}

// ── residence-route table pages (golden visa / digital nomad) ──

function residenceRow(r: ResidenceRoute, slug: string | undefined, money: (r: ResidenceRoute) => string | null) {
  const amount = money(r);
  return (
    <tr key={r.id}>
      <td className={CELL}>
        <CountryCell iso={r.country.iso_n3} name={r.country.name} slug={slug} />
      </td>
      <td className={CELL}>
        <span className="font-medium">{r.title}</span>
        <ConfidenceChip confidence={r.confidence} />
        <span className="mt-1 block max-w-[46ch] text-xs leading-relaxed text-muted-foreground">{firstSentence(r.summary)}</span>
      </td>
      <td className={`${CELL} whitespace-nowrap font-mono text-xs`}>
        {amount
          ? <><span className="text-muted-foreground/60">from </span>{amount}</>
          : <span className="text-muted-foreground/50" title="No amount recorded from the instrument">—</span>}
      </td>
      <td className={`${CELL} whitespace-nowrap font-mono text-xs text-muted-foreground`} data-v={r.permit_duration_months ?? 0}>
        {fmtTerm(r) ?? <span className="text-muted-foreground/50" title="Not yet read from the instrument">—</span>}
      </td>
      <td className={CELL}><LadderCell tier={ladderTier(r)} /></td>
      <td className={`${CELL} whitespace-nowrap text-xs`} data-v={r.work_rights ?? 'zz'}>
        {r.work_rights
          ? <span className="text-muted-foreground">{WORK_RIGHTS_LABELS[r.work_rights].long}</span>
          : <span className="text-muted-foreground/50" title="Not yet read from the instrument">—</span>}
      </td>
      <td className={`${CELL} whitespace-nowrap font-mono text-xs text-muted-foreground`} data-v={r.last_checked}>
        {r.last_checked}
      </td>
    </tr>
  );
}

function ResidenceTablePage({ data, category, moneyHeader, money, moneyRecordedLabel, eyebrow, title, lede, endedLede }: {
  data: CitizenshipRoutesData;
  category: string;
  moneyHeader: string;
  money: (r: ResidenceRoute) => string | null;
  moneyRecordedLabel: string;
  eyebrow: string;
  title: string;
  lede: (active: ResidenceRoute[], split: TierSplit) => React.ReactNode;
  endedLede: string;
}) {
  const slugByIso = buildCountrySlugMap(data.jurisdictions);
  const rows = (data.residence_routes ?? []).filter(r => r.category === category);
  const byName = (a: ResidenceRoute, b: ResidenceRoute) => a.country.name.localeCompare(b.country.name);
  const active = rows.filter(r => r.status === 'active').sort(byName);
  const ended = rows.filter(r => r.status === 'inactive').sort(byName);
  const split = tierSplit(active);
  const withMoney = active.filter(r => money(r) !== null).length;

  return (
    <PageShell eyebrow={eyebrow} title={title} lede={lede(active, split)}>
      <Section title={`Active programmes (${active.length})`}>
        {/* The page's aggregate view: the same tier bar as the hub, so 100+
            rows arrive pre-summarised instead of as an undifferentiated dump. */}
        <div className="mt-4 max-w-[560px]">
          <TierBar split={split} height="h-2" />
          <p className="mt-1.5 font-mono text-[0.68rem] text-muted-foreground">
            {tierCaption(split)} · {moneyRecordedLabel.replace('{n}', String(withMoney))}
          </p>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <Th label="Country" sortable />
              <Th label="Programme" />
              <Th label={moneyHeader} />
              <Th label="Term" sortable numeric />
              <Th label="Counts toward" sortable numeric />
              <Th label="Local work" sortable />
              <Th label="Checked" sortable />
            </tr>
          </thead>
          <tbody className={LAST_ROW_FIX}>
            {active.map(r => residenceRow(r, slugByIso.get(r.country.iso_n3), money))}
          </tbody>
        </TableWrap>
        <p className="mt-2 max-w-[80ch] font-mono text-[0.68rem] leading-relaxed text-muted-foreground/80">
          "From" amounts are the statutory floor; many programmes band by age, family size, or
          investment option, and the country profile carries the variants. Amounts are in each
          programme's own currency and are not comparable across rows without conversion.
          "Term" is one grant's validity; "renews" appears only where the instrument says so.
          "Counts toward" states whose clock this permit runs: citizenship means time here counts
          toward naturalization, not that the visa grants a passport. "Local work" is read from
          the instrument, never inferred; a dash means not yet recorded, not "no". Eligibility can
          also hinge on the passport you already hold. The country profile carries those
          conditions where recorded.
        </p>
      </Section>
      {ended.length > 0 && (
        <Section title={`Ended programmes (${ended.length})`} lede={endedLede}>
          <TableWrap>
            <thead>
              <tr><Th label="Country" sortable /><Th label="Programme" /><Th label="What happened" /></tr>
            </thead>
            <tbody className={LAST_ROW_FIX}>
              {ended.map(r => (
                <tr key={r.id}>
                  <td className={CELL}>
                    <CountryCell iso={r.country.iso_n3} name={r.country.name} slug={slugByIso.get(r.country.iso_n3)} />
                  </td>
                  <td className={`${CELL} font-medium`}>{r.title}</td>
                  <td className={`${CELL} max-w-[52ch] text-xs leading-relaxed text-muted-foreground`}>{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Section>
      )}
    </PageShell>
  );
}

export function GoldenVisaPage({ data }: { data: CitizenshipRoutesData }) {
  return (
    <ResidenceTablePage
      data={data}
      category="investment"
      moneyHeader="Min. investment"
      money={r => fmtMoney(r.min_investment)}
      moneyRecordedLabel="minimum recorded for {n}"
      eyebrow="Golden visas"
      title="Residence by investment, with the ladder made explicit."
      lede={(active, split) => (
        <p>
          {active.length} active programmes grant residence for a qualifying investment. The entry
          price is the least interesting column here: what separates these programmes is whose
          clock they run. Time on {split.cit} of them counts toward citizenship, {split.pr} count
          toward permanent residence, and {split.tr} are pure temporary residence with no credit at
          all. Direct citizenship for investment is a much shorter list with{' '}
          <a href="/citizenship-by-investment/" className="underline underline-offset-2 hover:text-foreground">its own page</a>.
        </p>
      )}
      endedLede="Golden visas churn. Programmes close under EU pressure, housing politics, or security review; a closed programme still being marketed is a red flag."
    />
  );
}

export function NomadVisaPage({ data }: { data: CitizenshipRoutesData }) {
  return (
    <ResidenceTablePage
      data={data}
      category="digital_nomad"
      moneyHeader="Min. monthly income"
      money={r => fmtMoney(r.min_income_monthly)}
      moneyRecordedLabel="income floor recorded for {n}"
      eyebrow="Digital nomad visas"
      title="Remote-work visas, sorted by what they actually lead to."
      lede={(active, split) => {
        const exceptions = [...new Set(active
          .filter(r => r.counts_toward_permanent_residence || r.counts_toward_naturalization)
          .map(r => r.country.name))].sort();
        return (
          <p>
            {active.length} active programmes admit remote workers on foreign income. Most are pure
            temporary residence: time-boxed stays whose years count toward nothing.
            {' '}{exceptions.length > 0
              ? `The exceptions, where the clock genuinely runs: ${exceptions.join(', ')}. If a nomad visa is meant to become a settlement strategy, that short list is the strategy.`
              : 'None currently counts toward settlement.'}
          </p>
        );
      }}
      endedLede="Several pandemic-era nomad programmes have quietly lapsed. Each ended row's run dates live on the country profile."
    />
  );
}

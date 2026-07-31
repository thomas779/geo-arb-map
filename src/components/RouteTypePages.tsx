import type { CitizenshipRoute, CitizenshipRoutesData, ResidenceRoute } from '@/types';
import { buildCountrySlugMap } from '@/lib/slug';
import { countryFlag } from '@/lib/country';
import { ROUTE_CLASSES } from '@/lib/route-classes';

/**
 * Prerendered comparison pages for route types (/route-types/ hub +
 * /citizenship-by-investment, /golden-visas, /digital-nomad-visas).
 *
 * Tables, never card lists — the country page owns the prose; these pages own
 * the structured fields and the cross-country aggregates (counts, thresholds,
 * the closed-programme churn) that cannot live on any single country page.
 * Rendered via renderToStaticMarkup only: interactivity is limited to the
 * TABLE_SORT_JS script in build_country_pages, driven by data attributes.
 */

const TIER_LABEL: Record<number, string> = { 0: 'Residence only', 1: 'Permanent residence', 2: 'Citizenship' };

function ladderTier(route: ResidenceRoute): number {
  if (route.counts_toward_naturalization) return 2;
  if (route.counts_toward_permanent_residence) return 1;
  return 0;
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

/** Ladder pips — the same three-step vocabulary as the atlas Access levels. */
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
  // House rule: the badge appears only below `high` — labelling the majority
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
      <table className="w-full min-w-[640px] border-collapse text-sm" data-sortable>
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
        Confidence below high is flagged inline. Informational only — not legal advice.
      </p>
    </main>
  );
}

// ── /route-types/ hub ──

// ROUTE_CLASSES descriptions are written for the atlas sidebar; a couple
// reference UI that doesn't exist on this page, so the hub overrides them.
const HUB_DESCRIPTION: Record<string, string> = {
  'golden-visa': 'Residence for a qualifying investment. Not citizenship — the table shows how far each programme leads.',
};

const TABLE_PAGE_BY_CLASS: Record<string, string> = {
  cbi: '/citizenship-by-investment/',
  'golden-visa': '/golden-visas/',
  'digital-nomad': '/digital-nomad-visas/',
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

export function RouteTypesHub({ data }: { data: CitizenshipRoutesData }) {
  const counts = routeClassCounts(data);
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
        The same eight route families the atlas paints, as browsable lists: what you put in
        (money, ancestry, residence, skills) and how far each programme can carry you —
        temporary residence, permanent residence, or a passport.
      </p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {ROUTE_CLASSES.map(cls => {
          const table = TABLE_PAGE_BY_CLASS[cls.id];
          const n = counts.get(cls.id) ?? 0;
          return (
            <li key={cls.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-lg font-semibold leading-tight">
                  {table ? <a href={table} className="hover:underline hover:underline-offset-2">{cls.label}</a> : cls.label}
                </h2>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {n} active
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{HUB_DESCRIPTION[cls.id] ?? cls.description}</p>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
                {table && <a href={table} className="text-primary hover:underline hover:underline-offset-2">Compare programmes →</a>}
                <a href={`/?class=${cls.id}`} className="text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-2">
                  See it on the atlas →
                </a>
              </p>
            </li>
          );
        })}
      </ul>
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
      title="Passports you can buy — every programme with a legal basis."
      lede={(
        <>
          <p>
            {active.length} jurisdictions currently grant citizenship directly for a qualifying
            investment or contribution. Marketing lists run much longer than this one because they
            count programmes that have closed, bills that were never enacted, and golden visas —
            residence permits — dressed up as passports.{' '}
            <a href="/golden-visas/" className="underline underline-offset-2 hover:text-foreground">Residence-by-investment lives on its own page.</a>
          </p>
        </>
      )}
    >
      <Section title={`Active programmes (${active.length})`}>
        <TableWrap>
          <thead><tr><Th label="Country" sortable /><Th label="Programme" /><Th label="Checked" sortable /></tr></thead>
          <tbody className={LAST_ROW_FIX}>{active.map(routeRow)}</tbody>
        </TableWrap>
      </Section>
      <Section
        title={`Closed programmes (${closed.length})`}
        lede="Programmes that ran and ended — kept visible because closure is the story: CBI is volatile, and a passport pitch built on a closed programme is the most common scam in this market."
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
      </td>
      <td className={`${CELL} whitespace-nowrap font-mono text-xs`}>
        {amount ?? <span className="text-muted-foreground/60">—</span>}
      </td>
      <td className={CELL}><LadderCell tier={ladderTier(r)} /></td>
      <td className={`${CELL} whitespace-nowrap font-mono text-xs text-muted-foreground`} data-v={r.last_checked}>
        {r.last_checked}
      </td>
    </tr>
  );
}

function ResidenceTablePage({ data, category, moneyHeader, money, eyebrow, title, lede, endedLede }: {
  data: CitizenshipRoutesData;
  category: string;
  moneyHeader: string;
  money: (r: ResidenceRoute) => string | null;
  eyebrow: string;
  title: string;
  lede: React.ReactNode;
  endedLede: string;
}) {
  const slugByIso = buildCountrySlugMap(data.jurisdictions);
  const rows = (data.residence_routes ?? []).filter(r => r.category === category);
  const byName = (a: ResidenceRoute, b: ResidenceRoute) => a.country.name.localeCompare(b.country.name);
  const active = rows.filter(r => r.status === 'active').sort(byName);
  const ended = rows.filter(r => r.status === 'inactive').sort(byName);

  return (
    <PageShell eyebrow={eyebrow} title={title} lede={lede}>
      <Section title={`Active programmes (${active.length})`}>
        <TableWrap>
          <thead>
            <tr>
              <Th label="Country" sortable />
              <Th label="Programme" />
              <Th label={moneyHeader} />
              <Th label="Leads to" sortable numeric />
              <Th label="Checked" sortable />
            </tr>
          </thead>
          <tbody className={LAST_ROW_FIX}>
            {active.map(r => residenceRow(r, slugByIso.get(r.country.iso_n3), money))}
          </tbody>
        </TableWrap>
        <p className="mt-2 font-mono text-[0.68rem] text-muted-foreground/80">
          Amounts are statutory minimums in the programme's own currency and are not comparable across rows without conversion.
          "Leads to" is the best outcome the route itself can reach — the same TR → PR → CIT ladder the atlas paints.
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
  const n = (data.residence_routes ?? []).filter(r => r.category === 'investment' && r.status === 'active').length;
  return (
    <ResidenceTablePage
      data={data}
      category="investment"
      moneyHeader="Min. investment"
      money={r => fmtMoney(r.min_investment)}
      eyebrow="Golden visas"
      title="Residence by investment, with the ladder made explicit."
      lede={(
        <p>
          {n} active programmes grant residence for a qualifying investment. The number that matters
          is not the entry price but the ladder: many golden visas stop at residence, some reach
          permanent residence, and a minority genuinely count toward citizenship. Direct
          citizenship-for-investment is a different, much shorter list —{' '}
          <a href="/citizenship-by-investment/" className="underline underline-offset-2 hover:text-foreground">see the CBI page</a>.
        </p>
      )}
      endedLede="Golden visas churn: programmes close under EU pressure, housing politics, or security review. A closed programme still being marketed is a red flag."
    />
  );
}

export function NomadVisaPage({ data }: { data: CitizenshipRoutesData }) {
  const n = (data.residence_routes ?? []).filter(r => r.category === 'digital_nomad' && r.status === 'active').length;
  return (
    <ResidenceTablePage
      data={data}
      category="digital_nomad"
      moneyHeader="Min. monthly income"
      money={r => fmtMoney(r.min_income_monthly)}
      eyebrow="Digital nomad visas"
      title="Remote-work visas, sorted by what they actually lead to."
      lede={(
        <p>
          {n} active programmes admit remote workers on foreign income. Most are time-boxed permits
          that lead nowhere — paid stays, not immigration routes. The exceptions that count toward
          permanent residence or citizenship are what make this table worth reading.
        </p>
      )}
      endedLede="Several pandemic-era nomad programmes have quietly lapsed. Each ended row carries its run dates in the country profile."
    />
  );
}

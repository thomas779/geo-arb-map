import type { ReactNode } from 'react';
import type { AtlasIndexData, BilateralLane, Bloc, BlocRights, BlocsData } from '@/types';
import { buildCountrySlugMap, entitySlug } from '@/lib/slug';
import { countryFlag } from '@/lib/country';
import { ExternalSourceLink } from '@/components/ExternalSourceLink';
import { displayRouteTitle } from '@/lib/display-title';
import { dataCorrectionUrl, sourceUrl } from '@/lib/trust';

// Shared full-page profiles for regional systems (blocs → /rights/<slug>) and
// regional systems (/rights/<slug>). Used by the interactive app
// (in-app nav) and the static SSR prerender (scripts/build_country_pages.ts),
// so a page and its atlas panel can't drift. Mirrors CountryProfile.

export const BLOC_CATEGORY_LABEL: Record<Bloc['category'], string> = {
  full: 'Established rights',
  closed: 'Established rights',
  partial: 'Limited framework',
  hub_spoke: 'Hub-and-spoke',
  one_way: 'One-way access',
  proto: 'Emerging framework',
};

const ALLOCATION_LABEL: Record<NonNullable<BilateralLane['allocation']>, string> = {
  right: 'Entitlement',
  ballot: 'Ballot / lottery',
  quota_queue: 'Quota queue',
  discretionary: 'Discretionary',
};

interface MemberLink {
  iso: string;
  name: string;
  slug: string | null;
}

export interface BlocProfileData {
  kind: 'bloc';
  id: string;
  slug: string;
  name: string;
  category: Bloc['category'];
  categoryLabel: string;
  color: string;
  rights: BlocRights;
  members: MemberLink[];
  notes: string;
  description: string;
}

export interface RouteProfileData {
  kind: 'lane';
  id: string;
  slug: string;
  name: string;
  destination: MemberLink;
  leadsToSettlement: boolean;
  allocation: NonNullable<BilateralLane['allocation']>;
  grants: string;
  limits: string;
  beneficiariesNote: string | null;
  renouncesPrevious: boolean;
  sources: string[];
  description: string;
}

export type RightsProfileData = BlocProfileData | RouteProfileData;

function memberLink(m: { iso_n3: string; name: string }, countrySlugs: Map<string, string>): MemberLink {
  return { iso: m.iso_n3, name: m.name, slug: countrySlugs.get(m.iso_n3) ?? null };
}

/** Blocs that get a /rights page (all of them). */
export function blocsForPages(mobility: BlocsData): Bloc[] {
  return mobility.blocs;
}

/** @deprecated Heritage /route pages dissolved; kept as empty for build script imports until removed. */
export function routeLanesForPages(_mobility: BlocsData): BilateralLane[] {
  return [];
}

export function deriveBlocProfile(
  id: string,
  mobility: BlocsData,
  citizenship: AtlasIndexData,
): BlocProfileData | null {
  const bloc = mobility.blocs.find(b => b.id === id);
  if (!bloc) return null;
  const countrySlugs = buildCountrySlugMap(citizenship.jurisdictions);
  const slug = entitySlug(id);
  const categoryLabel = BLOC_CATEGORY_LABEL[bloc.category];
  const name = displayRouteTitle(bloc.name);
  // Used only for the page's <meta>/OG description (SEO snippet), not shown on-page.
  const description = `${name}: what residence and citizenship rights it grants, `
    + `and its ${bloc.members.length} member countries.`;
  return {
    kind: 'bloc',
    id,
    slug,
    name,
    category: bloc.category,
    categoryLabel,
    color: bloc.color,
    rights: bloc.rights,
    members: bloc.members
      .map(m => memberLink(m, countrySlugs))
      .sort((a, b) => a.name.localeCompare(b.name)),
    notes: bloc.notes,
    description,
  };
}

export function deriveRouteProfile(
  id: string,
  mobility: BlocsData,
  citizenship: AtlasIndexData,
): RouteProfileData | null {
  const lane = mobility.bilateral_lanes.find(l => l.id === id);
  if (!lane) return null;
  const countrySlugs = buildCountrySlugMap(citizenship.jurisdictions);
  const slug = entitySlug(id);
  const name = displayRouteTitle(lane.name);
  // Used only for the page's <meta>/OG description (SEO snippet), not shown on-page.
  const description = `${name}: who qualifies for ${lane.destination.name}, what it grants, and the limits.`;
  return {
    kind: 'lane',
    id,
    slug,
    name,
    destination: memberLink(lane.destination, countrySlugs),
    leadsToSettlement: lane.leads_to_settlement,
    allocation: lane.allocation ?? 'right',
    grants: lane.grants,
    limits: lane.limits,
    beneficiariesNote: lane.beneficiaries_note ?? null,
    renouncesPrevious: Boolean(lane.renounces_previous),
    sources: lane.sources ?? [],
    description,
  };
}

function Eyebrow({ children, divider = true }: { children: ReactNode; divider?: boolean }) {
  return (
    <h2 className={`mb-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground${divider ? ' border-t pt-5' : ''}`}>
      {children}
    </h2>
  );
}

function MemberGrid({ members }: { members: MemberLink[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {members.map(m => {
        const inner = (
          <>
            <span className="shrink-0 text-base" aria-hidden>{countryFlag(m.iso)}</span>
            <span className="truncate">{m.name}</span>
          </>
        );
        return m.slug ? (
          <a
            key={m.iso}
            href={`/country/${m.slug}`}
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary"
          >
            {inner}
          </a>
        ) : (
          <span key={m.iso} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
            {inner}
          </span>
        );
      })}
    </div>
  );
}

function Shell({
  breadcrumb,
  title,
  emoji,
  facts,
  atlasHref,
  sectionNav,
  children,
  reportHref,
  footerExtra,
}: {
  breadcrumb: { label: string; href: string };
  title: string;
  emoji: ReactNode;
  facts: Array<[string, string]>;
  atlasHref: string;
  sectionNav: Array<[string, string]>;
  children: ReactNode;
  reportHref: string;
  footerExtra: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1060px] px-4 py-8 sm:px-6">
      <nav className="mb-6 font-mono text-xs text-muted-foreground">
        <a href="/" className="underline underline-offset-2">Flag Paths</a> ›{' '}
        <a href={breadcrumb.href} className="underline underline-offset-2">{breadcrumb.label}</a> › {title}
      </nav>
      <div className="grid gap-8 md:grid-cols-[266px_1fr] md:items-start">
        <aside className="md:sticky md:top-20">
          <div className="text-4xl leading-none" aria-hidden>{emoji}</div>
          <h1 className="mb-4 mt-2 font-heading text-3xl font-bold tracking-tight">{title}</h1>
          <dl className="mb-4 flex flex-col gap-3 rounded-lg border bg-card p-4">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <a href={atlasHref} className="block rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground hover:brightness-105">
            Open in the interactive atlas →
          </a>
          <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 font-mono text-xs text-muted-foreground">
            {sectionNav.map(([label, href]) => (
              <a key={href} href={href} className="hover:text-foreground">{label}</a>
            ))}
          </nav>
        </aside>
        <div>
          {children}
          <footer className="mt-10 border-t pt-5 text-xs text-muted-foreground">
            <p>Data is compiled from official and primary legal sources and reviewed for the Flag Paths atlas. Arrangements change; verify against official sources before acting.</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {footerExtra}
              <a href={reportHref} target="_blank" rel="noreferrer" className="underline underline-offset-2">Report this arrangement</a>
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}

function BlocPage({ data }: { data: BlocProfileData }) {
  const sectionNav: Array<[string, string]> = [['Rights', '#rights'], ['Members', '#members']];
  if (data.notes) sectionNav.push(['Notes', '#notes']);
  return (
    <Shell
      breadcrumb={{ label: 'Rights', href: '/rights' }}
      title={data.name}
      emoji={<span className="inline-block size-7 rounded-md align-middle" style={{ background: data.color }} aria-hidden />}
      facts={[['Type', data.categoryLabel], ['Member countries', String(data.members.length)]]}
      atlasHref={`/?blocs=${data.id}`}
      sectionNav={sectionNav}
      reportHref={dataCorrectionUrl(data.name, `bloc:${data.id}`)}
      footerExtra={<a href="/rights" className="underline underline-offset-2">All regional systems</a>}
    >
      <section id="rights" className="scroll-mt-20">
        <Eyebrow divider={false}>Rights by status</Eyebrow>
        <p className="mb-3 max-w-[62ch] text-sm text-muted-foreground">
          Read the row matching the status you would hold. Domestic citizenship rules remain country-specific.
        </p>
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border">
          {([['TR', data.rights.TR], ['PR', data.rights.PR], ['CIT', data.rights.CIT]] as const).map(([tier, text]) => (
            <div key={tier} className="grid grid-cols-[44px_1fr] gap-3 bg-card px-4 py-3">
              <span className="pt-0.5 font-mono text-[11px] font-semibold text-muted-foreground">{tier}</span>
              <p className="text-sm leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="members" className="mt-8 scroll-mt-20">
        <Eyebrow>Member countries</Eyebrow>
        <p className="mb-3 max-w-[62ch] text-sm text-muted-foreground">
          Open a country for its domestic naturalization, birth, ancestry, and investment rules.
        </p>
        <MemberGrid members={data.members} />
      </section>
      {data.notes && (
        <section id="notes" className="mt-8 scroll-mt-20">
          <Eyebrow>Scope notes</Eyebrow>
          <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">{data.notes}</p>
        </section>
      )}
    </Shell>
  );
}

function RoutePage({ data }: { data: RouteProfileData }) {
  const destHref = data.destination.slug ? `/country/${data.destination.slug}` : `/?country=${data.destination.iso}`;
  return (
    <Shell
      breadcrumb={{ label: 'Countries', href: '/country' }}
      title={data.name}
      emoji={<span aria-hidden>{countryFlag(data.destination.iso)}</span>}
      facts={[
        ['Destination', data.destination.name],
        ['Type', data.leadsToSettlement ? 'Settlement path' : 'Temporary access'],
        ...(data.allocation !== 'right' ? [['Allocation', ALLOCATION_LABEL[data.allocation]] as [string, string]] : []),
      ]}
      atlasHref={`/?lane=${data.id}`}
      sectionNav={[['What you get', '#grants'], ...(data.sources.length ? [['Sources', '#sources'] as [string, string]] : [])]}
      reportHref={dataCorrectionUrl(data.name, `lane:${data.id}`)}
      footerExtra={<a href="/country" className="underline underline-offset-2">All countries</a>}
    >
      <section id="grants" className="scroll-mt-20">
        <Eyebrow divider={false}>What this path provides</Eyebrow>
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border">
          <div className="grid grid-cols-[56px_1fr] gap-3 bg-card px-4 py-3">
            <span className="pt-0.5 font-mono text-[11px] font-semibold text-verified">GET</span>
            <p className="text-sm leading-relaxed">{data.grants}</p>
          </div>
          <div className="grid grid-cols-[56px_1fr] gap-3 bg-card px-4 py-3">
            <span className="pt-0.5 font-mono text-[11px] font-semibold text-muted-foreground">LIMIT</span>
            <p className="text-sm leading-relaxed">{data.limits}</p>
          </div>
        </div>
        {data.renouncesPrevious && (
          <p className="mt-3 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            Naturalizing here may require renouncing your current citizenship.
          </p>
        )}
        {data.beneficiariesNote && (
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">{data.beneficiariesNote}</p>
        )}
        <div className="mt-4">
          <a href={destHref} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary">
            <span aria-hidden>{countryFlag(data.destination.iso)}</span>
            {data.destination.name} country guide →
          </a>
        </div>
      </section>
      {data.sources.length > 0 && (
        <section id="sources" className="mt-8 scroll-mt-20">
          <Eyebrow>Sources</Eyebrow>
          <ul className="space-y-2">
            {data.sources.map(source => {
              const href = sourceUrl(source);
              return (
                <li key={source} className="text-sm leading-relaxed text-muted-foreground">
                  {href
                    ? <ExternalSourceLink href={href}>{source}</ExternalSourceLink>
                    : source}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Shell>
  );
}

export function RightsProfile({ data }: { data: RightsProfileData }) {
  return data.kind === 'bloc' ? <BlocPage data={data} /> : <RoutePage data={data} />;
}

// ── Hub lists ──────────────────────────────────────────────────────────────

const HUB_GROUPS: Array<{ label: string; description: string; categories: Bloc['category'][] }> = [
  {
    label: 'Broad cross-border rights',
    description: 'Established systems with practical residence or work rights.',
    categories: ['full', 'closed'],
  },
  {
    label: 'Conditional access',
    description: 'Access depends on nationality, direction, or local rules.',
    categories: ['partial', 'hub_spoke', 'one_way'],
  },
  {
    label: 'Developing systems',
    description: 'Cooperation exists, but dependable movement rights remain limited.',
    categories: ['proto'],
  },
];

function blocOutcome(bloc: Bloc): string {
  if (bloc.category === 'full' || bloc.category === 'closed') {
    return `Shared residence or work rights · ${bloc.members.length} countries`;
  }
  if (bloc.category === 'proto') {
    return `Developing cooperation · ${bloc.members.length} countries`;
  }
  return `Conditional cross-border access · ${bloc.members.length} countries`;
}

export function RightsList({ mobility }: { mobility: BlocsData }) {
  return (
    <main className="mx-auto max-w-[1060px] px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Rights that reach beyond one country</h1>
      <p className="mt-3 max-w-[68ch] text-muted-foreground">
        Some passports and residence statuses let you live or work in other countries. Choose a system to see
        the status you need, what it unlocks, and its member countries.
      </p>
      <a href="/" className="mb-8 mt-3 inline-flex text-sm font-medium text-primary hover:underline">
        See these systems on the atlas →
      </a>
      {HUB_GROUPS.map(group => {
        const blocs = mobility.blocs
          .filter(b => group.categories.includes(b.category))
          .sort((a, b) => b.members.length - a.members.length);
        if (!blocs.length) return null;
        return (
          <section key={group.label} className="mb-8">
            <div className="mb-3">
              <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-foreground">{group.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {blocs.map(b => (
                <a key={b.id} href={`/rights/${entitySlug(b.id)}`} className="group flex min-h-[76px] items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:border-primary">
                  <span className="size-3 shrink-0 rounded-[3px]" style={{ background: b.color }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug">{displayRouteTitle(b.name)}</span>
                    <span className="mt-1 block text-xs leading-snug text-muted-foreground">{blocOutcome(b)}</span>
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
                </a>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

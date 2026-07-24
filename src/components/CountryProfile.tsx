import type { ReactNode } from 'react';
import type { BlocsData, CitizenshipRoute, CitizenshipRoutesData, ResidenceCategory, ResidenceRoute } from '@/types';
import { buildCountrySlugMap, entitySlug } from '@/lib/slug';
import { countryFlag } from '@/lib/country';

// Shared per-country page derivation + labels, used by the interactive app
// (dev + in-app nav) and by the static SSR prerender (scripts/build_country_pages.ts),
// so the country pages are a single source of truth with the app.

export const CITIZENSHIP_MODE_LABELS: Record<string, string> = {
  ancestry: 'Ancestry', naturalization: 'Naturalization', birth: 'Birth', investment: 'Investment',
};
export const RESIDENCE_CATEGORY_LABELS: Record<ResidenceCategory, string> = {
  investment: 'Investment (golden visa)',
  digital_nomad: 'Digital nomad',
  retirement_pension: 'Retirement',
  talent_skilled: 'Talent',
  general_permanent_residence: 'Permanent residence',
};
const COVERAGE_ORDER = ['ancestry', 'naturalization', 'birth', 'investment'] as const;

export interface CountryProfileData {
  iso: string;
  name: string;
  slug: string;
  coverage: Record<string, string>;
  routes: CitizenshipRoute[];
  residence: ResidenceRoute[];
  blocs: BlocsData['blocs'];
  lanesIn: BlocsData['bilateral_lanes'];
  reviewedModes: number;
  cheapest: ResidenceRoute['min_investment'];
  description: string;
}

/** Resolve everything a country page needs from the public data. Returns null if the iso is unknown. */
export function deriveCountryProfile(
  iso: string,
  citizenshipRoutes: CitizenshipRoutesData,
  mobility: BlocsData,
): CountryProfileData | null {
  const jur = citizenshipRoutes.jurisdictions.find(j => j.iso_n3 === iso);
  if (!jur) return null;
  const routes = citizenshipRoutes.routes.filter(r => r.country.iso_n3 === iso);
  const residence = (citizenshipRoutes.residence_routes ?? []).filter(r => r.country.iso_n3 === iso);
  const blocs = mobility.blocs.filter(b => b.members.some(m => m.iso_n3 === iso));
  const lanesIn = mobility.bilateral_lanes.filter(l => l.destination.iso_n3 === iso);
  const reviewedModes = Object.values(jur.coverage).filter(s => s === 'reviewed').length;
  const cheapest = residence
    .filter(r => r.min_investment)
    .sort((a, b) => a.min_investment!.amount - b.min_investment!.amount)[0]?.min_investment ?? null;
  const residenceCats = [...new Set(residence.map(r => r.category))].map(c => RESIDENCE_CATEGORY_LABELS[c]);
  const description = `How to get citizenship and residence in ${jur.name}: `
    + `${routes.length} citizenship route${routes.length === 1 ? '' : 's'}`
    + (residence.length ? ` and ${residence.length} residence programme${residence.length === 1 ? '' : 's'} (${residenceCats.join(', ')})` : '')
    + `, with official sources. Part of the Flag Paths atlas.`;
  return {
    iso, name: jur.name, slug: buildCountrySlugMap(citizenshipRoutes.jurisdictions).get(iso)!,
    coverage: jur.coverage as Record<string, string>,
    routes, residence, blocs, lanesIn, reviewedModes, cheapest, description,
  };
}

function money(m: { amount: number; currency: string } | null): string | null {
  return m ? `${m.currency} ${m.amount.toLocaleString('en-US')}` : null;
}

function Sources({ sources }: { sources: { title: string; url: string }[] }) {
  if (!sources.length) return null;
  return (
    <p className="mt-3 border-t border-dashed pt-2.5 text-xs text-muted-foreground">
      Sources:{' '}
      {sources.map((s, i) => (
        <span key={s.url}>
          {i > 0 && ' · '}
          <a href={s.url} rel="nofollow noreferrer" className="underline underline-offset-2 hover:text-foreground">{s.title}</a>
        </span>
      ))}
    </p>
  );
}

function RouteCard({ route }: { route: CitizenshipRoute }) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {CITIZENSHIP_MODE_LABELS[route.mode] ?? route.mode}
        </span>
        <span
          className={`rounded-full px-1.5 font-mono text-[0.66rem] ${
            route.status === 'active' ? 'bg-verified/15 text-verified' : 'border text-muted-foreground'
          }`}
        >
          {route.status.replace(/_/g, ' ')}
        </span>
      </div>
      <h3 className="font-heading text-lg font-semibold leading-tight">{route.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{route.summary}</p>
      <Sources sources={route.sources} />
    </article>
  );
}

function ResidenceCard({ route }: { route: ResidenceRoute }) {
  const chips: string[] = [];
  const inv = money(route.min_investment);
  if (inv) chips.push(`from ${inv}`);
  const inc = money(route.min_income_monthly);
  if (inc) chips.push(`${inc}/mo`);
  if (route.physical_presence_days_per_year !== null) {
    chips.push(route.physical_presence_days_per_year === 0 ? 'no stay required' : `${route.physical_presence_days_per_year} days/yr`);
  }
  const leads = route.counts_toward_naturalization ? '→ citizenship'
    : route.counts_toward_permanent_residence ? '→ permanent residence' : 'renewable — no PR';
  const leadClass = (route.counts_toward_naturalization || route.counts_toward_permanent_residence)
    ? 'bg-verified/15 text-verified' : 'border text-muted-foreground';
  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {RESIDENCE_CATEGORY_LABELS[route.category]}
        </span>
        <span className={`rounded-full px-1.5 font-mono text-[0.66rem] ${leadClass}`}>{leads}</span>
      </div>
      <h3 className="font-heading text-lg font-semibold leading-tight">{route.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{route.summary}</p>
      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {chips.map(c => (
            <span key={c} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">{c}</span>
          ))}
        </div>
      )}
      <Sources sources={route.sources} />
    </article>
  );
}

function Eyebrow({ children, divider = true }: { children: ReactNode; divider?: boolean }) {
  return (
    <h2 className={`mb-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground${divider ? ' border-t pt-5' : ''}`}>
      {children}
    </h2>
  );
}

export function CountryProfile({ data }: { data: CountryProfileData }) {
  const { iso, name, routes, residence, blocs, lanesIn, reviewedModes, cheapest } = data;
  const facts: Array<[string, string]> = [
    ['Citizenship', `${reviewedModes} of 4 modes reviewed`],
    ...(routes.length ? [['Citizenship routes', String(routes.length)] as [string, string]] : []),
    ...(residence.length ? [['Residence programmes', String(residence.length)] as [string, string]] : []),
    ...(cheapest ? [['Residence by investment from', money(cheapest)!] as [string, string]] : []),
    ...(blocs.length ? [['Regional systems', String(blocs.length)] as [string, string]] : []),
  ];
  return (
    <main className="mx-auto max-w-[1060px] px-4 py-8 sm:px-6">
      <nav className="mb-6 font-mono text-xs text-muted-foreground">
        <a href="/" className="underline underline-offset-2">Flag Paths</a> ›{' '}
        <a href="/country" className="underline underline-offset-2">Countries</a> › {name}
      </nav>
      <div className="grid gap-8 md:grid-cols-[266px_1fr] md:items-start">
        <aside className="md:sticky md:top-20">
          <div className="text-5xl leading-none" aria-hidden>{countryFlag(iso)}</div>
          <h1 className="mb-4 mt-2 font-heading text-3xl font-bold tracking-tight">{name}</h1>
          <dl className="mb-4 flex flex-col gap-3 rounded-lg border bg-card p-4">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <a href={`/?country=${iso}`} className="block rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground hover:brightness-105">
            Open in the interactive atlas →
          </a>
          <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 font-mono text-xs text-muted-foreground">
            <a href="#citizenship" className="hover:text-foreground">Citizenship</a>
            {residence.length > 0 && <a href="#residence" className="hover:text-foreground">Residence</a>}
            {blocs.length > 0 && <a href="#regional" className="hover:text-foreground">Regional</a>}
            {lanesIn.length > 0 && <a href="#treaties" className="hover:text-foreground">Treaties</a>}
          </nav>
        </aside>
        <div>
          <section id="citizenship" className="scroll-mt-20">
            <Eyebrow divider={false}>Citizenship routes</Eyebrow>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {COVERAGE_ORDER.map(mode => {
                const state = data.coverage[mode] ?? 'unchecked';
                const dot = state === 'reviewed' ? 'bg-verified' : state === 'partial' ? 'bg-primary' : 'bg-muted-foreground';
                return (
                  <div key={mode} className="rounded-lg border bg-card p-2.5">
                    <span className="block font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">{CITIZENSHIP_MODE_LABELS[mode]}</span>
                    <span className="mt-1 flex items-center gap-1.5 text-sm font-semibold capitalize">
                      <span className={`size-2 rounded-full ${dot}`} aria-hidden />{state}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-3">
              {routes.length
                ? routes.map(r => <RouteCard key={r.id} route={r} />)
                : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Not yet reviewed at route level — a coverage gap, not a claim that no path exists.</p>}
            </div>
          </section>
          {residence.length > 0 && (
            <section id="residence" className="mt-8 scroll-mt-20">
              <Eyebrow>Residence &amp; settlement</Eyebrow>
              <div className="space-y-3">{residence.map(r => <ResidenceCard key={r.id} route={r} />)}</div>
            </section>
          )}
          {blocs.length > 0 && (
            <section id="regional" className="mt-8 scroll-mt-20">
              <Eyebrow>Regional rights</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {blocs.map(b => (
                  <a key={b.id} href={`/rights/${entitySlug(b.id)}`} className="rounded-full border bg-card px-3 py-1.5 text-sm hover:border-primary">{b.name}</a>
                ))}
              </div>
            </section>
          )}
          {lanesIn.length > 0 && (
            <section id="treaties" className="mt-8 scroll-mt-20">
              <Eyebrow>Treaty &amp; country paths</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {lanesIn.map(l => (
                  <a
                    key={l.id}
                    href={l.beneficiaries.length === 0 ? `/route/${entitySlug(l.id)}` : `/?lane=${l.id}`}
                    className="rounded-full border bg-card px-3 py-1.5 text-sm hover:border-primary"
                  >
                    {l.name}
                  </a>
                ))}
              </div>
            </section>
          )}
          <footer className="mt-10 border-t pt-5 text-xs text-muted-foreground">
            <p>Data is compiled from official and primary legal sources and reviewed for the Flag Paths atlas. Programmes — especially residence-by-investment — change frequently; verify against the linked official sources before acting.</p>
            <p className="mt-2">
              <a href="/country" className="underline underline-offset-2">All countries</a> ·{' '}
              <a href={`/?country=${iso}`} className="underline underline-offset-2">Open {name} in the atlas</a>
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}

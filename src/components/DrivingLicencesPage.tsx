import type { LicenceExchangeData } from '@/lib/licence-exchange';
import {
  exchangeWindowLabels,
  listOrigins,
  nationalityGateLabel,
  resolveExchangeWindow,
  testLabel,
} from '@/lib/licence-exchange';
import { ArrowRight, Car, ExternalLink, Home, Info, ShieldCheck, UserCheck } from 'lucide-react';

/**
 * /routes/driving-licences/ — exchange lookup hub (#171).
 *
 * Prerendered for SEO with a static fallback list. Live origin → destination
 * filtering is progressive-enhanced by public/licence-exchange.js.
 */
export function DrivingLicencesPage({ data }: { data: LicenceExchangeData }) {
  const origins = listOrigins(data);
  const destCount = data.destinations.length;
  // Destinations that gate any listing on the holder's nationality. Derived, never
  // hardcoded: the moment a second annex records one, the copy below says so.
  const gatedDestinations = data.destinations.filter(
    dest => dest.entries.some(entry => (entry.nationality_gate ?? null) !== null),
  );

  return (
    <main className="mx-auto max-w-[1060px] px-4 py-8 sm:px-6">
      <nav className="mb-4 font-mono text-[0.7rem] text-muted-foreground">
        <a href="/" className="underline underline-offset-2">Flag Paths</a>
        {' › '}
        <a href="/routes/" className="underline underline-offset-2">Routes</a>
        {' › '}
        <span>Driving licences</span>
      </nav>

      <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-primary">
        Driving licence exchange
      </p>
      <h1 className="mt-2 flex items-center gap-3 font-heading text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
        <Car className="size-8 shrink-0 text-primary" aria-hidden />
        Where can I exchange my licence?
      </h1>
      <p className="mt-3 max-w-[62ch] leading-relaxed text-muted-foreground">
        Choose where your current licence was issued. We’ll show the mapped destinations
        that accept it and whether their official list still requires a theory or practical test.
      </p>

      <div className="mt-7 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section
          id="licence-exchange-live"
          className="overflow-hidden rounded-xl border bg-card shadow-sm"
          hidden
        >
          <div className="border-b bg-accent/45 p-4 sm:p-5">
            <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-primary">
              Start here
            </p>
            <h2 className="mt-1 font-heading text-xl font-semibold">My licence was issued in…</h2>
            <label className="sr-only" htmlFor="licence-exchange-origin">
              Issuing country or territory
            </label>
            <select
              id="licence-exchange-origin"
              className="mt-4 min-h-12 w-full rounded-lg border bg-background px-3.5 text-base font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled
              defaultValue=""
            >
              <option value="">Loading countries…</option>
            </select>
          </div>
          <div className="p-4 sm:p-5">
            <p
              id="licence-exchange-status"
              className="mb-4 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            />
            <div id="licence-exchange-results">
              <div className="licence-empty-state">
                <span className="licence-empty-mark" aria-hidden><ArrowRight className="size-4" /></span>
                <div>
                  <p className="font-semibold text-foreground">Choose the issuing country</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Your mapped exchange destinations will appear here.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="rounded-xl border bg-card p-4 sm:p-5" aria-label="Before you exchange">
          <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Before you exchange
          </p>
          <div className="mt-4 space-y-4">
            <div className="flex gap-3">
              <Home className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-semibold">Residence comes first</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  You normally need to live in the destination and to have been resident where the licence was issued.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-semibold">The original is replaced</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Exchange gives you one local licence; it is not an extra document to stack.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <UserCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-semibold">Some lists check your passport, not your licence</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {gatedDestinations.length > 0 && (
                    <>
                      {gatedDestinations.map(d => d.name).join(', ')}
                      {' '}gate listed origins on the holder’s nationality, so a listed licence
                      is not on its own an answer there.{' '}
                    </>
                  )}
                  Where no nationality rule is shown, none was published — that is silence,
                  not permission.
                </p>
              </div>
            </div>
          </div>
          <details className="group mt-5 border-t pt-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
              How the rules work
              <Info className="size-4 text-muted-foreground" aria-hidden />
            </summary>
            <div className="mt-3 space-y-3 text-xs leading-relaxed text-muted-foreground">
              <p>{data.disclaimer.normal_residence}</p>
              <p>{data.disclaimer.scope}</p>
            </div>
          </details>
          <details className="group mt-3 border-t pt-4">
            <summary className="cursor-pointer list-none text-sm font-semibold">
              Coverage notes · {destCount} destinations
            </summary>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{data.disclaimer.coverage}</p>
            <a
              href="https://github.com/thomas779/geo-arb-map/issues/171"
              className="mt-3 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
            >
              Research notes <ExternalLink className="size-3" aria-hidden />
            </a>
          </details>
        </aside>
      </div>

      <section id="licence-exchange-fallback" className="mt-8">
        <h2 className="font-heading text-xl font-semibold">Mapped destinations</h2>
        <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
          Each annex is destination-led: what that country accepts from foreign issuers.
          Enable JavaScript for the interactive origin → destination lookup above.
        </p>
        <div className="mt-4 space-y-6">
          {data.destinations.map(dest => {
            const noRetest = dest.entries.filter(e => !e.subnational && e.no_retest);
            const unique = [...new Map(noRetest.map(e => [e.origin_label_en, e])).values()]
              .sort((a, b) => a.origin_label_en.localeCompare(b.origin_label_en));
            return (
              // Keyed on the name, not the ISO: thirteen destinations are provinces and
              // states that carry no ISO at all, and null keys would collide.
              <article key={dest.name} className="rounded-xl border bg-card p-4">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-heading text-base font-semibold">{dest.name}</h3>
                  <a
                    href={dest.source_url}
                    className="inline-flex items-center gap-1 font-mono text-xs text-primary underline-offset-2 hover:underline"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Primary source
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </header>
                <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground">{dest.instrument}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {dest.entries.length} origin rows · {unique.length} national-level no-retest listings shown below
                </p>
                {exchangeWindowLabels(resolveExchangeWindow(dest)).map(line => (
                  <p key={line} className="mt-1 text-xs text-muted-foreground">{line}</p>
                ))}
                <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {unique.slice(0, 24).map(e => (
                    <li key={`${dest.name}-${e.origin_label_en}`} className="text-sm">
                      <span className="font-medium">{e.origin_label_en}</span>
                      <span className="ml-1 font-mono text-[0.65rem] text-muted-foreground">
                        {testLabel(e.theory_test_required, e.practical_test_required)}
                      </span>
                      {/* Only where the authority published one. A row with no gate prints
                          nothing here rather than an implied "anyone" — the null case is the
                          whole reason this field exists. */}
                      {e.nationality_gate && (
                        <span
                          className="ml-1 font-mono text-[0.65rem] text-primary"
                          data-nationality-gate={e.nationality_gate}
                        >
                          {nationalityGateLabel(e.nationality_gate)}
                        </span>
                      )}
                      {e.origin_iso_n3 && (
                        <a
                          className="ml-1 font-mono text-[0.65rem] text-primary underline-offset-2 hover:underline"
                          href={'/routes/driving-licences/' + `?from=${e.origin_iso_n3}`}
                        >
                          look up
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
                {unique.length > 24 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    +{unique.length - 24} more — use the live lookup.
                  </p>
                )}
              </article>
            );
          })}
        </div>

        <details className="mt-8 rounded-lg border bg-card px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            All origins in the seed ({origins.length} groups)
          </summary>
          <ul className="mt-3 columns-2 gap-x-6 text-sm sm:columns-3">
            {origins.map(o => (
              <li key={o.key} className="break-inside-avoid py-0.5">
                {o.iso_n3 ? (
                  <a
                    href={'/routes/driving-licences/' + `?from=${o.iso_n3}`}
                    className="text-foreground underline-offset-2 hover:underline"
                  >
                    {o.label}
                  </a>
                ) : (
                  o.label
                )}
                {o.varies_by_subnational && (
                  <span className="ml-1 font-mono text-[0.65rem] text-muted-foreground">varies</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <p className="mt-8 border-t pt-5 text-xs leading-relaxed text-muted-foreground">
        Exchange eligibility is destination-specific. A mapped listing is a starting point—not approval—and does not replace the destination authority’s residence, validity, class, or deadline checks.
      </p>
    </main>
  );
}

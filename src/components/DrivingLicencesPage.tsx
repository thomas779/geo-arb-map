import type { LicenceExchangeData } from '@/lib/licence-exchange';
import { listOrigins, testLabel } from '@/lib/licence-exchange';
import { AlertTriangle, Car, ExternalLink } from 'lucide-react';

/**
 * /routes/driving-licences/ — exchange lookup hub (#171).
 *
 * Prerendered for SEO with a static fallback list. Live origin → destination
 * filtering is progressive-enhanced by public/licence-exchange.js.
 */
export function DrivingLicencesPage({ data }: { data: LicenceExchangeData }) {
  const origins = listOrigins(data);
  const de = data.destinations.find(d => d.iso_n3 === '276');
  const noRetestNational = (de?.entries ?? []).filter(
    e => !e.subnational && e.no_retest,
  );
  // unique by label
  const noRetestLabels = [...new Map(noRetestNational.map(e => [e.origin_label_en, e])).values()]
    .sort((a, b) => a.origin_label_en.localeCompare(b.origin_label_en));

  return (
    <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
      <nav className="mb-4 font-mono text-[0.7rem] text-muted-foreground">
        <a href="/" className="underline underline-offset-2">Flag Paths</a>
        {' › '}
        <a href="/routes/" className="underline underline-offset-2">Routes</a>
        {' › '}
        <span>Driving licences</span>
      </nav>

      <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-primary">
        Driving licences
      </p>
      <h1 className="mt-2 flex items-center gap-3 font-heading text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
        <Car className="size-8 shrink-0 text-primary" aria-hidden />
        Licence exchange lookup
      </h1>
      <p className="mb-6 mt-3 max-w-[68ch] leading-relaxed text-muted-foreground">
        See which destinations will exchange a foreign driving licence — and whether a theory
        or practical test is still required. Seeded with Germany&apos;s official origin list
        (Anlage 11 FeV). More destination annexes will expand the map.
      </p>

      {/* Always-visible legal framing */}
      <aside
        className="mb-8 rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed"
        role="note"
      >
        <p className="flex gap-2 font-semibold text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          Normal residence is the real gate
        </p>
        <p className="mt-2 text-muted-foreground">{data.disclaimer.normal_residence}</p>
        <p className="mt-2 text-muted-foreground">{data.disclaimer.scope}</p>
        <p className="mt-2 text-xs text-muted-foreground">{data.disclaimer.coverage}</p>
      </aside>

      {/* Live lookup (enhanced by licence-exchange.js) */}
      <section
        id="licence-exchange-live"
        className="mb-10 rounded-xl border bg-card p-4 sm:p-5"
        hidden
      >
        <h2 className="font-heading text-lg font-semibold">I hold a licence from…</h2>
        <p id="licence-exchange-status" className="mt-1 text-xs text-muted-foreground" />
        <label className="mt-4 block text-sm font-medium" htmlFor="licence-exchange-origin">
          Issuing country
        </label>
        <select
          id="licence-exchange-origin"
          className="mt-1.5 w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm"
          disabled
          defaultValue=""
        >
          <option value="">Loading…</option>
        </select>
        <div id="licence-exchange-results" className="mt-5 space-y-4" />
      </section>

      {/* Static fallback / SEO content */}
      <section id="licence-exchange-fallback">
        <h2 className="font-heading text-lg font-semibold">
          Germany — origins with no theory and no practical test
        </h2>
        <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
          From Anlage 11 FeV (national-level rows only). Sub-national US / Canada / Australia
          units are listed under their parent country in the live lookup — never as a single
          fake country-wide rule.
        </p>
        {de && (
          <p className="mt-2">
            <a
              href={de.source_url}
              className="inline-flex items-center gap-1 font-mono text-xs text-primary underline-offset-2 hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {de.instrument}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </p>
        )}
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {noRetestLabels.map(e => (
            <li
              key={e.origin_label_en}
              className="rounded-md border bg-card px-3 py-2 text-sm"
            >
              <span className="font-medium">{e.origin_label_en}</span>
              <span className="mt-0.5 block font-mono text-[0.7rem] text-muted-foreground">
                {e.classes ?? 'classes n/a'} · {testLabel(e.theory_test_required, e.practical_test_required)}
              </span>
              {e.origin_iso_n3 && (
                <a
                  className="mt-1 inline-block font-mono text-[0.65rem] text-primary underline-offset-2 hover:underline"
                  href={`/routes/driving-licences/?from=${e.origin_iso_n3}`}
                >
                  Look up
                </a>
              )}
            </li>
          ))}
        </ul>

        <details className="mt-8 rounded-lg border bg-card px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            All origins in the Germany seed ({origins.length} groups)
          </summary>
          <ul className="mt-3 columns-2 gap-x-6 text-sm sm:columns-3">
            {origins.map(o => (
              <li key={o.key} className="break-inside-avoid py-0.5">
                {o.iso_n3 ? (
                  <a
                    href={`/routes/driving-licences/?from=${o.iso_n3}`}
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

      <section className="mt-10 border-t pt-6 text-sm text-muted-foreground">
        <h2 className="font-heading text-base font-semibold text-foreground">What this is not</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Not a guide to obtaining a licence without meeting residence conditions.</li>
          <li>Not a rights-index score and not a citizenship or residence route.</li>
          <li>Not multi-hop planning — one destination annex at a time until more are seeded.</li>
        </ul>
        <p className="mt-4">
          Research notes: see issue{' '}
          <a href="https://github.com/thomas779/geo-arb-map/issues/171" className="underline underline-offset-2">
            #171
          </a>
          .
        </p>
      </section>
    </main>
  );
}

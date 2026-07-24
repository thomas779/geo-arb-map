import type { CitizenshipRoutesData } from '@/types';
import { buildCountrySlugMap } from '@/lib/slug';
import { countryFlag } from '@/lib/country';

// Uninhabited entries excluded from coverage (see App.tsx) — no dedicated page.
const NON_APPLICABLE = new Set(['086', '239', '260', '334']);

export function CountriesList({
  citizenshipRoutes,
}: {
  citizenshipRoutes: CitizenshipRoutesData | null;
}) {
  const jurisdictions = citizenshipRoutes?.jurisdictions ?? [];
  const slugByIso = buildCountrySlugMap(jurisdictions);
  const items = jurisdictions
    .filter(j => !NON_APPLICABLE.has(j.iso_n3))
    .map(j => ({ iso: j.iso_n3, name: j.name, slug: slugByIso.get(j.iso_n3)! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-[1060px] px-4 py-8 sm:px-6">
        <h1 className="font-heading text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
          All countries &amp; territories
        </h1>
        <p className="mb-8 mt-3 max-w-[68ch] text-muted-foreground">
          Citizenship and residence routes for {items.length} jurisdictions — open any country for its
          full profile, or explore them on the <a href="/" className="underline underline-offset-2 hover:text-foreground">interactive atlas</a>.
          Also browse <a href="/rights" className="underline underline-offset-2 hover:text-foreground">regional systems</a> and{' '}
          <a href="/route" className="underline underline-offset-2 hover:text-foreground">heritage routes</a>.
        </p>
        {/* Same card style as the rights/route hubs, but CSS multi-column so the
            A→Z order runs DOWN each column (easier to scan) rather than across. */}
        <ul className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {items.map(item => (
            <li key={item.iso} className="mb-2 break-inside-avoid">
              <a
                href={`/country/${item.slug}/`}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 hover:border-primary"
              >
                <span className="shrink-0 text-lg" aria-hidden>{countryFlag(item.iso)}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
              </a>
            </li>
          ))}
        </ul>
    </div>
  );
}

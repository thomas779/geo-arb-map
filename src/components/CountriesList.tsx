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
    <div className="absolute inset-0 z-30 overflow-y-auto bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="font-heading text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
          All countries &amp; territories
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Citizenship and residence routes for {items.length} jurisdictions — open any country for its
          full profile, or explore them on the <a href="/" className="underline underline-offset-2 hover:text-foreground">interactive atlas</a>.
        </p>
        <ul className="mt-6 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(item => (
            <li key={item.iso}>
              <a
                href={`/country/${item.slug}/`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <span className="shrink-0 text-base" aria-hidden>{countryFlag(item.iso)}</span>
                <span className="truncate">{item.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

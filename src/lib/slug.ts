// Deterministic country slugs shared by the static per-country page generator
// (scripts/build_country_pages.ts) and the client "full profile" links. Both
// derive the map from the same jurisdiction list (public/citizenship_routes.json),
// so they always agree without a separate lookup file.

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/['’.]/g, '') // drop apostrophes/periods so "Côte d'Ivoire" -> "cote-divoire"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface SlugJurisdiction {
  iso_n3: string;
  name: string;
}

/**
 * Build a collision-free iso_n3 -> slug map. Determinism: process jurisdictions
 * in iso order; on a slug collision, the later entry gets a `-<iso>` suffix so
 * results are stable regardless of caller.
 */
export function buildCountrySlugMap(jurisdictions: SlugJurisdiction[]): Map<string, string> {
  const byIso = new Map<string, string>();
  const used = new Set<string>();
  for (const jurisdiction of [...jurisdictions].sort((a, b) => a.iso_n3.localeCompare(b.iso_n3))) {
    const base = slugify(jurisdiction.name) || `country-${jurisdiction.iso_n3}`;
    const slug = used.has(base) ? `${base}-${jurisdiction.iso_n3}` : base;
    used.add(slug);
    byIso.set(jurisdiction.iso_n3, slug);
  }
  return byIso;
}

export function buildSlugToIso(jurisdictions: SlugJurisdiction[]): Map<string, string> {
  const reverse = new Map<string, string>();
  for (const [iso, slug] of buildCountrySlugMap(jurisdictions)) reverse.set(slug, iso);
  return reverse;
}

/**
 * Slug for an id-keyed entity (bloc, lane): `eu_eea` → `eu-eea`. A pure function
 * of the id so a single forward link never needs the full set and can't drift
 * from the map. Ids are unique; a uniqueness test guards against slug collisions.
 */
export function entitySlug(id: string): string {
  return slugify(id.replace(/_/g, ' ')) || id;
}

/** Shared by the rights/route SSR generator and the client "full page" links. */
export function buildEntitySlugMap(items: Array<{ id: string }>): Map<string, string> {
  const byId = new Map<string, string>();
  for (const item of items) byId.set(item.id, entitySlug(item.id));
  return byId;
}

export function buildEntitySlugToId(items: Array<{ id: string }>): Map<string, string> {
  const reverse = new Map<string, string>();
  for (const [id, slug] of buildEntitySlugMap(items)) reverse.set(slug, id);
  return reverse;
}

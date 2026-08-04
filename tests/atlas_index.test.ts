import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildAtlasIndex, buildCountrySlice } from '../scripts/build_country_pages';
import { buildCountrySlugMap } from '../src/lib/slug';
import { isNonApplicableJurisdiction } from '../src/lib/country';
import type { CitizenshipRoutesData } from '../src/types';

const citizenship = JSON.parse(readFileSync(
  new URL('../data/compiled/citizenship_routes.json', import.meta.url), 'utf8')) as CitizenshipRoutesData;

describe('atlas index and country slices', () => {
  test('the index carries every entity but no prose bodies', () => {
    const index = buildAtlasIndex(citizenship, 'test-release');
    // Completeness: the index is the map/sidebar/search substrate, so losing
    // rows here silently blanks the atlas.
    expect(index.jurisdictions).toHaveLength(citizenship.jurisdictions.length);
    expect(index.routes).toHaveLength(citizenship.routes.length);
    expect(index.residence_routes).toHaveLength((citizenship.residence_routes ?? []).length);

    // The protection boundary: prose and provenance live only in the slices.
    // If a body field creeps into the index, the bulk corpus is public again by
    // accident and first paint balloons back toward 1.4MB.
    // Titles ride along so the panel needs no extra fetch; the prose and
    // provenance that make the corpus valuable do not.
    const bodyFields = ['summary', 'sources', 'pathways', 'facts'];
    for (const field of bodyFields) {
      expect(Object.keys(index.routes[0])).not.toContain(field);
      expect(Object.keys(index.residence_routes[0])).not.toContain(field);
    }
    // Serialised, the index must stay an order of magnitude under the corpus.
    const ratio = JSON.stringify(index).length / JSON.stringify(citizenship).length;
    expect(ratio).toBeLessThan(0.3);
  });

  test('the index keeps the fields the atlas paints and filters by', () => {
    const index = buildAtlasIndex(citizenship);
    const route = index.routes[0];
    // Strict projection: same nesting as the corpus, so map/panel code that
    // reads route.country.iso_n3 works against either shape unchanged.
    expect(route.country).toHaveProperty('iso_n3');
    expect(route).toHaveProperty('title');
    expect(route).toHaveProperty('mode');
    expect(route).toHaveProperty('status');
    const residence = index.residence_routes[0];
    // isosForRouteClass() derives the three-tier map paint from exactly these.
    expect(residence).toHaveProperty('category');
    expect(residence).toHaveProperty('counts_toward_permanent_residence');
    expect(residence).toHaveProperty('counts_toward_naturalization');
    // Country search shows "n/4 reviewed" from coverage.
    expect(Object.keys(index.jurisdictions[0].coverage).length).toBeGreaterThanOrEqual(4);
  });

  test('slices partition the corpus and carry full detail', () => {
    const slugByIso = buildCountrySlugMap(citizenship.jurisdictions);
    const isos = citizenship.jurisdictions
      .map(jurisdiction => jurisdiction.iso_n3)
      .filter(iso => !isNonApplicableJurisdiction(iso));
    let routeCount = 0;
    for (const iso of isos) {
      const slice = buildCountrySlice(iso, slugByIso.get(iso)!, citizenship, 'test-release');
      routeCount += slice.routes.length;
      expect(slice.routes.every(route => route.country.iso_n3 === iso)).toBe(true);
    }
    // Every route belongs to exactly one emitted slice (non-applicable
    // jurisdictions get no page, so they are excluded from both sides).
    const expected = citizenship.routes.filter(route =>
      !isNonApplicableJurisdiction(route.country.iso_n3)).length;
    expect(routeCount).toBe(expected);

    const portugal = buildCountrySlice('620', 'portugal', citizenship, 'test-release');
    expect(portugal.jurisdiction?.name).toBe('Portugal');
    expect(portugal.routes.length).toBeGreaterThan(0);
    // A slice is self-describing: it names its shape and points back at the index.
    expect(portugal.meta.shape).toBe('country-slice');
    expect(portugal.meta.index).toContain('/atlas-index.json');
    expect(portugal.routes[0]).toHaveProperty('summary');
    expect(portugal.routes[0]).toHaveProperty('sources');
  });
});

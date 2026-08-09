import { describe, expect, test } from 'bun:test';
import type { CitizenshipRoutesData } from '../src/types';
import {
  ROUTE_CLASSES,
  isosForRouteClass,
  residenceCategoryPageHref,
  routeClassById,
  routeClassPageHref,
} from '../src/lib/route-classes';

// Route-class browse (#129): the map paints jurisdictions with >=1 ACTIVE route
// of a class. These fixtures pin the painted-set semantics against the real
// public data, including the rule the whole feature hangs on: negatives and
// lapsed programmes never paint.

const data = (await Bun.file(
  new URL('../data/compiled/citizenship_routes.json', import.meta.url),
).json()) as CitizenshipRoutesData;

const isos = (id: string) => isosForRouteClass(routeClassById(id)!, data).all;
const tiers = (id: string) => isosForRouteClass(routeClassById(id)!, data);

describe('route-class painted sets', () => {
  test('every class resolves and paints at least one jurisdiction', () => {
    for (const cls of ROUTE_CLASSES) {
      expect(isosForRouteClass(cls, data).all.size, cls.id).toBeGreaterThan(0);
    }
  });

  test('golden visa paints active RBI countries only', () => {
    const set = isos('golden-visa');
    expect(set.has('620')).toBe(true);  // Portugal ARI — active
    // Germany paints via active entrepreneur investment category, not a negative.
    expect(set.has('276')).toBe(true);
    // Malawi has no active investment residence product (absences not stored).
    expect(set.has('454')).toBe(false);
  });

  test('digital nomad paints live programmes, not audited negatives or lapsed ones', () => {
    const set = isos('digital-nomad');
    expect(set.has('710')).toBe(true);  // South Africa — corrected to active by the 2026-07-30 audit
    expect(set.has('388')).toBe(false); // Jamaica — confirmed never existed
    expect(set.has('028')).toBe(false); // Antigua — existed and lapsed (inactive), must not paint
  });

  test('CBI paints active programmes only', () => {
    const set = isos('cbi');
    expect(set.has('792')).toBe(true);  // Türkiye — active
    expect(set.has('470')).toBe(false); // Malta — programme ended (inactive route)
  });

  // #191: the ancestry facet used to match on mode alone and highlighted 232 of
  // 240 jurisdictions, because every country transmits to the child of a citizen.
  // These pin the split by reach, which is the axis people actually search on.
  test('the ancestry facets stay small enough to carry information', () => {
    const total = new Set(data.routes.map(route => route.country.iso_n3)).size;
    const everyAncestryCountry = new Set(
      data.routes.filter(route => route.mode === 'ancestry' && route.status === 'active')
        .map(route => route.country.iso_n3),
    );
    // The bug, still true of the underlying data: mode alone is near-universal.
    expect(everyAncestryCountry.size / total).toBeGreaterThan(0.9);
    // The fix: no ancestry facet paints anything close to that.
    for (const cls of ROUTE_CLASSES.filter(candidate => candidate.match === 'ancestry')) {
      expect(isosForRouteClass(cls, data).all.size / total, cls.id).toBeLessThan(0.2);
    }
  });

  test('grandparent-or-deeper is the reach people ask for, and excludes parent-only', () => {
    const set = isos('ancestry');
    expect(set.has('372')).toBe(true);  // Ireland — grandparent born on the island
    expect(set.has('826')).toBe(true);  // UK — s.3(2) registration through a grandparent
    expect(set.has('132')).toBe(true);  // Cabo Verde — grandchild to great-great-grandchild
    // Italy transmits without a stated generational limit, but the corpus records
    // only a parent condition. It must NOT paint here: doing so would publish a
    // finding nobody authored. It reads as parent_only until the limb is sourced.
    expect(set.has('380')).toBe(false);
  });

  test('ethnic and diaspora origin is its own axis, not a generation', () => {
    const set = isos('ancestry-origin');
    expect(set.has('376')).toBe(true);  // Israel — Law of Return, previously parent-only
    expect(set.has('276')).toBe(true);  // Germany — Spätaussiedler, previously no descent at all
    expect(set.has('051')).toBe(true);  // Armenia
    expect(set.has('417')).toBe(true);  // Kyrgyzstan
    expect(set.has('616')).toBe(true);  // Poland — narodowość polska, not an ancestor's citizenship
    // An origin route never doubles into a degree facet: origin wins the bucket.
    expect(isos('ancestry').has('376')).toBe(false);
  });

  test('nothing paints on an index that predates the reach projection', () => {
    // The field ships in atlas-index.json. A cached older index carries no reach at
    // all, and the facet must then paint an empty map rather than the whole world.
    const stale = {
      ...data,
      routes: data.routes.map(({ descent_reach: _dropped, ...route }) => route),
    };
    for (const cls of ROUTE_CLASSES.filter(candidate => candidate.match === 'ancestry')) {
      expect(isosForRouteClass(cls, stale).all.size, cls.id).toBe(0);
    }
  });

  test('three tiers, two colours + hatch: best outcome per country', () => {
    const nomad = tiers('digital-nomad');
    // Tiers are mutually exclusive and cover the painted set.
    expect(nomad.cit.size + nomad.pr.size + nomad.tr.size).toBe(nomad.all.size);
    for (const iso of nomad.cit) { expect(nomad.pr.has(iso)).toBe(false); expect(nomad.tr.has(iso)).toBe(false); }
    // Portugal's D8 counts toward naturalisation — CIT, solid strong.
    expect(nomad.cit.has('620')).toBe(true);
    // South Africa's Remote Work visa accrues toward nothing — TR, light tone:
    // the owner's "money grab" tier, unambiguous now.
    expect(nomad.tr.has('710')).toBe(true);
    // Citizenship classes paint everything CIT by definition.
    const cbi = tiers('cbi');
    expect(cbi.cit.size).toBe(cbi.all.size);
  });

  test('citizenship and residence investment stay distinct classes', () => {
    // The label collision the owner hit: CBI (buy a passport) vs golden visa
    // (buy residence). New Zealand has an active golden visa and no CBI.
    expect(isos('golden-visa').has('554')).toBe(true);
    expect(isos('cbi').has('554')).toBe(false);
  });

  test('country and category browse paths point to the same nested route indexes', () => {
    expect(routeClassPageHref('cbi')).toBe('/routes/citizenship-by-investment/');
    expect(routeClassPageHref('retirement')).toBe('/routes/retirement-visas/');
    expect(routeClassPageHref('talent')).toBe('/routes/talent-skilled-visas/');
    expect(routeClassPageHref('digital-identity')).toBe('/routes/digital-identities/');
    expect(residenceCategoryPageHref('retirement_pension')).toBe(routeClassPageHref('retirement'));
    expect(residenceCategoryPageHref('talent_skilled')).toBe(routeClassPageHref('talent'));
    expect(residenceCategoryPageHref('digital_identity')).toBe(routeClassPageHref('digital-identity'));
    expect(residenceCategoryPageHref('general_permanent_residence')).toBeNull();
  });
});

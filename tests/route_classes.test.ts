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
  new URL('../public/citizenship_routes.json', import.meta.url),
).json()) as CitizenshipRoutesData;

const isos = (id: string) => isosForRouteClass(routeClassById(id)!, data).all;
const tiers = (id: string) => isosForRouteClass(routeClassById(id)!, data);

describe('route-class painted sets', () => {
  test('every class resolves and paints at least one jurisdiction', () => {
    for (const cls of ROUTE_CLASSES) {
      expect(isosForRouteClass(cls, data).all.size, cls.id).toBeGreaterThan(0);
    }
  });

  test('golden visa paints active RBI countries, never verified negatives', () => {
    const set = isos('golden-visa');
    expect(set.has('620')).toBe(true);  // Portugal ARI — active
    // Germany PAINTS despite its no-golden-visa verified negative, because the
    // investment category also holds its active §21 entrepreneur permit — the
    // class is category-faithful, and the country page footnote explains the
    // distinction. Malawi is the pure case: a verified negative and nothing else.
    expect(set.has('276')).toBe(true);
    expect(set.has('454')).toBe(false); // Malawi — verified_negative only
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

  test('ancestry includes the folded diaspora programmes', () => {
    const set = isos('ancestry');
    expect(set.has('380')).toBe(true); // Italy jure sanguinis
    expect(set.has('376')).toBe(true); // Israel — Law of Return folded into the ancestry route
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

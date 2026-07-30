import { describe, expect, test } from 'bun:test';
import type { CitizenshipRoutesData } from '../src/types';
import { ROUTE_CLASSES, isosForRouteClass, routeClassById } from '../src/lib/route-classes';

// Route-class browse (#129): the map paints jurisdictions with >=1 ACTIVE route
// of a class. These fixtures pin the painted-set semantics against the real
// public data, including the rule the whole feature hangs on: negatives and
// lapsed programmes never paint.

const data = (await Bun.file(
  new URL('../public/citizenship_routes.json', import.meta.url),
).json()) as CitizenshipRoutesData;

const isos = (id: string) => isosForRouteClass(routeClassById(id)!, data).all;
const accruing = (id: string) => isosForRouteClass(routeClassById(id)!, data).accruing;

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

  test('two-tone paint: accruing is a subset and catches the dead-end nomad visas', () => {
    const nomad = isosForRouteClass(routeClassById('digital-nomad')!, data);
    for (const iso of nomad.accruing) expect(nomad.all.has(iso)).toBe(true);
    // Portugal's D8 counts toward naturalisation — solid tier.
    expect(nomad.accruing.has('620')).toBe(true);
    // South Africa's Remote Work visa is a visitor visa: time accrues toward
    // nothing. Paints, but muted — the owner's "money grab" tier, made visible.
    expect(nomad.all.has('710')).toBe(true);
    expect(nomad.accruing.has('710')).toBe(false);
    // Citizenship classes are all-accruing by definition.
    const cbi = isosForRouteClass(routeClassById('cbi')!, data);
    expect(cbi.accruing.size).toBe(cbi.all.size);
  });

  test('citizenship and residence investment stay distinct classes', () => {
    // The label collision the owner hit: CBI (buy a passport) vs golden visa
    // (buy residence). New Zealand has an active golden visa and no CBI.
    expect(isos('golden-visa').has('554')).toBe(true);
    expect(isos('cbi').has('554')).toBe(false);
  });
});

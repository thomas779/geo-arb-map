import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  countryHasLicenceData,
  listOrigins,
  matchesForOrigin,
  summariseCountry,
  testLabel,
  type LicenceExchangeData,
} from '../src/lib/licence-exchange';

const seed = JSON.parse(
  readFileSync(join(import.meta.dir, '../public/licence_exchange.json'), 'utf8'),
) as LicenceExchangeData;

const DEST_ISOS = [
  '036', '040', '208', '250', '276', '372', '528', '554', '620', '724', '826',
];

describe('licence exchange seed (#171)', () => {
  test('seed has eleven destination annexes plus disclaimer', () => {
    expect(seed.schema_version).toBe(1);
    expect(seed.disclaimer.normal_residence).toMatch(/185 days/i);
    expect(seed.disclaimer.scope).toMatch(/not a guide to licence tourism/i);
    expect(seed.destinations.map(d => d.iso_n3).sort()).toEqual([...DEST_ISOS].sort());
    expect(seed.destinations.length).toBe(11);
    for (const d of seed.destinations) {
      expect(d.entries.length).toBeGreaterThan(0);
      expect(d.source_url).toMatch(/^https?:\/\//);
    }
  });

  test('core instruments remain wired', () => {
    const de = seed.destinations.find(d => d.iso_n3 === '276')!;
    const uk = seed.destinations.find(d => d.iso_n3 === '826')!;
    const es = seed.destinations.find(d => d.iso_n3 === '724')!;
    const at = seed.destinations.find(d => d.iso_n3 === '040')!;
    const au = seed.destinations.find(d => d.iso_n3 === '036')!;
    expect(de.source_url).toContain('fev_2010/anlage_11');
    expect(uk.source_url).toContain('legislation.gov.uk');
    expect(es.source_url).toContain('dgt.es');
    expect(at.source_url).toContain('oesterreich.gv.at');
    expect(au.source_url).toContain('austroads.gov.au');
  });

  test('Switzerland is no retest in Germany; Connecticut requires theory', () => {
    const entries = seed.destinations.find(d => d.iso_n3 === '276')!.entries;
    const ch = entries.find(e => e.origin_label_en === 'Switzerland' || e.origin_label === 'Schweiz');
    expect(ch).toBeTruthy();
    expect(ch!.no_retest).toBe(true);
    const ct = entries.find(e => e.subnational_label === 'Connecticut');
    expect(ct!.theory_test_required).toBe(true);
    expect(ct!.practical_test_required).toBe(false);
  });

  test('Spain lists Paraguay with car/moto no tests; truck/bus note', () => {
    const es = seed.destinations.find(d => d.iso_n3 === '724')!;
    const py = es.entries.find(e => e.origin_iso_n3 === '600');
    expect(py).toBeTruthy();
    expect(py!.no_retest).toBe(true);
    expect(py!.note ?? '').toMatch(/Truck|C\/D|bus/i);
  });

  test('Japan matches every seeded destination without practical retest', () => {
    const matches = matchesForOrigin(seed, 'nat:392');
    expect(matches.map(m => m.destination.iso_n3).sort()).toEqual([...DEST_ISOS].sort());
    expect(matches.every(m => m.any_no_retest || !m.any_practical)).toBe(true);
    expect(matches.every(m => !m.any_practical)).toBe(true);
  });

  test('lookup groups US under parent with subnational variance (DE)', () => {
    const matches = matchesForOrigin(seed, 'nat:840');
    const de = matches.find(m => m.destination.iso_n3 === '276');
    expect(de).toBeTruthy();
    expect(de!.varies_by_subnational).toBe(true);
  });

  test('country summary for Paraguay and Japan', () => {
    const py = summariseCountry(seed, '600');
    expect(countryHasLicenceData(py)).toBe(true);
    expect(py.as_origin_destinations.map(d => d.iso_n3).sort()).toEqual(['250', '724']);

    const jp = summariseCountry(seed, '392');
    expect(jp.as_origin_destinations).toHaveLength(11);
  });

  test('listOrigins is non-empty and sorted', () => {
    const origins = listOrigins(seed);
    expect(origins.length).toBeGreaterThan(40);
    const labels = origins.map(o => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  test('testLabel wording', () => {
    expect(testLabel(false, false)).toBe('No retest');
    expect(testLabel(true, false)).toBe('Theory only');
  });
});

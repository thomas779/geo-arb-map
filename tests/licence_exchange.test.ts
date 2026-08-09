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

describe('licence exchange seed (#171)', () => {
  test('seed has Germany and Great Britain destinations plus disclaimer', () => {
    expect(seed.schema_version).toBe(1);
    expect(seed.disclaimer.normal_residence).toMatch(/185 days/i);
    expect(seed.disclaimer.scope).toMatch(/not a guide to licence tourism/i);
    expect(seed.destinations.map(d => d.iso_n3).sort()).toEqual(['276', '826']);
    const de = seed.destinations.find(d => d.iso_n3 === '276')!;
    const uk = seed.destinations.find(d => d.iso_n3 === '826')!;
    expect(de.source_url).toContain('fev_2010/anlage_11');
    expect(de.entries.length).toBeGreaterThan(50);
    expect(uk.source_url).toContain('legislation.gov.uk');
    expect(uk.entries.length).toBeGreaterThanOrEqual(20);
  });

  test('Switzerland is no retest in Germany; Connecticut requires theory', () => {
    const entries = seed.destinations.find(d => d.iso_n3 === '276')!.entries;
    const ch = entries.find(e => e.origin_label_en === 'Switzerland' || e.origin_label === 'Schweiz');
    expect(ch).toBeTruthy();
    expect(ch!.theory_test_required).toBe(false);
    expect(ch!.practical_test_required).toBe(false);
    expect(ch!.no_retest).toBe(true);

    const ct = entries.find(e => e.subnational_label === 'Connecticut');
    expect(ct).toBeTruthy();
    expect(ct!.theory_test_required).toBe(true);
    expect(ct!.practical_test_required).toBe(false);
    expect(ct!.subnational).toBe(true);
    expect(ct!.parent_iso_n3).toBe('840');
  });

  test('UK designates Japan and UAE without retest; Canada varies', () => {
    const uk = seed.destinations.find(d => d.iso_n3 === '826')!;
    const jp = uk.entries.find(e => e.origin_iso_n3 === '392');
    const ae = uk.entries.find(e => e.origin_iso_n3 === '784');
    const ca = uk.entries.find(e => e.origin_iso_n3 === '124');
    expect(jp?.no_retest).toBe(true);
    expect(ae?.no_retest).toBe(true);
    expect(ca?.varies_by_subnational).toBe(true);
  });

  test('lookup groups US under parent and flags subnational variance', () => {
    const origins = listOrigins(seed);
    const us = origins.find(o => o.iso_n3 === '840');
    expect(us).toBeTruthy();
    expect(us!.varies_by_subnational).toBe(true);
    expect(us!.label).toMatch(/United States/i);

    const matches = matchesForOrigin(seed, 'nat:840');
    expect(matches.some(m => m.destination.iso_n3 === '276')).toBe(true);
    const de = matches.find(m => m.destination.iso_n3 === '276')!;
    expect(de.varies_by_subnational).toBe(true);
    expect(de.entries.every(e => e.subnational)).toBe(true);
  });

  test('Japan matches both Germany and UK without practical test', () => {
    const matches = matchesForOrigin(seed, 'nat:392');
    expect(matches.map(m => m.destination.iso_n3).sort()).toEqual(['276', '826']);
    expect(matches.every(m => m.any_no_retest)).toBe(true);
    expect(matches.every(m => !m.any_practical)).toBe(true);
  });

  test('country summary for Germany and Japan', () => {
    const de = summariseCountry(seed, '276');
    expect(countryHasLicenceData(de)).toBe(true);
    expect(de.as_destination?.origin_count).toBeGreaterThan(50);

    const jp = summariseCountry(seed, '392');
    expect(countryHasLicenceData(jp)).toBe(true);
    expect(jp.as_destination).toBeNull();
    expect(jp.as_origin_destinations.map(d => d.iso_n3).sort()).toEqual(['276', '826']);
  });

  test('testLabel wording', () => {
    expect(testLabel(false, false)).toBe('No retest');
    expect(testLabel(true, false)).toBe('Theory only');
    expect(testLabel(true, true)).toBe('Theory + practical');
  });
});

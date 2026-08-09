import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listOrigins,
  matchesForOrigin,
  testLabel,
  type LicenceExchangeData,
} from '../src/lib/licence-exchange';

const seed = JSON.parse(
  readFileSync(join(import.meta.dir, '../public/licence_exchange.json'), 'utf8'),
) as LicenceExchangeData;

describe('licence exchange seed (#171)', () => {
  test('seed has Germany destination and disclaimer', () => {
    expect(seed.schema_version).toBe(1);
    expect(seed.disclaimer.normal_residence).toMatch(/185 days/i);
    expect(seed.disclaimer.scope).toMatch(/not a guide to licence tourism/i);
    expect(seed.destinations).toHaveLength(1);
    expect(seed.destinations[0].iso_n3).toBe('276');
    expect(seed.destinations[0].source_url).toContain('fev_2010/anlage_11');
    expect(seed.destinations[0].entries.length).toBeGreaterThan(50);
  });

  test('Switzerland is no retest; Connecticut requires theory', () => {
    const entries = seed.destinations[0].entries;
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

  test('lookup groups US under parent and flags subnational variance', () => {
    const origins = listOrigins(seed);
    const us = origins.find(o => o.iso_n3 === '840');
    expect(us).toBeTruthy();
    expect(us!.varies_by_subnational).toBe(true);
    expect(us!.label).toMatch(/United States/i);

    const matches = matchesForOrigin(seed, 'nat:840');
    expect(matches).toHaveLength(1);
    expect(matches[0].destination.iso_n3).toBe('276');
    expect(matches[0].varies_by_subnational).toBe(true);
    expect(matches[0].entries.every(e => e.subnational)).toBe(true);
  });

  test('Japan no-retest lookup against Germany', () => {
    const matches = matchesForOrigin(seed, 'nat:392');
    expect(matches).toHaveLength(1);
    expect(matches[0].any_no_retest).toBe(true);
    expect(matches[0].any_practical).toBe(false);
  });

  test('testLabel wording', () => {
    expect(testLabel(false, false)).toBe('No retest');
    expect(testLabel(true, false)).toBe('Theory only');
    expect(testLabel(true, true)).toBe('Theory + practical');
  });
});

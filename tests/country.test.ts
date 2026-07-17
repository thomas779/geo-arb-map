import { describe, expect, test } from 'bun:test';
import { countryFlag, countryLabel } from '../src/lib/country';

describe('country labels', () => {
  test('converts numeric ISO codes to Unicode flags', () => {
    expect(countryFlag('250')).toBe('🇫🇷');
    expect(countryFlag('840')).toBe('🇺🇸');
    expect(countryFlag('158')).toBe('🇹🇼');
  });

  test('supports the registry Kosovo code and leaves non-ISO entities unflagged', () => {
    expect(countryFlag('XKX')).toBe('🇽🇰');
    expect(countryFlag('000')).toBe('');
    expect(countryLabel('Somaliland', '000')).toBe('Somaliland');
  });
});

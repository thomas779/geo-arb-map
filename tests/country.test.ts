import { describe, expect, test } from 'bun:test';
import { countryFlag, countryLabel, findJurisdictions } from '../src/lib/country';
import type { CitizenshipRoutesData } from '../src/types';

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

describe('country discovery', () => {
  const jurisdictions = [
    { iso_n3: '250', name: 'France' },
    { iso_n3: '254', name: 'French Guiana' },
    { iso_n3: '710', name: 'South Africa' },
    { iso_n3: '178', name: 'Congo' },
    { iso_n3: '180', name: 'Democratic Republic of the Congo' },
    { iso_n3: '086', name: 'British Indian Ocean Territory' },
  ].map(country => ({
    ...country,
    type: 'sovereign' as const,
    coverage: {
      ancestry: 'unchecked' as const,
      naturalization: 'unchecked' as const,
      birth: 'unchecked' as const,
      investment: 'unchecked' as const,
    },
    route_ids: [],
  })) satisfies CitizenshipRoutesData['jurisdictions'];

  test('ranks name prefixes and supports numeric ISO lookup', () => {
    expect(findJurisdictions(jurisdictions, 'congo').map(country => country.name))
      .toEqual(['Congo', 'Democratic Republic of the Congo']);
    expect(findJurisdictions(jurisdictions, '710').map(country => country.name))
      .toEqual(['South Africa']);
  });

  test('never surfaces non-national research entities', () => {
    expect(findJurisdictions(jurisdictions, 'British Indian')).toEqual([]);
  });
});

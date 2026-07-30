import { numericToAlpha2 } from 'i18n-iso-countries';

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - 65;

/**
 * Research entities that carry no nationality of their own, so they get no
 * country page and are filtered out of jurisdiction lists. Antarctica (010 is
 * absent here), Fr. S. Antarctic Lands (260), Heard & McDonald (334),
 * Bouvet (074)… in practice: 086, 239, 260, 334.
 *
 * Single source of truth — this was previously duplicated in src/App.tsx,
 * src/components/CountriesList.tsx and scripts/build_country_pages.ts, which
 * meant adding an entity required remembering all three.
 */
export const NON_APPLICABLE_JURISDICTIONS = new Set(['086', '239', '260', '334']);

/** True when a jurisdiction should be excluded from lists and page generation. */
export function isNonApplicableJurisdiction(isoN3: string): boolean {
  return NON_APPLICABLE_JURISDICTIONS.has(isoN3);
}

/**
 * Convert the numeric ISO codes used by the map into a Unicode flag.
 * Non-ISO research entities deliberately return an empty string instead of
 * borrowing another jurisdiction's flag.
 */
export function countryFlag(isoN3: string): string {
  const alpha2 = isoN3 === 'XKX' ? 'XK' : numericToAlpha2(isoN3);
  if (!alpha2 || !/^[A-Z]{2}$/.test(alpha2)) return '';
  return [...alpha2]
    .map(letter => String.fromCodePoint(letter.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET))
    .join('');
}

export function countryLabel(name: string, isoN3: string): string {
  const flag = countryFlag(isoN3);
  return flag ? `${flag} ${name}` : name;
}

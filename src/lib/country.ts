import { numericToAlpha2 } from 'i18n-iso-countries';

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - 65;

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

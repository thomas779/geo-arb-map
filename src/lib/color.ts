import * as d3 from 'd3';

/**
 * Bloc/lane accent colors were tuned for the dark ocean background. On the
 * light paper theme, pale accents (OECS amber, CAN green, tans, pinks) wash
 * out — so in light mode we clamp Lab lightness instead of hand-retuning
 * every color. Dark mode returns colors untouched.
 */
const LIGHT_MODE_MAX_L = 58;

const cache = new Map<string, string>();

export function displayColor(hex: string, dark: boolean): string {
  if (dark) return hex;
  const cached = cache.get(hex);
  if (cached) return cached;
  const lab = d3.lab(hex);
  const out = lab.l > LIGHT_MODE_MAX_L
    ? d3.lab(LIGHT_MODE_MAX_L, lab.a, lab.b).formatHex()
    : hex;
  cache.set(hex, out);
  return out;
}

export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark');
}

/** Lab-space average of 2+ colors — used for multi-select overlap countries. */
export function blendColors(hexes: string[]): string {
  if (hexes.length === 1) return hexes[0];
  let l = 0, a = 0, b = 0;
  for (const hex of hexes) {
    const lab = d3.lab(hex);
    l += lab.l; a += lab.a; b += lab.b;
  }
  const n = hexes.length;
  return d3.lab(l / n, a / n, b / n).formatHex();
}

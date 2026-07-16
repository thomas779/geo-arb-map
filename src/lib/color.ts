import * as d3 from 'd3';

/**
 * Bloc/lane accents are authored for the dark ocean surface. On light paper
 * they must darken to hold contrast — but a clamp or scale would flatten the
 * lightness ALTERNATION that carries colorblind separation between adjacent
 * palette steps. A constant Lab-lightness OFFSET preserves every ΔL exactly,
 * so light mode inherits the dark palette's validated CVD separation.
 * Dark mode returns colors untouched.
 */
const LIGHT_MODE_L_OFFSET = 10;

const cache = new Map<string, string>();

export function displayColor(hex: string, dark: boolean): string {
  if (dark) return hex;
  const cached = cache.get(hex);
  if (cached) return cached;
  const lab = d3.lab(hex);
  const out = d3.lab(Math.max(lab.l - LIGHT_MODE_L_OFFSET, 8), lab.a, lab.b).formatHex();
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

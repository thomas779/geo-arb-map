#!/usr/bin/env bun
/**
 * Ordered categorical palette for blocs + lanes (dataviz-skill method).
 *
 * Each category family owns a hue arc; blocs step through it IN SIDEBAR ORDER,
 * so the list reads as a sequence and the "next" color is predictable.
 * Lightness alternates between steps for CVD separation. Proto blocs are
 * deliberately low-chroma (they encode "no settlement rights" — recessive by
 * design, exempt from the chroma floor). Colors are identity-stable: they
 * follow the bloc, never selection order (color follows the entity).
 *
 * Validate after running (dataviz skill validator):
 *   node <skill>/scripts/validate_palette.js "<family hexes>" --mode dark --surface "#101823"
 */

import fs from 'node:fs';

// ── OKLCH → sRGB hex ─────────────────────────────────────────────────────────
function oklchToHex(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const toS = (c) => {
    c = Math.max(0, Math.min(1, c));
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${toS(r)}${toS(g)}${toS(bb)}`.toUpperCase();
}

const ramp = (hues, Ls, C) => hues.map((h, i) => oklchToHex(Ls[i % Ls.length], C, h));
const walk = (from, to, n) =>
  Array.from({ length: n }, (_, i) => (n === 1 ? from : from + ((to - from) * i) / (n - 1)));

// ── family definitions (hue arcs, in sidebar order) ─────────────────────────
const FAMILY = {
  full:      { hues: [...walk(255, 220, 4), ...walk(172, 130, 5)], Ls: [0.585, 0.66], C: 0.115 }, // blue → green, hopping sRGB's dark-teal chroma pinch (h≈185-215)
  partial:   { hues: [85, 65, 45],      Ls: [0.66, 0.575, 0.64], C: 0.13 }, // gold → rust
  hub_spoke: { hues: [125],             Ls: [0.63], C: 0.115 },       // lime-green
  one_way:   { hues: [295, 315, 335],   Ls: [0.645, 0.555, 0.66], C: 0.115 }, // violet → magenta
  closed:    { hues: [30, 15, 0, 345],  Ls: [0.585, 0.66, 0.545, 0.65], C: 0.12 }, // clay → crimson
  proto:     { hues: [250, 250, 250],   Ls: [0.55, 0.62, 0.69], C: 0.035 },  // recessive slate
};

// Lanes: identity chips, never co-displayed on the map — hue walks per group,
// alternating L so the sidebar sequence still separates neighbors.
const LANE_FAMILY = {
  bilateral: { from: 95, to: 5,   Ls: [0.60, 0.68], C: 0.12 },  // warm arc
  ancestry:  { from: 345, to: 275, Ls: [0.62, 0.55, 0.68], C: 0.115 }, // rose → violet
};

const CATEGORY_ORDER = ['full', 'partial', 'hub_spoke', 'one_way', 'closed', 'proto'];

const data = JSON.parse(fs.readFileSync('public/blocs_data.json', 'utf8'));

const report = {};
for (const cat of CATEGORY_ORDER) {
  const blocs = data.blocs.filter(b => b.category === cat);
  const f = FAMILY[cat];
  const colors = ramp(f.hues, f.Ls, f.C);
  blocs.forEach((b, i) => { b.color = colors[i]; });
  report[cat] = colors.slice(0, blocs.length);
}

const bilateral = data.bilateral_lanes.filter(l => l.beneficiaries.length > 0);
const ancestry = data.bilateral_lanes.filter(l => l.beneficiaries.length === 0);
for (const [lanes, famKey] of [[bilateral, 'bilateral'], [ancestry, 'ancestry']]) {
  const f = LANE_FAMILY[famKey];
  const hues = walk(f.from, f.to, lanes.length);
  lanes.forEach((l, i) => { l.color = oklchToHex(f.Ls[i % f.Ls.length], f.C, hues[i]); });
  report[`lanes:${famKey}`] = lanes.map(l => l.color);
}

fs.writeFileSync('public/blocs_data.json', JSON.stringify(data, null, 2) + '\n');
for (const [k, v] of Object.entries(report)) console.log(k.padEnd(16), v.join(','));

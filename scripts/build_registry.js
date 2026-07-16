#!/usr/bin/env bun
/**
 * Build data/registry.json: the canonical jurisdiction registry.
 *
 * Two tiers per the locked spec (UNSD M49-style):
 *   - sovereigns:  UN members + observers (Vatican, Palestine)
 *   - territories: supplemental registry of dependencies and special-status
 *     jurisdictions we intentionally track (Taiwan, HK, Macau, Kosovo,
 *     Crown Dependencies, overseas territories, associated states, ...)
 * Entries whose atlas id is not a 3-digit numeric code land in `special`
 * with a note instead of being silently dropped.
 *
 * Names/ids are sourced from world-atlas countries-50m so they match the
 * map layer exactly. Kosovo is appended manually (no M49 numeric code).
 *
 * Usage: bun scripts/build_registry.js [path-to-countries-50m.json]
 */

const fs = require('fs');

// Dependent territories + special-status jurisdictions (not UN members/observers)
const TERRITORY_ISOS = new Set([
  '016', '060', '092', '136', '158', '184', '234', '238', '258', '260',
  '292', '304', '316', '344', '446', '500', '531', '533', '534', '540',
  '570', '574', '580', '612', '630', '652', '654', '660', '663', '666',
  '744', '772', '796', '831', '832', '833', '850', '876',
]);

// Non-state map features that are neither sovereigns nor tracked territories
const NON_JURISDICTION_ISOS = new Set(['010']); // Antarctica

const DISPUTED = { '732': 'Western Sahara: disputed territory (M49 special handling)' };

async function loadAtlas() {
  const localPath = process.argv[2];
  if (localPath) return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
  return res.json();
}

const atlas = await loadAtlas();
const geoms = atlas.objects.countries.geometries;

const sovereigns = [];
const territories = [];
const special = [];
const seen = new Set();

for (const g of geoms) {
  const rawId = String(g.id ?? '');
  const name = g.properties?.name ?? rawId;
  const iso = rawId.padStart(3, '0');
  if (seen.has(iso)) continue;
  seen.add(iso);

  if (!/^\d{3}$/.test(iso)) {
    special.push({ id: rawId, name, note: 'No M49 numeric code in atlas (unrecognized/limited-recognition entity).' });
    continue;
  }
  if (NON_JURISDICTION_ISOS.has(iso)) continue;

  if (TERRITORY_ISOS.has(iso)) {
    territories.push({ iso_n3: iso, name });
  } else if (DISPUTED[iso]) {
    special.push({ id: iso, name, note: DISPUTED[iso] });
  } else {
    sovereigns.push({ iso_n3: iso, name });
  }
}

// Supplements not present (or not usably coded) in the atlas
const SOVEREIGN_SUPPLEMENTS = [
  { iso_n3: '798', name: 'Tuvalu' }, // UN member; too small for the 50m atlas
];
const TERRITORY_SUPPLEMENTS = [
  { iso_n3: '292', name: 'Gibraltar' },
  { iso_n3: '772', name: 'Tokelau' },
];
for (const s of SOVEREIGN_SUPPLEMENTS) if (!seen.has(s.iso_n3)) { sovereigns.push(s); seen.add(s.iso_n3); }
for (const t of TERRITORY_SUPPLEMENTS) if (!seen.has(t.iso_n3)) { territories.push(t); seen.add(t.iso_n3); }
if (!seen.has('XKX')) {
  special.push({ id: 'XKX', name: 'Kosovo', note: 'No M49 numeric code; tracked per the locked registry decision.' });
}

sovereigns.sort((a, b) => a.iso_n3.localeCompare(b.iso_n3));
territories.sort((a, b) => a.iso_n3.localeCompare(b.iso_n3));

const out = {
  meta: {
    description: 'Canonical jurisdiction registry: M49-style core sovereigns + supplemental territory registry. Coverage and future graph layers span both tiers.',
    last_updated: '2026-07-16',
    counts: { sovereigns: sovereigns.length, territories: territories.length, special: special.length },
  },
  sovereigns,
  territories,
  special,
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/registry.json', JSON.stringify(out, null, 2) + '\n');
console.log('data/registry.json:', out.meta.counts);

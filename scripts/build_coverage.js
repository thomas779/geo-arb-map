#!/usr/bin/env bun
/**
 * Build public/coverage.json: an all-countries research-coverage matrix.
 *
 * One row per country/territory in the world-atlas countries-50m TopoJSON
 * (same IDs the map uses), every row seeded "unchecked", then:
 *   - every country appearing anywhere in blocs_data.json (bloc member,
 *     former member, lane destination or beneficiary) -> "partial"
 *   - explicit overrides from the research gray-zone logs fill specific rows
 *     as "verified_none" / "partial" with notes + sources
 * Precedence: a dataset "partial" is never downgraded by an override;
 * override notes are appended instead.
 *
 * States: verified | verified_none | partial | unchecked
 * Usage: bun scripts/build_coverage.js [path-to-countries-50m.json]
 *        (downloads from jsDelivr if no local path given)
 */

const fs = require('fs');

const TODAY = '2026-07-16';

// Gray-zone / could-not-verify overrides. iso -> {state, note, sources}
const OVERRIDES = {
  '268': { state: 'verified_none', note: 'Georgia: 1-yr visa-free stay is generous but unilateral visa policy, not a settlement privilege.', sources: ['Georgian government visa-exemption list'] },
  '336': { state: 'verified_none', note: 'Vatican: citizenship is office-functional, not a settlement lane.', sources: ['Official Vatican citizenship materials'] },
  '031': { state: 'verified_none', note: 'Azerbaijan: Turkey-Azerbaijan is visa-free/ID-card travel only; no settlement lane verified. No Turan visa instrument in force.', sources: ['Turkish official travel guidance'] },
  '674': { state: 'verified_none', note: 'San Marino: 1939/1980 conventions confirmed, but open-ended reciprocal residence/work rights with Italy not proven in primary law.', sources: ['1939 friendship convention', '1980 additional agreement'] },
  '178': { state: 'partial', note: 'Congo: France-Congo accords could not be verified at settlement grade in this sweep; may exist as narrower labor channels.', sources: ['Batch-2 coverage statement'] },
  '496': { state: 'partial', note: 'Mongolia: ethnic-return process fragments found, but no clean primary-law text comparable to Kazakhstan kandas.', sources: ['Batch-2 coverage statement'] },
  '792': { state: 'partial', note: 'Turkey: TRNC-side facilitation exists (property, company formation) but no blanket Turkey-side residence/work right verified.', sources: ['Batch-2 gray-zone log'] },
  '768': { state: 'partial', note: 'Togo: France-Togo accord not verified at settlement grade in batch-2 sweep.', sources: ['Batch-2 coverage statement'] },
  '384': { state: 'partial', note: "Cote d'Ivoire: France-CIV accord not verified at settlement grade in batch-2 sweep.", sources: ['Batch-2 coverage statement'] },
  '158': { state: 'partial', note: 'Taiwan: HK/Macau and Mainland-spouse channels confirmed in primary law, but post-2020 operational tightening imprecise (pending_verification).', sources: ['Batch-2 Greater China run'] },
  '860': { state: 'partial', note: 'Uzbekistan: Russia recruitment lane (2017) is temporary-labor only - out of settlement scope.', sources: ['Publication Pravo 2017 agreement'] },
  '762': { state: 'partial', note: 'Tajikistan: Russia recruitment lane is temporary-only; the 1995 dual-citizenship treaty is recorded under dual_citizenship.', sources: ['Publication Pravo 2020 agreement', '1995 dual-citizenship treaty'] },
  '204': { state: 'partial', note: 'Benin: 2007 France accord derogates from CESEDA but covers work/study channels, not settlement-grade rights.', sources: ['Legifrance Decree No. 2010-230'] },
  '120': { state: 'partial', note: 'Cameroon: France package real but 2009 accord narrower (pending_verification). CEMAC travel implemented; residence/establishment not.', sources: ['Batch-2 Francophone run'] },
  '140': { state: 'partial', note: 'Central African Republic: CEMAC biometric-passport travel partially implemented; no settlement rights in force.', sources: ['CEMAC communiques 2012/2013'] },
  '148': { state: 'partial', note: 'Chad: CEMAC travel partially implemented; no settlement rights in force.', sources: ['CEMAC communiques 2012/2013'] },
  '226': { state: 'partial', note: 'Equatorial Guinea: accepted CEMAC biometric-passport circulation 2017 with continued border controls.', sources: ['Equatorial Guinea official statement 2017'] },
};

// Registry is the canonical jurisdiction list (run scripts/build_registry.js first)
function loadRegistry() {
  return JSON.parse(fs.readFileSync('data/registry.json', 'utf8'));
}

function datasetIsos(data) {
  const isos = new Set();
  for (const b of data.blocs) {
    for (const m of b.members) isos.add(m.iso_n3);
    for (const m of b.former_members ?? []) isos.add(m.iso_n3);
  }
  for (const l of data.bilateral_lanes) {
    isos.add(l.destination.iso_n3);
    for (const m of l.beneficiaries) isos.add(m.iso_n3);
  }
  return isos;
}

const registry = loadRegistry();
const data = JSON.parse(fs.readFileSync('public/blocs_data.json', 'utf8'));
const inDataset = datasetIsos(data);

const entries = [
  ...registry.sovereigns.map(e => ({ ...e, type: 'sovereign' })),
  ...registry.territories.map(e => ({ ...e, type: 'territory' })),
  ...registry.special.map(e => ({ iso_n3: e.id, name: e.name, type: 'special', registry_note: e.note })),
];
const rows = [];
const seen = new Set();

for (const entry of entries) {
  const iso = entry.iso_n3;
  if (seen.has(iso)) continue;
  seen.add(iso);
  const name = entry.name;

  const row = { iso_n3: iso, name, type: entry.type, state: 'unchecked', last_checked: null };
  if (entry.registry_note) row.note = entry.registry_note;

  if (inDataset.has(iso)) {
    row.state = 'partial';
    row.note = [row.note, 'Appears in blocs_data.json (bloc member and/or lane party).'].filter(Boolean).join(' ');
    row.last_checked = TODAY;
  }

  const ov = OVERRIDES[iso];
  if (ov) {
    if (row.state === 'partial' && ov.state === 'verified_none') {
      // dataset presence wins; append the gray-zone finding
      row.note = `${row.note} Gray-zone: ${ov.note}`;
    } else {
      row.state = ov.state;
      row.note = row.note ? `${row.note} ${ov.note}` : ov.note;
    }
    row.sources = ov.sources;
    row.last_checked = TODAY;
  }

  rows.push(row);
}

// Jurisdictions in our dataset that the registry may not carry
for (const iso of inDataset) {
  if (!seen.has(iso)) {
    const name =
      data.blocs.flatMap(b => [...b.members, ...(b.former_members ?? [])])
        .concat(data.bilateral_lanes.flatMap(l => [l.destination, ...l.beneficiaries]))
        .find(m => m.iso_n3 === iso)?.name ?? iso;
    rows.push({ iso_n3: iso, name, type: 'territory', state: 'partial', note: 'In dataset; absent from registry tiers - review registry supplement.', last_checked: TODAY });
    seen.add(iso);
  }
}

rows.sort((a, b) => a.iso_n3.localeCompare(b.iso_n3));

const counts = {};
for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;

const out = {
  meta: {
    description: 'Research-coverage matrix over the canonical registry (M49-style sovereigns + territory supplement): which jurisdictions have been checked for privileged settlement arrangements. States: verified | verified_none | partial | unchecked.',
    last_updated: TODAY,
    counts,
  },
  rows,
};

fs.writeFileSync('public/coverage.json', JSON.stringify(out, null, 2) + '\n');
console.log(`public/coverage.json: ${rows.length} rows —`, counts);

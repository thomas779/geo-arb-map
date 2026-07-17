#!/usr/bin/env bun
/**
 * Build public/citizenship_routes.json.
 *
 * The output is a complete jurisdiction matrix over data/registry.json with
 * one coverage cell for each acquisition mode:
 * ancestry | naturalization | birth | investment.
 *
 * Reviewed records live in data/citizenship_routes.json. Existing identity
 * lanes and birth events mark partial coverage for their destination country,
 * but are not duplicated as new route records here.
 */

import fs from 'node:fs';

const MODES = ['ancestry', 'naturalization', 'birth', 'investment'];
const TODAY = '2026-07-17';

function emptyCoverage() {
  return Object.fromEntries(MODES.map(mode => [mode, 'unchecked']));
}

const registry = JSON.parse(fs.readFileSync('data/registry.json', 'utf8'));
const mobility = JSON.parse(fs.readFileSync('public/blocs_data.json', 'utf8'));
const curated = JSON.parse(fs.readFileSync('data/citizenship_routes.json', 'utf8'));

const entries = [
  ...registry.sovereigns.map(entry => ({ ...entry, type: 'sovereign' })),
  ...registry.territories.map(entry => ({ ...entry, type: 'territory' })),
  ...registry.special.map(entry => ({
    iso_n3: entry.id,
    name: entry.name,
    type: 'special',
    registry_note: entry.note,
  })),
];

const jurisdictions = [];
const byIso = new Map();

for (const entry of entries) {
  if (byIso.has(entry.iso_n3)) continue;
  const row = {
    iso_n3: entry.iso_n3,
    name: entry.name,
    type: entry.type,
    coverage: emptyCoverage(),
    route_ids: [],
  };
  if (entry.registry_note) row.registry_note = entry.registry_note;
  jurisdictions.push(row);
  byIso.set(entry.iso_n3, row);
}

// Existing identity lanes provide partial ancestry coverage.
for (const lane of mobility.bilateral_lanes) {
  if (lane.beneficiaries.length !== 0) continue;
  const row = byIso.get(lane.destination.iso_n3);
  if (row) row.coverage.ancestry = 'partial';
}

// Existing audited birth events provide partial birth coverage.
for (const event of mobility.generational_events ?? []) {
  const row = byIso.get(event.country.iso_n3);
  if (row) row.coverage.birth = 'partial';
}

for (const route of curated.routes) {
  const row = byIso.get(route.country.iso_n3);
  if (!row) {
    throw new Error(`Citizenship route ${route.id} references unknown jurisdiction ${route.country.iso_n3}`);
  }
  row.route_ids.push(route.id);
  if (route.status === 'pending_verification') {
    row.coverage[route.mode] = 'pending';
  } else if (route.mode === 'investment') {
    // A current official source can establish whether a direct programme is
    // operating; that does not imply the other three modes are complete.
    row.coverage.investment = 'reviewed';
  } else {
    row.coverage[route.mode] = 'partial';
  }
}

jurisdictions.sort((a, b) => a.iso_n3.localeCompare(b.iso_n3));

const byMode = Object.fromEntries(MODES.map(mode => [
  mode,
  curated.routes.filter(route => route.mode === mode).length,
]));
const byStatus = {};
for (const route of curated.routes) {
  byStatus[route.status] = (byStatus[route.status] ?? 0) + 1;
}

const out = {
  meta: {
    description: 'Country-level citizenship acquisition matrix. Every registry jurisdiction has explicit coverage for ancestry, naturalization, birth, and investment; unchecked is a research state, not a claim that no route exists.',
    last_updated: TODAY,
    acquisition_modes: {
      ancestry: 'Citizenship through a parent, grandparent, wider descent rule, restoration, or documented heritage connection.',
      naturalization: 'Citizenship after residence or another qualifying domestic status, including rules about which residence periods count.',
      birth: 'Citizenship or an accelerated parent route triggered by place of birth.',
      investment: 'Direct investor citizenship or a contribution programme; residence-by-investment without direct citizenship is naturalization, not CBI.',
    },
    coverage_states: {
      reviewed: 'A current route or verified negative has been checked against an official source.',
      partial: 'At least one relevant rule is recorded, but the mode is not exhaustive for this jurisdiction.',
      pending: 'A legal basis or credible lead exists, but current operation is not verified for live recommendations.',
      unchecked: 'No route-level review has been completed for this mode.',
    },
    counts: {
      jurisdictions: jurisdictions.length,
      routes: curated.routes.length,
      by_mode: byMode,
      by_status: byStatus,
    },
  },
  jurisdictions,
  routes: curated.routes,
};

fs.writeFileSync('public/citizenship_routes.json', JSON.stringify(out, null, 2) + '\n');
console.log('public/citizenship_routes.json:', out.meta.counts);

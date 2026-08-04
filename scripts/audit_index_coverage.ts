#!/usr/bin/env bun
/**
 * Coverage audit for the rights index defined in docs/rights-index-spec.md.
 *
 * The index scores citizenships on permanent rights rather than tourist visa-free
 * access. Most of its inputs do not exist yet, and several exist as fully built
 * schemas with zero rows: transmission_abroad is validated, projected, documented
 * and tested, and populated on none of the 877 routes. A schema that looks
 * finished but carries no data is the failure mode this report exists to make
 * loud, because a scorer reading it would rank every country identically low
 * while appearing precise.
 *
 * This is the progress metric for a sourcing programme measured in months, so it
 * reads only committed/compiled artifacts and writes nothing.
 *
 * Usage:
 *   bun run index:audit           # table
 *   bun run index:audit -- --json # machine-readable, for issue bodies
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const asJson = process.argv.includes('--json');

const corpusPath = `${root}data/compiled/citizenship_routes.json`;
if (!fs.existsSync(corpusPath)) {
  console.error(
    `${corpusPath} is missing.\n` +
      'The compiled corpus is gitignored and lives in the private flag-paths-data repo.\n' +
      'Run bun run data:promote -- --allow-draft first, or fetch the published release.',
  );
  process.exit(1);
}

type Pathway = { eligibility_months?: number | null };
type Route = {
  id: string;
  country: { iso_n3: string };
  mode: 'birth' | 'ancestry' | 'naturalization' | 'investment';
  confidence?: string;
  facts?: Record<string, unknown>;
  transmission_abroad?: unknown;
  parent_residence_right?: unknown;
  nationality_eligibility?: unknown;
  pathways?: Pathway[];
};
type ResidenceRoute = {
  category: string;
  work_rights?: string | null;
  permit_duration_months?: number | null;
  permit_renewable?: boolean | null;
  min_age?: number | null;
  max_age?: number | null;
  counts_toward_permanent_residence?: boolean;
  counts_toward_naturalization?: boolean;
};
type Jurisdiction = { iso_n3: string; dual_nationality?: { status: string } | null };

const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as {
  jurisdictions: Jurisdiction[];
  routes: Route[];
  residence_routes: ResidenceRoute[];
};
const blocs = JSON.parse(fs.readFileSync(`${root}public/blocs_data.json`, 'utf8')) as {
  blocs: Array<{ id: string; category: string; rights?: Record<string, string> }>;
  bilateral_lanes: Array<{ id: string }>;
  dual_citizenship?: { countries?: Record<string, unknown> };
};

const routes = corpus.routes;
const residence = corpus.residence_routes;
const jurisdictions = corpus.jurisdictions;
const byMode = (mode: Route['mode']) => routes.filter(r => r.mode === mode);
const birth = byMode('birth');
const ancestry = byMode('ancestry');
const naturalization = byMode('naturalization');

/** Raw public blocs_data has no zod schema, so probe the serialized form. */
const blocsRaw = fs.readFileSync(`${root}public/blocs_data.json`, 'utf8');
const nonNull = <T>(xs: T[], pick: (x: T) => unknown) =>
  xs.filter(x => pick(x) !== null && pick(x) !== undefined).length;

/**
 * `absent`  — no schema exists; the field has to be designed before sourcing.
 * `empty`   — schema exists and validates, zero rows populated.
 * `thin`    — populated below a level any score could rest on.
 * `prose`   — the information is recorded, but as free text a scorer cannot read.
 * `ready`   — enough structured data to score today.
 */
type Status = 'absent' | 'empty' | 'thin' | 'prose' | 'ready';

type Dimension = {
  id: string;
  axis: 'A' | 'B';
  label: string;
  status: Status;
  have: number;
  total: number;
  note: string;
};

const monthsOf = (r: Route) =>
  (r.pathways ?? []).map(p => p.eligibility_months).filter((m): m is number => typeof m === 'number');
const isoWithMonths = new Set(naturalization.filter(r => monthsOf(r).length > 0).map(r => r.country.iso_n3));
const isoHighConfidence = new Set(
  naturalization.filter(r => monthsOf(r).length > 0 && r.confidence === 'high').map(r => r.country.iso_n3),
);

const factKey = (rs: Route[], key: string) => rs.filter(r => r.facts && key in r.facts).length;

const dimensions: Dimension[] = [
  // ---- Axis A: what the passport is worth once held -----------------------
  {
    id: 'A1',
    axis: 'A',
    label: 'Settlement by right',
    status: 'prose',
    have: 0,
    total: blocs.blocs.length,
    note: `rights_by_status is 3 free-text strings; 0/${blocs.blocs.length} structured`,
  },
  {
    id: 'A2',
    axis: 'A',
    label: 'Work by right',
    status: 'prose',
    have: 0,
    total: blocs.blocs.length,
    note: 'no field separates labour-market access from residence',
  },
  {
    id: 'A3',
    axis: 'A',
    label: 'Transmission to children',
    status: nonNull(routes, r => r.transmission_abroad) === 0 ? 'empty' : 'thin',
    have: nonNull(routes, r => r.transmission_abroad),
    total: birth.length + ancestry.length,
    note: 'TransmissionAbroadSchema is validated, projected, documented and tested',
  },
  {
    id: 'A4',
    axis: 'A',
    label: 'Plurality (dual nationality)',
    status: 'thin',
    have: jurisdictions.filter(j => j.dual_nationality).length,
    total: jurisdictions.length,
    note: `rival model in blocs_data covers ${
      Object.keys(blocs.dual_citizenship?.countries ?? {}).length
    } with a different enum (banned vs prohibited)`,
  },
  { id: 'A5', axis: 'A', label: 'Security of status', status: 'absent', have: 0, total: jurisdictions.length, note: 'no field for revocation, loss by absence, or birth-vs-acquired asymmetry' },
  { id: 'A6', axis: 'A', label: 'Obligations', status: 'absent', have: 0, total: jurisdictions.length, note: 'no field for conscription, citizenship-based tax, exit tax, or retention residence' },
  {
    id: 'A7',
    axis: 'A',
    label: 'Onward acceleration',
    status: 'prose',
    have: 0,
    total: blocs.blocs.length + blocs.bilateral_lanes.length,
    note: 'implied by arrangement prose and by eligibility conditions stripped from the projection',
  },

  // ---- Axis B: how obtainable the citizenship is --------------------------
  {
    id: 'B1',
    axis: 'B',
    label: 'Jus soli',
    status: 'thin',
    have: factKey(birth, 'jus_soli'),
    total: birth.length,
    note: 'complete, but inside untyped facts with no zod, no enum, and no consumer',
  },
  {
    id: 'B2',
    axis: 'B',
    label: 'Descent depth',
    status: 'thin',
    have: factKey(ancestry, 'maximum_ancestor_degree'),
    total: ancestry.length,
    note: 'degree otherwise encoded in eligibility field NAMES, which the projection drops',
  },
  {
    id: 'B3',
    axis: 'B',
    label: 'Naturalisation period',
    status: 'ready',
    have: isoWithMonths.size,
    total: jurisdictions.length,
    note: `${isoHighConfidence.size} of ${isoWithMonths.size} at high confidence`,
  },
  {
    id: 'B4',
    axis: 'B',
    label: 'Investment price',
    status: 'ready',
    have: byMode('investment').length,
    total: byMode('investment').length,
    note: `plus ${residence.filter(r => r.category === 'investment').length} residence-by-investment routes`,
  },
  { id: 'B5', axis: 'B', label: 'Family / spouse', status: 'prose', have: 0, total: routes.length, note: 'spouse conditions live in eligibility[], dropped by data-build before publication' },
  {
    id: 'B6',
    axis: 'B',
    label: 'Discretion',
    status: 'ready',
    have: factKey(routes, 'discretionary_decision'),
    total: routes.length,
    note: 'as-of-right vs discretionary grant',
  },
];

/** Residence-side fields the index leans on but which are separately thin. */
const residenceFields: Dimension[] = [
  { id: 'R1', axis: 'A', label: 'work_rights', status: 'thin', have: nonNull(residence, r => r.work_rights), total: residence.length, note: 'null means NOT RECORDED, never unrestricted' },
  { id: 'R2', axis: 'A', label: 'permit_duration_months', status: 'thin', have: nonNull(residence, r => r.permit_duration_months), total: residence.length, note: '' },
  { id: 'R3', axis: 'A', label: 'permit_renewable', status: 'thin', have: nonNull(residence, r => r.permit_renewable), total: residence.length, note: '' },
  { id: 'R4', axis: 'B', label: 'min_age / max_age', status: 'thin', have: nonNull(residence, r => r.min_age), total: residence.length, note: `max_age populated on ${nonNull(residence, r => r.max_age)}` },
  { id: 'R5', axis: 'B', label: 'counts_toward_* flags', status: 'ready', have: residence.filter(r => typeof r.counts_toward_naturalization === 'boolean').length, total: residence.length, note: 'the only settlement-permanence signal populated for every row' },
];

/**
 * Arrangement provenance. This is the sharpest finding in the report and it was
 * missed on the first pass: only 3 of the 46 published arrangements have a
 * canonical record (eu_eea, mercosur, spain_iberoamerican). The other 43 are
 * legacy passthrough, so they have no directionality, no destinations/beneficiaries
 * split, and no evidence links. Not one of the 24 blocs carries a `sources` field.
 *
 * Dimension A1 is the whole point of the index, and it currently rests almost
 * entirely on unsourced membership lists. Spec rule 6 says every dimension traces
 * to an instrument, so A1 cannot be published from this input regardless of how
 * the scorer is written.
 */
function arrangementProvenance() {
  let canonicalIds = new Set<string>();
  let sample = true;
  try {
    // Synchronous on purpose: the resolver falls back to the committed sample, so
    // a fork without the private pilot still gets a truthful (if smaller) report.
    const mod = require(`${root}scripts/lib/canonical-source.ts`);
    sample = mod.CANONICAL_SOURCE_IS_SAMPLE;
    canonicalIds = new Set(
      (mod.buildCanonicalPilot().arrangements as Array<{ id: string }>).map(a => a.id),
    );
  } catch {
    return null;
  }
  const blocIds = blocs.blocs.map(b => b.id);
  const laneIds = blocs.bilateral_lanes.map(l => l.id);
  return {
    sample,
    canonical_blocs: blocIds.filter(id => canonicalIds.has(id)),
    legacy_blocs: blocIds.filter(id => !canonicalIds.has(id)),
    canonical_lanes: laneIds.filter(id => canonicalIds.has(id)),
    legacy_lanes: laneIds.filter(id => !canonicalIds.has(id)),
    blocs_with_sources: blocs.blocs.filter(b => 'sources' in b).length,
    lanes_with_sources: blocs.bilateral_lanes.filter(l => 'sources' in l).length,
  };
}
const provenance = arrangementProvenance();

/** Structural blockers that are code fixes rather than sourcing. */
const blockers = [
  {
    id: 'directionality',
    ok: blocsRaw.includes('directionality'),
    detail:
      'canonical carries directionality plus participants.destinations/beneficiaries; ' +
      'projectBloc drops both, so a one-way right would be credited symmetrically ' +
      '(wrongly boosting UK BNO/BOT and US COFA)',
  },
  {
    id: 'eligibility projected',
    ok: JSON.stringify(routes[0] ?? {}).includes('"eligibility"'),
    detail: 'eligibility[] is dropped from the public projection, taking descent degree with it',
  },
  {
    id: 'willing_child_abroad reachable',
    ok: !fs
      .readFileSync(`${root}src/lib/pathfinder.ts`, 'utf8')
      .includes("if (n === 'willing_child_abroad') return false"),
    detail: 'needsSatisfied hard-returns false, so the 3 child-birth accelerator edges can never fire',
  },
];

const summary = {
  generated_from: 'data/compiled/citizenship_routes.json + public/blocs_data.json',
  corpus: {
    jurisdictions: jurisdictions.length,
    citizenship_routes: routes.length,
    residence_routes: residence.length,
    birth: birth.length,
    ancestry: ancestry.length,
    naturalization: naturalization.length,
    investment: byMode('investment').length,
    arrangements: blocs.blocs.length,
    bilateral_lanes: blocs.bilateral_lanes.length,
  },
  dimensions,
  residence_fields: residenceFields,
  arrangement_provenance: provenance,
  blockers,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const c = summary.corpus;
console.log('Rights index coverage audit');
console.log(`  ${c.jurisdictions} jurisdictions · ${c.citizenship_routes} citizenship routes ` +
  `(birth ${c.birth}, ancestry ${c.ancestry}, naturalization ${c.naturalization}, investment ${c.investment})`);
console.log(`  ${c.residence_routes} residence routes · ${c.arrangements} arrangements · ${c.bilateral_lanes} bilateral lanes`);

const MARK: Record<Status, string> = {
  ready: 'READY ', thin: 'THIN  ', prose: 'PROSE ', empty: 'EMPTY ', absent: 'ABSENT',
};

function table(title: string, rows: Dimension[]) {
  console.log(`\n${title}`);
  for (const d of rows) {
    const frac = d.status === 'absent' ? '-' : `${d.have}/${d.total}`;
    console.log(`  ${d.id.padEnd(3)} ${MARK[d.status]} ${d.label.padEnd(28)} ${frac.padStart(9)}  ${d.note}`);
  }
}

table('AXIS A — worth once held', dimensions.filter(d => d.axis === 'A'));
table('AXIS B — openness to outsiders', dimensions.filter(d => d.axis === 'B'));
table('Residence-side fields', residenceFields);

if (provenance) {
  const cb = provenance.canonical_blocs.length;
  const cl = provenance.canonical_lanes.length;
  const total = blocs.blocs.length + blocs.bilateral_lanes.length;
  console.log('\nArrangement provenance (dimension A1 rests on this)');
  console.log(`  canonical   ${cb + cl}/${total}   blocs: ${provenance.canonical_blocs.join(', ') || 'none'}` +
    ` · lanes: ${provenance.canonical_lanes.join(', ') || 'none'}`);
  console.log(`  legacy      ${provenance.legacy_blocs.length + provenance.legacy_lanes.length}/${total}` +
    `   no directionality, no destinations/beneficiaries split, no evidence links`);
  console.log(`  sourced     blocs ${provenance.blocs_with_sources}/${blocs.blocs.length}` +
    ` · lanes ${provenance.lanes_with_sources}/${blocs.bilateral_lanes.length}`);
  if (provenance.blocs_with_sources === 0) {
    console.log('  WARNING  not one bloc carries a source. A1 cannot satisfy spec rule 6 from this input.');
  }
  if (provenance.sample) console.log('  (canonical source is the committed SAMPLE, so counts are a floor)');
}

console.log('\nStructural blockers (code, not sourcing)');
for (const b of blockers) {
  console.log(`  ${b.ok ? 'FIXED  ' : 'BLOCKED'} ${b.id.padEnd(28)} ${b.detail}`);
}

const scoreable = dimensions.filter(d => d.status === 'ready').length;
console.log(
  `\n${scoreable} of ${dimensions.length} dimensions are scoreable today. ` +
    `Publishing before that improves means shipping a number that measures coverage, not rights.`,
);

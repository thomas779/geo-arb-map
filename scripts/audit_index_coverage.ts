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
import { scoreAxis } from './lib/rights-score';

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
  descent?: { limit_recorded: boolean; authored_basis?: string } | null;
  jus_soli_condition?: { family: string; families?: string[]; openness: number | null } | null;
  summary?: string;
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
type Jurisdiction = {
  iso_n3: string;
  dual_nationality?: {
    status: string;
    provenance: 'instrument' | 'legacy_import';
    asymmetry: { present: string };
  } | null;
};

const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as {
  jurisdictions: Jurisdiction[];
  routes: Route[];
  residence_routes: ResidenceRoute[];
};
const blocs = JSON.parse(fs.readFileSync(`${root}public/blocs_data.json`, 'utf8')) as {
  blocs: Array<{ id: string; category: string; rights?: Record<string, string> }>;
  bilateral_lanes: Array<{ id: string; sources?: string[] }>;
  // No `dual_citizenship.countries` any more: the rival plurality model was
  // migrated into the canonical field and retired by #144.
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

const pluralityRows = jurisdictions
  .map(j => j.dual_nationality)
  .filter((row): row is NonNullable<Jurisdiction['dual_nationality']> => Boolean(row));
const pluralityLegacy = pluralityRows.filter(row => row.provenance === 'legacy_import').length;
const pluralityAsymmetric = pluralityRows.filter(row => row.asymmetry.present === 'yes').length;

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

/** Rights matrices from the canonical pilot, empty when only the sample resolves. */
function provenanceMatrices(): Array<{ citizenship?: { reside?: string; work?: string; detail?: string } }> {
  try {
    const mod = require(`${root}scripts/lib/canonical-source.ts`);
    return (mod.buildCanonicalPilot().arrangements as Array<{ rights_matrix?: unknown }>)
      .flatMap(a => (a.rights_matrix ? [a.rights_matrix as { citizenship?: { reside?: string; work?: string; detail?: string } }] : []));
  } catch {
    return [];
  }
}

const factKey = (rs: Route[], key: string) => rs.filter(r => r.facts && key in r.facts).length;

/**
 * The conditional third of jus soli cannot be scored on its recorded label.
 *
 * `facts.parent_condition` has 16 values and no schema, and cross-reading each
 * route's own summary against its label shows three systematic problems:
 *  - 29 of 59 are dependent territories whose summary only says "follows <metropole>
 *    rules", so the label restates another jurisdiction's rule, not their instrument;
 *  - Belgium, France, Italy and Ukraine say birth alone is NOT generally enough, so
 *    their conditional flag describes a right to acquire LATER (age 13/16/18), not
 *    citizenship at birth;
 *  - Chile reads "Chilean by birth except children of transient foreigners", which is
 *    unconditional with a narrow exception, yet it is bucketed with Germany's
 *    settled-parent rule.
 * Detected here rather than asserted, so the count tracks the data as it is fixed.
 */
const conditionalBirth = birth.filter(r => (r.facts as Record<string, unknown> | undefined)?.jus_soli === 'conditional');

// Read off the projected field rather than recomputed here. `data-build.ts` already
// runs `classifyJusSoli` into `jus_soli_condition` for every birth route, so
// classifying a second time in the audit would let the two drift and report a
// coverage number the corpus does not actually carry.
const conditions = conditionalBirth.map(r => r.jus_soli_condition).filter(Boolean);
const classifiedConditional = conditions.filter(c => c!.family !== 'needs_review').length;
const deferring = conditions.filter(c => c!.family === 'follows_metropole').length;
const unreviewed = conditions.filter(c => c!.family === 'needs_review').length;
/** Routes whose text describes more than one qualifying limb. A single label loses these. */
const multiLimb = conditions.filter(c => (c!.families ?? []).length > 1).length;
const conditionalTension = conditionalBirth.filter(r => {
  const summary = String((r as unknown as { summary?: string }).summary ?? '');
  return /follows .* (rules|law)/.test(summary)
    || /alone is not|not generally enough|No unconditional/.test(summary)
    || /stateless/i.test(summary);
});

/**
 * A1 and A2 read the structured rights matrix (#154), not the free-text prose.
 * `unknown` does not count: it means the instrument was not read, and counting it
 * would let an unmeasured bloc inflate the dimension.
 */
const matrices = provenanceMatrices();
const rightsMatrixCount = matrices.length;
const rightsMatrixScoreable = matrices.filter(m => m.citizenship?.reside && m.citizenship.reside !== 'unknown').length;
const workScoreable = matrices.filter(m => m.citizenship?.work && m.citizenship.work !== 'unknown').length;
// Populated is not verified. A row derived from the recorded prose is marked
// UNVERIFIED in its detail, because reading instruments has corrected 3 of the 5
// read so far: ECOWAS confers entry not residence, EAEU residence is tied to an
// employment contract, and OECS lets a member regulate movement under art. 12.5.
const rightsVerified = matrices.filter(
  m => m.citizenship?.detail && !m.citizenship.detail.startsWith('UNVERIFIED'),
).length;

const dimensions: Dimension[] = [
  // ---- Axis A: what the passport is worth once held -----------------------
  {
    id: 'A1',
    axis: 'A',
    label: 'Settlement by right',
    status: rightsMatrixScoreable > 0 ? 'thin' : 'prose',
    have: rightsMatrixScoreable,
    total: blocs.blocs.length,
    note: `${rightsVerified} of ${rightsMatrixCount} rows were read against the instrument; `
      + 'the rest are prose-derived and marked UNVERIFIED in their detail',
  },
  {
    id: 'A2',
    axis: 'A',
    label: 'Work by right',
    status: workScoreable > 0 ? 'thin' : 'prose',
    have: workScoreable,
    total: blocs.blocs.length,
    note: 'work is now a separate enum from residence, so a residence-only right no longer '
      + 'scores as labour-market access',
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
    // Instrument-read rows only. A `legacy_import` carries a headline claim and
    // the prose it arrived with, and no limbs at all — counting it as coverage
    // would report the retired blocs_data model back as progress.
    have: pluralityRows.filter(row => row.provenance === 'instrument').length,
    total: jurisdictions.length,
    note: `one model now: the blocs_data rival (banned vs prohibited) is retired and its `
      + `rows migrated. ${pluralityLegacy} unsourced import(s) carried as legacy_import — `
      + `a status and prose, every limb unknown — and excluded from this count. `
      + `${pluralityAsymmetric} row(s) record a birth-vs-naturalised or equivalent split `
      + `structurally`,
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
    label: 'Jus soli (tri-state)',
    status: 'thin',
    have: factKey(birth, 'jus_soli'),
    total: birth.length,
    note: 'untyped facts, no zod, no enum, no consumer; and see B1b before scoring the conditional third',
  },
  {
    id: 'B1b',
    axis: 'B',
    label: 'Jus soli CONDITION',
    status: classifiedConditional >= conditionalBirth.length * 0.9 ? 'ready' : 'thin',
    have: classifiedConditional,
    total: conditionalBirth.length,
    note: `conditional routes resolved into a typed family; ${deferring} defer to a metropole `
      + `and ${unreviewed} await primary review (both score null, never zero); `
      + `${multiLimb} state more than one qualifying limb and score on the widest`,
  },
  {
    id: 'B2',
    axis: 'B',
    label: 'Descent depth (recorded)',
    status: nonNull(ancestry, r => r.descent) >= ancestry.length * 0.9 ? 'ready' : 'thin',
    have: nonNull(ancestry, r => r.descent),
    total: ancestry.length,
    note: `derived from authored eligibility field names, plus ${ancestry.filter(r => r.descent?.authored_basis).length} `
      + `authored from prose the field names never carried; the `
      + `${ancestry.length - nonNull(ancestry, r => r.descent)} nulls record neither an ancestral relation nor an `
      + 'origin claim',
  },
  {
    id: 'B2b',
    axis: 'B',
    label: 'Descent CEILING',
    status: 'thin',
    have: ancestry.filter(r => r.descent?.limit_recorded).length,
    total: ancestry.length,
    // Only a STATED cutoff counts, whether written as a numeric bound in the
    // eligibility conditions or authored from the provision. A list that merely
    // stops at a grandparent is not a ceiling, and scoring it as one would tell a
    // qualifying applicant they do not qualify.
    note: 'how DEEP descent runs. Absence is unknown, never a cutoff, so this cannot be derived and must be sourced',
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
  const canonicalById = new Map<string, { id: string; source_refs?: unknown[] }>();
  let sample = true;
  try {
    // Synchronous on purpose: the resolver falls back to the committed sample, so
    // a fork without the private pilot still gets a truthful (if smaller) report.
    const mod = require(`${root}scripts/lib/canonical-source.ts`);
    sample = mod.CANONICAL_SOURCE_IS_SAMPLE;
    const arrangements = mod.buildCanonicalPilot().arrangements as Array<{
      id: string; source_refs?: unknown[];
    }>;
    canonicalIds = new Set(arrangements.map(a => a.id));
    for (const a of arrangements) canonicalById.set(a.id, a);
  } catch {
    return null;
  }
  const blocIds = blocs.blocs.map(b => b.id);
  const laneIds = blocs.bilateral_lanes.map(l => l.id);
  return {
    sample,
    // Sourced is reported separately from canonical on purpose. Migrating an
    // arrangement into canonical does NOT source it: the 2026-08-08 lane batch
    // moved 21 records across with 6 of them carrying no source_refs at all, and
    // "canonical 24/46" must never be read as "sourced 24/46".
    canonical_sourced: [...canonicalById.values()].filter(
      a => (a.source_refs ?? []).length > 0,
    ).length,
    canonical_total: canonicalIds.size,
    canonical_blocs: blocIds.filter(id => canonicalIds.has(id)),
    legacy_blocs: blocIds.filter(id => !canonicalIds.has(id)),
    canonical_lanes: laneIds.filter(id => canonicalIds.has(id)),
    legacy_lanes: laneIds.filter(id => !canonicalIds.has(id)),
    blocs_with_sources: blocs.blocs.filter(b => 'sources' in b).length,
    lanes_with_sources: blocs.bilateral_lanes.filter(l => 'sources' in l).length,
    // Blocs sourced CANONICALLY, which is the only place a bloc citation can
    // live. `blocs_with_sources` above counts a `sources` key on the legacy
    // public/blocs_data.json records; that file has never carried one and is not
    // where evidence goes, so on its own it under-reports a migrated-and-sourced
    // bloc to zero forever. Kept as a separate number rather than merged, because
    // a bloc can be canonical and still unsourced and that has to stay visible:
    // this counts source_refs, not membership of the pilot.
    canonical_blocs_sourced: blocIds.filter(
      id => (canonicalById.get(id)?.source_refs ?? []).length > 0,
    ).length,
    // A `sources` array is not a citation. Measured 2026-08-08: of 28 entries
    // across 15 lanes, ZERO are URLs. 27 are prose ("Executive Decree 226 of July
    // 2021", "Russian GUVM work-patent rules") and one is a bare host. So they
    // cannot become source entities (SourceRecordSchema.url requires a real URL)
    // and "15 of 22 sourced" overstates what is actually citable.
    lanes_with_resolvable_source: blocs.bilateral_lanes.filter(
      l => ((l as { sources?: string[] }).sources ?? []).some(u => /^https?:\/\//.test(u)),
    ).length,
  };
}
const provenance = arrangementProvenance();

/** Structural blockers that are code fixes rather than sourcing. */
const blockers = [
  {
    id: 'directionality served',
    ok: blocsRaw.includes('directionality'),
    detail:
      'projectBloc now carries directionality and the destinations/beneficiaries split ' +
      '(2026-08-08), so the pipe is correct. Still BLOCKED because ' +
      'public/blocs_data.json is the legacy SOURCE the browser reads, not a projection ' +
      'output, and only 2 of 24 blocs are canonical. Clears when the 43 arrangements ' +
      'reach canonical and the served file is generated from the projection.',
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
  console.log(`  sourced     blocs ${provenance.canonical_blocs_sourced}/${blocs.blocs.length}` +
    ` (canonical source_refs; ${provenance.blocs_with_sources} legacy \`sources\` fields)` +
    ` · lanes ${provenance.lanes_with_sources}/${blocs.bilateral_lanes.length}` +
    ` (only ${provenance.lanes_with_resolvable_source} lane(s) cite a URL; the rest are prose)`);
  console.log(`  of the ${provenance.canonical_total} canonical, ` +
    `${provenance.canonical_sourced} carry source_refs — migrating is not sourcing`);
  if (provenance.canonical_blocs_sourced === 0) {
    console.log('  WARNING  not one bloc carries a source. A1 cannot satisfy spec rule 6 from this input.');
  } else if (provenance.canonical_blocs_sourced < blocs.blocs.length) {
    console.log(`  WARNING  ${blocs.blocs.length - provenance.canonical_blocs_sourced} bloc(s) still` +
      ' carry no source. A1 can only be scored over the sourced subset, never the full set.');
  }
  if (provenance.sample) console.log('  (canonical source is the committed SAMPLE, so counts are a floor)');
}

/**
 * Run the composite model (scripts/lib/rights-score.ts) over dimension AVAILABILITY
 * to answer "could either axis be published today".
 *
 * This is programme readiness, NOT a country score: the input is whether each
 * dimension is scoreable at all, not any country's value. Weights are equal because
 * the spec deliberately defers them until the inputs exist, so this measures breadth
 * of coverage rather than importance.
 */
function axisReadiness(axis: 'A' | 'B') {
  return scoreAxis(
    dimensions
      .filter(dimension => dimension.axis === axis)
      .map(dimension => ({
        id: dimension.id,
        weight: 1,
        value: dimension.status === 'ready' ? 100 : null,
        confidence: dimension.status === 'ready' ? ('high' as const) : null,
      })),
  );
}

console.log('\nCould either axis be published today? (equal weights, availability only)');
for (const axis of ['A', 'B'] as const) {
  const readiness = axisReadiness(axis);
  const pct = Math.round(readiness.completeness * 100);
  console.log(
    `  Axis ${axis}  ${readiness.scored}/${readiness.total} dimensions scoreable  `
      + `completeness ${String(pct).padStart(3)}%  `
      + `${readiness.rankable ? 'RANKABLE' : 'NOT RANKABLE'}`,
  );
  if (readiness.missing.length) console.log(`          missing: ${readiness.missing.join(', ')}`);
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

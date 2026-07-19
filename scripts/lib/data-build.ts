import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlocsData, BilateralLane, Bloc, Member } from '../../src/types';
import { buildCanonicalPilot, type CanonicalPilot } from './canonical-pilot';
import {
  CANONICAL_SCHEMAS,
  type ArrangementRecord,
  type JurisdictionRecord,
  type SourceRecord,
} from './canonical-schema';
import { buildDataShadow, type DataShadow } from './data-shadow';
import {
  importCanonicalPilot,
  readCanonicalProjections,
  type CanonicalImportResult,
  type CanonicalProjections,
} from './canonical-store';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * `data:build` is the single deterministic release compiler. It reads the
 * canonical revision scope from local SQLite, combines the migrated canonical
 * pilot entities with the read-only legacy remainder, compiles the public
 * release artifact set, and runs parity gates that prove the migration has not
 * disturbed unmigrated data and that the only reviewed difference vs the live
 * public files is the sanctioned Spain Ibero-American beneficiary correction.
 *
 * The compiler never approves revisions, never publishes a release row, and
 * never overwrites `public/*.json`. It writes a draft release bundle under
 * `.generated/data-canonical/releases/<release_id>/` for parity review only.
 */

const PILOT_ARRANGEMENT_IDS = ['eu_eea', 'mercosur', 'spain_iberoamerican'] as const;
const SPAIN_IBEROAMERICAN = 'spain_iberoamerican';

/** Reviewed compatibility differences canonical is permitted to introduce. */
export interface SanctionedDifference {
  entity_id: string;
  kind: 'beneficiary_correction';
  path_prefix: string;
  reason: string;
}

export const SANCTIONED_DIFFERENCES: readonly SanctionedDifference[] = [
  {
    entity_id: SPAIN_IBEROAMERICAN,
    kind: 'beneficiary_correction',
    path_prefix: 'bilateral_lanes[spain_iberoamerican].beneficiaries',
    reason:
      'Ibero-American beneficiary enumeration corrected against Civil Code Article 22 and the BOE community list; awaits compatibility cutover.',
  },
];

export type ParityStatus = 'pass' | 'sanctioned' | 'fail';

export interface ParityGateResult {
  gate: string;
  status: ParityStatus;
  detail: unknown;
}

export interface CompatibilityDiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
}

export interface CompatibilityDiff {
  mobility: CompatibilityDiffEntry[];
  citizenship: CompatibilityDiffEntry[];
}

export interface EntityHashEntry {
  entity_id: string;
  revision_id: string;
  entity_type: 'source' | 'jurisdiction' | 'arrangement';
  content_hash: string;
  review_status: 'draft';
}

export interface ReleaseChangelog {
  baseline_release_id: string | null;
  added: string[];
  changed: string[];
  removed: string[];
}

export interface DataReleaseManifest {
  schema_version: 1;
  mode: 'canonical_release_draft';
  release_id: string;
  candidate_release_id: string;
  shadow_release_id: string;
  created_at: string;
  published_at: null;
  scope: {
    jurisdictions: string[];
    arrangements: string[];
  };
  source_hashes: Record<string, string>;
  compatibility_hashes: {
    mobility_source: string;
    citizenship_source: string;
    mobility_projected: string;
    citizenship_projected: string;
  };
  counts: {
    canonical_entities: number;
    sources: number;
    jurisdictions: number;
    arrangements: number;
    routes: number;
    edges: number;
    legacy_mobility_remainder: number;
    legacy_citizenship_remainder: number;
  };
  parity_passed: boolean;
}

export interface DataRelease {
  manifest: DataReleaseManifest;
  catalog: {
    jurisdictions: Array<{
      iso_n3: string;
      name: string;
      type: string;
      review_state: string;
      route_count: number;
    }>;
    arrangements: Array<{
      id: string;
      name: string;
      kind: string;
      status: string;
      display_category: string;
      directionality: string;
    }>;
  };
  projections: CanonicalProjections;
  jurisdictions: JurisdictionRecord[];
  arrangements: ArrangementRecord[];
  sources: SourceRecord[];
  graph: {
    meta: { description: string; generated_from: string };
    edges: CanonicalProjections['edges'];
  };
  api_release_rows: EntityHashEntry[];
  compatibility: {
    mobility: BlocsData;
    citizenship: { meta: Record<string, unknown>; routes: unknown[] };
  };
  compatibility_diff: CompatibilityDiff;
  parity: {
    gates: ParityGateResult[];
    reviewed_differences: SanctionedDifference[];
    sanctioned_diff_paths: string[];
    passed: boolean;
  };
}

interface Registry {
  sovereigns: Member[];
  territories: Member[];
  special: Array<{ id: string; name: string }>;
}

interface CuratedCitizenship {
  meta: Record<string, unknown>;
  routes: Array<{ id: string; country: Member }>;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function readJson<T>(root: string, relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

function registryNameMap(registry: Registry): Map<string, string> {
  const names = new Map<string, string>();
  for (const member of [...registry.sovereigns, ...registry.territories]) {
    names.set(member.iso_n3, member.name);
  }
  for (const special of registry.special) {
    names.set(special.id, special.name);
  }
  return names;
}

function participantsOf(
  record: ArrangementRecord,
  role: 'members' | 'former_members' | 'destinations' | 'beneficiaries',
): string[] {
  return [...record.participants[role]].sort();
}

function laneParticipantIsos(
  lane: BilateralLane,
  role: 'destination' | 'beneficiaries',
): string[] {
  if (role === 'destination') return [lane.destination.iso_n3];
  return lane.beneficiaries.map(member => member.iso_n3).sort();
}

function blocMemberIsoos(bloc: Bloc, role: 'members' | 'former_members'): string[] {
  const list = role === 'members' ? bloc.members : (bloc.former_members ?? []);
  return list.map(member => member.iso_n3).sort();
}

/** Recursive, natural-key-aware deep diff producing stable path strings. */
export function deepDiff(before: unknown, after: unknown, segment: string): CompatibilityDiffEntry[] {
  const entries: CompatibilityDiffEntry[] = [];
  if (Object.is(before, after)) return entries;
  if (
    before === null
    || after === null
    || typeof before !== 'object'
    || typeof after !== 'object'
  ) {
    entries.push({ path: segment, kind: 'changed', before, after });
    return entries;
  }
  const beforeIsArray = Array.isArray(before);
  const afterIsArray = Array.isArray(after);
  if (beforeIsArray !== afterIsArray) {
    entries.push({ path: segment, kind: 'changed', before, after });
    return entries;
  }
  if (beforeIsArray) {
    const beforeList = before as unknown[];
    const afterList = after as unknown[];
    const keyField = arrayKeyField(beforeList, afterList);
    if (keyField) {
      const beforeMap = new Map<string, unknown>();
      const afterMap = new Map<string, unknown>();
      for (const item of beforeList) {
        if (item && typeof item === 'object' && keyField in item) {
          beforeMap.set(String((item as Record<string, unknown>)[keyField]), item);
        }
      }
      for (const item of afterList) {
        if (item && typeof item === 'object' && keyField in item) {
          afterMap.set(String((item as Record<string, unknown>)[keyField]), item);
        }
      }
      const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
      for (const key of [...keys].sort()) {
        const child = `${segment}[${key}]`;
        if (!beforeMap.has(key)) {
          entries.push({ path: child, kind: 'added', before: undefined, after: afterMap.get(key) });
        } else if (!afterMap.has(key)) {
          entries.push({ path: child, kind: 'removed', before: beforeMap.get(key), after: undefined });
        } else {
          entries.push(...deepDiff(beforeMap.get(key), afterMap.get(key), child));
        }
      }
      return entries;
    }
    const max = Math.max(beforeList.length, afterList.length);
    for (let index = 0; index < max; index += 1) {
      const child = `${segment}[${index}]`;
      if (index >= beforeList.length) {
        entries.push({ path: child, kind: 'added', before: undefined, after: afterList[index] });
      } else if (index >= afterList.length) {
        entries.push({ path: child, kind: 'removed', before: beforeList[index], after: undefined });
      } else {
        entries.push(...deepDiff(beforeList[index], afterList[index], child));
      }
    }
    return entries;
  }
  const beforeObj = before as Record<string, unknown>;
  const afterObj = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  for (const key of [...keys].sort()) {
    const child = segment ? `${segment}.${key}` : key;
    if (!(key in beforeObj)) {
      entries.push({ path: child, kind: 'added', before: undefined, after: afterObj[key] });
    } else if (!(key in afterObj)) {
      entries.push({ path: child, kind: 'removed', before: beforeObj[key], after: undefined });
    } else {
      entries.push(...deepDiff(beforeObj[key], afterObj[key], child));
    }
  }
  return entries;
}

function arrayKeyField(...arrays: unknown[][]): 'id' | 'iso_n3' | null {
  for (const field of ['id', 'iso_n3'] as const) {
    if (arrays.every(arr => arr.length > 0 && arr.every(item =>
      item !== null && typeof item === 'object' && field in item))) {
      return field;
    }
  }
  return null;
}

function correctedSpainBeneficiaries(
  canonical: ArrangementRecord,
  legacy: BilateralLane,
  names: Map<string, string>,
): Member[] {
  const legacyByIso = new Map(legacy.beneficiaries.map(member => [member.iso_n3, member]));
  return participantsOf(canonical, 'beneficiaries').map(iso => {
    const existing = legacyByIso.get(iso);
    if (existing) return { iso_n3: existing.iso_n3, name: existing.name };
    const name = names.get(iso);
    if (!name) throw new Error(`Corrected beneficiary ${iso} is missing from the registry`);
    return { iso_n3: iso, name };
  });
}

/** Build compatibility mobility: legacy mobility with the sanctioned Spain fix overlaid. */
function projectCompatibilityMobility(
  pilot: CanonicalPilot,
  shadow: DataShadow,
  source: BlocsData,
  names: Map<string, string>,
): BlocsData {
  const spainCanonical = pilot.arrangements.find(item => item.id === SPAIN_IBEROAMERICAN);
  if (!spainCanonical) throw new Error('Spain Ibero-American arrangement missing from pilot');
  const legacySpain = source.bilateral_lanes.find(lane => lane.id === SPAIN_IBEROAMERICAN);
  if (!legacySpain) throw new Error('Spain Ibero-American lane missing from public mobility data');
  const corrected = correctedSpainBeneficiaries(spainCanonical, legacySpain, names);
  const bilateral_lanes = source.bilateral_lanes.map(lane =>
    lane.id === SPAIN_IBEROAMERICAN
      ? { ...lane, beneficiaries: corrected }
      : lane,
  );
  return { ...source, bilateral_lanes };
}

function diffMobility(generated: BlocsData, source: BlocsData): CompatibilityDiffEntry[] {
  const entries: CompatibilityDiffEntry[] = [];
  entries.push(...deepDiff(source.meta, generated.meta, 'meta'));
  entries.push(...deepDiff(source.blocs, generated.blocs, 'blocs'));
  entries.push(
    ...deepDiff(source.bilateral_lanes, generated.bilateral_lanes, 'bilateral_lanes'),
  );
  for (const key of Object.keys(source)) {
    if (['meta', 'blocs', 'bilateral_lanes'].includes(key)) continue;
    entries.push(...deepDiff(
      (source as unknown as Record<string, unknown>)[key],
      (generated as unknown as Record<string, unknown>)[key],
      key,
    ));
  }
  return entries;
}

function diffCitizenship(generated: CuratedCitizenship, source: CuratedCitizenship): CompatibilityDiffEntry[] {
  return deepDiff(source, generated, '');
}

export function isSanctioned(
  entry: CompatibilityDiffEntry,
  sanctioned: readonly SanctionedDifference[],
): boolean {
  return sanctioned.some(diff => {
    if (entry.path === diff.path_prefix) return true;
    const rest = entry.path.slice(diff.path_prefix.length);
    return rest.startsWith('.') || rest.startsWith('[');
  });
}

function gateExclusiveOwnership(
  pilot: CanonicalPilot,
  sourceMobility: BlocsData,
  shadow: DataShadow,
): ParityGateResult {
  const failures: string[] = [];
  const legacyArrangementIds = new Set([
    ...sourceMobility.blocs.map(bloc => bloc.id),
    ...sourceMobility.bilateral_lanes.map(lane => lane.id),
  ]);
  for (const arrangement of pilot.arrangements) {
    if (!legacyArrangementIds.has(arrangement.id)) {
      failures.push(`canonical arrangement ${arrangement.id} has no legacy counterpart`);
    }
  }
  const internalArrangementCounts = new Map<string, number>();
  for (const arrangement of pilot.arrangements) {
    internalArrangementCounts.set(arrangement.id, (internalArrangementCounts.get(arrangement.id) ?? 0) + 1);
  }
  for (const [id, count] of internalArrangementCounts) {
    if (count > 1) failures.push(`duplicate canonical arrangement ${id}`);
  }
  const shadowArrangementIds = new Set(shadow.arrangements.map(item => item.record.id));
  for (const arrangement of pilot.arrangements) {
    if (!shadowArrangementIds.has(arrangement.id)) {
      failures.push(`pilot arrangement ${arrangement.id} missing from shadow extraction`);
    }
  }
  const seenJurisdictions = new Set<string>();
  for (const jurisdiction of pilot.jurisdictions) {
    if (seenJurisdictions.has(jurisdiction.id)) {
      failures.push(`duplicate pilot jurisdiction ${jurisdiction.id}`);
    }
    seenJurisdictions.add(jurisdiction.id);
  }
  return {
    gate: 'exclusive_ownership',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail: failures,
  };
}

function gateLegacyRemainderParity(
  sourceMobility: BlocsData,
  sourceCitizenship: CuratedCitizenship,
  pilot: CanonicalPilot,
): ParityGateResult {
  const pilotArrangementIds = new Set<string>(pilot.arrangements.map(item => item.id));
  const pilotJurisdictionIsos = new Set(pilot.jurisdictions.map(item => item.jurisdiction.iso_n3));
  const remainderBlocs = sourceMobility.blocs.filter(bloc => !pilotArrangementIds.has(bloc.id));
  const remainderLanes = sourceMobility.bilateral_lanes.filter(lane => !pilotArrangementIds.has(lane.id));
  const remainderRoutes = sourceCitizenship.routes.filter(
    route => !pilotJurisdictionIsos.has(route.country.iso_n3),
  );
  const sourceArrangementIds = new Set([
    ...sourceMobility.blocs.map(bloc => bloc.id),
    ...sourceMobility.bilateral_lanes.map(lane => lane.id),
  ]);
  const unownedPilotArrangements = pilot.arrangements
    .map(item => item.id)
    .filter(id => !sourceArrangementIds.has(id));
  const failures: string[] = [];
  if (unownedPilotArrangements.length > 0) {
    failures.push(`pilot arrangements absent from source: ${unownedPilotArrangements.join(', ')}`);
  }
  return {
    gate: 'legacy_remainder_parity',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail: {
      legacy_mobility_remainder: remainderBlocs.length + remainderLanes.length,
      legacy_citizenship_remainder: remainderRoutes.length,
      failures,
    },
  };
}

function gateParticipantParity(
  pilot: CanonicalPilot,
  sourceMobility: BlocsData,
): ParityGateResult {
  const failures: string[] = [];
  const reviewed: Array<{ arrangement_id: string; role: string; kind: string; before: string[]; after: string[] }> = [];
  for (const arrangement of pilot.arrangements) {
    const legacy = arrangementLegacyFromMobility(arrangement, sourceMobility);
    const comparisons: Array<{
      role: 'members' | 'former_members' | 'destinations' | 'beneficiaries';
      canonical: string[];
      legacy: string[];
    }> = arrangement.kind === 'regional'
      ? [
        { role: 'members', canonical: participantsOf(arrangement, 'members'), legacy: blocMemberIsoos(legacy as Bloc, 'members') },
        { role: 'former_members', canonical: participantsOf(arrangement, 'former_members'), legacy: blocMemberIsoos(legacy as Bloc, 'former_members') },
      ]
      : [
        { role: 'destinations', canonical: participantsOf(arrangement, 'destinations'), legacy: laneParticipantIsos(legacy as BilateralLane, 'destination') },
        { role: 'beneficiaries', canonical: participantsOf(arrangement, 'beneficiaries'), legacy: laneParticipantIsos(legacy as BilateralLane, 'beneficiaries') },
      ];
    for (const { role, canonical, legacy: legacySet } of comparisons) {
      if (role === 'beneficiaries' && arrangement.id === SPAIN_IBEROAMERICAN) {
        const added = canonical.filter(iso => !legacySet.includes(iso));
        const removed = legacySet.filter(iso => !canonical.includes(iso));
        reviewed.push({ arrangement_id: arrangement.id, role, kind: 'beneficiary_correction', before: legacySet, after: canonical });
        if (removed.length > 0) {
          failures.push(`Spain correction must not remove beneficiaries (removed: ${removed.join(', ')})`);
        }
        continue;
      }
      const added = canonical.filter(iso => !legacySet.includes(iso));
      const removed = legacySet.filter(iso => !canonical.includes(iso));
      if (added.length > 0 || removed.length > 0) {
        failures.push(
          `${arrangement.id}.${role} drifted from legacy (+${added.join(',')}/-${removed.join(',')})`,
        );
      }
    }
  }
  return {
    gate: 'pilot_participant_parity',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail: { reviewed, failures },
  };
}

function arrangementLegacyFromMobility(
  arrangement: ArrangementRecord,
  sourceMobility: BlocsData,
): Bloc | BilateralLane {
  const bloc = sourceMobility.blocs.find(item => item.id === arrangement.id);
  if (bloc) return bloc;
  const lane = sourceMobility.bilateral_lanes.find(item => item.id === arrangement.id);
  if (lane) return lane;
  throw new Error(`Pilot arrangement ${arrangement.id} not found in source mobility`);
}

function gateSchemaValidity(pilot: CanonicalPilot): ParityGateResult {
  const failures: string[] = [];
  for (const source of pilot.sources) {
    const result = CANONICAL_SCHEMAS.source.safeParse(source);
    if (!result.success) failures.push(`source ${source.id}: ${result.error.message}`);
  }
  for (const jurisdiction of pilot.jurisdictions) {
    const result = CANONICAL_SCHEMAS.jurisdiction.safeParse(jurisdiction);
    if (!result.success) failures.push(`jurisdiction ${jurisdiction.id}: ${result.error.message}`);
  }
  for (const arrangement of pilot.arrangements) {
    const result = CANONICAL_SCHEMAS.arrangement.safeParse(arrangement);
    if (!result.success) failures.push(`arrangement ${arrangement.id}: ${result.error.message}`);
  }
  return {
    gate: 'schema_validity',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail: failures,
  };
}

function gateCompatibilityDiff(
  compatibilityDiff: CompatibilityDiff,
): { result: ParityGateResult; sanctionedPaths: string[] } {
  const sanctionedPaths = SANCTIONED_DIFFERENCES.map(diff => diff.path_prefix);
  const unsanctioned = [
    ...compatibilityDiff.mobility,
    ...compatibilityDiff.citizenship,
  ].filter(entry => !isSanctioned(entry, SANCTIONED_DIFFERENCES));
  return {
    result: {
      gate: 'compatibility_drift',
      status: unsanctioned.length === 0 ? 'sanctioned' : 'fail',
      detail: {
        sanctioned_paths: sanctionedPaths,
        sanctioned_diffs: [
          ...compatibilityDiff.mobility,
          ...compatibilityDiff.citizenship,
        ].filter(entry => isSanctioned(entry, SANCTIONED_DIFFERENCES)),
        unsanctioned_diffs: unsanctioned,
      },
    },
    sanctionedPaths,
  };
}

function gateUnreleasedState(database: Database): ParityGateResult {
  const releases = database.query('SELECT COUNT(*) AS count FROM releases').get() as { count: number };
  const approved = database.query(
    `SELECT COUNT(*) AS count FROM canonical_revisions WHERE review_status = 'approved'`,
  ).get() as { count: number };
  const publishedRows = database.query(
    `SELECT COUNT(*) AS count FROM releases WHERE status = 'published'`,
  ).get() as { count: number };
  const ok = releases.count === 0 && approved.count === 0 && publishedRows.count === 0;
  return {
    gate: 'unreleased_draft_state',
    status: ok ? 'pass' : 'fail',
    detail: { releases: releases.count, approved_revisions: approved.count, published_releases: publishedRows.count },
  };
}

export interface CompileDataReleaseOptions {
  root?: string;
  pilot?: CanonicalPilot;
  shadow?: DataShadow;
}

export interface CompiledDataRelease extends DataRelease {
  imported: CanonicalImportResult;
  database: Database;
}

/**
 * Compile a draft release from the canonical pilot plus the read-only legacy
 * remainder. Caller owns the returned database handle and must close it.
 */
export function compileDataRelease(options: CompileDataReleaseOptions = {}): CompiledDataRelease {
  const root = options.root ?? REPO_ROOT;
  const shadow = options.shadow ?? buildDataShadow(root);
  const pilot = options.pilot ?? buildCanonicalPilot(shadow);

  const sourceMobility = readJson<BlocsData>(root, 'public/blocs_data.json');
  const sourceCitizenship = readJson<CuratedCitizenship>(root, 'data/citizenship_routes.json');
  const registry = readJson<Registry>(root, 'data/registry.json');
  const names = registryNameMap(registry);

  const database = new Database(':memory:', { strict: true });
  const migration = fs.readFileSync(
    path.join(root, 'data/d1/migrations/0001_canonical_data.sql'),
    'utf8',
  );
  database.exec(migration);
  const imported = importCanonicalPilot(database, pilot);
  const projections = readCanonicalProjections(
    database,
    Object.values(imported.revision_by_entity),
  );

  const compatibilityMobility = projectCompatibilityMobility(pilot, shadow, sourceMobility, names);
  const compatibilityCitizenship: CuratedCitizenship = {
    meta: sourceCitizenship.meta,
    routes: sourceCitizenship.routes,
  };

  const mobilityDiff = diffMobility(compatibilityMobility, sourceMobility);
  const citizenshipDiff = diffCitizenship(compatibilityCitizenship, sourceCitizenship);
  const compatibilityDiff: CompatibilityDiff = { mobility: mobilityDiff, citizenship: citizenshipDiff };

  const gates: ParityGateResult[] = [];
  gates.push(gateExclusiveOwnership(pilot, sourceMobility, shadow));
  gates.push(gateLegacyRemainderParity(sourceMobility, sourceCitizenship, pilot));
  gates.push(gateParticipantParity(pilot, sourceMobility));
  gates.push(gateSchemaValidity(pilot));
  const { result: compatibilityGate, sanctionedPaths } = gateCompatibilityDiff(compatibilityDiff);
  gates.push(compatibilityGate);
  gates.push(gateUnreleasedState(database));

  const passed = gates.every(gate => gate.status !== 'fail');

  const apiReleaseRows: EntityHashEntry[] = [
    ...pilot.sources,
    ...pilot.jurisdictions,
    ...pilot.arrangements,
  ].sort((a, b) => a.id.localeCompare(b.id)).map(record => {
    const revisionId = imported.revision_by_entity[record.id];
    const contentHash = createHash('sha256').update(JSON.stringify(record)).digest('hex');
    return {
      entity_id: record.id,
      revision_id: revisionId,
      entity_type: record.entity_type,
      content_hash: contentHash,
      review_status: 'draft' as const,
    };
  });

  const catalog = {
    jurisdictions: pilot.jurisdictions.map(item => ({
      iso_n3: item.jurisdiction.iso_n3,
      name: item.jurisdiction.name,
      type: item.jurisdiction.type,
      review_state: item.review.state,
      route_count: item.routes.length,
    })),
    arrangements: pilot.arrangements.map(item => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      status: item.status,
      display_category: item.display.category,
      directionality: item.directionality,
    })),
  };

  const graph = {
    meta: {
      description: 'Status-graph edges compiled from canonical arrangement pathways and regional membership (SQL-derived).',
      generated_from: 'canonical SQLite projections via scripts/lib/data-build.ts',
    },
    edges: projections.edges,
  };

  const manifestContent = {
    schema_version: 1 as const,
    mode: 'canonical_release_draft' as const,
    candidate_release_id: pilot.release_id,
    shadow_release_id: pilot.shadow_release_id,
    created_at: imported.created_at,
    published_at: null as null,
    scope: {
      jurisdictions: pilot.jurisdictions.map(item => item.jurisdiction.iso_n3).sort(),
      arrangements: [...PILOT_ARRANGEMENT_IDS],
    },
    source_hashes: {
      'canonical/pilot': hashJson({
        sources: pilot.sources,
        jurisdictions: pilot.jurisdictions,
        arrangements: pilot.arrangements,
      }),
      'public/blocs_data.json': hashJson(sourceMobility),
      'data/citizenship_routes.json': hashJson(sourceCitizenship),
      'data/registry.json': hashJson(registry),
      'data/migration-pilot.json': hashJson(shadow.pilot),
    },
    compatibility_hashes: {
      mobility_source: hashJson(sourceMobility),
      citizenship_source: hashJson(sourceCitizenship),
      mobility_projected: hashJson(compatibilityMobility),
      citizenship_projected: hashJson(compatibilityCitizenship),
    },
    counts: {
      canonical_entities: imported.counts.entities,
      sources: pilot.sources.length,
      jurisdictions: pilot.jurisdictions.length,
      arrangements: pilot.arrangements.length,
      routes: imported.counts.routes,
      edges: projections.edges.length,
      legacy_mobility_remainder:
        sourceMobility.blocs.filter(b => !pilot.arrangements.some(a => a.id === b.id)).length
        + sourceMobility.bilateral_lanes.filter(l => !pilot.arrangements.some(a => a.id === l.id)).length,
      legacy_citizenship_remainder: sourceCitizenship.routes.filter(
        r => !pilot.jurisdictions.some(j => j.jurisdiction.iso_n3 === r.country.iso_n3),
      ).length,
    },
    parity_passed: passed,
  };
  const releaseId = hashJson(manifestContent).slice(0, 16);
  const manifest: DataReleaseManifest = { release_id: releaseId, ...manifestContent };

  return {
    manifest,
    catalog,
    projections,
    jurisdictions: pilot.jurisdictions,
    arrangements: pilot.arrangements,
    sources: pilot.sources,
    graph,
    api_release_rows: apiReleaseRows,
    compatibility: {
      mobility: compatibilityMobility,
      citizenship: compatibilityCitizenship,
    },
    compatibility_diff: compatibilityDiff,
    parity: {
      gates,
      reviewed_differences: [...SANCTIONED_DIFFERENCES],
      sanctioned_diff_paths: sanctionedPaths,
      passed,
    },
    imported,
    database,
  };
}

/** Compute a changelog vs a prior draft release manifest, if present on disk. */
export function computeChangelog(
  release: DataRelease,
  previousManifest: { release_id: string; entity_hashes?: Record<string, string> } | null,
): ReleaseChangelog {
  const current = new Map(release.api_release_rows.map(row => [row.entity_id, row.content_hash]));
  if (!previousManifest || !previousManifest.entity_hashes) {
    return {
      baseline_release_id: previousManifest?.release_id ?? null,
      added: [...current.keys()].sort(),
      changed: [],
      removed: [],
    };
  }
  const previous = new Map(Object.entries(previousManifest.entity_hashes));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, hash] of current) {
    if (!previous.has(id)) added.push(id);
    else if (previous.get(id) !== hash) changed.push(id);
  }
  for (const id of previous.keys()) {
    if (!current.has(id)) removed.push(id);
  }
  return {
    baseline_release_id: previousManifest.release_id,
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sourceFileName(source: SourceRecord): string {
  return `${source.id.replace(/:/g, '--')}.json`;
}

/** Find the most recent prior draft release manifest on disk, if any. */
export function findPreviousDraftManifest(root = REPO_ROOT): {
  release_id: string;
  entity_hashes?: Record<string, string>;
} | null {
  const releasesRoot = path.join(root, '.generated/data-canonical/releases');
  if (!fs.existsSync(releasesRoot)) return null;
  const candidates = fs.readdirSync(releasesRoot)
    .map(dir => path.join(releasesRoot, dir, 'manifest.json'))
    .filter(file => fs.existsSync(file));
  if (candidates.length === 0) return null;
  let best: { release_id: string; entity_hashes?: Record<string, string>; mtime: number } | null = null;
  for (const file of candidates) {
    try {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (manifest.mode !== 'canonical_release_draft') continue;
      const stat = fs.statSync(file);
      if (!best || stat.mtimeMs > best.mtime) {
        best = { release_id: manifest.release_id, entity_hashes: manifest.entity_hashes, mtime: stat.mtimeMs };
      }
    } catch {
      continue;
    }
  }
  if (!best) return null;
  return { release_id: best.release_id, entity_hashes: best.entity_hashes };
}

/**
 * Write a draft release bundle. Returns the release directory. Does not publish.
 *
 * Local draft output is a rebuildable build artifact (gitignored), so the write
 * is idempotent: the release id is content-addressed, so identical input always
 * lands at the same path and rewrites cleanly. Immutability of releases is
 * enforced for published D1 rows by the schema triggers in
 * `data/d1/migrations/0001_canonical_data.sql`, not by this local writer.
 */
export function writeDataRelease(release: DataRelease, root = REPO_ROOT): string {
  const releaseRoot = path.join(
    root,
    '.generated/data-canonical/releases',
    release.manifest.release_id,
  );
  // Snapshot the prior baseline before rewriting this release's directory.
  const previousAll = findPreviousDraftManifest(root);
  const previous = previousAll && previousAll.release_id !== release.manifest.release_id
    ? previousAll
    : null;
  fs.rmSync(releaseRoot, { recursive: true, force: true });
  const entityHashes = Object.fromEntries(
    release.api_release_rows.map(row => [row.entity_id, row.content_hash]),
  );
  const manifestWithHashes = { ...release.manifest, entity_hashes: entityHashes };
  for (const source of release.sources) {
    writeJson(path.join(releaseRoot, 'sources', sourceFileName(source)), source);
  }
  for (const jurisdiction of release.jurisdictions) {
    writeJson(
      path.join(releaseRoot, 'jurisdictions', `${jurisdiction.jurisdiction.iso_n3}.json`),
      jurisdiction,
    );
  }
  for (const arrangement of release.arrangements) {
    writeJson(path.join(releaseRoot, 'arrangements', `${arrangement.id}.json`), arrangement);
  }
  writeJson(path.join(releaseRoot, 'manifest.json'), manifestWithHashes);
  writeJson(path.join(releaseRoot, 'catalog.json'), release.catalog);
  writeJson(path.join(releaseRoot, 'projections.json'), release.projections);
  writeJson(path.join(releaseRoot, 'graph.json'), release.graph);
  writeJson(path.join(releaseRoot, 'api_release_rows.json'), release.api_release_rows);
  writeJson(path.join(releaseRoot, 'compatibility/blocs_data.json'), release.compatibility.mobility);
  writeJson(
    path.join(releaseRoot, 'compatibility/citizenship_routes.json'),
    release.compatibility.citizenship,
  );
  writeJson(path.join(releaseRoot, 'compatibility_diff.json'), release.compatibility_diff);
  writeJson(path.join(releaseRoot, 'parity-report.json'), release.parity);
  writeJson(path.join(releaseRoot, 'changes.json'), computeChangelog(release, previous));

  writeJson(path.join(root, '.generated/data-canonical/latest.json'), {
    release_id: release.manifest.release_id,
    manifest: `releases/${release.manifest.release_id}/manifest.json`,
    parity_passed: release.parity.passed,
  });
  return releaseRoot;
}

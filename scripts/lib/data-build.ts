import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BlocsData,
  BilateralLane,
  Bloc,
  CitizenshipAcquisitionMode,
  CitizenshipCoverageState,
  CitizenshipRoute,
  CitizenshipRoutesData,
  Member,
  ResidenceRoute,
} from '../../src/types';
import {
  CANONICAL_SCHEMAS,
  type ArrangementRecord,
  type JurisdictionRecord,
  type SourceRecord,
} from './canonical-schema';
import {
  readCanonicalProjections,
  type CanonicalProjections,
} from './canonical-store';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * `data:build` is the deterministic release compiler. It is deliberately
 * decoupled from the authoring source: it reads reviewed canonical records from
 * a persistent SQLite database (the local mirror of `flag-paths-data`, or a
 * `wrangler d1 export`), deserializes `canonical_revisions.payload_json`, and
 * compiles the public release. Seeding that database from Git is a separate
 * stage (`bun run data:db`); this stage only reads it, so the same compiler
 * works against an approved D1 export after cutover.
 *
 * The compiler combines the migrated canonical entities with the read-only
 * legacy remainder, reconstructs the public shapes, and runs parity gates that
 * prove the DB round-trips every canonical-owned field and that the only
 * compatibility drift vs the live public files is the sanctioned Spain
 * Ibero-American beneficiary correction.
 *
 * It never approves revisions, never publishes a release row, and never
 * overwrites `public/*.json`. It writes a draft release bundle under
 * `.generated/data-canonical/releases/<release_id>/` for parity review only.
 */

const SPAIN_IBEROAMERICAN = 'spain_iberoamerican';
const SPAIN_ADDED_BENEFICIARIES = ['188', '192', '214', '222', '320', '340', '558', '591'] as const;

/** Canonical-owned compatibility fields that may legitimately differ from legacy. */
export interface SanctionedDifference {
  entity_id: string;
  kind: 'beneficiary_correction';
  description: string;
}

export const SANCTIONED_DIFFERENCES: readonly SanctionedDifference[] = [
  {
    entity_id: SPAIN_IBEROAMERICAN,
    kind: 'beneficiary_correction',
    description:
      'Ibero-American beneficiary enumeration corrected against Civil Code Article 22 and the BOE community list; awaits compatibility cutover.',
  },
];

export type CompileSelectionMode = 'draft' | 'approved' | 'release';

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
  citizenship_field_drift: Array<{ entity_id: string; field: string; canonical: unknown; legacy: unknown }>;
}

export interface EntityRow {
  entity_id: string;
  entity_type: 'source' | 'jurisdiction' | 'arrangement';
  revision_id: string;
  content_hash: string;
  review_status: string;
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
  database: {
    content_hash: string;
    selection_mode: CompileSelectionMode;
    release_id: string | null;
  };
  created_at: string;
  published_at: null;
  scope: {
    jurisdictions: string[];
    arrangements: string[];
  };
  source_hashes: Record<string, string>;
  counts: {
    canonical_entities: number;
    sources: number;
    jurisdictions: number;
    arrangements: number;
    routes: number;
    legacy_mobility_remainder: number;
    legacy_citizenship_remainder: number;
  };
  parity_passed: boolean;
}

export interface DataRelease {
  input: {
    database_path: string;
    baseline_release_id: string | null;
  };
  manifest: DataReleaseManifest;
  catalog: {
    jurisdictions: Array<Record<string, unknown>>;
    arrangements: Array<Record<string, unknown>>;
  };
  projections: CanonicalProjections;
  jurisdictions: JurisdictionRecord[];
  arrangements: ArrangementRecord[];
  sources: SourceRecord[];
  api_release_rows: EntityRow[];
  compatibility: {
    mobility: BlocsData;
    citizenship: { meta: Record<string, unknown>; routes: unknown[] };
  };
  frontend: {
    citizenship: CitizenshipRoutesData;
  };
  compatibility_diff: CompatibilityDiff;
  parity: {
    gates: ParityGateResult[];
    reviewed_differences: Array<{ entity_id: string; kind: string; description: string }>;
    passed: boolean;
  };
}

interface Registry {
  sovereigns: Member[];
  territories: Member[];
  special: Array<{ id: string; name: string }>;
}

const ACQUISITION_MODES: CitizenshipAcquisitionMode[] = [
  'ancestry',
  'naturalization',
  'birth',
  'investment',
];

interface MigrationPilot {
  jurisdictions: string[];
  arrangements: {
    blocs: string[];
    bilateral_lanes: string[];
  };
}

interface LegacyCitizenshipRoute {
  id: string;
  country: Member;
  mode: string;
  status: string;
  title: string;
  summary: string;
  facts: Record<string, unknown>;
  confidence: string;
  last_checked: string;
  sources: Array<{ title: string; url: string }>;
}

interface LegacyCitizenship {
  meta: Record<string, unknown>;
  routes: LegacyCitizenshipRoute[];
}

export interface LoadedCanonical {
  sources: SourceRecord[];
  jurisdictions: JurisdictionRecord[];
  arrangements: ArrangementRecord[];
  entities: EntityRow[];
  revisionByEntity: Record<string, string>;
  projections: CanonicalProjections;
  dbState: {
    releases: number;
    approved_revisions: number;
    published_releases: number;
    selected_statuses: string[];
    selected_release_status: string | null;
  };
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
  for (const special of registry.special) names.set(special.id, special.name);
  return names;
}

interface CanonicalRevisionRow {
  entity_id: string;
  entity_type: 'source' | 'jurisdiction' | 'arrangement';
  revision_id: string;
  payload_json: string;
  content_hash: string;
  review_status: 'draft' | 'approved' | 'rejected';
  created_at: string;
  supersedes_revision_id: string | null;
}

export interface CanonicalDatabaseSelection {
  mode?: CompileSelectionMode;
  releaseId?: string;
}

function selectRevisionHeads(
  rows: CanonicalRevisionRow[],
  mode: Exclude<CompileSelectionMode, 'release'>,
): CanonicalRevisionRow[] {
  const eligible = rows.filter(row =>
    mode === 'approved'
      ? row.review_status === 'approved'
      : row.review_status !== 'rejected');
  const byEntity = new Map<string, CanonicalRevisionRow[]>();
  for (const row of eligible) {
    const group = byEntity.get(row.entity_id) ?? [];
    group.push(row);
    byEntity.set(row.entity_id, group);
  }

  const selected: CanonicalRevisionRow[] = [];
  for (const [entityId, group] of byEntity) {
    const superseded = new Set(
      group
        .map(row => row.supersedes_revision_id)
        .filter((id): id is string => id !== null),
    );
    const heads = group.filter(row => !superseded.has(row.revision_id));
    if (heads.length !== 1) {
      throw new Error(
        `Canonical entity ${entityId} has ${heads.length} ${mode} revision heads; `
          + 'link revisions with supersedes_revision_id or compile an explicit release.',
      );
    }
    selected.push(heads[0]!);
  }
  return selected.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}

function materializeDatabaseInput(inputPath: string): {
  databasePath: string;
  cleanup: () => void;
} {
  if (path.extname(inputPath).toLowerCase() !== '.sql') {
    return { databasePath: inputPath, cleanup: () => undefined };
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-paths-d1-export-'));
  const databasePath = path.join(temporaryRoot, 'export.sqlite');
  const database = new Database(databasePath, { create: true, strict: true });
  try {
    database.exec(fs.readFileSync(inputPath, 'utf8'));
    database.exec('PRAGMA optimize');
  } catch (error) {
    database.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw new Error(
      `Failed to materialize D1 SQL export ${inputPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  database.close();
  return {
    databasePath,
    cleanup: () => fs.rmSync(temporaryRoot, { recursive: true, force: true }),
  };
}

/** Read the single current draft head for every entity from a DB or D1 export. */
export function readCanonicalHeadIds(
  dbPath: string,
  root = REPO_ROOT,
): Record<string, string> {
  const absolute = path.isAbsolute(dbPath) ? dbPath : path.join(root, dbPath);
  if (!fs.existsSync(absolute)) throw new Error(`Canonical database not found at ${absolute}`);
  const materialized = materializeDatabaseInput(absolute);
  const database = new Database(materialized.databasePath, { readonly: true });
  try {
    const rows = database.query(
      `SELECT
         entity.id AS entity_id,
         entity.entity_type AS entity_type,
         revision.id AS revision_id,
         revision.payload_json AS payload_json,
         revision.content_hash AS content_hash,
         revision.review_status AS review_status,
         revision.created_at AS created_at,
         revision.supersedes_revision_id AS supersedes_revision_id
       FROM canonical_revisions AS revision
       JOIN canonical_entities AS entity ON entity.id = revision.entity_id
       ORDER BY entity.id, revision.created_at, revision.id`,
    ).all() as CanonicalRevisionRow[];
    return Object.fromEntries(
      selectRevisionHeads(rows, 'draft').map(row => [row.entity_id, row.revision_id]),
    );
  } finally {
    database.close();
    materialized.cleanup();
  }
}

/** Open a canonical SQLite database (local mirror or D1 export) and load one revision per entity. */
export function loadCanonicalDatabase(
  dbPath: string,
  root = REPO_ROOT,
  selection: CanonicalDatabaseSelection = {},
): LoadedCanonical {
  const absolute = path.isAbsolute(dbPath) ? dbPath : path.join(root, dbPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `Canonical database not found at ${absolute}. Run \`bun run data:db\` first, `
        + 'or pass --db <path> to a wrangler D1 export.',
    );
  }
  const materialized = materializeDatabaseInput(absolute);
  const database = new Database(materialized.databasePath, { readonly: true });
  try {
    const mode = selection.mode ?? 'draft';
    if (mode === 'release' && !selection.releaseId) {
      throw new Error('Release selection requires a releaseId');
    }
    if (mode !== 'release' && selection.releaseId) {
      throw new Error('releaseId can only be used with release selection mode');
    }

    const allRows = database.query(
      `SELECT
         entity.id AS entity_id,
         entity.entity_type AS entity_type,
         revision.id AS revision_id,
         revision.payload_json AS payload_json,
         revision.content_hash AS content_hash,
         revision.review_status AS review_status,
         revision.created_at AS created_at,
         revision.supersedes_revision_id AS supersedes_revision_id
       FROM canonical_revisions AS revision
       JOIN canonical_entities AS entity ON entity.id = revision.entity_id
       ORDER BY entity.id, revision.created_at, revision.id`,
    ).all() as CanonicalRevisionRow[];

    let selectedReleaseStatus: string | null = null;
    let rows: CanonicalRevisionRow[];
    if (mode === 'release') {
      const release = database.query(
        'SELECT status FROM releases WHERE id = ?1',
      ).get(selection.releaseId!) as { status: string } | null;
      if (!release) throw new Error(`Canonical release ${selection.releaseId} does not exist`);
      selectedReleaseStatus = release.status;
      const selectedIds = new Set(
        (database.query(
          'SELECT revision_id FROM release_items WHERE release_id = ?1 ORDER BY entity_id',
        ).all(selection.releaseId!) as Array<{ revision_id: string }>)
          .map(row => row.revision_id),
      );
      rows = allRows.filter(row => selectedIds.has(row.revision_id));
      if (rows.length !== selectedIds.size) {
        throw new Error(`Canonical release ${selection.releaseId} references missing revisions`);
      }
    } else {
      rows = selectRevisionHeads(allRows, mode);
    }
    if (rows.length === 0) {
      throw new Error(`Canonical ${mode} selection is empty`);
    }

    const sources: SourceRecord[] = [];
    const jurisdictions: JurisdictionRecord[] = [];
    const arrangements: ArrangementRecord[] = [];
    const entities: EntityRow[] = [];
    const revisionByEntity: Record<string, string> = {};

    for (const row of rows) {
      const record = JSON.parse(row.payload_json) as
        SourceRecord | JurisdictionRecord | ArrangementRecord;
      const actualHash = hashJson(record);
      if (actualHash !== row.content_hash) {
        throw new Error(
          `canonical_revisions content_hash mismatch for ${row.entity_id}: `
            + `stored ${row.content_hash}, computed ${actualHash}`,
        );
      }
      if (record.id !== row.entity_id) {
        throw new Error(
          `canonical_revisions entity mismatch: row ${row.entity_id} contains ${record.id}`,
        );
      }
      const schema = CANONICAL_SCHEMAS[row.entity_type];
      const parsed = schema.safeParse(record);
      if (!parsed.success) {
        throw new Error(
          `canonical_revisions payload for ${row.entity_id} failed its schema: ${parsed.error.message}`,
        );
      }
      if (
        row.entity_type === 'jurisdiction'
        && (parsed.data as JurisdictionRecord).id
          !== `jurisdiction:${(parsed.data as JurisdictionRecord).jurisdiction.iso_n3}`
      ) {
        throw new Error(
          `canonical jurisdiction identity mismatch for ${row.entity_id}`,
        );
      }
      entities.push({
        entity_id: row.entity_id,
        entity_type: row.entity_type,
        revision_id: row.revision_id,
        content_hash: actualHash,
        review_status: row.review_status,
      });
      revisionByEntity[row.entity_id] = row.revision_id;
      if (row.entity_type === 'source') sources.push(parsed.data as SourceRecord);
      if (row.entity_type === 'jurisdiction') jurisdictions.push(parsed.data as JurisdictionRecord);
      if (row.entity_type === 'arrangement') arrangements.push(parsed.data as ArrangementRecord);
    }
    sources.sort((a, b) => a.id.localeCompare(b.id));
    jurisdictions.sort((a, b) => a.id.localeCompare(b.id));
    arrangements.sort((a, b) => a.id.localeCompare(b.id));
    entities.sort((a, b) => a.entity_id.localeCompare(b.entity_id));

    const dbState = {
      releases: (database.query('SELECT COUNT(*) AS count FROM releases').get() as { count: number }).count,
      approved_revisions: (database.query(
        `SELECT COUNT(*) AS count FROM canonical_revisions WHERE review_status = 'approved'`,
      ).get() as { count: number }).count,
      published_releases: (database.query(
        `SELECT COUNT(*) AS count FROM releases WHERE status = 'published'`,
      ).get() as { count: number }).count,
      selected_statuses: [...new Set(rows.map(row => row.review_status))].sort(),
      selected_release_status: selectedReleaseStatus,
    };
    const projections = readCanonicalProjections(
      database,
      rows.map(row => row.revision_id),
    );
    return {
      sources,
      jurisdictions,
      arrangements,
      entities,
      revisionByEntity,
      projections,
      dbState,
    };
  } finally {
    database.close();
    materialized.cleanup();
  }
}

/** Recursive, natural-key-aware deep diff producing stable path strings. */
export function deepDiff(before: unknown, after: unknown, segment: string): CompatibilityDiffEntry[] {
  const entries: CompatibilityDiffEntry[] = [];
  if (Object.is(before, after)) return entries;
  if (
    before === null || after === null
    || typeof before !== 'object' || typeof after !== 'object'
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
      const beforeMap = keyIndex(beforeList, keyField);
      const afterMap = keyIndex(afterList, keyField);
      for (const key of new Set([...beforeMap.keys(), ...afterMap.keys()]).values()) {
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
  for (const key of new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]).values()) {
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

function keyIndex(arr: unknown[], field: string): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const item of arr) {
    if (item && typeof item === 'object' && field in item) {
      map.set(String((item as Record<string, unknown>)[field]), item);
    }
  }
  return map;
}

/** Resolve canonical beneficiary ISOs to Member[], preserving legacy objects where they exist. */
function resolveMembers(isos: string[], legacyMembers: Member[], names: Map<string, string>): Member[] {
  const legacyByIso = new Map(legacyMembers.map(member => [member.iso_n3, member]));
  return isos.map(iso => {
    const existing = legacyByIso.get(iso);
    if (existing) return { iso_n3: existing.iso_n3, name: existing.name };
    const name = names.get(iso);
    if (!name) throw new Error(`Canonical beneficiary ${iso} is missing from the registry`);
    return { iso_n3: iso, name };
  });
}

function resolveMembersLegacyOrder(
  isos: string[],
  legacyMembers: Member[],
  names: Map<string, string>,
): Member[] {
  const selected = new Set(isos);
  const existing = legacyMembers.filter(member => selected.has(member.iso_n3));
  const existingIsos = new Set(existing.map(member => member.iso_n3));
  const additions = isos.filter(iso => !existingIsos.has(iso));
  return [...existing, ...resolveMembers(additions, [], names)];
}

/**
 * Reconstruct the public mobility shape from the legacy remainder plus canonical
 * pilot projections. Only reviewed corrections are overlaid on the legacy
 * record (currently the Spain beneficiary set); every other byte is inherited
 * from the verified-identical legacy record. The projection is driven by the
 * canonical record deserialized from the database.
 */
function projectCompatibilityMobility(
  loaded: LoadedCanonical,
  source: BlocsData,
  names: Map<string, string>,
): BlocsData {
  const arrangementById = new Map(loaded.arrangements.map(item => [item.id, item]));
  const blocs = source.blocs.map(bloc => {
    const canonical = arrangementById.get(bloc.id) as ArrangementRecord | undefined;
    return canonical ? projectBloc(canonical, bloc, names) : bloc;
  });
  const bilateral_lanes = source.bilateral_lanes.map(lane => {
    const canonical = arrangementById.get(lane.id) as ArrangementRecord | undefined;
    return canonical ? projectLane(canonical, lane, names) : lane;
  });
  return { ...source, blocs, bilateral_lanes };
}

/** Project every compatibility field owned by the canonical regional schema. */
function projectBloc(canonical: ArrangementRecord, legacy: Bloc, names: Map<string, string>): Bloc {
  const { former_members: _legacyFormerMembers, ...legacyWithoutFormerMembers } = legacy;
  return {
    ...legacyWithoutFormerMembers,
    id: canonical.id,
    name: canonical.name,
    category: canonical.display.category,
    strength: canonical.display.strength,
    color: canonical.display.color,
    members: resolveMembers(canonical.participants.members, legacy.members, names),
    ...(canonical.participants.former_members.length
      ? {
        former_members: resolveMembers(
          canonical.participants.former_members,
          legacy.former_members ?? [],
          names,
        ),
      }
      : {}),
    rights: {
      TR: canonical.rights_by_status.temporary_residence,
      PR: canonical.rights_by_status.permanent_residence,
      CIT: canonical.rights_by_status.citizenship,
    },
    fastest_entry: canonical.editorial.fastest_entry ?? '',
    notes: canonical.editorial.notes ?? '',
  };
}

/** Project every compatibility field owned by the canonical bilateral schema. */
function projectLane(canonical: ArrangementRecord, legacy: BilateralLane, names: Map<string, string>): BilateralLane {
  if (canonical.participants.destinations.length !== 1) {
    throw new Error(
      `Compatibility lane ${canonical.id} requires exactly one destination, `
        + `found ${canonical.participants.destinations.length}`,
    );
  }
  const destinationIso = canonical.participants.destinations[0]!;
  const destination = resolveMembers([destinationIso], [legacy.destination], names)[0]!;
  return {
    ...legacy,
    id: canonical.id,
    name: canonical.name,
    color: canonical.display.color,
    destination,
    beneficiaries: resolveMembersLegacyOrder(
      canonical.participants.beneficiaries,
      legacy.beneficiaries,
      names,
    ),
    beneficiaries_note: canonical.participants.beneficiaries_note,
    grants: canonical.rights_by_status.citizenship,
    limits: canonical.editorial.limits ?? '',
    leads_to_settlement: canonical.pathways.some(pathway => pathway.outcome !== 'work'),
  };
}

function canonicalRouteSources(
  route: JurisdictionRecord['routes'][number],
  sourceIndex: Map<string, SourceRecord>,
  legacySources: Array<{ title: string; url: string }>,
): Array<{ title: string; url: string }> {
  const sourceIds = route.variants.flatMap(variant =>
    variant.source_refs.map(reference => reference.source_id));
  const seen = new Set<string>();
  const canonical = sourceIds.flatMap(sourceId => {
    if (seen.has(sourceId)) return [];
    seen.add(sourceId);
    const source = sourceIndex.get(sourceId);
    if (!source) {
      throw new Error(`Canonical route ${route.id} references missing source ${sourceId}`);
    }
    return [{ title: source.title, url: source.url }];
  });
  const canonicalByUrl = new Map(canonical.map(source => [source.url, source]));
  const ordered = legacySources.flatMap(source => {
    const replacement = canonicalByUrl.get(source.url);
    if (!replacement) return [];
    canonicalByUrl.delete(source.url);
    // The canonical source owns the evidence URL. Keep the legacy display title
    // for existing compatibility routes because one statute can have several
    // route-specific labels without requiring duplicate canonical sources.
    return [{ ...replacement, title: source.title }];
  });
  return [...ordered, ...canonicalByUrl.values()];
}

/**
 * Project canonical-owned route fields while carrying the legacy descriptive
 * title and free-form facts until the canonical schema owns those fields.
 */
function projectCompatibilityCitizenship(
  loaded: LoadedCanonical,
  source: LegacyCitizenship,
): LegacyCitizenship {
  const sourceIndex = new Map(loaded.sources.map(item => [item.id, item]));
  const canonicalRoutes = new Map(
    loaded.jurisdictions.flatMap(jurisdiction =>
      jurisdiction.routes.map(route => [route.id, { jurisdiction, route }] as const)),
  );
  return {
    ...source,
    routes: source.routes.map(legacy => {
      const canonical = canonicalRoutes.get(legacy.id);
      if (!canonical) return legacy;
      return {
        ...legacy,
        country: {
          iso_n3: canonical.jurisdiction.jurisdiction.iso_n3,
          name: canonical.jurisdiction.jurisdiction.name,
        },
        mode: canonical.route.mode,
        status: canonical.route.status,
        summary: canonical.route.summary,
        confidence: canonical.route.review.confidence,
        last_checked: canonical.route.review.last_checked ?? legacy.last_checked,
        sources: canonicalRouteSources(canonical.route, sourceIndex, legacy.sources),
      };
    }),
  };
}

function coverageState(
  state: JurisdictionRecord['coverage'][number]['review']['state'],
): CitizenshipCoverageState {
  if (state === 'reviewed') return 'reviewed';
  if (state === 'partial') return 'partial';
  if (state === 'pending') return 'pending';
  return 'unchecked';
}

function canonicalRouteFacts(
  route: JurisdictionRecord['routes'][number],
): Record<string, unknown> {
  const eligibilityMonths = [...new Set(route.variants
    .map(variant => variant.timeline.eligibility_minimum_months)
    .filter((months): months is number => months !== null))].sort((a, b) => a - b);
  return {
    canonical: true,
    variant_count: route.variants.length,
    eligibility_months: eligibilityMonths,
    discretionary_decision: route.variants.some(
      variant => variant.allocation === 'discretionary',
    ),
  };
}

type CanonicalResidenceRoute = NonNullable<JurisdictionRecord['residence_routes']>[number];

function residenceRouteSources(
  route: CanonicalResidenceRoute,
  sourceIndex: Map<string, SourceRecord>,
): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; url: string }> = [];
  for (const variant of route.variants) {
    for (const reference of variant.source_refs) {
      if (seen.has(reference.source_id)) continue;
      seen.add(reference.source_id);
      const source = sourceIndex.get(reference.source_id);
      if (!source) {
        throw new Error(`Residence route ${route.id} references missing source ${reference.source_id}`);
      }
      out.push({ title: source.title, url: source.url });
    }
  }
  return out;
}

function projectResidenceRoute(
  route: CanonicalResidenceRoute,
  iso: string,
  name: string,
  sourceIndex: Map<string, SourceRecord>,
): ResidenceRoute {
  const eligibilityMonths = [...new Set(route.variants
    .map(variant => variant.timeline.eligibility_minimum_months)
    .filter((months): months is number => months !== null))].sort((a, b) => a - b);
  return {
    id: route.id,
    country: { iso_n3: iso, name },
    category: route.category,
    status: route.status,
    title: route.title,
    summary: route.summary,
    outcome: route.variants.some(variant => variant.outcome === 'permanent_residence')
      ? 'permanent_residence'
      : 'residence',
    counts_toward_permanent_residence: route.counts_toward_permanent_residence,
    counts_toward_naturalization: route.counts_toward_naturalization,
    min_investment: route.min_investment,
    min_income_monthly: route.min_income_monthly,
    physical_presence_days_per_year: route.physical_presence_days_per_year,
    facts: {
      canonical: true,
      variant_count: route.variants.length,
      eligibility_months: eligibilityMonths,
      discretionary_decision: route.variants.some(variant => variant.allocation === 'discretionary'),
    },
    pathways: route.variants.map(variant => ({
      id: variant.id,
      label: variant.label,
      allocation: variant.allocation,
      eligibility_months: variant.timeline.eligibility_minimum_months,
      ...(variant.timeline.note ? { note: variant.timeline.note } : {}),
    })),
    confidence: route.review.confidence,
    last_checked: route.review.last_checked ?? '2026-07-21',
    sources: residenceRouteSources(route, sourceIndex),
  };
}

function buildLegacyCountryDetails(
  registry: Registry,
  mobility: BlocsData,
  citizenship: LegacyCitizenship,
): CitizenshipRoutesData {
  const emptyCoverage = (): Record<CitizenshipAcquisitionMode, CitizenshipCoverageState> => ({
    ancestry: 'unchecked',
    naturalization: 'unchecked',
    birth: 'unchecked',
    investment: 'unchecked',
  });
  const entries = [
    ...registry.sovereigns.map(entry => ({ ...entry, type: 'sovereign' as const })),
    ...registry.territories.map(entry => ({ ...entry, type: 'territory' as const })),
    ...registry.special.map(entry => ({
      iso_n3: entry.id,
      name: entry.name,
      type: 'special' as const,
    })),
  ];
  const jurisdictions = entries.map(entry => ({
    ...entry,
    coverage: emptyCoverage(),
    route_ids: [] as string[],
  }));
  const byIso = new Map(jurisdictions.map(entry => [entry.iso_n3, entry]));

  for (const lane of mobility.bilateral_lanes) {
    if (lane.beneficiaries.length !== 0) continue;
    const row = byIso.get(lane.destination.iso_n3);
    if (row) row.coverage.ancestry = 'partial';
  }
  for (const event of mobility.generational_events ?? []) {
    const row = byIso.get(event.country.iso_n3);
    if (row) row.coverage.birth = 'partial';
  }
  for (const route of citizenship.routes) {
    const row = byIso.get(route.country.iso_n3);
    if (!row) throw new Error(`Legacy citizenship route ${route.id} has no jurisdiction`);
    row.route_ids.push(route.id);
    row.coverage[route.mode as CitizenshipAcquisitionMode] = route.status === 'pending_verification'
      ? 'pending'
      : route.mode === 'investment' ? 'reviewed' : 'partial';
  }

  const routes = citizenship.routes as CitizenshipRoute[];
  const legacyReviewDates = routes.map(route => route.last_checked).sort();
  return {
    meta: {
      description:
        'Country citizenship routes compiled from a canonical D1 release plus the read-only legacy remainder.',
      last_updated: legacyReviewDates[legacyReviewDates.length - 1] ?? '2026-07-21',
      acquisition_modes: {
        ancestry: 'Citizenship through a parent, grandparent, wider descent rule, restoration, or documented heritage connection.',
        naturalization: 'Citizenship after residence or another qualifying domestic status.',
        birth: 'Citizenship or an accelerated route triggered by place of birth.',
        investment: 'Direct investor citizenship; residence-by-investment is not classified as citizenship by investment.',
      },
      coverage_states: {
        reviewed: 'The recorded finding has been checked against an official source.',
        partial: 'At least one rule is recorded, but this mode is not yet exhaustive.',
        pending: 'A credible legal basis exists but current operation is not verified.',
        unchecked: 'No route-level review has been completed for this mode.',
      },
      counts: {
        jurisdictions: jurisdictions.length,
        routes: routes.length,
        by_mode: Object.fromEntries(ACQUISITION_MODES.map(mode => [
          mode,
          routes.filter(route => route.mode === mode).length,
        ])) as Record<CitizenshipAcquisitionMode, number>,
        by_status: {},
      },
    },
    jurisdictions: jurisdictions.sort((a, b) => a.iso_n3.localeCompare(b.iso_n3)),
    routes,
    residence_routes: [],
  };
}

function projectFrontendCitizenship(
  loaded: LoadedCanonical,
  registry: Registry,
  mobility: BlocsData,
  legacy: LegacyCitizenship,
): CitizenshipRoutesData {
  const frontend = buildLegacyCountryDetails(registry, mobility, legacy);
  const sourceIndex = new Map(loaded.sources.map(source => [source.id, source]));
  const legacyRouteIndex = new Map(legacy.routes.map(route => [route.id, route]));
  const canonicalIsos = new Set(
    loaded.jurisdictions.map(jurisdiction => jurisdiction.jurisdiction.iso_n3),
  );
  frontend.routes = frontend.routes.filter(route => !canonicalIsos.has(route.country.iso_n3));

  for (const jurisdiction of loaded.jurisdictions) {
    const iso = jurisdiction.jurisdiction.iso_n3;
    const row = frontend.jurisdictions.find(item => item.iso_n3 === iso);
    if (!row) throw new Error(`Canonical jurisdiction ${iso} is missing from the registry`);
    row.name = jurisdiction.jurisdiction.name;
    row.type = jurisdiction.jurisdiction.type;
    row.route_ids = jurisdiction.routes.map(route => route.id);
    row.coverage = Object.fromEntries(jurisdiction.coverage.map(item => [
      item.mode,
      coverageState(item.review.state),
    ])) as Record<CitizenshipAcquisitionMode, CitizenshipCoverageState>;

    for (const route of jurisdiction.routes) {
      const legacyRoute = legacyRouteIndex.get(route.id);
      frontend.routes.push({
        id: route.id,
        country: { iso_n3: iso, name: jurisdiction.jurisdiction.name },
        mode: route.mode,
        status: route.status,
        title: route.title,
        summary: route.summary,
        // Preserve structured fields that have not yet migrated into the
        // canonical schema, then overlay the values derived from D1. This keeps
        // the Atlas lossless during the staged migration while D1 owns the
        // route identity, review state, timeline, and sources.
        facts: {
          ...(legacyRoute?.facts ?? {}),
          ...canonicalRouteFacts(route),
        },
        pathways: route.variants.map(variant => ({
          id: variant.id,
          label: variant.label,
          allocation: variant.allocation,
          eligibility_months: variant.timeline.eligibility_minimum_months,
          ...(variant.timeline.note ? { note: variant.timeline.note } : {}),
        })),
        confidence: route.review.confidence,
        last_checked: route.review.last_checked ?? '2026-07-21',
        sources: canonicalRouteSources(route, sourceIndex, []),
      });
    }

    const residenceRoutes = jurisdiction.residence_routes ?? [];
    const residenceCoverage = jurisdiction.residence_coverage ?? [];
    if (residenceRoutes.length > 0 || residenceCoverage.length > 0) {
      row.residence_route_ids = residenceRoutes.map(route => route.id);
      row.residence_coverage = Object.fromEntries(residenceCoverage.map(item => [
        item.category,
        coverageState(item.review.state),
      ]));
      for (const route of residenceRoutes) {
        frontend.residence_routes!.push(
          projectResidenceRoute(route, iso, jurisdiction.jurisdiction.name, sourceIndex),
        );
      }
    }
  }

  frontend.residence_routes!.sort((a, b) =>
    a.country.iso_n3.localeCompare(b.country.iso_n3) || a.id.localeCompare(b.id));
  frontend.meta.counts.residence_routes = frontend.residence_routes!.length;

  frontend.routes.sort((a, b) =>
    a.country.iso_n3.localeCompare(b.country.iso_n3) || a.id.localeCompare(b.id));
  const canonicalReviewDates = loaded.sources.map(source => source.last_checked).sort();
  frontend.meta.last_updated = canonicalReviewDates[canonicalReviewDates.length - 1]
    ?? frontend.meta.last_updated;
  frontend.meta.counts.routes = frontend.routes.length;
  frontend.meta.counts.by_mode = Object.fromEntries(ACQUISITION_MODES.map(mode => [
    mode,
    frontend.routes.filter(route => route.mode === mode).length,
  ])) as Record<CitizenshipAcquisitionMode, number>;
  frontend.meta.counts.by_status = {};
  for (const route of frontend.routes) {
    frontend.meta.counts.by_status[route.status] =
      (frontend.meta.counts.by_status[route.status] ?? 0) + 1;
  }
  return frontend;
}

function diffMobility(generated: BlocsData, source: BlocsData): CompatibilityDiffEntry[] {
  const entries: CompatibilityDiffEntry[] = [];
  entries.push(...deepDiff(source.meta, generated.meta, 'meta'));
  entries.push(...deepDiff(source.blocs, generated.blocs, 'blocs'));
  entries.push(...deepDiff(source.bilateral_lanes, generated.bilateral_lanes, 'bilateral_lanes'));
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

function expectedCompatibilityMobility(
  source: BlocsData,
  names: Map<string, string>,
): BlocsData {
  return {
    ...source,
    bilateral_lanes: source.bilateral_lanes.map(lane => {
      if (lane.id !== SPAIN_IBEROAMERICAN) return lane;
      const existing = new Set(lane.beneficiaries.map(member => member.iso_n3));
      const additions = SPAIN_ADDED_BENEFICIARIES.filter(iso => !existing.has(iso));
      return {
        ...lane,
        beneficiaries: [
          ...lane.beneficiaries,
          ...resolveMembers([...additions], [], names),
        ],
      };
    }),
  };
}

/**
 * Compatibility still carries legacy-only titles and free-form `facts`.
 * Existing legacy routes must round-trip exactly; new canonical routes remain
 * in the release bundle until the browser cuts over to canonical projections.
 */
function citizenshipFieldDrift(
  loaded: LoadedCanonical,
  source: LegacyCitizenship,
): CompatibilityDiff['citizenship_field_drift'] {
  const sourceIndex = new Map(loaded.sources.map(src => [src.id, src]));
  const legacyRouteById = new Map(source.routes.map(route => [route.id, route]));
  const drift: CompatibilityDiff['citizenship_field_drift'] = [];
  const pilotIsos = new Set(loaded.jurisdictions.map(item => item.jurisdiction.iso_n3));
  const expectedRouteIds = new Set(
    source.routes
      .filter(route => pilotIsos.has(route.country.iso_n3))
      .map(route => route.id),
  );
  const canonicalRoutes = loaded.jurisdictions.flatMap(jurisdiction =>
    jurisdiction.routes.map(route => ({ jurisdiction, route })));
  const canonicalRouteIds = new Set(canonicalRoutes.map(item => item.route.id));
  if (canonicalRouteIds.size !== canonicalRoutes.length) {
    const seen = new Set<string>();
    for (const { route } of canonicalRoutes) {
      if (seen.has(route.id)) {
        drift.push({
          entity_id: route.id,
          field: 'id',
          canonical: '(duplicate canonical route)',
          legacy: route.id,
        });
      }
      seen.add(route.id);
    }
  }

  for (const routeId of expectedRouteIds) {
    if (!canonicalRouteIds.has(routeId)) {
      drift.push({
        entity_id: routeId,
        field: 'id',
        canonical: '(missing canonical route)',
        legacy: routeId,
      });
    }
  }
  for (const { jurisdiction, route } of canonicalRoutes) {
    const legacy = legacyRouteById.get(route.id);
    if (!legacy) continue;
      const compare: Array<[string, unknown, unknown]> = [
        ['country.iso_n3', jurisdiction.jurisdiction.iso_n3, legacy.country.iso_n3],
        ['country.name', jurisdiction.jurisdiction.name, legacy.country.name],
        ['mode', route.mode, legacy.mode],
        ['status', route.status, legacy.status],
        ['summary', route.summary, legacy.summary],
        ['confidence', route.review.confidence, legacy.confidence],
        ['last_checked', route.review.last_checked, legacy.last_checked],
      ];
      for (const [field, canonical, legacyValue] of compare) {
        if (canonical !== legacyValue) {
          drift.push({ entity_id: route.id, field, canonical, legacy: legacyValue });
        }
      }
      const canonicalSourceUrls = new Set(
        route.variants
          .flatMap(variant => variant.source_refs.map(ref => ref.source_id))
          .map(id => sourceIndex.get(id)?.url)
          .filter((url): url is string => Boolean(url)),
      );
      const legacySourceUrls = new Set(legacy.sources.map(src => src.url));
      if (canonicalSourceUrls.size !== legacySourceUrls.size
        || [...canonicalSourceUrls].some(url => !legacySourceUrls.has(url))) {
        drift.push({
          entity_id: route.id,
          field: 'sources',
          canonical: [...canonicalSourceUrls].sort(),
          legacy: [...legacySourceUrls].sort(),
        });
      }
  }
  return drift;
}

function gateExclusiveOwnership(
  loaded: LoadedCanonical,
  sourceMobility: BlocsData,
  pilot: MigrationPilot,
): ParityGateResult {
  const failures: string[] = [];
  const legacyIds = new Set([
    ...sourceMobility.blocs.map(b => b.id),
    ...sourceMobility.bilateral_lanes.map(l => l.id),
  ]);
  const expectedArrangementIds = new Set([
    ...pilot.arrangements.blocs,
    ...pilot.arrangements.bilateral_lanes,
  ]);
  const expectedJurisdictionIsos = new Set(pilot.jurisdictions);
  const seen = new Set<string>();
  for (const arrangement of loaded.arrangements) {
    if (!legacyIds.has(arrangement.id)) {
      failures.push(`canonical arrangement ${arrangement.id} has no legacy counterpart`);
    }
    if (seen.has(arrangement.id)) failures.push(`duplicate canonical arrangement ${arrangement.id}`);
    if (!expectedArrangementIds.has(arrangement.id)) {
      failures.push(`canonical arrangement ${arrangement.id} is outside the migration scope`);
    }
    seen.add(arrangement.id);
  }
  for (const arrangementId of expectedArrangementIds) {
    if (!seen.has(arrangementId)) {
      failures.push(`migration-scope arrangement ${arrangementId} is missing`);
    }
  }
  const jurisdictionSeen = new Set<string>();
  for (const jurisdiction of loaded.jurisdictions) {
    const iso = jurisdiction.jurisdiction.iso_n3;
    if (jurisdictionSeen.has(iso)) failures.push(`duplicate canonical jurisdiction ${iso}`);
    if (!expectedJurisdictionIsos.has(jurisdiction.jurisdiction.iso_n3)) {
      failures.push(
        `canonical jurisdiction ${jurisdiction.jurisdiction.iso_n3} is outside the migration scope`,
      );
    }
    jurisdictionSeen.add(iso);
  }
  for (const iso of expectedJurisdictionIsos) {
    if (!loaded.jurisdictions.some(jurisdiction => jurisdiction.jurisdiction.iso_n3 === iso)) {
      failures.push(`migration-scope jurisdiction ${iso} is missing`);
    }
  }
  return { gate: 'exclusive_ownership', status: failures.length ? 'fail' : 'pass', detail: failures };
}

/** Prove every canonical-owned arrangement field round-trips to the legacy shape. */
function gateArrangementProjectionParity(
  loaded: LoadedCanonical,
  sourceMobility: BlocsData,
  names: Map<string, string>,
): ParityGateResult {
  const projectedMobility = projectCompatibilityMobility(loaded, sourceMobility, names);
  const expectedMobility = expectedCompatibilityMobility(sourceMobility, names);
  const actual = diffMobility(projectedMobility, sourceMobility);
  const expected = diffMobility(expectedMobility, sourceMobility);
  const mismatch = deepDiff(expected, actual, 'sanctioned_diff');
  return {
    gate: 'arrangement_projection_parity',
    status: mismatch.length === 0 ? (actual.length ? 'sanctioned' : 'pass') : 'fail',
    detail: { expected, actual, mismatch },
  };
}

function gateCitizenshipRoundtrip(loaded: LoadedCanonical, sourceCitizenship: LegacyCitizenship): ParityGateResult {
  const drift = citizenshipFieldDrift(loaded, sourceCitizenship);
  const legacyIds = new Set(sourceCitizenship.routes.map(route => route.id));
  const canonicalAdditions = loaded.jurisdictions
    .flatMap(jurisdiction => jurisdiction.routes.map(route => route.id))
    .filter(routeId => !legacyIds.has(routeId))
    .sort();
  return {
    gate: 'citizenship_roundtrip_parity',
    status: drift.length === 0 ? 'pass' : 'fail',
    detail: {
      drift,
      canonical_additions: canonicalAdditions,
      compatibility_policy:
        'Canonical-only routes ship in the release bundle and are not back-projected into legacy JSON.',
      legacy_carried_fields: [
        'title (canonical introduces a structural label; the legacy descriptive title is inherited)',
        'facts (canonical does not yet own structured facts; inherited until the schema grows)',
        'source titles (canonical owns the evidence URL; route-specific display labels are inherited)',
      ],
    },
  };
}

/** Reconstruct the non-pilot slice of the source and prove it is byte-identical. */
function gateRemainderByteParity(
  loaded: LoadedCanonical,
  sourceMobility: BlocsData,
  sourceCitizenship: LegacyCitizenship,
  generatedMobility: BlocsData,
  generatedCitizenship: LegacyCitizenship,
): ParityGateResult {
  const pilotArrangementIds = new Set(loaded.arrangements.map(a => a.id));
  const pilotJurisdictionIsos = new Set(loaded.jurisdictions.map(j => j.jurisdiction.iso_n3));
  const mobilityRemainder = (data: BlocsData) => ({
    ...data,
    blocs: data.blocs.filter(bloc => !pilotArrangementIds.has(bloc.id)),
    bilateral_lanes: data.bilateral_lanes.filter(lane => !pilotArrangementIds.has(lane.id)),
  });
  const citizenshipRemainder = (data: LegacyCitizenship) => ({
    ...data,
    routes: data.routes.filter(route => !pilotJurisdictionIsos.has(route.country.iso_n3)),
  });
  const sourceMobilityRemainder = mobilityRemainder(sourceMobility);
  const generatedMobilityRemainder = mobilityRemainder(generatedMobility);
  const sourceCitizenshipRemainder = citizenshipRemainder(sourceCitizenship);
  const generatedCitizenshipRemainder = citizenshipRemainder(generatedCitizenship);
  const hashes = {
    source_mobility: hashJson(sourceMobilityRemainder),
    generated_mobility: hashJson(generatedMobilityRemainder),
    source_citizenship: hashJson(sourceCitizenshipRemainder),
    generated_citizenship: hashJson(generatedCitizenshipRemainder),
  };
  const failures: string[] = [];
  if (hashes.source_mobility !== hashes.generated_mobility) {
    failures.push('non-pilot mobility remainder changed');
  }
  if (hashes.source_citizenship !== hashes.generated_citizenship) {
    failures.push('non-pilot citizenship remainder changed');
  }
  return {
    gate: 'legacy_remainder_byte_parity',
    status: failures.length ? 'fail' : 'pass',
    detail: {
      legacy_mobility_remainder:
        sourceMobilityRemainder.blocs.length
        + sourceMobilityRemainder.bilateral_lanes.length,
      legacy_citizenship_remainder: sourceCitizenshipRemainder.routes.length,
      hashes,
      failures,
    },
  };
}

function gateSelectedRevisionState(
  loaded: LoadedCanonical,
  selectionMode: CompileSelectionMode,
): ParityGateResult {
  const { selected_statuses, selected_release_status } = loaded.dbState;
  const allowed = selectionMode === 'draft'
    ? new Set(['draft', 'approved'])
    : new Set(['approved']);
  const invalid = selected_statuses.filter(status => !allowed.has(status));
  const releaseStateInvalid = selectionMode === 'release' && selected_release_status === null;
  return {
    gate: 'selected_revision_state',
    status: invalid.length === 0 && !releaseStateInvalid ? 'pass' : 'fail',
    detail: {
      selection_mode: selectionMode,
      selected_statuses,
      selected_release_status,
      invalid_statuses: invalid,
    },
  };
}

function gateCanonicalReferences(loaded: LoadedCanonical): ParityGateResult {
  const sourceIds = new Set(loaded.sources.map(source => source.id));
  const missing: Array<{ entity_id: string; source_id: string }> = [];
  for (const jurisdiction of loaded.jurisdictions) {
    for (const route of jurisdiction.routes) {
      for (const reference of route.variants.flatMap(variant => variant.source_refs)) {
        if (!sourceIds.has(reference.source_id)) {
          missing.push({ entity_id: route.id, source_id: reference.source_id });
        }
      }
    }
  }
  for (const arrangement of loaded.arrangements) {
    for (const reference of [
      ...arrangement.source_refs,
      ...arrangement.pathways.flatMap(pathway => pathway.source_refs),
    ]) {
      if (!sourceIds.has(reference.source_id)) {
        missing.push({ entity_id: arrangement.id, source_id: reference.source_id });
      }
    }
  }
  return {
    gate: 'canonical_reference_integrity',
    status: missing.length === 0 ? 'pass' : 'fail',
    detail: { missing },
  };
}

function gateRelationalProjectionCompleteness(
  loaded: LoadedCanonical,
): ParityGateResult {
  const expected = {
    coverage: loaded.jurisdictions.length,
    mode_coverage: loaded.jurisdictions.length * 4,
    route_variants: loaded.jurisdictions.reduce(
      (count, jurisdiction) =>
        count + jurisdiction.routes.reduce(
          (routeCount, route) => routeCount + route.variants.length,
          0,
        ),
      0,
    ),
    arrangement_participants: loaded.arrangements.reduce(
      (count, arrangement) =>
        count
        + arrangement.participants.members.length
        + arrangement.participants.former_members.length
        + arrangement.participants.destinations.length
        + arrangement.participants.beneficiaries.length,
      0,
    ),
    edges: loaded.arrangements.reduce((count, arrangement) => {
      if (arrangement.status !== 'active') return count;
      const regional = ['full', 'closed', 'partial', 'hub_spoke']
        .includes(arrangement.display.category)
        ? arrangement.participants.members.length
          * Math.max(arrangement.participants.members.length - 1, 0)
        : 0;
      const pathways = arrangement.pathways.length
        * arrangement.participants.beneficiaries.length
        * arrangement.participants.destinations.length;
      return count + regional + pathways;
    }, 0),
  };
  const actual = {
    coverage: loaded.projections.coverage.length,
    mode_coverage: loaded.projections.mode_coverage.length,
    route_variants: loaded.projections.routes.length,
    arrangement_participants: loaded.projections.arrangements.length,
    edges: loaded.projections.edges.length,
  };
  const mismatch = Object.entries(expected).flatMap(([key, value]) =>
    actual[key as keyof typeof actual] === value
      ? []
      : [{ projection: key, expected: value, actual: actual[key as keyof typeof actual] }]);
  return {
    gate: 'relational_projection_completeness',
    status: mismatch.length === 0 ? 'pass' : 'fail',
    detail: { expected, actual, mismatch },
  };
}

export interface CompileDataReleaseOptions {
  root?: string;
  /** Path to a canonical SQLite database (local mirror or D1 export). */
  dbPath?: string;
  /** Select draft heads, approved heads, or the revisions pinned to a release. */
  selectionMode?: CompileSelectionMode;
  /** Required when selectionMode is `release`. */
  releaseId?: string;
  /** Explicit prior release id for changelog comparison (no filesystem mtime). */
  baselineReleaseId?: string;
}

const DEFAULT_DB_PATH = '.generated/data-canonical/canonical.sqlite';

export function compileDataRelease(options: CompileDataReleaseOptions = {}): DataRelease {
  const root = options.root ?? REPO_ROOT;
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const selectionMode = options.selectionMode ?? 'draft';
  const loaded = loadCanonicalDatabase(dbPath, root, {
    mode: selectionMode,
    releaseId: options.releaseId,
  });

  const sourceMobility = readJson<BlocsData>(root, 'public/blocs_data.json');
  const sourceCitizenship = readJson<LegacyCitizenship>(root, 'data/citizenship_routes.json');
  const registry = readJson<Registry>(root, 'data/registry.json');
  const pilot = readJson<MigrationPilot>(root, 'data/migration-pilot.json');
  const names = registryNameMap(registry);

  const compatibilityMobility = projectCompatibilityMobility(loaded, sourceMobility, names);
  const expectedMobility = expectedCompatibilityMobility(sourceMobility, names);
  const compatibilityCitizenship = projectCompatibilityCitizenship(
    loaded,
    sourceCitizenship,
  );
  const frontendCitizenship = projectFrontendCitizenship(
    loaded,
    registry,
    compatibilityMobility,
    sourceCitizenship,
  );
  const mobilityDiff = diffMobility(compatibilityMobility, sourceMobility);
  const citizenshipDrift = citizenshipFieldDrift(loaded, sourceCitizenship);

  const gates: ParityGateResult[] = [
    gateExclusiveOwnership(loaded, sourceMobility, pilot),
    gateArrangementProjectionParity(loaded, sourceMobility, names),
    gateCitizenshipRoundtrip(loaded, sourceCitizenship),
    gateRemainderByteParity(
      loaded,
      sourceMobility,
      sourceCitizenship,
      compatibilityMobility,
      compatibilityCitizenship,
    ),
    gateSelectedRevisionState(loaded, selectionMode),
    gateCanonicalReferences(loaded),
    gateRelationalProjectionCompleteness(loaded),
  ];
  const passed = gates.every(g => g.status !== 'fail');

  const pilotJurisdictionIsos = loaded.jurisdictions.map(j => j.jurisdiction.iso_n3).sort();
  const pilotArrangementIds = loaded.arrangements.map(a => a.id).sort();

  const apiReleaseRows: EntityRow[] = loaded.entities;

  const catalog = {
    jurisdictions: loaded.jurisdictions.map(item => ({
      iso_n3: item.jurisdiction.iso_n3,
      name: item.jurisdiction.name,
      type: item.jurisdiction.type,
      review_state: item.review.state,
      route_count: item.routes.length,
    })),
    arrangements: loaded.arrangements.map(item => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      status: item.status,
      display_category: item.display.category,
      directionality: item.directionality,
    })),
  };

  const created_at = (() => {
    const dates = [
      ...loaded.sources.map(s => s.last_checked),
      ...loaded.jurisdictions.map(j => j.review.last_checked),
      ...loaded.arrangements.map(a => a.review.last_checked),
    ].filter((d): d is string => Boolean(d)).sort();
    return dates.length ? `${dates[dates.length - 1]}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z';
  })();

  const dbContentHash = hashJson({
    entities: loaded.entities.map(e => ({ id: e.entity_id, hash: e.content_hash, revision: e.revision_id })),
  });

  const legacyRemainder = {
    mobility:
      sourceMobility.blocs.filter(b => !pilotArrangementIds.includes(b.id)).length
      + sourceMobility.bilateral_lanes.filter(l => !pilotArrangementIds.includes(l.id)).length,
    citizenship: sourceCitizenship.routes.filter(r => !pilotJurisdictionIsos.includes(r.country.iso_n3)).length,
  };

  const manifestContent = {
    schema_version: 1 as const,
    mode: 'canonical_release_draft' as const,
    database: {
      content_hash: dbContentHash,
      selection_mode: selectionMode,
      release_id: options.releaseId ?? null,
    },
    created_at,
    published_at: null as null,
    scope: { jurisdictions: pilotJurisdictionIsos, arrangements: pilotArrangementIds },
    source_hashes: {
      'public/blocs_data.json': hashJson(sourceMobility),
      'data/citizenship_routes.json': hashJson(sourceCitizenship),
      'data/registry.json': hashJson(registry),
      'data/migration-pilot.json': hashJson(pilot),
    },
    counts: {
      canonical_entities: loaded.entities.length,
      sources: loaded.sources.length,
      jurisdictions: loaded.jurisdictions.length,
      arrangements: loaded.arrangements.length,
      routes: loaded.jurisdictions.reduce((n, j) => n + j.routes.length, 0),
      legacy_mobility_remainder: legacyRemainder.mobility,
      legacy_citizenship_remainder: legacyRemainder.citizenship,
    },
    parity_passed: passed,
  };
  const releaseId = hashJson(manifestContent).slice(0, 16);
  const manifest: DataReleaseManifest = { release_id: releaseId, ...manifestContent };

  return {
    input: {
      database_path: dbPath,
      baseline_release_id: options.baselineReleaseId ?? null,
    },
    manifest,
    catalog,
    projections: loaded.projections,
    jurisdictions: loaded.jurisdictions,
    arrangements: loaded.arrangements,
    sources: loaded.sources,
    api_release_rows: apiReleaseRows,
    compatibility: { mobility: compatibilityMobility, citizenship: compatibilityCitizenship },
    frontend: { citizenship: frontendCitizenship },
    compatibility_diff: {
      mobility: mobilityDiff,
      citizenship_field_drift: citizenshipDrift,
    },
    parity: {
      gates,
      reviewed_differences: SANCTIONED_DIFFERENCES.map(s => ({
        entity_id: s.entity_id,
        kind: s.kind,
        description: s.description,
      })),
      passed,
    },
  };
}

/** Read a baseline manifest by explicit release id, or null when none given. */
export function loadBaselineManifest(
  baselineReleaseId: string | undefined,
  root = REPO_ROOT,
): { release_id: string; entity_hashes?: Record<string, string> } | null {
  if (!baselineReleaseId) return null;
  const file = path.join(root, '.generated/data-canonical/releases', baselineReleaseId, 'manifest.json');
  if (!fs.existsSync(file)) {
    throw new Error(`Baseline release ${baselineReleaseId} not found at ${file}`);
  }
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { release_id: manifest.release_id, entity_hashes: manifest.entity_hashes };
}

export function computeChangelog(
  release: DataRelease,
  baseline: { release_id: string; entity_hashes?: Record<string, string> } | null,
): ReleaseChangelog {
  const current = new Map(release.api_release_rows.map(row => [row.entity_id, row.content_hash]));
  if (!baseline || !baseline.entity_hashes) {
    return {
      baseline_release_id: baseline?.release_id ?? null,
      added: [...current.keys()].sort(),
      changed: [],
      removed: [],
    };
  }
  const previous = new Map(Object.entries(baseline.entity_hashes));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, hash] of current) {
    if (!previous.has(id)) added.push(id);
    else if (previous.get(id) !== hash) changed.push(id);
  }
  for (const id of previous.keys()) if (!current.has(id)) removed.push(id);
  return {
    baseline_release_id: baseline.release_id,
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

/** Write a draft release bundle. Content-addressed and idempotent. Does not publish. */
export function writeDataRelease(release: DataRelease, root = REPO_ROOT): string {
  const releaseRoot = path.join(root, '.generated/data-canonical/releases', release.manifest.release_id);
  fs.rmSync(releaseRoot, { recursive: true, force: true });
  const entityHashes = Object.fromEntries(release.api_release_rows.map(row => [row.entity_id, row.content_hash]));
  const manifestWithHashes = { ...release.manifest, entity_hashes: entityHashes };
  for (const source of release.sources) {
    writeJson(path.join(releaseRoot, 'sources', sourceFileName(source)), source);
  }
  for (const jurisdiction of release.jurisdictions) {
    writeJson(path.join(releaseRoot, 'jurisdictions', `${jurisdiction.jurisdiction.iso_n3}.json`), jurisdiction);
  }
  for (const arrangement of release.arrangements) {
    writeJson(path.join(releaseRoot, 'arrangements', `${arrangement.id}.json`), arrangement);
  }
  writeJson(path.join(releaseRoot, 'manifest.json'), manifestWithHashes);
  writeJson(path.join(releaseRoot, 'catalog.json'), release.catalog);
  writeJson(path.join(releaseRoot, 'projections.json'), release.projections);
  writeJson(path.join(releaseRoot, 'coverage.json'), release.projections.coverage);
  writeJson(
    path.join(releaseRoot, 'mode-coverage.json'),
    release.projections.mode_coverage,
  );
  writeJson(path.join(releaseRoot, 'timelines.json'), release.projections.routes);
  writeJson(
    path.join(releaseRoot, 'arrangement-projections.json'),
    release.projections.arrangements,
  );
  writeJson(path.join(releaseRoot, 'api_release_rows.json'), release.api_release_rows);
  writeJson(path.join(releaseRoot, 'compatibility/blocs_data.json'), release.compatibility.mobility);
  writeJson(path.join(releaseRoot, 'compatibility/citizenship_routes.json'), release.compatibility.citizenship);
  writeJson(path.join(releaseRoot, 'frontend/citizenship_routes.json'), release.frontend.citizenship);
  writeJson(path.join(releaseRoot, 'compatibility_diff.json'), release.compatibility_diff);
  writeJson(path.join(releaseRoot, 'parity-report.json'), release.parity);
  const baseline = loadBaselineManifest(
    release.input.baseline_release_id ?? undefined,
    root,
  );
  writeJson(path.join(releaseRoot, 'changes.json'), computeChangelog(release, baseline));
  writeJson(path.join(root, '.generated/data-canonical/latest.json'), {
    release_id: release.manifest.release_id,
    manifest: `releases/${release.manifest.release_id}/manifest.json`,
    parity_passed: release.parity.passed,
  });
  return releaseRoot;
}

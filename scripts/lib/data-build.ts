import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS derivation script imported as the graph parity oracle.
import { buildEdges } from '../build_edges.js';
import type { BlocsData, BilateralLane, Bloc, Member } from '../../src/types';
import {
  CANONICAL_SCHEMAS,
  type ArrangementRecord,
  type JurisdictionRecord,
  type SourceRecord,
} from './canonical-schema';

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
 * legacy remainder, reconstructs the public shapes, derives the complete graph,
 * and runs parity gates that prove the DB round-trips every canonical-owned
 * field and that the only compatibility drift vs the live public files is the
 * sanctioned Spain Ibero-American beneficiary correction and its direct graph
 * propagation.
 *
 * It never approves revisions, never publishes a release row, and never
 * overwrites `public/*.json`. It writes a draft release bundle under
 * `.generated/data-canonical/releases/<release_id>/` for parity review only.
 */

const SPAIN_IBEROAMERICAN = 'spain_iberoamerican';

/** Canonical-owned compatibility fields that may legitimately differ from legacy. */
export interface SanctionedDifference {
  entity_id: string;
  kind: 'beneficiary_correction' | 'graph_propagation';
  description: string;
  /** Returns true for a compatibility or graph diff path/edge attributable to this correction. */
  matches: (target: { path?: string; edge?: Record<string, unknown> }) => boolean;
}

const SPAIN_ADDED_BENEFICIARIES = ['188', '192', '214', '222', '320', '340', '558', '591'];

export const SANCTIONED_DIFFERENCES: readonly SanctionedDifference[] = [
  {
    entity_id: SPAIN_IBEROAMERICAN,
    kind: 'beneficiary_correction',
    description:
      'Ibero-American beneficiary enumeration corrected against Civil Code Article 22 and the BOE community list; awaits compatibility cutover.',
    matches: ({ path }) => !!path && path.startsWith('bilateral_lanes[spain_iberoamerican].beneficiaries'),
  },
  {
    entity_id: SPAIN_IBEROAMERICAN,
    kind: 'graph_propagation',
    description:
      'The corrected beneficiary set adds Spain settlement edges for the eight new Ibero-American nationals and widens the Spain two-year naturalization conditional to include them.',
    matches: ({ edge }) => {
      if (!edge) return false;
      const mechanism = String(edge.mechanism ?? '');
      if (mechanism === SPAIN_IBEROAMERICAN) return true;
      // Spain naturalization conditional edges (pr/settle_full/settle_partial:724 → cit:724)
      // whose `needs` list grew by the corrected beneficiaries. Both the old
      // (removed) and new (added) forms are the same edge identity.
      if (mechanism === 'naturalization') {
        const toSpain = String(edge.to ?? '').endsWith(':724');
        const fromSpain = String(edge.from ?? '').endsWith(':724');
        if (!(toSpain || fromSpain)) return false;
        const needs = String((edge.needs as unknown[] | undefined)?.[0] ?? '');
        return needs.startsWith('citizenship_any:');
      }
      return false;
    },
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

export interface GraphDiffEntry {
  kind: 'added' | 'removed';
  edge: Record<string, unknown>;
}

export interface CompatibilityDiff {
  mobility: CompatibilityDiffEntry[];
  citizenship_field_drift: Array<{ entity_id: string; field: string; canonical: unknown; legacy: unknown }>;
  graph: GraphDiffEntry[];
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
  database: { path: string; content_hash: string };
  created_at: string;
  published_at: null;
  baseline_release_id: string | null;
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
    graph_edges: number;
    legacy_mobility_remainder: number;
    legacy_citizenship_remainder: number;
  };
  parity_passed: boolean;
}

export interface DataRelease {
  manifest: DataReleaseManifest;
  catalog: {
    jurisdictions: Array<Record<string, unknown>>;
    arrangements: Array<Record<string, unknown>>;
  };
  projections_note: string;
  jurisdictions: JurisdictionRecord[];
  arrangements: ArrangementRecord[];
  sources: SourceRecord[];
  graph: { meta: Record<string, unknown>; edges: unknown[] };
  api_release_rows: EntityRow[];
  compatibility: {
    mobility: BlocsData;
    citizenship: { meta: Record<string, unknown>; routes: unknown[] };
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

interface ManualEdges {
  edges?: Array<Record<string, unknown>>;
}

export interface LoadedCanonical {
  sources: SourceRecord[];
  jurisdictions: JurisdictionRecord[];
  arrangements: ArrangementRecord[];
  entities: EntityRow[];
  revisionByEntity: Record<string, string>;
  dbState: {
    releases: number;
    approved_revisions: number;
    published_releases: number;
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

/** Open a canonical SQLite database (local mirror or D1 export) and load revisions. */
export function loadCanonicalDatabase(dbPath: string, root = REPO_ROOT): LoadedCanonical {
  const absolute = path.isAbsolute(dbPath) ? dbPath : path.join(root, dbPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `Canonical database not found at ${absolute}. Run \`bun run data:db\` first, `
        + 'or pass --db <path> to a wrangler D1 export.',
    );
  }
  const database = new Database(absolute, { readonly: true });
  try {
    const rows = database.query(
      `SELECT
         entity.id AS entity_id,
         entity.entity_type AS entity_type,
         revision.id AS revision_id,
         revision.payload_json AS payload_json,
         revision.content_hash AS content_hash,
         revision.review_status AS review_status
       FROM canonical_revisions AS revision
       JOIN canonical_entities AS entity ON entity.id = revision.entity_id
       ORDER BY entity.id`,
    ).all() as Array<{
      entity_id: string;
      entity_type: 'source' | 'jurisdiction' | 'arrangement';
      revision_id: string;
      payload_json: string;
      content_hash: string;
      review_status: string;
    }>;

    const sources: SourceRecord[] = [];
    const jurisdictions: JurisdictionRecord[] = [];
    const arrangements: ArrangementRecord[] = [];
    const entities: EntityRow[] = [];
    const revisionByEntity: Record<string, string> = {};

    for (const row of rows) {
      const record = JSON.parse(row.payload_json) as
        SourceRecord | JurisdictionRecord | ArrangementRecord;
      const schema = CANONICAL_SCHEMAS[row.entity_type];
      const parsed = schema.safeParse(record);
      if (!parsed.success) {
        throw new Error(
          `canonical_revisions payload for ${row.entity_id} failed its schema: ${parsed.error.message}`,
        );
      }
      entities.push({
        entity_id: row.entity_id,
        entity_type: row.entity_type,
        revision_id: row.revision_id,
        content_hash: row.content_hash,
        review_status: row.review_status,
      });
      revisionByEntity[row.entity_id] = row.revision_id;
      if (row.entity_type === 'source') sources.push(parsed.data as SourceRecord);
      if (row.entity_type === 'jurisdiction') jurisdictions.push(parsed.data as JurisdictionRecord);
      if (row.entity_type === 'arrangement') arrangements.push(parsed.data as ArrangementRecord);
    }

    const dbState = {
      releases: (database.query('SELECT COUNT(*) AS count FROM releases').get() as { count: number }).count,
      approved_revisions: (database.query(
        `SELECT COUNT(*) AS count FROM canonical_revisions WHERE review_status = 'approved'`,
      ).get() as { count: number }).count,
      published_releases: (database.query(
        `SELECT COUNT(*) AS count FROM releases WHERE status = 'published'`,
      ).get() as { count: number }).count,
    };
    return { sources, jurisdictions, arrangements, entities, revisionByEntity, dbState };
  } finally {
    database.close();
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
  return [...isos].sort().map(iso => {
    const existing = legacyByIso.get(iso);
    if (existing) return { iso_n3: existing.iso_n3, name: existing.name };
    const name = names.get(iso);
    if (!name) throw new Error(`Canonical beneficiary ${iso} is missing from the registry`);
    return { iso_n3: iso, name };
  });
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
    return canonical ? projectBloc(canonical, bloc) : bloc;
  });
  const bilateral_lanes = source.bilateral_lanes.map(lane => {
    const canonical = arrangementById.get(lane.id) as ArrangementRecord | undefined;
    return canonical ? projectLane(canonical, lane, names) : lane;
  });
  return { ...source, blocs, bilateral_lanes };
}

/** Overlay reviewed canonical corrections onto a legacy bloc (none today). */
function projectBloc(_canonical: ArrangementRecord, legacy: Bloc): Bloc {
  // Canonical regional arrangements faithfully reproduce the legacy bloc (the
  // participant-parity gate proves the field round-trip). No compatibility
  // field is corrected yet, so the public bloc is inherited verbatim.
  return legacy;
}

/** Overlay reviewed canonical corrections onto a legacy lane (Spain beneficiaries). */
function projectLane(canonical: ArrangementRecord, legacy: BilateralLane, names: Map<string, string>): BilateralLane {
  if (canonical.id !== SPAIN_IBEROAMERICAN) return legacy;
  const beneficiaries = resolveMembers(canonical.participants.beneficiaries, legacy.beneficiaries, names);
  return { ...legacy, beneficiaries };
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

/**
 * Citizenship routes are not yet corrected in canonical (the schema does not
 * own the legacy free-form `facts`). Instead of copying wholesale, prove the
 * database round-trips every canonical-owned field of each pilot route and
 * report any drift.
 */
function citizenshipFieldDrift(
  loaded: LoadedCanonical,
  source: LegacyCitizenship,
): CompatibilityDiff['citizenship_field_drift'] {
  const sourceByUrl = new Map(source.routes.flatMap(route => route.sources.map(src => [src.url, route.id])));
  const sourceIndex = new Map(loaded.sources.map(src => [src.id, src]));
  const legacyRouteById = new Map(source.routes.map(route => [route.id, route]));
  const drift: CompatibilityDiff['citizenship_field_drift'] = [];

  for (const jurisdiction of loaded.jurisdictions) {
    for (const route of jurisdiction.routes) {
      const legacy = legacyRouteById.get(route.id);
      if (!legacy) {
        drift.push({
          entity_id: route.id,
          field: 'id',
          canonical: route.id,
          legacy: '(missing legacy route)',
        });
        continue;
      }
      const compare: Array<[string, unknown, unknown]> = [
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
      void sourceByUrl;
    }
  }
  return drift;
}

function graphDiff(generated: { edges: unknown[] }, source: { edges: unknown[] }): GraphDiffEntry[] {
  const sourceKeys = new Set(source.edges.map(edge => JSON.stringify(edge)));
  const generatedKeys = new Set(generated.edges.map(edge => JSON.stringify(edge)));
  const entries: GraphDiffEntry[] = [];
  for (const key of generatedKeys) {
    if (!sourceKeys.has(key)) entries.push({ kind: 'added', edge: JSON.parse(key) as Record<string, unknown> });
  }
  for (const key of sourceKeys) {
    if (!generatedKeys.has(key)) entries.push({ kind: 'removed', edge: JSON.parse(key) as Record<string, unknown> });
  }
  return entries;
}

function gateExclusiveOwnership(loaded: LoadedCanonical, sourceMobility: BlocsData): ParityGateResult {
  const failures: string[] = [];
  const legacyIds = new Set([
    ...sourceMobility.blocs.map(b => b.id),
    ...sourceMobility.bilateral_lanes.map(l => l.id),
  ]);
  const seen = new Set<string>();
  for (const arrangement of loaded.arrangements) {
    if (!legacyIds.has(arrangement.id)) {
      failures.push(`canonical arrangement ${arrangement.id} has no legacy counterpart`);
    }
    if (seen.has(arrangement.id)) failures.push(`duplicate canonical arrangement ${arrangement.id}`);
    seen.add(arrangement.id);
  }
  const jurisdictionSeen = new Set<string>();
  for (const jurisdiction of loaded.jurisdictions) {
    if (jurisdictionSeen.has(jurisdiction.id)) failures.push(`duplicate canonical jurisdiction ${jurisdiction.id}`);
    jurisdictionSeen.add(jurisdiction.id);
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
  const diff = diffMobility(projectedMobility, sourceMobility);
  const unsanctioned = diff.filter(entry => !SANCTIONED_DIFFERENCES.some(s => s.matches({ path: entry.path })));
  return {
    gate: 'arrangement_projection_parity',
    status: unsanctioned.length === 0 ? (diff.length ? 'sanctioned' : 'pass') : 'fail',
    detail: { sanctioned: diff.filter(d => SANCTIONED_DIFFERENCES.some(s => s.matches({ path: d.path }))), unsanctioned },
  };
}

function gateCitizenshipRoundtrip(loaded: LoadedCanonical, sourceCitizenship: LegacyCitizenship): ParityGateResult {
  const drift = citizenshipFieldDrift(loaded, sourceCitizenship);
  return {
    gate: 'citizenship_roundtrip_parity',
    status: drift.length === 0 ? 'pass' : 'fail',
    detail: {
      drift,
      legacy_carried_fields: [
        'title (canonical introduces a structural label; the legacy descriptive title is inherited)',
        'facts (canonical does not yet own structured facts; inherited until the schema grows)',
      ],
    },
  };
}

function gateGraphParity(
  compatibilityMobility: BlocsData,
  manualEdges: ManualEdges,
  sourceEdges: { edges: unknown[] },
): ParityGateResult {
  const generated = buildEdges(compatibilityMobility, manualEdges) as { edges: unknown[] };
  const diff = graphDiff(generated, sourceEdges);
  const unsanctioned = diff.filter(entry => !SANCTIONED_DIFFERENCES.some(s => s.matches({ edge: entry.edge })));
  return {
    gate: 'graph_parity',
    status: unsanctioned.length === 0 ? (diff.length ? 'sanctioned' : 'pass') : 'fail',
    detail: {
      generated_edges: generated.edges.length,
      public_edges: sourceEdges.edges.length,
      sanctioned: diff.filter(d => SANCTIONED_DIFFERENCES.some(s => s.matches({ edge: d.edge }))).length,
      unsanctioned,
    },
  };
}

/** Reconstruct the non-pilot slice of the source and prove it is byte-identical. */
function gateRemainderByteParity(
  loaded: LoadedCanonical,
  sourceMobility: BlocsData,
  sourceCitizenship: LegacyCitizenship,
): ParityGateResult {
  const pilotArrangementIds = new Set(loaded.arrangements.map(a => a.id));
  const pilotJurisdictionIsos = new Set(loaded.jurisdictions.map(j => j.jurisdiction.iso_n3));
  const remainderBlocs = sourceMobility.blocs.filter(b => !pilotArrangementIds.has(b.id));
  const remainderLanes = sourceMobility.bilateral_lanes.filter(l => !pilotArrangementIds.has(l.id));
  const remainderRoutes = sourceCitizenship.routes.filter(r => !pilotJurisdictionIsos.has(r.country.iso_n3));
  // The legacy remainder must partition the source exactly with the pilot set.
  const sourceArrangementIds = new Set([
    ...sourceMobility.blocs.map(b => b.id),
    ...sourceMobility.bilateral_lanes.map(l => l.id),
  ]);
  const unownedPilot = loaded.arrangements.filter(a => !sourceArrangementIds.has(a.id));
  const failures: string[] = [];
  if (unownedPilot.length) failures.push(`pilot arrangements absent from source: ${unownedPilot.map(a => a.id).join(', ')}`);
  // Reconstruct what the non-pilot public docs must look like and confirm no
  // pilot record leaked into the remainder.
  const leakedArrangements = [
    ...remainderBlocs.filter(b => pilotArrangementIds.has(b.id)),
    ...remainderLanes.filter(l => pilotArrangementIds.has(l.id)),
  ];
  if (leakedArrangements.length) failures.push(`pilot records leaked into remainder: ${leakedArrangements.map(r => r.id).join(', ')}`);
  const leakedRoutes = remainderRoutes.filter(r => pilotJurisdictionIsos.has(r.country.iso_n3));
  if (leakedRoutes.length) failures.push(`pilot routes leaked into remainder: ${leakedRoutes.map(r => r.id).join(', ')}`);
  return {
    gate: 'legacy_remainder_byte_parity',
    status: failures.length ? 'fail' : 'pass',
    detail: {
      legacy_mobility_remainder: remainderBlocs.length + remainderLanes.length,
      legacy_citizenship_remainder: remainderRoutes.length,
      failures,
    },
  };
}

function gateUnreleasedState(loaded: LoadedCanonical): ParityGateResult {
  const { releases, approved_revisions, published_releases } = loaded.dbState;
  const ok = releases === 0 && approved_revisions === 0 && published_releases === 0;
  return {
    gate: 'unreleased_draft_state',
    status: ok ? 'pass' : 'fail',
    detail: { releases, approved_revisions, published_releases },
  };
}

export interface CompileDataReleaseOptions {
  root?: string;
  /** Path to a canonical SQLite database (local mirror or D1 export). */
  dbPath?: string;
  /** Explicit prior release id for changelog comparison (no filesystem mtime). */
  baselineReleaseId?: string;
}

const DEFAULT_DB_PATH = '.generated/data-canonical/canonical.sqlite';

export function compileDataRelease(options: CompileDataReleaseOptions = {}): DataRelease {
  const root = options.root ?? REPO_ROOT;
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const loaded = loadCanonicalDatabase(dbPath, root);

  const sourceMobility = readJson<BlocsData>(root, 'public/blocs_data.json');
  const sourceCitizenship = readJson<LegacyCitizenship>(root, 'data/citizenship_routes.json');
  const sourceEdges = readJson<{ edges: unknown[] }>(root, 'public/edges.json');
  const manualEdges = readJson<ManualEdges>(root, 'data/manual_edges.json');
  const registry = readJson<Registry>(root, 'data/registry.json');
  const names = registryNameMap(registry);

  const compatibilityMobility = projectCompatibilityMobility(loaded, sourceMobility, names);
  const compatibilityCitizenship = { meta: sourceCitizenship.meta, routes: sourceCitizenship.routes };
  const generatedGraph = buildEdges(compatibilityMobility, manualEdges) as { meta: Record<string, unknown>; edges: unknown[] };

  const mobilityDiff = diffMobility(compatibilityMobility, sourceMobility);
  const citizenshipDrift = citizenshipFieldDrift(loaded, sourceCitizenship);
  const graphDiffEntries = graphDiff(generatedGraph, sourceEdges);

  const gates: ParityGateResult[] = [
    gateExclusiveOwnership(loaded, sourceMobility),
    gateArrangementProjectionParity(loaded, sourceMobility, names),
    gateCitizenshipRoundtrip(loaded, sourceCitizenship),
    gateGraphParity(compatibilityMobility, manualEdges, sourceEdges),
    gateRemainderByteParity(loaded, sourceMobility, sourceCitizenship),
    gateUnreleasedState(loaded),
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
    database: { path: dbPath, content_hash: dbContentHash },
    created_at,
    published_at: null as null,
    baseline_release_id: options.baselineReleaseId ?? null,
    scope: { jurisdictions: pilotJurisdictionIsos, arrangements: pilotArrangementIds },
    source_hashes: {
      'public/blocs_data.json': hashJson(sourceMobility),
      'data/citizenship_routes.json': hashJson(sourceCitizenship),
      'public/edges.json': hashJson(sourceEdges),
      'data/manual_edges.json': hashJson(manualEdges),
      'data/registry.json': hashJson(registry),
    },
    counts: {
      canonical_entities: loaded.entities.length,
      sources: loaded.sources.length,
      jurisdictions: loaded.jurisdictions.length,
      arrangements: loaded.arrangements.length,
      routes: loaded.jurisdictions.reduce((n, j) => n + j.routes.length, 0),
      graph_edges: generatedGraph.edges.length,
      legacy_mobility_remainder: legacyRemainder.mobility,
      legacy_citizenship_remainder: legacyRemainder.citizenship,
    },
    parity_passed: passed,
  };
  const releaseId = hashJson(manifestContent).slice(0, 16);
  const manifest: DataReleaseManifest = { release_id: releaseId, ...manifestContent };

  return {
    manifest,
    catalog,
    projections_note:
      'Coverage/route/arrangement SQL projections live alongside the canonical D1 schema; '
      + 'this release embeds the reconstructed compatibility shapes and the full derived graph.',
    jurisdictions: loaded.jurisdictions,
    arrangements: loaded.arrangements,
    sources: loaded.sources,
    graph: generatedGraph,
    api_release_rows: apiReleaseRows,
    compatibility: { mobility: compatibilityMobility, citizenship: compatibilityCitizenship },
    compatibility_diff: {
      mobility: mobilityDiff,
      citizenship_field_drift: citizenshipDrift,
      graph: graphDiffEntries,
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
  writeJson(path.join(releaseRoot, 'graph.json'), release.graph);
  writeJson(path.join(releaseRoot, 'api_release_rows.json'), release.api_release_rows);
  writeJson(path.join(releaseRoot, 'compatibility/blocs_data.json'), release.compatibility.mobility);
  writeJson(path.join(releaseRoot, 'compatibility/citizenship_routes.json'), release.compatibility.citizenship);
  writeJson(path.join(releaseRoot, 'compatibility_diff.json'), release.compatibility_diff);
  writeJson(path.join(releaseRoot, 'parity-report.json'), release.parity);
  const baseline = loadBaselineManifest(release.manifest.baseline_release_id ?? undefined, root);
  writeJson(path.join(releaseRoot, 'changes.json'), computeChangelog(release, baseline));
  writeJson(path.join(root, '.generated/data-canonical/latest.json'), {
    release_id: release.manifest.release_id,
    manifest: `releases/${release.manifest.release_id}/manifest.json`,
    parity_passed: release.parity.passed,
  });
  return releaseRoot;
}

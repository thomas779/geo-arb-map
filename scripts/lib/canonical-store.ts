import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type {
  ArrangementRecord,
  JurisdictionRecord,
  JurisdictionRecordV1,
  SourceRecord,
} from './canonical-schema';
import { JurisdictionRecordV1Schema } from './canonical-schema';
import type { CanonicalPilot } from './canonical-pilot-types';

type CanonicalRecord = SourceRecord | JurisdictionRecord | JurisdictionRecordV1 | ArrangementRecord;
export type CanonicalSqlValue = string | number | null;

export interface CanonicalSqlMutation {
  sql: string;
  values: CanonicalSqlValue[];
}

export interface CanonicalImportResult {
  created_at: string;
  revision_by_entity: Record<string, string>;
  counts: {
    entities: number;
    revisions: number;
    sources: number;
    jurisdictions: number;
    mode_coverage: number;
    arrangements: number;
    routes: number;
    route_variants: number;
    arrangement_pathways: number;
    participants: number;
    evidence_links: number;
  };
}

export interface CanonicalImportPlan extends CanonicalImportResult {
  mutations: CanonicalSqlMutation[];
}

export interface CanonicalReleasePlan {
  release_id: string;
  manifest_hash: string;
  mutations: CanonicalSqlMutation[];
}

interface MutationSink {
  run(sql: string, values: CanonicalSqlValue[]): void;
}

export interface CanonicalRouteProjection {
  iso_n3: string;
  jurisdiction: string;
  jurisdiction_review_state: string;
  route_id: string;
  mode: string;
  route_status: string;
  route_review_state: string;
  variant_id: string;
  outcome: string;
  allocation: string;
  eligibility_minimum_months: number | null;
  processing_typical_months: number | null;
  timeline_confidence: string;
}

export interface CanonicalCoverageProjection {
  iso_n3: string;
  jurisdiction: string;
  review_state: string;
  review_confidence: string;
  last_checked: string | null;
  route_count: number;
  route_modes: string[];
  arrangement_count: number;
}

export interface CanonicalModeCoverageProjection {
  iso_n3: string;
  jurisdiction: string;
  mode: string;
  finding: string;
  review_state: string;
  review_confidence: string;
  last_checked: string | null;
  review_note: string | null;
  route_count: number;
}

export interface CanonicalArrangementProjection {
  arrangement_id: string;
  name: string;
  kind: string;
  status: string;
  directionality: string;
  display_category: string;
  review_state: string;
  participant_role: string;
  iso_n3: string;
}

export interface CanonicalEdgeProjection {
  from: string;
  to: string;
  mechanism: string;
  allocation: string;
  years: number;
}

export interface CanonicalProjections {
  coverage: CanonicalCoverageProjection[];
  mode_coverage: CanonicalModeCoverageProjection[];
  routes: CanonicalRouteProjection[];
  arrangements: CanonicalArrangementProjection[];
  edges: CanonicalEdgeProjection[];
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function deterministicCreatedAt(pilot: CanonicalPilot): string {
  const dates = [
    ...pilot.sources.map(source => source.last_checked),
    ...pilot.jurisdictions.map(item => item.review.last_checked),
    ...pilot.arrangements.map(item => item.review.last_checked),
  ].filter((date): date is string => date !== null);
  dates.sort();
  const latest = dates[dates.length - 1];
  if (!latest) throw new Error('Canonical import requires at least one review date');
  return `${latest}T00:00:00.000Z`;
}

export function canonicalRevisionId(record: CanonicalRecord): string {
  return `revision:${record.id}:${hashJson(record).slice(0, 16)}`;
}

function insertRevision(
  sink: MutationSink,
  record: CanonicalRecord,
  createdAt: string,
  supersedesRevisionId: string | null = null,
): string {
  const contentHash = hashJson(record);
  const revisionId = canonicalRevisionId(record);
  sink.run(
    `INSERT INTO canonical_entities (id, entity_type, created_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET entity_type = excluded.entity_type
     WHERE canonical_entities.entity_type != excluded.entity_type`,
    [record.id, record.entity_type, createdAt],
  );
  sink.run(
    `INSERT INTO canonical_revisions (
       id, entity_id, schema_version, payload_json, content_hash,
       review_status, created_at, supersedes_revision_id
     ) VALUES (?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET content_hash = excluded.content_hash
     WHERE canonical_revisions.content_hash != excluded.content_hash`,
    [
      revisionId,
      record.id,
      record.schema_version,
      JSON.stringify(record),
      contentHash,
      createdAt,
      supersedesRevisionId,
    ],
  );
  return revisionId;
}

function legacyJurisdictionRevision(record: JurisdictionRecord): JurisdictionRecordV1 {
  const {
    coverage: _coverage,
    residence_routes: _residenceRoutes,
    residence_coverage: _residenceCoverage,
    ...legacy
  } = record;
  return JurisdictionRecordV1Schema.parse({
    ...legacy,
    schema_version: 1,
  });
}

function insertSource(
  sink: MutationSink,
  source: SourceRecord,
  revisionId: string,
): void {
  sink.run(
    `INSERT INTO source_index (
       revision_id, url, publisher, source_type, last_checked
     ) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(revision_id) DO NOTHING`,
    [
      revisionId,
      source.url,
      source.publisher,
      source.source_type,
      source.last_checked,
    ],
  );
  for (const iso of [...source.jurisdictions].sort()) {
    sink.run(
      `INSERT INTO source_jurisdictions (revision_id, iso_n3)
       VALUES (?1, ?2)
       ON CONFLICT(revision_id, iso_n3) DO NOTHING`,
      [revisionId, iso],
    );
  }
}

function insertJurisdiction(
  sink: MutationSink,
  record: JurisdictionRecord,
  revisionId: string,
): void {
  sink.run(
    `INSERT INTO jurisdiction_index (
       revision_id, iso_n3, name, jurisdiction_type,
       review_state, review_confidence, last_checked
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(revision_id) DO NOTHING`,
    [
      revisionId,
      record.jurisdiction.iso_n3,
      record.jurisdiction.name,
      record.jurisdiction.type,
      record.review.state,
      record.review.confidence,
      record.review.last_checked,
    ],
  );
  for (const coverage of [...record.coverage].sort((a, b) => a.mode.localeCompare(b.mode))) {
    sink.run(
      `INSERT INTO jurisdiction_mode_coverage (
         revision_id, mode, finding, review_state, review_confidence,
         last_checked, review_note
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(revision_id, mode) DO NOTHING`,
      [
        revisionId,
        coverage.mode,
        coverage.finding,
        coverage.review.state,
        coverage.review.confidence,
        coverage.review.last_checked,
        coverage.review.note ?? null,
      ],
    );
  }
  for (const route of [...record.routes].sort((a, b) => a.id.localeCompare(b.id))) {
    sink.run(
      `INSERT INTO route_index (
         revision_id, route_id, mode, route_status, title,
         review_state, review_confidence, last_checked
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(revision_id, route_id) DO NOTHING`,
      [
        revisionId,
        route.id,
        route.mode,
        route.status,
        route.title,
        route.review.state,
        route.review.confidence,
        route.review.last_checked,
      ],
    );
    for (const variant of [...route.variants].sort((a, b) => a.id.localeCompare(b.id))) {
      sink.run(
        `INSERT INTO route_variant_index (
           revision_id, route_id, variant_id, outcome, allocation,
           eligibility_minimum_months, processing_typical_months,
           timeline_confidence
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(revision_id, route_id, variant_id) DO NOTHING`,
        [
          revisionId,
          route.id,
          variant.id,
          variant.outcome,
          variant.allocation,
          variant.timeline.eligibility_minimum_months,
          variant.timeline.processing_typical_months,
          variant.timeline.confidence,
        ],
      );
    }
  }
}

function insertArrangement(
  sink: MutationSink,
  record: ArrangementRecord,
  revisionId: string,
): void {
  sink.run(
    `INSERT INTO arrangement_index (
       revision_id, arrangement_id, kind, status, directionality, name,
       display_category, display_strength,
       review_state, review_confidence, last_checked
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(revision_id) DO NOTHING`,
    [
      revisionId,
      record.id,
      record.kind,
      record.status,
      record.directionality,
      record.name,
      record.display.category,
      record.display.strength,
      record.review.state,
      record.review.confidence,
      record.review.last_checked,
    ],
  );
  const participantGroups = [
    ['member', record.participants.members],
    ['former_member', record.participants.former_members],
    ['destination', record.participants.destinations],
    ['beneficiary', record.participants.beneficiaries],
  ] as const;
  for (const [role, isos] of participantGroups) {
    for (const iso of [...isos].sort()) {
      sink.run(
        `INSERT INTO arrangement_participants (revision_id, role, iso_n3)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(revision_id, role, iso_n3) DO NOTHING`,
        [revisionId, role, iso],
      );
    }
  }
  for (const pathway of [...record.pathways].sort((a, b) => a.id.localeCompare(b.id))) {
    sink.run(
      `INSERT INTO arrangement_pathway_index (
         revision_id, pathway_id, outcome, allocation,
         eligibility_minimum_months, processing_typical_months,
         timeline_confidence
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(revision_id, pathway_id) DO NOTHING`,
      [
        revisionId,
        pathway.id,
        pathway.outcome,
        pathway.allocation,
        pathway.timeline.eligibility_minimum_months,
        pathway.timeline.processing_typical_months,
        pathway.timeline.confidence,
      ],
    );
  }
}

function evidenceReferences(record: JurisdictionRecord | ArrangementRecord): Array<{
  source_id: string;
  supports_fields: string[];
  note?: string;
}> {
  if (record.entity_type === 'jurisdiction') {
    return [
      ...record.coverage.flatMap(item => item.source_refs),
      ...record.routes.flatMap(route =>
        route.variants.flatMap(variant => variant.source_refs)),
      ...(record.residence_coverage ?? []).flatMap(item => item.source_refs),
      ...(record.residence_routes ?? []).flatMap(route =>
        route.variants.flatMap(variant => variant.source_refs)),
    ];
  }
  return [
    ...record.source_refs,
    ...record.pathways.flatMap(pathway => pathway.source_refs),
  ];
}

function insertEvidence(
  sink: MutationSink,
  records: Array<JurisdictionRecord | ArrangementRecord>,
  revisionByEntity: Record<string, string>,
): number {
  const seen = new Set<string>();
  for (const record of records) {
    const targetRevisionId = revisionByEntity[record.id];
    if (!targetRevisionId) throw new Error(`Missing revision for ${record.id}`);
    for (const reference of evidenceReferences(record)) {
      const sourceRevisionId = revisionByEntity[reference.source_id];
      if (!sourceRevisionId) {
        throw new Error(`Missing source revision for ${reference.source_id}`);
      }
      for (const fieldPath of reference.supports_fields) {
        const key = `${targetRevisionId}\0${sourceRevisionId}\0${fieldPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sink.run(
          `INSERT INTO evidence_links (
             target_revision_id, source_revision_id, field_path, note
           ) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(target_revision_id, source_revision_id, field_path)
           DO NOTHING`,
          [
            targetRevisionId,
            sourceRevisionId,
            fieldPath,
            reference.note ?? null,
          ],
        );
      }
    }
  }
  return seen.size;
}

export function buildCanonicalImportPlan(
  pilot: CanonicalPilot,
  priorRevisionByEntity: Record<string, string> = {},
): CanonicalImportPlan {
  const createdAt = deterministicCreatedAt(pilot);
  const revisionByEntity: Record<string, string> = {};
  const mutations: CanonicalSqlMutation[] = [];
  const sink: MutationSink = {
    run(sql, values) {
      mutations.push({ sql, values });
    },
  };
  const records: Array<SourceRecord | JurisdictionRecord | ArrangementRecord> = [
    ...pilot.sources,
    ...pilot.jurisdictions,
    ...pilot.arrangements,
  ].sort((a, b) => a.id.localeCompare(b.id));

  let evidenceLinks = 0;
  for (const record of records) {
    let supersedesRevisionId: string | null = priorRevisionByEntity[record.id] ?? null;
    if (record.entity_type === 'jurisdiction') {
      supersedesRevisionId = insertRevision(
        sink,
        legacyJurisdictionRevision(record),
        createdAt,
        supersedesRevisionId,
      );
    }
    const revisionId = insertRevision(sink, record, createdAt, supersedesRevisionId);
    revisionByEntity[record.id] = revisionId;
    if (record.entity_type === 'source') insertSource(sink, record, revisionId);
    if (record.entity_type === 'jurisdiction') {
      insertJurisdiction(sink, record, revisionId);
    }
    if (record.entity_type === 'arrangement') {
      insertArrangement(sink, record, revisionId);
    }
  }
  evidenceLinks = insertEvidence(
    sink,
    [...pilot.jurisdictions, ...pilot.arrangements],
    revisionByEntity,
  );

  return {
    created_at: createdAt,
    revision_by_entity: Object.fromEntries(
      Object.entries(revisionByEntity).sort(([a], [b]) => a.localeCompare(b)),
    ),
    counts: {
      entities: records.length,
      revisions: records.length + pilot.jurisdictions.length,
      sources: pilot.sources.length,
      jurisdictions: pilot.jurisdictions.length,
      mode_coverage: pilot.jurisdictions.reduce(
        (sum, item) => sum + item.coverage.length,
        0,
      ),
      arrangements: pilot.arrangements.length,
      routes: pilot.jurisdictions.reduce((sum, item) => sum + item.routes.length, 0),
      route_variants: pilot.jurisdictions.reduce(
        (sum, item) => sum + item.routes.reduce(
          (routeSum, route) => routeSum + route.variants.length,
          0,
        ),
        0,
      ),
      arrangement_pathways: pilot.arrangements.reduce(
        (sum, item) => sum + item.pathways.length,
        0,
      ),
      participants: pilot.arrangements.reduce(
        (sum, item) => sum
          + item.participants.members.length
          + item.participants.former_members.length
          + item.participants.destinations.length
          + item.participants.beneficiaries.length,
        0,
      ),
      evidence_links: evidenceLinks,
    },
    mutations,
  };
}

export function applyCanonicalMutations(
  db: Database,
  mutations: CanonicalSqlMutation[],
): void {
  db.transaction(() => {
    for (const mutation of mutations) {
      db.query(mutation.sql).run(...mutation.values);
    }
  })();
}

export function importCanonicalPilot(
  db: Database,
  pilot: CanonicalPilot,
): CanonicalImportResult {
  const plan = buildCanonicalImportPlan(pilot);
  applyCanonicalMutations(db, plan.mutations);
  const { mutations: _mutations, ...result } = plan;
  return result;
}

function sqlLiteral(value: CanonicalSqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SQL values must be finite numbers');
    return String(value);
  }
  return `'${value.split("'").join("''")}'`;
}

export function renderCanonicalSql(
  mutations: CanonicalSqlMutation[],
): string {
  const statements = mutations.map(mutation => {
    const rendered = mutation.sql.replace(/\?(\d+)/g, (_match, position: string) => {
      const value = mutation.values[Number(position) - 1];
      if (value === undefined) {
        throw new Error(`Missing SQL value ?${position}`);
      }
      return sqlLiteral(value);
    });
    return `${rendered};`;
  });
  return [
    '-- Generated by scripts/build_canonical_database.ts. Do not edit.',
    ...statements,
    '',
  ].join('\n');
}

export function buildCanonicalReleasePlan({
  revisionByEntity,
  createdAt,
  publishedAt,
}: {
  revisionByEntity: Record<string, string>;
  createdAt: string;
  publishedAt: string;
}): CanonicalReleasePlan {
  const entries = Object.entries(revisionByEntity)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) throw new Error('Cannot build an empty canonical release');
  const manifestHash = hashJson(entries);
  const releaseId = manifestHash.slice(0, 16);
  const mutations: CanonicalSqlMutation[] = [{
    sql: `INSERT INTO releases (
      id, status, manifest_hash, created_at
    ) VALUES (?1, 'building', ?2, ?3)
    ON CONFLICT(id) DO NOTHING`,
    values: [releaseId, manifestHash, createdAt],
  }];
  for (const [entityId, revisionId] of entries) {
    mutations.push({
      sql: `INSERT INTO release_items (release_id, entity_id, revision_id)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(release_id, entity_id) DO NOTHING`,
      values: [releaseId, entityId, revisionId],
    });
  }
  mutations.push({
    sql: `UPDATE releases
      SET status = 'published', published_at = ?2
      WHERE id = ?1 AND status = 'building'`,
    values: [releaseId, publishedAt],
  });
  return {
    release_id: releaseId,
    manifest_hash: manifestHash,
    mutations,
  };
}

interface ProjectionScope {
  cte: string;
  values: string[];
}

function revisionScope(revisionIds: string[]): ProjectionScope {
  if (revisionIds.length === 0) throw new Error('Projection scope cannot be empty');
  const values = [...new Set(revisionIds)].sort();
  return {
    cte: `WITH projection_scope(revision_id) AS (VALUES ${
      values.map((_, index) => `(?${index + 1})`).join(', ')
    })`,
    values,
  };
}

function rows<T>(db: Database, sql: string, values: string[]): T[] {
  return db.query(sql).all(...values) as T[];
}

export function readCanonicalProjections(
  db: Database,
  revisionIds: string[],
): CanonicalProjections {
  return readScopedCanonicalProjections(db, revisionScope(revisionIds));
}

export function readCanonicalReleaseProjections(
  db: Database,
  releaseId: string,
): CanonicalProjections {
  return readScopedCanonicalProjections(db, {
    cte: `WITH projection_scope(revision_id) AS (
      SELECT revision_id FROM release_items WHERE release_id = ?1
    )`,
    values: [releaseId],
  });
}

function readScopedCanonicalProjections(
  db: Database,
  scoped: ProjectionScope,
): CanonicalProjections {
  const routes = rows<CanonicalRouteProjection>(
    db,
    `${scoped.cte}
     SELECT
       jurisdiction.iso_n3,
       jurisdiction.name AS jurisdiction,
       jurisdiction.review_state AS jurisdiction_review_state,
       route.route_id,
       route.mode,
       route.route_status,
       route.review_state AS route_review_state,
       variant.variant_id,
       variant.outcome,
       variant.allocation,
       variant.eligibility_minimum_months,
       variant.processing_typical_months,
       variant.timeline_confidence
     FROM projection_scope AS scope
     JOIN jurisdiction_index AS jurisdiction USING (revision_id)
     JOIN route_index AS route USING (revision_id)
     JOIN route_variant_index AS variant USING (revision_id, route_id)
     ORDER BY jurisdiction.iso_n3, route.route_id, variant.variant_id`,
    scoped.values,
  );
  const rawCoverage = rows<{
    iso_n3: string;
    jurisdiction: string;
    review_state: string;
    review_confidence: string;
    last_checked: string | null;
    route_count: number;
    route_modes: string | null;
    arrangement_count: number;
  }>(
    db,
    `${scoped.cte},
     route_summary AS (
       SELECT
         jurisdiction.revision_id,
         COUNT(DISTINCT route.route_id) AS route_count,
         GROUP_CONCAT(DISTINCT route.mode) AS route_modes
       FROM projection_scope AS scope
       JOIN jurisdiction_index AS jurisdiction USING (revision_id)
       LEFT JOIN route_index AS route USING (revision_id)
       GROUP BY jurisdiction.revision_id
     ),
     arrangement_summary AS (
       SELECT participant.iso_n3, COUNT(DISTINCT arrangement.arrangement_id) AS arrangement_count
       FROM projection_scope AS scope
       JOIN arrangement_index AS arrangement USING (revision_id)
       JOIN arrangement_participants AS participant USING (revision_id)
       GROUP BY participant.iso_n3
     )
     SELECT
       jurisdiction.iso_n3,
       jurisdiction.name AS jurisdiction,
       jurisdiction.review_state,
       jurisdiction.review_confidence,
       jurisdiction.last_checked,
       route_summary.route_count,
       route_summary.route_modes,
       COALESCE(arrangement_summary.arrangement_count, 0) AS arrangement_count
     FROM projection_scope AS scope
     JOIN jurisdiction_index AS jurisdiction USING (revision_id)
     JOIN route_summary USING (revision_id)
     LEFT JOIN arrangement_summary USING (iso_n3)
     ORDER BY jurisdiction.iso_n3`,
    scoped.values,
  );
  const coverage = rawCoverage.map(row => ({
    ...row,
    route_modes: row.route_modes?.split(',').sort() ?? [],
  }));
  const modeCoverage = rows<CanonicalModeCoverageProjection>(
    db,
    `${scoped.cte},
     route_summary AS (
       SELECT revision_id, mode, COUNT(*) AS route_count
       FROM route_index
       GROUP BY revision_id, mode
     )
     SELECT
       jurisdiction.iso_n3,
       jurisdiction.name AS jurisdiction,
       coverage.mode,
       coverage.finding,
       coverage.review_state,
       coverage.review_confidence,
       coverage.last_checked,
       coverage.review_note,
       COALESCE(route_summary.route_count, 0) AS route_count
     FROM projection_scope AS scope
     JOIN jurisdiction_index AS jurisdiction USING (revision_id)
     JOIN jurisdiction_mode_coverage AS coverage USING (revision_id)
     LEFT JOIN route_summary
       ON route_summary.revision_id = coverage.revision_id
       AND route_summary.mode = coverage.mode
     ORDER BY jurisdiction.iso_n3, coverage.mode`,
    scoped.values,
  );
  const arrangements = rows<CanonicalArrangementProjection>(
    db,
    `${scoped.cte}
     SELECT
       arrangement.arrangement_id,
       arrangement.name,
       arrangement.kind,
       arrangement.status,
       arrangement.directionality,
       arrangement.display_category,
       arrangement.review_state,
       participant.role AS participant_role,
       participant.iso_n3
     FROM projection_scope AS scope
     JOIN arrangement_index AS arrangement USING (revision_id)
     JOIN arrangement_participants AS participant USING (revision_id)
     ORDER BY arrangement.arrangement_id, participant.role, participant.iso_n3`,
    scoped.values,
  );
  const regionalEdges = rows<CanonicalEdgeProjection>(
    db,
    `${scoped.cte}
     SELECT
       'cit:' || origin.iso_n3 AS "from",
       CASE
         WHEN arrangement.display_category IN ('full', 'closed')
           THEN 'settle_full:' || destination.iso_n3
         ELSE 'settle_partial:' || destination.iso_n3
       END AS "to",
       arrangement.arrangement_id AS mechanism,
       'right' AS allocation,
       0 AS years
     FROM projection_scope AS scope
     JOIN arrangement_index AS arrangement USING (revision_id)
     JOIN arrangement_participants AS origin
       ON origin.revision_id = arrangement.revision_id AND origin.role = 'member'
     JOIN arrangement_participants AS destination
       ON destination.revision_id = arrangement.revision_id AND destination.role = 'member'
     WHERE arrangement.status = 'active'
       AND arrangement.display_category IN ('full', 'closed', 'partial', 'hub_spoke')
       AND origin.iso_n3 != destination.iso_n3
     ORDER BY arrangement.arrangement_id, origin.iso_n3, destination.iso_n3`,
    scoped.values,
  );
  const pathwayEdges = rows<CanonicalEdgeProjection>(
    db,
    `${scoped.cte}
     SELECT
       'cit:' || beneficiary.iso_n3 AS "from",
       CASE pathway.outcome
         WHEN 'citizenship' THEN 'cit:' || destination.iso_n3
         WHEN 'permanent_residence' THEN 'pr:' || destination.iso_n3
         WHEN 'residence' THEN 'settle_partial:' || destination.iso_n3
         ELSE 'work:' || destination.iso_n3
       END AS "to",
       arrangement.arrangement_id AS mechanism,
       pathway.allocation,
       COALESCE(pathway.eligibility_minimum_months, 0) / 12.0 AS years
     FROM projection_scope AS scope
     JOIN arrangement_index AS arrangement USING (revision_id)
     JOIN arrangement_pathway_index AS pathway USING (revision_id)
     JOIN arrangement_participants AS beneficiary
       ON beneficiary.revision_id = arrangement.revision_id
       AND beneficiary.role = 'beneficiary'
     JOIN arrangement_participants AS destination
       ON destination.revision_id = arrangement.revision_id
       AND destination.role = 'destination'
     WHERE arrangement.status = 'active'
     ORDER BY arrangement.arrangement_id, beneficiary.iso_n3, destination.iso_n3`,
    scoped.values,
  );
  return {
    coverage,
    mode_coverage: modeCoverage,
    routes,
    arrangements,
    edges: [...regionalEdges, ...pathwayEdges],
  };
}

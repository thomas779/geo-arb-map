import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCanonicalMigrations } from '../scripts/lib/d1-migrations';

const migration = readCanonicalMigrations(
  fileURLToPath(new URL('..', import.meta.url)),
);

function database(): Database {
  const db = new Database(':memory:', { strict: true });
  db.exec(migration);
  return db;
}

function insertEntity(
  db: Database,
  entity: { id: string; type: 'source' | 'jurisdiction'; revision: string },
): void {
  db.query(
    `INSERT INTO canonical_entities (id, entity_type, created_at)
     VALUES (?1, ?2, ?3)`,
  ).run(entity.id, entity.type, '2026-07-19T00:00:00.000Z');
  db.query(
    `INSERT INTO canonical_revisions (
       id, entity_id, schema_version, payload_json, content_hash,
       review_status, created_at, approved_at
     ) VALUES (?1, ?2, 1, ?3, ?4, 'approved', ?5, ?5)`,
  ).run(
    entity.revision,
    entity.id,
    JSON.stringify({ id: entity.id }),
    `hash-${entity.revision}`,
    '2026-07-19T00:00:00.000Z',
  );
}

describe('canonical D1 schema', () => {
  test('supports relational route and evidence queries over canonical records', () => {
    const db = database();
    insertEntity(db, {
      id: 'source:boe',
      type: 'source',
      revision: 'revision:source:boe:1',
    });
    insertEntity(db, {
      id: 'jurisdiction:724',
      type: 'jurisdiction',
      revision: 'revision:jurisdiction:724:1',
    });

    db.query(
      `INSERT INTO source_index (
         revision_id, url, publisher, source_type, last_checked
       ) VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).run(
      'revision:source:boe:1',
      'https://www.boe.es/example',
      'BOE',
      'primary_law',
      '2026-07-19',
    );
    db.query(
      `INSERT INTO jurisdiction_index (
         revision_id, iso_n3, name, jurisdiction_type,
         review_state, review_confidence, last_checked
       ) VALUES (?1, '724', 'Spain', 'sovereign', 'partial', 'high', '2026-07-19')`,
    ).run('revision:jurisdiction:724:1');
    db.query(
      `INSERT INTO route_index (
         revision_id, route_id, mode, route_status, title,
         review_state, review_confidence, last_checked
       ) VALUES (?1, 'ordinary_naturalization', 'naturalization', 'active', ?2,
         'partial', 'high', '2026-07-19')`,
    ).run('revision:jurisdiction:724:1', 'Ordinary naturalization');
    db.query(
      `INSERT INTO route_variant_index (
         revision_id, route_id, variant_id, outcome, allocation,
         eligibility_minimum_months, processing_typical_months,
         timeline_confidence
       ) VALUES (?1, 'ordinary_naturalization', 'standard', 'citizenship',
         'discretionary', 120, NULL, 'high')`,
    ).run('revision:jurisdiction:724:1');
    db.query(
      `INSERT INTO evidence_links (
         target_revision_id, source_revision_id, field_path
       ) VALUES (?1, ?2, ?3)`,
    ).run(
      'revision:jurisdiction:724:1',
      'revision:source:boe:1',
      '/routes/ordinary_naturalization/variants/standard/timeline',
    );

    const result = db.query(
      `SELECT jurisdiction.iso_n3, route.route_id,
              variant.eligibility_minimum_months, source.publisher
       FROM jurisdiction_index AS jurisdiction
       JOIN route_index AS route USING (revision_id)
       JOIN route_variant_index AS variant USING (revision_id, route_id)
       JOIN evidence_links AS evidence
         ON evidence.target_revision_id = jurisdiction.revision_id
       JOIN source_index AS source
         ON source.revision_id = evidence.source_revision_id
       WHERE variant.outcome = 'citizenship'`,
    ).get() as Record<string, unknown>;

    expect(result).toEqual({
      iso_n3: '724',
      route_id: 'ordinary_naturalization',
      eligibility_minimum_months: 120,
      publisher: 'BOE',
    });
    db.close();
  });

  test('publishes only approved revisions and then freezes release history', () => {
    const db = database();
    db.query(
      `INSERT INTO canonical_entities (id, entity_type, created_at)
       VALUES ('jurisdiction:250', 'jurisdiction', ?1)`,
    ).run('2026-07-19T00:00:00.000Z');
    db.query(
      `INSERT INTO canonical_revisions (
         id, entity_id, schema_version, payload_json, content_hash,
         review_status, created_at
       ) VALUES (?1, 'jurisdiction:250', 1, ?2, 'hash-fr-1', 'draft', ?3)`,
    ).run(
      'revision:jurisdiction:250:1',
      JSON.stringify({ id: 'jurisdiction:250' }),
      '2026-07-19T00:00:00.000Z',
    );
    db.query(
      `INSERT INTO releases (id, status, manifest_hash, created_at)
       VALUES ('release:1', 'building', 'manifest-1', ?1)`,
    ).run('2026-07-19T00:00:00.000Z');

    expect(() => db.query(
      `INSERT INTO release_items (release_id, entity_id, revision_id)
       VALUES ('release:1', 'jurisdiction:250', 'revision:jurisdiction:250:1')`,
    ).run()).toThrow('release items must be approved revisions');

    db.query(
      `UPDATE canonical_revisions
       SET review_status = 'approved', approved_at = ?1
       WHERE id = 'revision:jurisdiction:250:1'`,
    ).run('2026-07-19T01:00:00.000Z');
    db.query(
      `INSERT INTO release_items (release_id, entity_id, revision_id)
       VALUES ('release:1', 'jurisdiction:250', 'revision:jurisdiction:250:1')`,
    ).run();
    db.query(
      `UPDATE releases
       SET status = 'published', published_at = ?1
       WHERE id = 'release:1'`,
    ).run('2026-07-19T02:00:00.000Z');

    expect(() => db.query(
      `UPDATE canonical_revisions
       SET review_status = 'rejected', approved_at = NULL
       WHERE id = 'revision:jurisdiction:250:1'`,
    ).run()).toThrow('published revisions are immutable');
    expect(() => db.query(
      `DELETE FROM release_items
       WHERE release_id = 'release:1' AND entity_id = 'jurisdiction:250'`,
    ).run()).toThrow('published release membership is immutable');
    expect(() => db.query(
      `UPDATE releases SET manifest_hash = 'changed' WHERE id = 'release:1'`,
    ).run()).toThrow('finalized release metadata is immutable');
    db.close();
  });

  test('rejects relational projections attached to the wrong entity type', () => {
    const db = database();
    insertEntity(db, {
      id: 'jurisdiction:620',
      type: 'jurisdiction',
      revision: 'revision:jurisdiction:620:1',
    });

    expect(() => db.query(
      `INSERT INTO source_index (
         revision_id, url, publisher, source_type, last_checked
       ) VALUES (?1, ?2, 'Wrong', 'discovery', '2026-07-19')`,
    ).run(
      'revision:jurisdiction:620:1',
      'https://example.com/not-a-source',
    )).toThrow('source index revision must belong to a source entity');
    db.close();
  });

  test('stores explicit reviewed negatives independently from route presence', () => {
    const db = database();
    insertEntity(db, {
      id: 'jurisdiction:724',
      type: 'jurisdiction',
      revision: 'revision:jurisdiction:724:coverage',
    });
    db.query(
      `INSERT INTO jurisdiction_index (
         revision_id, iso_n3, name, jurisdiction_type,
         review_state, review_confidence, last_checked
       ) VALUES (?1, '724', 'Spain', 'sovereign', 'partial', 'high', '2026-07-21')`,
    ).run('revision:jurisdiction:724:coverage');
    db.query(
      `INSERT INTO jurisdiction_mode_coverage (
         revision_id, mode, finding, review_state, review_confidence, last_checked
       ) VALUES (?1, 'investment', 'verified_none', 'reviewed', 'high', '2026-07-21')`,
    ).run('revision:jurisdiction:724:coverage');

    expect(db.query(
      `SELECT mode, finding, review_state
       FROM jurisdiction_mode_coverage WHERE revision_id = ?1`,
    ).get('revision:jurisdiction:724:coverage')).toEqual({
      mode: 'investment',
      finding: 'verified_none',
      review_state: 'reviewed',
    });
    expect(() => db.query(
      `INSERT INTO jurisdiction_mode_coverage (
         revision_id, mode, finding, review_state, review_confidence
       ) VALUES (?1, 'birth', 'verified_none', 'partial', 'medium')`,
    ).run('revision:jurisdiction:724:coverage')).toThrow(
      'verified negative coverage must be reviewed',
    );
    db.close();
  });
});

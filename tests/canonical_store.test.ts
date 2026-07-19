import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCanonicalPilot } from '../scripts/lib/canonical-pilot';
import {
  importCanonicalPilot,
  readCanonicalProjections,
  readCanonicalReleaseProjections,
} from '../scripts/lib/canonical-store';

const migration = fs.readFileSync(
  fileURLToPath(
    new URL('../data/d1/migrations/0001_canonical_data.sql', import.meta.url),
  ),
  'utf8',
);
const pilot = buildCanonicalPilot();

function importedDatabase(): {
  database: Database;
  revisions: string[];
} {
  const database = new Database(':memory:', { strict: true });
  database.exec(migration);
  const imported = importCanonicalPilot(database, pilot);
  return {
    database,
    revisions: Object.values(imported.revision_by_entity),
  };
}

describe('canonical SQL import and projections', () => {
  test('imports every pilot entity deterministically as an unpublished draft', () => {
    const first = importedDatabase();
    const second = importedDatabase();
    const firstRevisions = first.database.query(
      `SELECT id, entity_id, review_status, content_hash
       FROM canonical_revisions ORDER BY entity_id`,
    ).all();
    const secondRevisions = second.database.query(
      `SELECT id, entity_id, review_status, content_hash
       FROM canonical_revisions ORDER BY entity_id`,
    ).all();

    expect(firstRevisions).toEqual(secondRevisions);
    expect(firstRevisions).toHaveLength(
      pilot.sources.length + pilot.jurisdictions.length + pilot.arrangements.length,
    );
    expect(firstRevisions.every(
      row => (row as { review_status: string }).review_status === 'draft',
    )).toBe(true);
    expect(first.database.query('SELECT COUNT(*) AS count FROM releases').get()).toEqual({
      count: 0,
    });
    first.database.close();
    second.database.close();
  });

  test('derives queryable route and coverage projections from SQL', () => {
    const imported = importedDatabase();
    const projections = readCanonicalProjections(
      imported.database,
      imported.revisions,
    );
    const canonicalVariantCount = pilot.jurisdictions.reduce(
      (sum, jurisdiction) => sum + jurisdiction.routes.reduce(
        (routeSum, route) => routeSum + route.variants.length,
        0,
      ),
      0,
    );

    expect(projections.routes).toHaveLength(canonicalVariantCount);
    expect(projections.coverage.map(row => row.iso_n3)).toEqual(['250', '620', '724']);
    expect(projections.coverage.find(row => row.iso_n3 === '250')).toMatchObject({
      route_count: 1,
      route_modes: ['naturalization'],
    });
    imported.database.close();
  });

  test('derives pilot graph inputs from arrangements without parsing prose', () => {
    const imported = importedDatabase();
    const projections = readCanonicalProjections(
      imported.database,
      imported.revisions,
    );

    expect(projections.edges).toContainEqual({
      from: 'cit:076',
      to: 'settle_full:032',
      mechanism: 'mercosur',
      allocation: 'right',
      years: 0,
    });
    expect(projections.edges).toContainEqual({
      from: 'cit:188',
      to: 'cit:724',
      mechanism: 'spain_iberoamerican',
      allocation: 'discretionary',
      years: 2,
    });
    expect(projections.edges.some(edge =>
      edge.from === 'cit:250'
      && edge.to === 'settle_full:276'
      && edge.mechanism === 'eu_eea')).toBe(true);
    imported.database.close();
  });

  test('pins every evidence link to immutable target and source revisions', () => {
    const imported = importedDatabase();
    const unresolved = imported.database.query(
      `SELECT evidence.field_path
       FROM evidence_links AS evidence
       LEFT JOIN canonical_revisions AS target
         ON target.id = evidence.target_revision_id
       LEFT JOIN source_index AS source
         ON source.revision_id = evidence.source_revision_id
       WHERE target.id IS NULL OR source.revision_id IS NULL`,
    ).all();
    const evidenceCount = imported.database.query(
      'SELECT COUNT(*) AS count FROM evidence_links',
    ).get() as { count: number };

    expect(unresolved).toEqual([]);
    expect(evidenceCount.count).toBeGreaterThan(0);
    imported.database.close();
  });

  test('queries a published release without a large revision parameter list', () => {
    const imported = importedDatabase();
    imported.database.query(
      `UPDATE canonical_revisions
       SET review_status = 'approved', approved_at = ?1`,
    ).run('2026-07-19T01:00:00.000Z');
    imported.database.query(
      `INSERT INTO releases (id, status, manifest_hash, created_at)
       VALUES ('release:test', 'building', 'manifest:test', ?1)`,
    ).run('2026-07-19T01:00:00.000Z');
    const insertItem = imported.database.query(
      `INSERT INTO release_items (release_id, entity_id, revision_id)
       SELECT 'release:test', entity_id, id
       FROM canonical_revisions
       WHERE id = ?1`,
    );
    for (const revisionId of imported.revisions) insertItem.run(revisionId);
    imported.database.query(
      `UPDATE releases
       SET status = 'published', published_at = ?1
       WHERE id = 'release:test'`,
    ).run('2026-07-19T02:00:00.000Z');

    const candidate = readCanonicalProjections(
      imported.database,
      imported.revisions,
    );
    const published = readCanonicalReleaseProjections(
      imported.database,
      'release:test',
    );
    expect(published).toEqual(candidate);
    imported.database.close();
  });
});

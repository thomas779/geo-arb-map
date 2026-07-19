import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCanonicalPilot } from '../scripts/lib/canonical-pilot';
import {
  applyCanonicalMutations,
  buildCanonicalImportPlan,
  buildCanonicalReleasePlan,
  importCanonicalPilot,
  readCanonicalProjections,
  readCanonicalReleaseProjections,
  renderCanonicalSql,
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
  revisionByEntity: Record<string, string>;
} {
  const database = new Database(':memory:', { strict: true });
  database.exec(migration);
  const imported = importCanonicalPilot(database, pilot);
  return {
    database,
    revisions: Object.values(imported.revision_by_entity),
    revisionByEntity: imported.revision_by_entity,
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
    importCanonicalPilot(first.database, pilot);
    expect(first.database.query(
      'SELECT COUNT(*) AS count FROM canonical_revisions',
    ).get()).toEqual({ count: firstRevisions.length });
    first.database.close();
    second.database.close();
  });

  test('renders the same provider-neutral import plan for D1 SQL', () => {
    const plan = buildCanonicalImportPlan(pilot);
    const rendered = renderCanonicalSql(plan.mutations);
    const direct = new Database(':memory:', { strict: true });
    const fromSql = new Database(':memory:', { strict: true });
    direct.exec(migration);
    fromSql.exec(migration);
    applyCanonicalMutations(direct, plan.mutations);
    fromSql.exec(rendered);
    const snapshot = (database: Database) => database.query(
      `SELECT entity_id, id, content_hash, review_status
       FROM canonical_revisions ORDER BY entity_id`,
    ).all();

    expect(rendered).not.toContain('?1');
    expect(snapshot(fromSql)).toEqual(snapshot(direct));
    expect(fromSql.query('SELECT COUNT(*) AS count FROM evidence_links').get())
      .toEqual(direct.query('SELECT COUNT(*) AS count FROM evidence_links').get());
    direct.close();
    fromSql.close();
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
    const release = buildCanonicalReleasePlan({
      revisionByEntity: imported.revisionByEntity,
      createdAt: '2026-07-19T01:00:00.000Z',
      publishedAt: '2026-07-19T02:00:00.000Z',
    });
    expect(() => applyCanonicalMutations(
      imported.database,
      release.mutations,
    )).toThrow('release items must be approved revisions');
    expect(imported.database.query('SELECT COUNT(*) AS count FROM releases').get())
      .toEqual({ count: 0 });

    imported.database.query(
      `UPDATE canonical_revisions
       SET review_status = 'approved', approved_at = ?1`,
    ).run('2026-07-19T01:00:00.000Z');
    applyCanonicalMutations(imported.database, release.mutations);

    const candidate = readCanonicalProjections(
      imported.database,
      imported.revisions,
    );
    const published = readCanonicalReleaseProjections(
      imported.database,
      release.release_id,
    );
    expect(published).toEqual(candidate);
    imported.database.close();
  });
});

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCanonicalPilot } from '../scripts/lib/canonical-pilot';
import { readCanonicalMigrations } from '../scripts/lib/d1-migrations';
import {
  applyCanonicalMutations,
  buildCanonicalImportPlan,
  buildCanonicalReleasePlan,
  importCanonicalPilot,
  readCanonicalProjections,
  readCanonicalReleaseProjections,
  renderCanonicalSql,
} from '../scripts/lib/canonical-store';

const migration = readCanonicalMigrations(
  fileURLToPath(new URL('..', import.meta.url)),
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
      pilot.sources.length + (pilot.jurisdictions.length * 2) + pilot.arrangements.length,
    );
    expect(firstRevisions.every(
      row => (row as { review_status: string }).review_status === 'draft',
    )).toBe(true);
    expect(first.database.query('SELECT COUNT(*) AS count FROM releases').get()).toEqual({
      count: 0,
    });
    const heads = first.database.query(
      `SELECT revision.id
       FROM canonical_revisions AS revision
       WHERE NOT EXISTS (
         SELECT 1 FROM canonical_revisions AS newer
         WHERE newer.supersedes_revision_id = revision.id
       )
       ORDER BY revision.entity_id`,
    ).all();
    expect(heads).toHaveLength(
      pilot.sources.length + pilot.jurisdictions.length + pilot.arrangements.length,
    );
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

  test('a changed import supersedes the existing head instead of forking it', () => {
    const database = new Database(':memory:', { strict: true });
    database.exec(migration);
    const first = importCanonicalPilot(database, pilot);
    const changed = structuredClone(pilot);
    changed.sources[0].last_checked = '2026-07-21';
    changed.jurisdictions[0].review.note = 'Supersession regression fixture.';
    const next = buildCanonicalImportPlan(changed, first.revision_by_entity);
    applyCanonicalMutations(database, next.mutations);
    const ambiguous = database.query(
      `WITH superseded AS (
         SELECT supersedes_revision_id AS id
         FROM canonical_revisions
         WHERE supersedes_revision_id IS NOT NULL
       )
       SELECT revision.entity_id, COUNT(*) AS head_count
       FROM canonical_revisions AS revision
       LEFT JOIN superseded ON superseded.id = revision.id
       WHERE superseded.id IS NULL AND revision.review_status != 'rejected'
       GROUP BY revision.entity_id
       HAVING COUNT(*) != 1`,
    ).all();
    expect(ambiguous).toEqual([]);
    database.close();
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
    expect(projections.coverage.map(row => row.iso_n3)).toEqual([
      '008',
      '012',
      '020',
      '024',
      '028',
      '031',
      '032',
      '036',
      '040',
      '044',
      '050',
      '051',
      '052',
      '056',
      '068',
      '070',
      '072',
      '076',
      '084',
      '090',
      '096',
      '100',
      '108',
      '116',
      '120',
      '124',
      '132',
      '136',
      '140',
      '144',
      '148',
      '152',
      '156',
      '158',
      '170',
      '174',
      '178',
      '180',
      '188',
      '191',
      '192',
      '196',
      '203',
      '204',
      '208',
      '212',
      '214',
      '218',
      '222',
      '226',
      '231',
      '232',
      '233',
      '242',
      '246',
      '250',
      '262',
      '266',
      '268',
      '270',
      '276',
      '288',
      '296',
      '300',
      '308',
      '320',
      '324',
      '328',
      '332',
      '340',
      '348',
      '352',
      '356',
      '360',
      '364',
      '372',
      '376',
      '380',
      '384',
      '388',
      '392',
      '398',
      '400',
      '404',
      '410',
      '422',
      '426',
      '428',
      '430',
      '434',
      '438',
      '440',
      '442',
      '450',
      '454',
      '458',
      '466',
      '470',
      '478',
      '480',
      '484',
      '492',
      '498',
      '499',
      '504',
      '508',
      '516',
      '520',
      '524',
      '528',
      '548',
      '554',
      '558',
      '562',
      '566',
      '578',
      '583',
      '584',
      '585',
      '586',
      '591',
      '598',
      '600',
      '604',
      '608',
      '616',
      '620',
      '624',
      '626',
      '634',
      '642',
      '643',
      '646',
      '659',
      '662',
      '670',
      '678',
      '682',
      '686',
      '688',
      '690',
      '694',
      '702',
      '703',
      '704',
      '705',
      '706',
      '710',
      '716',
      '724',
      '728',
      '729',
      '740',
      '748',
      '752',
      '756',
      '764',
      '768',
      '776',
      '780',
      '784',
      '788',
      '792',
      '798',
      '800',
      '804',
      '807',
      '818',
      '826',
      '834',
      '840',
      '854',
      '858',
      '862',
      '882',
      '894',
    ])
    expect(projections.coverage.find(row => row.iso_n3 === '250')).toMatchObject({
      route_count: 3,
      route_modes: ['ancestry', 'birth', 'naturalization'],
    });
    expect(projections.mode_coverage).toHaveLength(pilot.jurisdictions.length * 4);
    expect(projections.mode_coverage.find(row =>
      row.iso_n3 === '250' && row.mode === 'naturalization')).toMatchObject({
        finding: 'present',
      review_state: 'reviewed',
        route_count: 1,
      });
    expect(projections.mode_coverage.find(row =>
      row.iso_n3 === '724' && row.mode === 'birth')).toMatchObject({
        finding: 'present',
      review_state: 'reviewed',
        route_count: 1,
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

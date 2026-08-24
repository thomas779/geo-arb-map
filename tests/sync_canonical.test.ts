import { describe, expect, test } from 'bun:test';
import {
  CANONICAL_PRIMARY_KEYS,
  desiredKeysByTable,
  planStaleDeletes,
  splitStatements,
} from '../scripts/sync_canonical_d1';

/**
 * The incremental sync stopped wiping the canonical tables, because the wipe was
 * rewriting all 15,286 rows to change however few actually differed — about
 * 96,000 of D1's 100,000 free daily writes per run. The import statements are
 * upserts and revision ids are content hashes, so unchanged rows converge for
 * free; the only thing the wipe did that upserts cannot is drop rows the master
 * no longer has. planStaleDeletes is that replacement, and it is the one part of
 * the sync that DELETES, so it is tested for what it must never do.
 */
describe('incremental sync prune', () => {
  const insert = (table: string, columns: string[], values: any[]) => ({
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `?${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`,
    values,
  });

  test('drops a row the master no longer has, and keeps the ones it does', () => {
    const current = new Map([['canonical_entities', [
      { id: 'kept', entity_type: 'jurisdiction', created_at: 'x' },
      { id: 'dropped', entity_type: 'jurisdiction', created_at: 'x' },
    ]]]);
    const desired = desiredKeysByTable([
      insert('canonical_entities', ['id', 'entity_type', 'created_at'], ['kept', 'jurisdiction', 'x']),
    ]);
    const { statements, byTable } = planStaleDeletes(current, desired);
    expect(statements).toEqual([`DELETE FROM canonical_entities WHERE id = 'dropped';`]);
    expect(byTable.get('canonical_entities')).toBe(1);
  });

  test('never prunes a table the import does not write', () => {
    // `releases` and `release_items` are populated by the release path, not the
    // canonical import. Treating "absent from the import" as "unwanted" would
    // empty them on every sync — the guard that stops that is load-bearing.
    const current = new Map([['releases', [{ id: 'r1' }, { id: 'r2' }]]]);
    const { statements } = planStaleDeletes(current, desiredKeysByTable([]));
    expect(statements).toEqual([]);
  });

  test('matches on the whole composite key, not just its first column', () => {
    const columns = ['revision_id', 'route_id'];
    const current = new Map([['route_index', [
      { revision_id: 'rev1', route_id: 'a' },
      { revision_id: 'rev1', route_id: 'b' },
    ]]]);
    const desired = desiredKeysByTable([insert('route_index', columns, ['rev1', 'a'])]);
    const { statements } = planStaleDeletes(current, desired);
    expect(statements).toEqual([`DELETE FROM route_index WHERE revision_id = 'rev1' AND route_id = 'b';`]);
  });

  test('deletes children before parents so cascades cannot strand a row', () => {
    const current = new Map<string, Record<string, unknown>[]>([
      ['canonical_entities', [{ id: 'gone' }]],
      ['evidence_links', [{ target_revision_id: 'gone', source_revision_id: 's', field_path: 'f' }]],
    ]);
    const { statements } = planStaleDeletes(current, new Map([
      ['canonical_entities', new Set<string>()],
      ['evidence_links', new Set<string>()],
    ]));
    const tables = statements.map(s => s.match(/DELETE FROM (\w+)/)![1]);
    expect(tables.indexOf('evidence_links')).toBeLessThan(tables.indexOf('canonical_entities'));
  });

  test('an unchanged corpus prunes nothing', () => {
    const row = { revision_id: 'rev1', iso_n3: '620' };
    const current = new Map([['source_jurisdictions', [row]]]);
    const desired = desiredKeysByTable([
      insert('source_jurisdictions', ['revision_id', 'iso_n3'], ['rev1', '620']),
    ]);
    expect(planStaleDeletes(current, desired).statements).toEqual([]);
  });

  test('every key is non-empty and leads with the revision, so cascades stay indexed', () => {
    for (const [table, pk] of Object.entries(CANONICAL_PRIMARY_KEYS)) {
      expect(pk.length, `${table} needs a key to delete by`).toBeGreaterThan(0);
      // The PK's own autoindex is what serves the foreign-key lookup when a
      // parent row goes; a key not led by the revision would make each cascade
      // a table scan, which is how a 5,479-row table turns into 5,479 reads.
      // The two root tables are keyed by their own id; every child must lead
      // with the revision it hangs off.
      if (table !== 'canonical_entities' && table !== 'canonical_revisions') {
        expect(pk[0], `${table} key should lead with the revision`).toMatch(/revision/);
      }
    }
  });
});

describe('sync splitStatements', () => {
  test('splits on ; but respects semicolons inside quoted literals', () => {
    expect(splitStatements("INSERT INTO t VALUES ('a;b');\nDELETE FROM t;")).toEqual([
      "INSERT INTO t VALUES ('a;b');",
      'DELETE FROM t;',
    ]);
  });

  test("skips -- line comments even when they contain ' or ;", () => {
    const sql = "-- Don't edit; generated file\nINSERT INTO t VALUES (1);";
    expect(splitStatements(sql)).toEqual(['INSERT INTO t VALUES (1);']);
  });
});

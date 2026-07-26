import { describe, expect, test } from 'bun:test';
import { splitStatements } from '../scripts/sync_canonical_d1';

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

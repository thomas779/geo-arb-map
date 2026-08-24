#!/usr/bin/env bun
/**
 * Sync the local (private) canonical dataset to the remote flag-paths-data D1,
 * via the Cloudflare D1 REST API.
 *
 * Why REST and not wrangler: after canonical-pilot.ts was privatized it is
 * gitignored, so CI (and `sync-canonical-d1.yml`) can only ever see the tiny
 * public sample — this is therefore a maintainer-LOCAL tool. It is also written
 * against the REST `/query` endpoint on purpose: a least-privilege **D1:Edit**
 * token cannot use `wrangler d1 export` or `wrangler d1 execute --remote --file`
 * (both stage through R2 and silently no-op with such a token). Inline queries
 * over REST are the only thing that works with D1:Edit alone.
 *
 * Reconcile model: converge, don't rebuild. The canonical tables are 100%
 * generated from code and the live site reads public/*.json (not D1), so a clean
 * wipe-and-reload was once the obvious way to clear drifted revision heads. It
 * was also expensive in the one unit D1's free tier bills: it rewrote all 15,286
 * rows to change however few actually differed, about 96,000 writes against a
 * 100,000/day allowance, so two syncs in a day breached the limit.
 *
 * It converges without the wipe because the import statements are upserts and
 * revision ids are content hashes: an unchanged entity produces an identical
 * primary key, so its rows are a no-op. What upserts cannot do is drop rows the
 * master no longer has, and planStaleDeletes does exactly that, diffed against
 * the pre-sync backup so it costs no extra reads. Measured on an unchanged
 * corpus: 96,000 writes -> 0.
 *
 * The wipe is still used when a schema migration is pending, because that
 * migration rebuilds a table others hold foreign keys into and is only free
 * while everything is empty.
 *
 * Usage (needs CLOUDFLARE_API_TOKEN in env, scoped Account · D1:Edit):
 *   bun run data:sync -- verify           # counts + head-ambiguity report only
 *   bun run data:sync -- plan             # dry run: what would change, reads only
 *   bun run data:sync -- backup [dir]     # dump canonical tables to JSON
 *   bun run data:sync -- sync             # backup -> converge -> prune -> verify
 *   bun run data:sync -- sync --force     # also re-send the hash-skipped groups
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalPilot, CANONICAL_SOURCE_IS_SAMPLE } from './lib/canonical-source';
import {
  buildCanonicalImportPlan,
  renderCanonicalSql,
  type CanonicalSqlMutation,
  type CanonicalSqlValue,
} from './lib/canonical-store';

const root = fileURLToPath(new URL('..', import.meta.url));

// Canonical tables (migrations 0001 + 0002). Wipe order is leaf -> root so
// foreign keys are satisfied. monitor_* tables (0003/0004) are NEVER touched.
const CANONICAL_TABLES_WIPE_ORDER = [
  'release_items', 'jurisdiction_mode_coverage', 'route_variant_index',
  'arrangement_participants', 'arrangement_pathway_index', 'evidence_links',
  'route_index', 'jurisdiction_index', 'arrangement_index', 'source_jurisdictions',
  'source_index', 'releases', 'canonical_revisions', 'canonical_entities',
] as const;

function readD1Config(): { accountId: string; databaseId: string } {
  const raw = fs.readFileSync(path.join(root, 'data/d1/wrangler.jsonc'), 'utf8');
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const config = JSON.parse(stripped);
  const db = config.d1_databases?.[0];
  if (!config.account_id || !db?.database_id) {
    throw new Error('Could not read account_id / database_id from data/d1/wrangler.jsonc');
  }
  return { accountId: config.account_id, databaseId: db.database_id };
}

const { accountId, databaseId } = readD1Config();
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

/**
 * What this run has cost, in the units D1's free tier actually bills: rows read
 * and rows written, not queries. Tracked because the limits (5,000,000 read and
 * 100,000 written per day) are enforced from 1 September 2026, and because a
 * sync that quietly costs 96,000 writes is indistinguishable from a cheap one
 * unless something counts.
 */
const usage = { rowsRead: 0, rowsWritten: 0, queries: 0 };

function reportUsage(label: string): void {
  const pct = ((usage.rowsWritten / 100_000) * 100).toFixed(1);
  console.log(
    `${label}: ${usage.queries} queries, ${usage.rowsRead.toLocaleString()} rows read, `
    + `${usage.rowsWritten.toLocaleString()} rows written (${pct}% of the free daily write limit)`,
  );
}

async function query(sql: string): Promise<any[]> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const body = await res.json() as any;
  if (!res.ok || !body.success) {
    throw new Error(`D1 query failed (${res.status}): ${JSON.stringify(body.errors ?? body)}`);
  }
  for (const result of body.result ?? []) {
    usage.queries += 1;
    usage.rowsRead += result?.meta?.rows_read ?? 0;
    usage.rowsWritten += result?.meta?.rows_written ?? 0;
  }
  return body.result[body.result.length - 1].results as any[];
}

/** Split SQL into statements, respecting single-quoted literals ('' = escaped quote). */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    // Skip `-- ...` line comments when not inside a string literal, so a comment
    // containing a quote or semicolon can't throw off the split.
    if (!inStr && c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    buf += c;
    if (inStr) {
      if (c === "'") {
        if (sql[i + 1] === "'") buf += sql[++i];
        else inStr = false;
      }
    } else if (c === "'") {
      inStr = true;
    } else if (c === ';') {
      const s = buf.trim();
      if (s && s !== ';') out.push(s);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

// Batch by BYTE size (not statement count) so a cluster of large payload inserts
// can't overflow D1's request limit, with exponential backoff + per-attempt
// logging (a silent 3x immediate retry hid the real failure).
async function runBatched(statements: string[], label: string, maxBytes = 500_000): Promise<void> {
  let done = 0;
  let index = 0;
  while (index < statements.length) {
    const chunk: string[] = [];
    let bytes = 0;
    while (index < statements.length && (chunk.length === 0 || bytes + statements[index].length + 1 <= maxBytes)) {
      chunk.push(statements[index]);
      bytes += statements[index].length + 1;
      index += 1;
    }
    const sql = chunk.map(s => (s.endsWith(';') ? s : `${s};`)).join('\n');
    for (let attempt = 1; ; attempt++) {
      try { await query(sql); break; }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= 4) throw new Error(`${label} batch @${done} (${chunk.length} stmts, ${bytes}B) failed after ${attempt} attempts: ${message}`);
        const wait = 500 * 2 ** (attempt - 1);
        console.warn(`${label} batch @${done} attempt ${attempt} failed, retrying in ${wait}ms: ${message}`);
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
    done += chunk.length;
    console.log(`${label}: ${done}/${statements.length}`);
  }
}

/**
 * Primary key of every table the canonical import writes, read off the live
 * schema with PRAGMA table_info and pinned here so the diff does not spend a
 * round trip per table discovering what it already knows. `syncPrimaryKeys` in
 * tests/sync_canonical.test.ts re-derives these from the migrations, so a schema
 * change that moves a key fails there rather than silently mis-deleting.
 *
 * Every one of these keys leads with `revision_id` (or IS the revision id), which
 * is why the cascade deletes below are cheap: the PK's own autoindex serves the
 * foreign-key lookup, so no separate FK index is needed.
 */
export const CANONICAL_PRIMARY_KEYS: Record<string, readonly string[]> = {
  canonical_entities: ['id'],
  canonical_revisions: ['id'],
  source_index: ['revision_id'],
  source_jurisdictions: ['revision_id', 'iso_n3'],
  jurisdiction_index: ['revision_id'],
  jurisdiction_mode_coverage: ['revision_id', 'mode'],
  route_index: ['revision_id', 'route_id'],
  route_variant_index: ['revision_id', 'route_id', 'variant_id'],
  arrangement_index: ['revision_id'],
  arrangement_participants: ['revision_id', 'role', 'iso_n3'],
  arrangement_pathway_index: ['revision_id', 'pathway_id'],
  evidence_links: ['target_revision_id', 'source_revision_id', 'field_path'],
};

/** `INSERT INTO t (a, b) VALUES (?1, ?2) ON CONFLICT ...` -> table and columns. */
function parseInsertTarget(sql: string): { table: string; columns: string[] } | null {
  const match = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([a-z_]+)\s*\(([^)]+)\)/i);
  if (!match) return null;
  return {
    table: match[1],
    columns: match[2].split(',').map(column => column.trim()),
  };
}

/** Stable text form of a primary key tuple, for set membership. */
function keyOf(row: Record<string, unknown>, columns: readonly string[]): string {
  return JSON.stringify(columns.map(column => {
    const value = row[column];
    return value === undefined || value === null ? null : String(value);
  }));
}

/**
 * The primary keys the fresh import intends each table to hold.
 *
 * Read off the mutations rather than the database: the import is the definition
 * of what should be there, and asking D1 what it currently holds is what the
 * pre-sync backup already did.
 */
export function desiredKeysByTable(mutations: CanonicalSqlMutation[]): Map<string, Set<string>> {
  const desired = new Map<string, Set<string>>();
  for (const mutation of mutations) {
    const target = parseInsertTarget(mutation.sql);
    if (!target) continue;
    const pk = CANONICAL_PRIMARY_KEYS[target.table];
    if (!pk) continue;
    const row: Record<string, unknown> = {};
    target.columns.forEach((column, position) => { row[column] = mutation.values[position]; });
    const keys = desired.get(target.table) ?? new Set<string>();
    keys.add(keyOf(row, pk));
    desired.set(target.table, keys);
  }
  return desired;
}

/**
 * Rows the remote holds that the fresh import does not intend to hold.
 *
 * This is what the DELETE-everything wipe used to accomplish, and it is the only
 * part of the wipe that was ever load-bearing. The import statements are all
 * upserts (DO UPDATE behind a content guard, or DO NOTHING) and revision ids are
 * content hashes, so re-importing unchanged data writes nothing at all — the
 * wipe was making D1 rewrite all 15,286 rows to change four of them, at roughly
 * 96,000 billed writes against a 100,000/day allowance.
 *
 * Superseded revisions are NOT stale: 233 rows carry supersedes_revision_id and
 * the import emits them deliberately. Only rows absent from the import go.
 */
export function planStaleDeletes(
  current: Map<string, Record<string, unknown>[]>,
  desired: Map<string, Set<string>>,
): { statements: string[]; byTable: Map<string, number> } {
  const statements: string[] = [];
  const byTable = new Map<string, number>();
  // Child tables first: the wipe order already encodes the dependency direction.
  for (const table of CANONICAL_TABLES_WIPE_ORDER) {
    const pk = CANONICAL_PRIMARY_KEYS[table];
    const rows = current.get(table);
    if (!pk || !rows) continue;
    const keys = desired.get(table);
    // A table the import does not write at all is not evidence that its rows are
    // unwanted — deleting on that basis would empty it. Skip instead.
    if (!keys) continue;
    const stale = rows.filter(row => !keys.has(keyOf(row, pk)));
    if (!stale.length) continue;
    byTable.set(table, stale.length);
    for (const row of stale) {
      const where = pk
        .map(column => `${column} = ${sqlValue(row[column] as CanonicalSqlValue)}`)
        .join(' AND ');
      statements.push(`DELETE FROM ${table} WHERE ${where};`);
    }
  }
  return { statements, byTable };
}

/**
 * The licence and reference sections replace whole self-contained table groups:
 * DELETE every row, then INSERT the generated set. Those inserts are not upserts,
 * so the canonical path's trick does not apply — but the groups are 100%
 * generated from code, so if the SQL we are about to send is byte-identical to
 * the SQL that produced the current contents, running it can only reproduce what
 * is already there. Skipping is then exactly equivalent, and free.
 *
 * This is the remaining ~15,000 writes of an otherwise no-op sync.
 *
 * The escape hatch is `--force`: the hash describes what this tool last wrote, so
 * a row changed by hand underneath it would not be noticed. Nothing edits these
 * tables by hand today, and `verify` still counts them afterwards.
 */
async function ensureGroupStateTable(): Promise<void> {
  await query(
    `CREATE TABLE IF NOT EXISTS sync_group_state (
       group_name TEXT PRIMARY KEY,
       content_hash TEXT NOT NULL,
       synced_at TEXT NOT NULL
     );`,
  );
}

async function runGroupIfChanged(
  group: string,
  statements: string[],
  force: boolean,
): Promise<void> {
  const hash = createHash('sha256').update(statements.join('\n')).digest('hex');
  if (!force) {
    const stored = await query(
      `SELECT content_hash FROM sync_group_state WHERE group_name = ${sqlValue(group)};`,
    );
    if (stored[0]?.content_hash === hash) {
      console.log(`  ${group} unchanged — skipping ${statements.length} statements`);
      return;
    }
  }
  console.log(`  ${statements.length} statements`);
  await runBatched(statements, group);
  await query(
    `INSERT INTO sync_group_state (group_name, content_hash, synced_at)
     VALUES (${sqlValue(group)}, ${sqlValue(hash)}, ${sqlValue(new Date().toISOString())})
     ON CONFLICT(group_name) DO UPDATE SET
       content_hash = excluded.content_hash, synced_at = excluded.synced_at;`,
  );
}

function requireRealMaster(): void {
  const count = buildCanonicalPilot().jurisdictions.length;
  if (CANONICAL_SOURCE_IS_SAMPLE || count < 100) {
    throw new Error(
      `Refusing to sync: only ${count} jurisdictions resolved (the public sample, not the `
      + 'private master). The real scripts/lib/canonical-pilot.ts must be present.',
    );
  }
  console.log(`resolved canonical: ${count} jurisdictions`);
}

/**
 * Page by rowid cursor, not OFFSET.
 *
 * `OFFSET n` does not skip cheaply — SQLite steps over all n rows and D1 bills
 * every one as read. Paging a table of N rows at page size P therefore costs
 * ~N²/2P reads instead of N: measured against the live database, backing up the
 * 14 canonical tables read 48,000 rows to return 12,632. A rowid cursor makes it
 * exactly one read per row, and matters because D1's free tier bills reads.
 *
 * The cursor column is stripped so the backup JSON keeps the shape a restore
 * expects — the point of this backup is to be replayable, not to gain a column.
 */
async function dumpTable(table: string, pageSize = 500): Promise<any[]> {
  const rows: any[] = [];
  let after = 0;
  for (;;) {
    const page = await query(
      `SELECT rowid AS _cursor, * FROM ${table} WHERE rowid > ${after} `
      + `ORDER BY rowid LIMIT ${pageSize};`,
    );
    if (!page.length) break;
    after = page[page.length - 1]._cursor;
    for (const row of page) {
      delete row._cursor;
      rows.push(row);
    }
    if (page.length < pageSize) break;
  }
  return rows;
}

/**
 * Returns the rows as well as writing them, so the incremental path can diff
 * against what the remote actually holds without reading it a second time. The
 * pre-sync backup is already a complete, consistent snapshot; re-querying for the
 * diff would double the read cost to learn nothing new.
 */
async function backup(dir: string): Promise<{
  total: number;
  rows: Map<string, Record<string, unknown>[]>;
}> {
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  const byTable = new Map<string, Record<string, unknown>[]>();
  for (const table of CANONICAL_TABLES_WIPE_ORDER) {
    const rows = await dumpTable(table);
    fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows));
    byTable.set(table, rows);
    total += rows.length;
    console.log(`  ${table.padEnd(30)} rows=${rows.length}`);
  }
  console.log(`backup: ${total} rows -> ${dir}`);
  return { total, rows: byTable };
}

/**
 * Apply pending schema migrations to the remote database.
 *
 * The import path only ever writes ROWS: it wipes the canonical tables and
 * re-inserts them, and never touches DDL. So a migration that changes a table
 * definition (as 0006 does, widening `display_strength` from a 0-1 real to a 0-3
 * integer tier) never reaches D1 on its own, and the next sync fails mid-write
 * against a CHECK constraint the local build has already moved past.
 *
 * Called between the wipe and the import, which is the one moment the canonical
 * tables are EMPTY. That matters: 0006 rebuilds arrangement_index, and
 * arrangement_participants / arrangement_pathway_index carry foreign keys into
 * it. With no rows anywhere there is nothing to cascade and nothing to copy, so
 * the rebuild needs no PRAGMA foreign_keys juggling — which is just as well,
 * since the D1 REST endpoint rejects those PRAGMAs.
 *
 * Idempotent by inspection: it reads the live DDL and returns early once the
 * table has been migrated, so a repeated sync is a no-op.
 */
/**
 * Is a schema migration outstanding?
 *
 * The incremental path leaves the canonical tables populated, and the migration
 * below rebuilds a table that others hold foreign keys into — which is only free
 * while everything is empty. So when a migration is pending the sync falls back
 * to the wipe-and-reload path, preserving the invariant this file has always
 * relied on. Pending migrations are rare; full-cost syncs stay rare with them.
 */
async function schemaMigrationPending(): Promise<boolean> {
  const master = await query(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'arrangement_index';",
  );
  const ddl = String(master[0]?.sql ?? '');
  if (!ddl) throw new Error('arrangement_index is missing from the remote database');
  return !/display_strength\s+INTEGER/i.test(ddl);
}

async function migrateRemoteSchema(): Promise<void> {
  if (!await schemaMigrationPending()) {
    console.log('  schema up to date (arrangement_index.display_strength is an integer tier)');
    return;
  }
  const file = path.join(root, 'data/d1/migrations/0006_arrangement_strength_tier.sql');
  // Strip PRAGMAs: the file carries them for the local bun:sqlite build, where
  // the table can be populated. Here it is empty, and D1 rejects them anyway.
  const statements = splitStatements(fs.readFileSync(file, 'utf8'))
    .filter(statement => !/^\s*PRAGMA\b/i.test(statement));
  console.log(`  applying 0006_arrangement_strength_tier (${statements.length} statements)`);
  await runBatched(statements, 'migrate');
}

/**
 * Create the licence-exchange tables if they are absent, then bring an EXISTING one
 * up to the current shape.
 *
 * The first half is pure CREATE IF NOT EXISTS (0007) and converges on every sync.
 * The second half exists because that is exactly what CREATE IF NOT EXISTS cannot
 * do: 0007 is already applied to the live database, so a column added to it would
 * never arrive, and the next sync would fail mid-write inserting `nationality_gate`
 * into a table that has no such column. 0010 is therefore applied by inspection —
 * read the live DDL, run it only when the new shape is absent — which is the same
 * shape as migrateRemoteSchema and equally idempotent.
 *
 * The tables are standalone (the monitor_* pattern), so they carry no foreign keys
 * into the canonical model and are safe to touch whether or not the canonical tables
 * are populated.
 */
async function ensureLicenceSchema(): Promise<void> {
  const file = path.join(root, 'data/d1/migrations/0007_licence_exchange.sql');
  const statements = splitStatements(fs.readFileSync(file, 'utf8'))
    .filter(statement => !/^\s*PRAGMA\b/i.test(statement));
  await runBatched(statements, 'licence-ddl');

  const master = await query(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' "
    + "AND name IN ('licence_exchange_index', 'licence_agreement_index');",
  );
  const ddl = (name: string) =>
    String(master.find(row => row.name === name)?.sql ?? '');
  const hasGate = /nationality_gate/i.test(ddl('licence_exchange_index'));
  const hasNotEstablished = /not_established/i.test(ddl('licence_agreement_index'));
  const hasSubnationalDestination =
    /destination_subnational_label/i.test(ddl('licence_exchange_index'));
  if (hasGate && hasNotEstablished && hasSubnationalDestination) {
    console.log('  licence schema up to date (nationality_gate + grants not_established'
      + ' + sub-national destinations)');
    return;
  }
  // Applied in order and by inspection, each one only when its shape is absent: 0011
  // rebuilds the table 0010 altered, so running them the other way round would drop
  // the columns 0010 had just added.
  const pending: Array<[string, boolean]> = [
    ['0010_licence_nationality_gate.sql', hasGate && hasNotEstablished],
    ['0011_licence_subnational_destination.sql', hasSubnationalDestination],
  ];
  for (const [name, applied] of pending) {
    if (applied) continue;
    const upgrade = splitStatements(
      fs.readFileSync(path.join(root, 'data/d1/migrations', name), 'utf8'),
    ).filter(statement => !/^\s*PRAGMA\b/i.test(statement));
    console.log(`  applying ${name.replace(/\.sql$/, '')} (${upgrade.length} statements)`);
    await runBatched(upgrade, 'licence-migrate');
  }
}

/**
 * Rows for the licence layer, rendered from the corpus.
 *
 * data/compiled/licence_exchange.json stays the source of truth — it is
 * version-controlled, and since #210 it is a BUILD INPUT rather than a served file:
 * the site is served an index plus one slice per origin, emitted from this same
 * corpus by scripts/build_country_pages.ts. These tables are its indexed projection,
 * so "which agreements cover Paraguay", "which lists are gated on nationality" and
 * "which states hold a bilateral agreement with anyone" are queries rather than a
 * scan of every slice.
 *
 * Exported so tests/licence_exchange.test.ts can execute it against a real in-memory
 * SQLite and assert the row and gate counts match the corpus. A count below the
 * source is a silent drop, which is the class of defect this render must not have.
 */
export function renderLicenceSql(): string[] {
  const data = JSON.parse(
    fs.readFileSync(path.join(root, 'data/compiled/licence_exchange.json'), 'utf8'),
  ) as {
    agreements?: Array<Record<string, unknown>>;
    destinations: Array<Record<string, unknown>>;
  };
  const q = (value: unknown): string => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number') return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
  };
  const out: string[] = [
    'DELETE FROM licence_exchange_index;',
    'DELETE FROM licence_agreement_participants;',
    'DELETE FROM licence_agreement_index;',
  ];
  for (const a of data.agreements ?? []) {
    out.push(
      'INSERT INTO licence_agreement_index (agreement_id, name, kind, directionality, instrument, source_url, grants, basis, kind_verified, superseded_from) VALUES ('
      + [a.id, a.name, a.kind, a.directionality, a.instrument, a.source_url, a.grants ?? null,
        a.basis ?? null, a.kind_verified ? 1 : 0, a.superseded_from ?? null].map(q).join(', ')
      + ');',
    );
    for (const [role, key] of [['destination', 'destinations'], ['beneficiary', 'beneficiaries']] as const) {
      for (const iso of (a[key] as string[] | undefined) ?? []) {
        out.push(`INSERT OR IGNORE INTO licence_agreement_participants (agreement_id, iso_n3, role) VALUES (${q(a.id)}, ${q(iso)}, ${q(role)});`);
      }
    }
  }
  for (const dest of data.destinations) {
    for (const e of (dest.entries as Array<Record<string, unknown>>) ?? []) {
      // subnational_label is carried in the JSON only where it DIFFERS from the English
      // label — the same deduplication origin_label already gets, and worth ~3.6KB of a
      // 200KB public surface. The projection must not lose the marker to that, so it
      // falls back the way every reader of this field already does (listOrigins,
      // entryMatchesKey, public/licence-exchange.js). Also keeps the natural key on
      // licence_exchange_index stable: it COALESCEs this column.
      const subnationalLabel = e.subnational_label
        ?? (e.subnational ? e.origin_label_en : null);
      // The two windows are RESOLVED here (entry value, else the destination's)
      // because the projection is entry-level and Italy's deadline varies by origin.
      // `?? null` throughout: an absent field is NOT RECORDED, never a zero and never
      // an "open to all" — which is the whole point of nationality_gate being NULL on
      // the 44 destinations that publish no nationality rule.
      const deadline = e.exchange_deadline_months ?? dest.exchange_deadline_months ?? null;
      const grace = e.foreign_licence_grace_months ?? dest.foreign_licence_grace_months ?? null;
      out.push(
        'INSERT INTO licence_exchange_index (destination_iso_n3, destination_subnational_label, agreement_id, origin_iso_n3, subnational_label, origin_label_en, classes, theory_test_required, practical_test_required, nationality_gate, exchange_deadline_months, foreign_licence_grace_months) VALUES ('
        // A sub-national destination writes NULL here and its own name in the next
        // column. Substituting the parent federation's ISO would answer "which states
        // grant an exchange" with "Canada" and "the United States", which is the
        // arrangement that does not exist.
        + [dest.iso_n3 ?? null, dest.subnational_label ?? null,
          dest.agreement_id ?? null, e.origin_iso_n3 ?? null, subnationalLabel,
          e.origin_label_en, e.classes ?? null, e.theory_test_required ?? null, e.practical_test_required ?? null,
          e.nationality_gate ?? null, deadline, grace].map(q).join(', ')
        + ');',
      );
    }
  }
  return out;
}

/**
 * Create the reference-data tables if they are absent.
 *
 * Same shape as ensureLicenceSchema and for the same reason: pure CREATE IF NOT
 * EXISTS with no table rebuild, so it converges on every sync. The tables are
 * standalone (the monitor_* pattern) and carry no foreign keys into the canonical
 * model, so they are safe to create whether or not the canonical tables hold rows.
 */
async function ensureReferenceSchema(): Promise<void> {
  const file = path.join(root, 'data/d1/migrations/0008_reference_data.sql');
  const statements = splitStatements(fs.readFileSync(file, 'utf8'))
    .filter(statement => !/^\s*PRAGMA\b/i.test(statement));
  await runBatched(statements, 'reference-ddl');
}

/** SQL literal. Escapes single quotes; NULL means NOT RECORDED, never a default. */
function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** JSON payload literal, or NULL when there is nothing to record. */
function sqlJson(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  return sqlValue(JSON.stringify(value));
}

/**
 * Rows for the reference layer, rendered from the three files that had no D1
 * representation at all: public/blocs_data.json, data/registry.json and
 * monitor/sources/manifest.json.
 *
 * The files stay the source of truth — they are version-controlled and the browser
 * fetches blocs_data.json directly. These tables are their durable, queryable
 * projection, so that "which blocs still list Mali" or "which jurisdictions have no
 * verification-tier source" stop being scans of an 85KB / 199KB blob.
 *
 * Exported so tests/reference_data.test.ts can execute this against a real in-memory
 * SQLite and assert the row counts match the files. A count below the source is a
 * silent drop, which is the class of defect this render must not have.
 */
export function renderReferenceDataSql(): string[] {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const blocs = read('public/blocs_data.json') as {
    blocs: Array<Record<string, any>>;
    bilateral_lanes: Array<Record<string, any>>;
    stacking_plays: Array<Record<string, any>>;
    pending_verification: Array<Record<string, any>>;
    generational_events: Array<Record<string, any>>;
    // Conflict-of-laws treaties only since #144. The per-country policy map that
    // used to sit here was a rival model of the canonical `dual_nationality`
    // field on its own enum; it was migrated into the canonical corpus and the
    // `dual_nationality_policy` mirror dropped in migration 0009.
    dual_citizenship: {
      treaty_exceptions: Array<Record<string, any>>;
    };
  };
  const registry = read('data/registry.json') as {
    sovereigns: Array<Record<string, any>>;
    territories: Array<Record<string, any>>;
    special: Array<Record<string, any>>;
  };
  const manifest = read('monitor/sources/manifest.json') as {
    sources: Array<Record<string, any>>;
  };

  const q = sqlValue;
  const insert = (table: string, columns: string[], values: unknown[][]): string[] =>
    values.map(row => `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${row.join(', ')});`);

  // Children before parents, so the deletes stand up under D1's foreign keys.
  const out: string[] = [
    'DELETE FROM bloc_members;',
    'DELETE FROM bloc_rights;',
    'DELETE FROM bloc_index;',
    'DELETE FROM bilateral_lane_beneficiaries;',
    'DELETE FROM bilateral_lane_index;',
    'DELETE FROM dual_nationality_treaty_parties;',
    'DELETE FROM dual_nationality_treaty_exception;',
    'DELETE FROM jurisdiction_registry;',
    'DELETE FROM monitor_source_jurisdictions;',
    'DELETE FROM monitor_source_manifest;',
    'DELETE FROM stacking_play_index;',
    'DELETE FROM generational_event_index;',
    'DELETE FROM pending_verification_index;',
  ];

  for (const bloc of blocs.blocs) {
    out.push(...insert(
      'bloc_index',
      ['id', 'name', 'category', 'strength', 'color', 'fastest_entry', 'notes', 'sub_bloc'],
      [[q(bloc.id), q(bloc.name), q(bloc.category), q(bloc.strength), q(bloc.color),
        q(bloc.fastest_entry ?? null), q(bloc.notes ?? null), sqlJson(bloc.sub_bloc ?? null)]],
    ));
    for (const tier of ['TR', 'PR', 'CIT'] as const) {
      const text = bloc.rights?.[tier];
      if (text === undefined || text === null) continue;
      out.push(...insert('bloc_rights', ['bloc_id', 'tier', 'text'],
        [[q(bloc.id), q(tier), q(text)]]));
    }
    // `former` is derived from WHICH array the entry came from, so it is never
    // unknown — see the column comment in 0008. ECOWAS keeps three withdrawn
    // members here and flattening the arrays would readmit them.
    for (const [members, former] of [[bloc.members, 0], [bloc.former_members, 1]] as const) {
      for (const member of (members as Array<Record<string, any>> | undefined) ?? []) {
        out.push(...insert('bloc_members', ['bloc_id', 'iso_n3', 'name', 'former'],
          [[q(bloc.id), q(member.iso_n3), q(member.name), q(former)]]));
      }
    }
  }

  for (const lane of blocs.bilateral_lanes) {
    out.push(...insert(
      'bilateral_lane_index',
      ['id', 'name', 'color', 'destination_iso_n3', 'destination_name', 'grants', 'limits',
        'leads_to_settlement', 'allocation', 'beneficiaries_note', 'confidence', 'volatility',
        'renounces_previous', 'sources'],
      [[q(lane.id), q(lane.name), q(lane.color), q(lane.destination.iso_n3),
        q(lane.destination.name), q(lane.grants), q(lane.limits), q(lane.leads_to_settlement),
        q(lane.allocation ?? null), q(lane.beneficiaries_note ?? null), q(lane.confidence ?? null),
        q(lane.volatility ?? null), q(lane.renounces_previous ?? null), sqlJson(lane.sources ?? null)]],
    ));
    for (const beneficiary of lane.beneficiaries ?? []) {
      out.push(...insert('bilateral_lane_beneficiaries', ['lane_id', 'iso_n3', 'name'],
        [[q(lane.id), q(beneficiary.iso_n3), q(beneficiary.name)]]));
    }
  }

  // No per-country plurality rows here any more. #144 resolved the divergence this
  // mirror existed to record: the 25 rows moved into the canonical
  // `dual_nationality` field, `banned` became `prohibited`, and the product reads
  // the canonical projection. The treaty exceptions below are a different fact —
  // conflict-of-laws treatment between two named states — and have no canonical
  // home yet, so they stay.
  for (const exception of blocs.dual_citizenship.treaty_exceptions) {
    out.push(...insert(
      'dual_nationality_treaty_exception',
      ['id', 'name', 'effect', 'status', 'confidence', 'last_checked', 'sources'],
      [[q(exception.id), q(exception.name), q(exception.effect), q(exception.status),
        q(exception.confidence ?? null), q(exception.last_checked ?? null),
        sqlJson(exception.sources ?? null)]],
    ));
    for (const party of exception.parties ?? []) {
      out.push(...insert('dual_nationality_treaty_parties', ['exception_id', 'iso_n3', 'name'],
        [[q(exception.id), q(party.iso_n3), q(party.name)]]));
    }
  }

  // `special` entries key on `id`, not `iso_n3` — Kosovo has no M49 numeric code at
  // all and is carried as 'XKX'. Reading iso_n3 blindly would drop both rows.
  for (const [key, entries] of [
    ['sovereign', registry.sovereigns], ['territory', registry.territories],
    ['special', registry.special],
  ] as const) {
    for (const entry of entries) {
      out.push(...insert('jurisdiction_registry', ['iso_n3', 'name', 'class', 'note'],
        [[q(entry.iso_n3 ?? entry.id), q(entry.name), q(key), q(entry.note ?? null)]]));
    }
  }

  for (const source of manifest.sources) {
    out.push(...insert(
      'monitor_source_manifest', ['id', 'tier', 'adapter', 'status', 'url', 'notes'],
      [[q(source.id), q(source.tier), q(source.adapter), q(source.status),
        q(source.url ?? null), q(source.notes ?? null)]],
    ));
    for (const jurisdiction of source.jurisdictions ?? []) {
      out.push(...insert('monitor_source_jurisdictions', ['source_id', 'jurisdiction'],
        [[q(source.id), q(jurisdiction)]]));
    }
  }

  for (const play of blocs.stacking_plays) {
    // No id in the file; `passport` is its only identifier, and it is not always a
    // country ('Falklands-born', 'Dominica (CBI)').
    out.push(...insert('stacking_play_index', ['passport', 'timeline', 'payload'],
      [[q(play.passport), q(play.timeline), sqlJson({ blocs: play.blocs, footprint: play.footprint })]]));
  }

  for (const event of blocs.generational_events) {
    out.push(...insert(
      'generational_event_index', ['id', 'country_iso_n3', 'country_name', 'payload'],
      [[q(event.id), q(event.country.iso_n3), q(event.country.name),
        sqlJson({ child: event.child, parent: event.parent, sources: event.sources })]],
    ));
  }

  for (const pending of blocs.pending_verification) {
    out.push(...insert(
      'pending_verification_index', ['id', 'name', 'confidence', 'volatility', 'payload'],
      [[q(pending.id), q(pending.name), q(pending.confidence ?? null), q(pending.volatility ?? null),
        sqlJson({ proposed_shape: pending.proposed_shape, reason: pending.reason, sources: pending.sources })]],
    ));
  }

  return out;
}

async function verify(): Promise<void> {
  const counts = (await query(
    `SELECT (SELECT COUNT(*) FROM canonical_entities) AS entities,
            (SELECT COUNT(*) FROM canonical_revisions) AS revisions,
            (SELECT COUNT(*) FROM evidence_links) AS evidence,
            (SELECT COUNT(*) FROM route_index) AS routes,
            (SELECT COUNT(*) FROM licence_agreement_index) AS licence_agreements,
            (SELECT COUNT(*) FROM licence_exchange_index) AS licence_rows,
            (SELECT COUNT(*) FROM bloc_index) AS blocs,
            (SELECT COUNT(*) FROM bilateral_lane_index) AS bilateral_lanes,
            (SELECT COUNT(*) FROM dual_nationality_treaty_exception) AS dual_nationality_treaties,
            (SELECT COUNT(*) FROM jurisdiction_registry) AS registry,
            (SELECT COUNT(*) FROM monitor_source_manifest) AS monitor_sources,
            (SELECT COUNT(*) FROM monitor_pages) AS monitor_pages,
            (SELECT COUNT(*) FROM monitor_posts) AS monitor_posts;`,
  ))[0];
  console.log('remote counts:', JSON.stringify(counts));
  const ambiguous = await query(
    `WITH superseded AS (
       SELECT supersedes_revision_id AS id FROM canonical_revisions WHERE supersedes_revision_id IS NOT NULL
     )
     SELECT r.entity_id, COUNT(*) AS heads
     FROM canonical_revisions r LEFT JOIN superseded s ON s.id = r.id
     WHERE s.id IS NULL AND r.review_status != 'rejected'
     GROUP BY r.entity_id HAVING COUNT(*) != 1;`,
  );
  if (ambiguous.length) {
    console.error(`FAIL: ${ambiguous.length} entities with ambiguous heads`, ambiguous.slice(0, 10));
    process.exit(1);
  }
  console.log('OK: every entity resolves to exactly one head');
}

if (import.meta.main) {
const argv = process.argv.slice(2);
// --force reruns the hashed groups even when their generated SQL is unchanged.
const forceGroups = argv.includes('--force');
const [cmd, arg] = argv.filter(a => a !== '--force');
const stamp = new Date().toISOString().replace(/[:.]/g, '').replace(/-/g, '');

if (cmd === 'verify') {
  await verify();
} else if (cmd === 'plan') {
  // Dry run: what would an incremental sync change? Reads only, writes nothing.
  // Exists because the prune deletes rows, and a destructive path deserves to be
  // inspectable before it runs rather than explained afterwards.
  requireRealMaster();
  const dir = path.join(root, '.generated/data-canonical/backups', `plan-${stamp}`);
  const { rows: currentRows } = await backup(dir);
  const plan = buildCanonicalImportPlan(buildCanonicalPilot());
  const desired = desiredKeysByTable(plan.mutations);
  const { statements: deletes, byTable } = planStaleDeletes(currentRows, desired);
  console.log('\n== would prune ==');
  if (!deletes.length) console.log('  nothing — every remote row is still in the master');
  for (const [table, count] of byTable) console.log(`  ${table.padEnd(30)} -${count}`);
  console.log('\n== coverage check (a table missing from the import is never pruned) ==');
  for (const table of CANONICAL_TABLES_WIPE_ORDER) {
    const held = currentRows.get(table)?.length ?? 0;
    const wanted = desired.get(table)?.size ?? null;
    const state = wanted === null ? 'not written by import — SKIPPED' : `import intends ${wanted}`;
    console.log(`  ${table.padEnd(30)} remote ${String(held).padStart(5)}  ${state}`);
  }
  console.log(`\nsample deletes:\n${deletes.slice(0, 5).map(s => `  ${s}`).join('\n') || '  (none)'}`);
  reportUsage('\nd1 cost of this dry run');
} else if (cmd === 'backup') {
  const dir = arg ?? path.join(root, '.generated/data-canonical/backups', `canonical-${stamp}`);
  const { total } = await backup(dir);
  if (total === 0) { console.error('FAIL: backup is empty'); process.exit(1); }
} else if (cmd === 'sync') {
  requireRealMaster();
  const backupDir = path.join(root, '.generated/data-canonical/backups', `canonical-${stamp}`);
  console.log('== 1. backup ==');
  const { total, rows: currentRows } = await backup(backupDir);
  if (total === 0) { console.error('FAIL: pre-sync backup empty, aborting before any write'); process.exit(1); }
  console.log('== 2. generate fresh import ==');
  const plan = buildCanonicalImportPlan(buildCanonicalPilot());
  const sql = renderCanonicalSql(plan.mutations);
  const statements = splitStatements(sql);
  console.log(`  ${statements.length} statements`);
  // Only wipe when a migration needs empty tables. Otherwise the import's own
  // upserts converge the rows and the wipe is pure cost: it rewrites every row
  // in the corpus to change however few actually differ, which is what put a
  // single sync at ~96,000 of D1's 100,000 free daily writes.
  const mustWipe = await schemaMigrationPending();
  try {
    if (mustWipe) {
      console.log('== 3. schema migration pending — wipe canonical tables (monitor_* untouched) ==');
      await runBatched(CANONICAL_TABLES_WIPE_ORDER.map(t => `DELETE FROM ${t};`), 'wipe');
      // Between wipe and import on purpose — see migrateRemoteSchema. DDL never
      // reaches D1 through the row import, so without this a schema change lands
      // locally and then fails the next sync against the stale remote constraint.
      console.log('== 4. schema migrations ==');
      await migrateRemoteSchema();
    } else {
      console.log('== 3. incremental: no wipe, upserts converge the rows ==');
    }
    console.log('== 5. import ==');
    await runBatched(statements, 'import');
    if (!mustWipe) {
      // The one thing the wipe did that upserts cannot: drop rows the master no
      // longer has. Computed against the pre-sync snapshot, so it costs no reads.
      console.log('== 5a. remove rows the master dropped ==');
      const { statements: deletes, byTable } = planStaleDeletes(currentRows, desiredKeysByTable(plan.mutations));
      if (!deletes.length) {
        console.log('  nothing to remove');
      } else {
        for (const [table, count] of byTable) console.log(`  ${table.padEnd(30)} -${count}`);
        await runBatched(deletes, 'prune');
      }
    }
    await ensureGroupStateTable();
    console.log('== 5b. licence exchange ==');
    await ensureLicenceSchema();
    await runGroupIfChanged('licence', renderLicenceSql(), forceGroups);
    console.log('== 5c. reference data ==');
    await ensureReferenceSchema();
    await runGroupIfChanged('reference', renderReferenceDataSql(), forceGroups);
  } catch (error) {
    console.error('\n!! sync FAILED mid-write — remote canonical tables may be PARTIAL.');
    console.error('   Recover: re-run `bun run data:sync -- sync` (imports are idempotent upserts and converge),');
    console.error(`   or restore from the pre-wipe backup at ${backupDir}`);
    throw error;
  }
  console.log('== 6. verify ==');
  await verify();
  reportUsage('d1 cost');
  console.log(`sync complete. backup kept at ${backupDir}`);
} else {
  console.log('Usage: bun run data:sync -- <plan|verify|backup [dir]|sync>');
  process.exit(1);
}
}

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
 * Reconcile model: a clean rebuild. The canonical tables are 100% generated from
 * code, and the live site reads public/*.json (not D1), so the safest way to
 * clear drifted/ambiguous revision heads is backup -> wipe canonical tables
 * (monitor_* untouched) -> fresh import -> verify.
 *
 * Usage (needs CLOUDFLARE_API_TOKEN in env, scoped Account · D1:Edit):
 *   bun run data:sync -- verify           # counts + head-ambiguity report only
 *   bun run data:sync -- backup [dir]     # dump canonical tables to JSON
 *   bun run data:sync -- sync             # backup -> wipe -> migrate -> import -> verify
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalPilot, CANONICAL_SOURCE_IS_SAMPLE } from './lib/canonical-source';
import { buildCanonicalImportPlan, renderCanonicalSql } from './lib/canonical-store';

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

async function dumpTable(table: string, pageSize = 500): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await query(`SELECT * FROM ${table} ORDER BY rowid LIMIT ${pageSize} OFFSET ${offset};`);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function backup(dir: string): Promise<number> {
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const table of CANONICAL_TABLES_WIPE_ORDER) {
    const rows = await dumpTable(table);
    fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows));
    total += rows.length;
    console.log(`  ${table.padEnd(30)} rows=${rows.length}`);
  }
  console.log(`backup: ${total} rows -> ${dir}`);
  return total;
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
async function migrateRemoteSchema(): Promise<void> {
  const master = await query(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'arrangement_index';",
  );
  const ddl = String(master[0]?.sql ?? '');
  if (!ddl) throw new Error('arrangement_index is missing from the remote database');
  if (/display_strength\s+INTEGER/i.test(ddl)) {
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

async function verify(): Promise<void> {
  const counts = (await query(
    `SELECT (SELECT COUNT(*) FROM canonical_entities) AS entities,
            (SELECT COUNT(*) FROM canonical_revisions) AS revisions,
            (SELECT COUNT(*) FROM evidence_links) AS evidence,
            (SELECT COUNT(*) FROM route_index) AS routes,
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
const [cmd, arg] = process.argv.slice(2);
const stamp = new Date().toISOString().replace(/[:.]/g, '').replace(/-/g, '');

if (cmd === 'verify') {
  await verify();
} else if (cmd === 'backup') {
  const dir = arg ?? path.join(root, '.generated/data-canonical/backups', `canonical-${stamp}`);
  const total = await backup(dir);
  if (total === 0) { console.error('FAIL: backup is empty'); process.exit(1); }
} else if (cmd === 'sync') {
  requireRealMaster();
  const backupDir = path.join(root, '.generated/data-canonical/backups', `canonical-${stamp}`);
  console.log('== 1. backup ==');
  const total = await backup(backupDir);
  if (total === 0) { console.error('FAIL: pre-sync backup empty, aborting before any write'); process.exit(1); }
  console.log('== 2. generate fresh import ==');
  const sql = renderCanonicalSql(buildCanonicalImportPlan(buildCanonicalPilot()).mutations);
  const statements = splitStatements(sql);
  console.log(`  ${statements.length} statements`);
  console.log('== 3. wipe canonical tables (monitor_* untouched) ==');
  try {
    await runBatched(CANONICAL_TABLES_WIPE_ORDER.map(t => `DELETE FROM ${t};`), 'wipe');
    // Between wipe and import on purpose — see migrateRemoteSchema. DDL never
    // reaches D1 through the row import, so without this a schema change lands
    // locally and then fails the next sync against the stale remote constraint.
    console.log('== 4. schema migrations ==');
    await migrateRemoteSchema();
    console.log('== 5. import ==');
    await runBatched(statements, 'import');
  } catch (error) {
    console.error('\n!! sync FAILED mid-write — remote canonical tables may be PARTIAL.');
    console.error('   Recover: re-run `bun run data:sync -- sync` (imports are idempotent upserts and converge),');
    console.error(`   or restore from the pre-wipe backup at ${backupDir}`);
    throw error;
  }
  console.log('== 6. verify ==');
  await verify();
  console.log(`sync complete. backup kept at ${backupDir}`);
} else {
  console.log('Usage: bun run data:sync -- <verify|backup [dir]|sync>');
  process.exit(1);
}
}

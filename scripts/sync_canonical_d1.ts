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
 *   bun run data:sync -- sync             # backup -> wipe -> import -> verify
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

async function runBatched(statements: string[], label: string, batchSize = 100): Promise<void> {
  let done = 0;
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize);
    const sql = chunk.map(s => (s.endsWith(';') ? s : `${s};`)).join('\n');
    for (let attempt = 1; ; attempt++) {
      try { await query(sql); break; }
      catch (error) {
        if (attempt >= 3) throw new Error(`${label} batch @${i} failed: ${error}`);
      }
    }
    done += chunk.length;
    if (done % 1000 < batchSize || done === statements.length) {
      console.log(`${label}: ${done}/${statements.length}`);
    }
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
  await runBatched(CANONICAL_TABLES_WIPE_ORDER.map(t => `DELETE FROM ${t};`), 'wipe');
  console.log('== 4. import ==');
  await runBatched(statements, 'import');
  console.log('== 5. verify ==');
  await verify();
  console.log(`sync complete. backup kept at ${backupDir}`);
} else {
  console.log('Usage: bun run data:sync -- <verify|backup [dir]|sync>');
  process.exit(1);
}

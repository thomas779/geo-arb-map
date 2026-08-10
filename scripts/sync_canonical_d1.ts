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

/**
 * Create the licence-exchange tables if they are absent.
 *
 * Separate from migrateRemoteSchema because it is pure CREATE IF NOT EXISTS with no
 * table rebuild — it can run on every sync and converge. The tables are standalone
 * (the monitor_* pattern), so they carry no foreign keys into the canonical model
 * and are safe to create whether or not the canonical tables are populated.
 */
async function ensureLicenceSchema(): Promise<void> {
  const file = path.join(root, 'data/d1/migrations/0007_licence_exchange.sql');
  const statements = splitStatements(fs.readFileSync(file, 'utf8'))
    .filter(statement => !/^\s*PRAGMA\b/i.test(statement));
  await runBatched(statements, 'licence-ddl');
}

/**
 * Rows for the licence layer, rendered from the served JSON.
 *
 * public/licence_exchange.json stays the source of truth — it is version-controlled
 * and is what the site actually fetches. These tables are its indexed projection, so
 * "which agreements cover Paraguay" and "which states hold a bilateral agreement
 * with anyone" become queries rather than a client-side scan of a 184KB blob.
 */
function renderLicenceSql(): string[] {
  const data = JSON.parse(
    fs.readFileSync(path.join(root, 'public/licence_exchange.json'), 'utf8'),
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
      out.push(
        'INSERT INTO licence_exchange_index (destination_iso_n3, agreement_id, origin_iso_n3, subnational_label, origin_label_en, classes, theory_test_required, practical_test_required) VALUES ('
        + [dest.iso_n3, dest.agreement_id ?? null, e.origin_iso_n3 ?? null, subnationalLabel,
          e.origin_label_en, e.classes ?? null, e.theory_test_required ?? null, e.practical_test_required ?? null].map(q).join(', ')
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
    console.log('== 5b. licence exchange ==');
    await ensureLicenceSchema();
    const licence = renderLicenceSql();
    console.log(`  ${licence.length} statements`);
    await runBatched(licence, 'licence');
    console.log('== 5c. reference data ==');
    await ensureReferenceSchema();
    const reference = renderReferenceDataSql();
    console.log(`  ${reference.length} statements`);
    await runBatched(reference, 'reference');
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

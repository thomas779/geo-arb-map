import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCanonicalPilot } from '../scripts/lib/canonical-pilot';
import {
  buildCanonicalImportPlan,
  importCanonicalPilot,
  renderCanonicalSql,
} from '../scripts/lib/canonical-store';
import {
  compileDataRelease,
  computeChangelog,
  deepDiff,
  loadBaselineManifest,
  loadCanonicalDatabase,
  writeDataRelease,
  type DataRelease,
} from '../scripts/lib/data-build';

const REPO_ROOT = process.cwd();
const MIGRATION = fs.readFileSync(
  path.join(REPO_ROOT, 'data/d1/migrations/0001_canonical_data.sql'),
  'utf8',
);

/** Build a fresh canonical SQLite database (the `data:db` stage) for hermetic tests. */
function buildDatabase(dbPath: string): void {
  const pilot = buildCanonicalPilot();
  const db = new Database(dbPath, { create: true, strict: true });
  db.exec(MIGRATION);
  importCanonicalPilot(db, pilot);
  db.exec('PRAGMA optimize');
  db.close();
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildMutatedDatabase(
  name: string,
  entityId: string,
  mutate: (payload: Record<string, unknown>) => void,
): string {
  const mutationPath = path.join(tmp, `${name}.sqlite`);
  buildDatabase(mutationPath);
  const db = new Database(mutationPath, { strict: true });
  const row = db.query(
    'SELECT payload_json FROM canonical_revisions WHERE entity_id = ?1',
  ).get(entityId) as { payload_json: string };
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  mutate(payload);
  db.exec('DROP TRIGGER canonical_revision_content_immutable');
  db.query(
    `UPDATE canonical_revisions
     SET payload_json = ?1, content_hash = ?2
     WHERE entity_id = ?3`,
  ).run(JSON.stringify(payload), hashJson(payload), entityId);
  db.close();
  return mutationPath;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'data-build-'));
const dbPath = path.join(tmp, 'canonical.sqlite');
let release: DataRelease;

beforeAll(() => {
  buildDatabase(dbPath);
  release = compileDataRelease({ dbPath, root: REPO_ROOT });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function gate(name: string) {
  return release.parity.gates.find(g => g.gate === name)!;
}

describe('data:build reads the canonical database', () => {
  test('loads canonical revisions from SQLite payload_json', () => {
    const loaded = loadCanonicalDatabase(dbPath, REPO_ROOT);
    expect(loaded.sources.length + loaded.jurisdictions.length + loaded.arrangements.length)
      .toBe(loaded.entities.length);
    expect(loaded.entities.every(row => row.review_status === 'draft')).toBe(true);
    expect(loaded.dbState).toEqual({
      releases: 0,
      approved_revisions: 0,
      published_releases: 0,
      selected_statuses: ['draft'],
      selected_release_status: null,
    });
    expect(loaded.projections.coverage).toHaveLength(3);
  });

  test('fails clearly when the database is missing', () => {
    expect(() => loadCanonicalDatabase(path.join(tmp, 'does-not-exist.sqlite'), REPO_ROOT))
      .toThrow(/Canonical database not found/);
  });

  test('compiles a wrangler-style SQL export by materializing it as SQLite', () => {
    const exportPath = path.join(tmp, 'canonical-export.sql');
    const plan = buildCanonicalImportPlan(buildCanonicalPilot());
    fs.writeFileSync(exportPath, `${MIGRATION}\n${renderCanonicalSql(plan.mutations)}`);
    const fromExport = compileDataRelease({ dbPath: exportPath, root: REPO_ROOT });
    expect(fromExport.parity.passed).toBe(true);
    expect(fromExport.manifest.database.content_hash)
      .toBe(release.manifest.database.content_hash);
    expect(fromExport.manifest.release_id).toBe(release.manifest.release_id);
  });

  test('selects a single supersession head instead of every historical revision', () => {
    const historyPath = path.join(tmp, 'history.sqlite');
    buildDatabase(historyPath);
    const db = new Database(historyPath, { strict: true });
    const previous = db.query(
      `SELECT id, payload_json
       FROM canonical_revisions
       WHERE entity_id = 'source:boe_es:a445a31ce9'`,
    ).get() as { id: string; payload_json: string };
    const payload = JSON.parse(previous.payload_json) as Record<string, unknown>;
    payload.title = `${String(payload.title)} (reviewed)`;
    db.query(
      `INSERT INTO canonical_revisions (
         id, entity_id, schema_version, payload_json, content_hash,
         review_status, created_at, supersedes_revision_id
       ) VALUES (?1, ?2, 1, ?3, ?4, 'draft', ?5, ?6)`,
    ).run(
      'revision:source:boe_es:a445a31ce9:reviewed',
      'source:boe_es:a445a31ce9',
      JSON.stringify(payload),
      hashJson(payload),
      '2026-07-20T00:00:00.000Z',
      previous.id,
    );
    db.close();

    const loaded = loadCanonicalDatabase(historyPath, REPO_ROOT);
    expect(loaded.entities).toHaveLength(21);
    expect(loaded.sources.find(source => source.id === 'source:boe_es:a445a31ce9')?.title)
      .toEndWith('(reviewed)');
  });

  test('rejects ambiguous revision heads', () => {
    const ambiguousPath = path.join(tmp, 'ambiguous.sqlite');
    buildDatabase(ambiguousPath);
    const db = new Database(ambiguousPath, { strict: true });
    const previous = db.query(
      `SELECT payload_json
       FROM canonical_revisions
       WHERE entity_id = 'source:boe_es:a445a31ce9'`,
    ).get() as { payload_json: string };
    const payload = JSON.parse(previous.payload_json) as Record<string, unknown>;
    payload.title = `${String(payload.title)} (ambiguous)`;
    db.query(
      `INSERT INTO canonical_revisions (
         id, entity_id, schema_version, payload_json, content_hash,
         review_status, created_at
       ) VALUES (?1, ?2, 1, ?3, ?4, 'draft', ?5)`,
    ).run(
      'revision:source:boe_es:a445a31ce9:ambiguous',
      'source:boe_es:a445a31ce9',
      JSON.stringify(payload),
      hashJson(payload),
      '2026-07-20T00:00:00.000Z',
    );
    db.close();

    expect(() => loadCanonicalDatabase(ambiguousPath, REPO_ROOT))
      .toThrow(/has 2 draft revision heads/);
  });

  test('validates stored hashes before using them in release identity', () => {
    const invalidPath = path.join(tmp, 'invalid-hash.sqlite');
    fs.copyFileSync(dbPath, invalidPath);
    const db = new Database(invalidPath, { strict: true });
    db.exec('DROP TRIGGER canonical_revision_content_immutable');
    db.query(
      `UPDATE canonical_revisions
       SET content_hash = 'not-the-payload-hash'
       WHERE entity_id = 'eu_eea'`,
    ).run();
    db.close();
    expect(() => loadCanonicalDatabase(invalidPath, REPO_ROOT))
      .toThrow(/content_hash mismatch/);
  });
});

describe('data:build adversarial parity', () => {
  test('fails when an entire migration-scope arrangement disappears', () => {
    const missingPath = path.join(tmp, 'missing-arrangement.sqlite');
    buildDatabase(missingPath);
    const db = new Database(missingPath, { strict: true });
    db.query(`DELETE FROM canonical_revisions WHERE entity_id = 'eu_eea'`).run();
    db.close();
    const mutated = compileDataRelease({ dbPath: missingPath, root: REPO_ROOT });
    expect(mutated.parity.passed).toBe(false);
    expect(mutated.parity.gates.find(item => item.gate === 'exclusive_ownership')?.status)
      .toBe('fail');
  });

  test('fails when a canonical EU member disappears', () => {
    const mutationPath = buildMutatedDatabase('missing-eu-member', 'eu_eea', payload => {
      const participants = payload.participants as { members: string[] };
      participants.members = participants.members.slice(1);
    });
    const mutated = compileDataRelease({ dbPath: mutationPath, root: REPO_ROOT });
    expect(mutated.parity.passed).toBe(false);
    expect(mutated.parity.gates.find(item => item.gate === 'arrangement_projection_parity')?.status)
      .toBe('fail');
  });

  test('fails when a canonical citizenship route disappears', () => {
    const mutationPath = buildMutatedDatabase(
      'missing-france-route',
      'jurisdiction:250',
      payload => {
        payload.routes = [];
      },
    );
    const mutated = compileDataRelease({ dbPath: mutationPath, root: REPO_ROOT });
    expect(mutated.parity.passed).toBe(false);
    expect(mutated.parity.gates.find(item => item.gate === 'citizenship_roundtrip_parity')?.status)
      .toBe('fail');
  });

  test('fails when the Spain correction removes an existing beneficiary', () => {
    const mutationPath = buildMutatedDatabase(
      'missing-spain-beneficiary',
      'spain_iberoamerican',
      payload => {
        const participants = payload.participants as { beneficiaries: string[] };
        participants.beneficiaries = participants.beneficiaries.filter(iso => iso !== '020');
      },
    );
    const mutated = compileDataRelease({ dbPath: mutationPath, root: REPO_ROOT });
    expect(mutated.parity.passed).toBe(false);
    expect(mutated.parity.gates.find(item => item.gate === 'arrangement_projection_parity')?.status)
      .toBe('fail');
    expect(mutated.parity.gates.find(item => item.gate === 'graph_parity')?.status)
      .toBe('fail');
  });

  test('approved heads compile without weakening parity', () => {
    const approvedPath = path.join(tmp, 'approved.sqlite');
    fs.copyFileSync(dbPath, approvedPath);
    const db = new Database(approvedPath, { strict: true });
    db.query(
      `UPDATE canonical_revisions
       SET review_status = 'approved', approved_at = '2026-07-20T00:00:00.000Z'`,
    ).run();
    db.close();
    const approved = compileDataRelease({
      dbPath: approvedPath,
      root: REPO_ROOT,
      selectionMode: 'approved',
    });
    expect(approved.parity.passed).toBe(true);
    expect(
      approved.parity.gates.find(item => item.gate === 'selected_revision_state')?.status,
    ).toBe('pass');
  });

  test('an explicit release compiles only its pinned approved revisions', () => {
    const releasePath = path.join(tmp, 'release-selection.sqlite');
    fs.copyFileSync(dbPath, releasePath);
    const db = new Database(releasePath, { strict: true });
    db.query(
      `UPDATE canonical_revisions
       SET review_status = 'approved', approved_at = '2026-07-20T00:00:00.000Z'`,
    ).run();
    db.query(
      `INSERT INTO releases (id, status, manifest_hash, created_at)
       VALUES ('reviewed-release', 'building', 'reviewed-manifest', '2026-07-20T00:00:00.000Z')`,
    ).run();
    db.query(
      `INSERT INTO release_items (release_id, entity_id, revision_id)
       SELECT 'reviewed-release', entity_id, id
       FROM canonical_revisions`,
    ).run();
    db.close();

    const pinned = compileDataRelease({
      dbPath: releasePath,
      root: REPO_ROOT,
      selectionMode: 'release',
      releaseId: 'reviewed-release',
    });
    expect(pinned.parity.passed).toBe(true);
    expect(pinned.manifest.database.release_id).toBe('reviewed-release');
    expect(pinned.api_release_rows).toHaveLength(21);
  });
});

describe('data:build parity gates', () => {
  test('every gate passes without approving or publishing', () => {
    expect(release.parity.passed).toBe(true);
    expect(release.parity.gates.map(g => g.status)).not.toContain('fail');
    expect(gate('selected_revision_state').detail).toEqual({
      selection_mode: 'draft',
      selected_statuses: ['draft'],
      selected_release_status: null,
      invalid_statuses: [],
    });
    expect(release.manifest.mode).toBe('canonical_release_draft');
    expect(release.manifest.published_at).toBeNull();
    expect(release.input.database_path).toBe(dbPath);
    expect(release.manifest.database).not.toHaveProperty('path');
  });

  test('arrangement projection round-trips eu_eea/mercosur and only corrects Spain', () => {
    const detail = gate('arrangement_projection_parity').detail as {
      expected: unknown[];
      actual: unknown[];
      mismatch: unknown[];
    };
    expect(detail.actual).toEqual(detail.expected);
    expect(detail.mismatch).toEqual([]);
    // Every mobility diff is under the sanctioned Spain beneficiaries path.
    for (const entry of release.compatibility_diff.mobility) {
      expect(entry.path.startsWith('bilateral_lanes[spain_iberoamerican].beneficiaries')).toBe(true);
    }
    expect(release.compatibility_diff.mobility.every(e => e.kind === 'added')).toBe(true);
  });

  test('canonical regional arrangements reproduce legacy membership exactly', () => {
    // No mobility diff touches eu_eea or mercosur — they round-trip byte-for-byte.
    const drifted = release.compatibility_diff.mobility.filter(e =>
      e.path.startsWith('blocs[') || (e.path.startsWith('bilateral_lanes[') && !e.path.includes('spain_iberoamerican')));
    expect(drifted).toEqual([]);
  });

  test('Spain correction adds the eight missing Ibero-American beneficiaries', () => {
    const added = release.compatibility_diff.mobility
      .map(e => /\[(\d{3})\]$/.exec(e.path)?.[1])
      .sort();
    expect(added).toEqual(['188', '192', '214', '222', '320', '340', '558', '591']);
  });

  test('citizenship round-trips every canonical-owned field with zero drift', () => {
    const detail = gate('citizenship_roundtrip_parity').detail as {
      drift: unknown[];
      legacy_carried_fields: string[];
    };
    expect(detail.drift).toEqual([]);
    // Documents the honest gap: title and facts are legacy-carried.
    expect(detail.legacy_carried_fields.length).toBeGreaterThanOrEqual(2);
  });

  test('compatibility citizenship is byte-identical to the curated source', () => {
    const source = JSON.parse(fs.readFileSync(
      path.join(REPO_ROOT, 'data/citizenship_routes.json'), 'utf8',
    ));
    expect(release.compatibility.citizenship).toEqual(source);
  });

  test('graph is complete and differs from public only by the sanctioned Spain propagation', () => {
    const detail = gate('graph_parity').detail as {
      generated_edges: number;
      public_edges: number;
      mismatch: unknown[];
    };
    expect(detail.public_edges).toBe(1953);
    expect(detail.generated_edges).toBeGreaterThan(detail.public_edges);
    expect(detail.mismatch).toEqual([]);
    // Every graph diff is attributable to the Spain beneficiary correction.
    for (const entry of release.compatibility_diff.graph) {
      const mechanism = String((entry.edge as Record<string, unknown>).mechanism ?? '');
      const isSpainLane = mechanism === 'spain_iberoamerican';
      const isSpainNaturalization = mechanism === 'naturalization'
        && (String((entry.edge as Record<string, unknown>).from).endsWith(':724')
          || String((entry.edge as Record<string, unknown>).to).endsWith(':724'));
      expect(isSpainLane || isSpainNaturalization).toBe(true);
    }
  });

  test('legacy remainder byte parity partitions source and pilot exactly', () => {
    expect(gate('legacy_remainder_byte_parity').status).toBe('pass');
  });
});

describe('data:build determinism and writes', () => {
  test('two compiles from the same database are byte-identical', () => {
    const second = compileDataRelease({ dbPath, root: REPO_ROOT });
    expect(second.manifest.release_id).toBe(release.manifest.release_id);
    expect(JSON.stringify(second.manifest)).toBe(JSON.stringify(release.manifest));
    expect(JSON.stringify(second.graph)).toBe(JSON.stringify(release.graph));
    expect(JSON.stringify(second.compatibility)).toBe(JSON.stringify(release.compatibility));
  });

  test('database paths and changelog baselines do not change release identity', () => {
    const firstPath = path.join(tmp, 'same-content-a.sqlite');
    const secondPath = path.join(tmp, 'same-content-b.sqlite');
    fs.copyFileSync(dbPath, firstPath);
    fs.copyFileSync(dbPath, secondPath);
    const first = compileDataRelease({
      dbPath: firstPath,
      root: REPO_ROOT,
      baselineReleaseId: 'first-baseline',
    });
    const second = compileDataRelease({
      dbPath: secondPath,
      root: REPO_ROOT,
      baselineReleaseId: 'second-baseline',
    });
    expect(first.manifest.database.content_hash).toBe(second.manifest.database.content_hash);
    expect(first.manifest.release_id).toBe(second.manifest.release_id);
    expect(first.manifest).toEqual(second.manifest);
  });

  test('writes the full draft bundle and is idempotent on rebuild', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'data-build-out-'));
    try {
      // Copy legacy inputs the compiler reads from disk.
      for (const file of [
        'public/blocs_data.json',
        'public/edges.json',
        'data/citizenship_routes.json',
        'data/manual_edges.json',
        'data/registry.json',
        'data/migration-pilot.json',
      ]) {
        const dest = path.join(work, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(REPO_ROOT, file), dest);
      }
      const workDb = path.join(work, 'canonical.sqlite');
      buildDatabase(workDb);
      const first = compileDataRelease({ dbPath: workDb, root: work });
      const out = writeDataRelease(first, work);
      const manifestPath = path.join(out, 'manifest.json');
      const firstManifest = fs.readFileSync(manifestPath, 'utf8');
      for (const artifact of [
        'catalog.json',
        'projections.json',
        'coverage.json',
        'timelines.json',
        'arrangement-projections.json',
        'graph.json',
        'api_release_rows.json',
        'compatibility/blocs_data.json',
        'compatibility/citizenship_routes.json',
        'parity-report.json',
        'changes.json',
      ]) {
        expect(fs.existsSync(path.join(out, artifact)), artifact).toBe(true);
      }
      const rewritten = compileDataRelease({ dbPath: workDb, root: work });
      writeDataRelease(rewritten, work);
      expect(fs.readFileSync(manifestPath, 'utf8')).toBe(firstManifest);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});

describe('data:build changelog uses an explicit baseline', () => {
  test('without a baseline, all entities are added', () => {
    const changelog = computeChangelog(release, null);
    expect(changelog.baseline_release_id).toBeNull();
    expect(changelog.added).toHaveLength(release.api_release_rows.length);
    expect(changelog.changed).toEqual([]);
    expect(changelog.removed).toEqual([]);
  });

  test('classifies added, changed, and removed entities vs an explicit prior manifest', () => {
    const rows = release.api_release_rows;
    const baseline = {
      release_id: 'prior',
      entity_hashes: {
        [rows[0]!.entity_id]: rows[0]!.content_hash,
        [rows[1]!.entity_id]: 'stale-hash',
        'jurisdiction:999': 'gone',
      },
    };
    const changelog = computeChangelog(release, baseline);
    expect(changelog.baseline_release_id).toBe('prior');
    expect(changelog.changed).toEqual([rows[1]!.entity_id]);
    expect(changelog.removed).toEqual(['jurisdiction:999']);
    expect(changelog.added).toContain(rows[2]!.entity_id);
  });

  test('loadBaselineManifest errors on an unknown baseline id', () => {
    expect(() => loadBaselineManifest('nonexistent', REPO_ROOT))
      .toThrow(/Baseline release nonexistent not found/);
  });
});

describe('deepDiff drift engine', () => {
  test('indexes arrays by iso_n3 and reports added members', () => {
    const before = { lanes: [{ id: 'a', beneficiaries: [{ iso_n3: '032' }] }] };
    const after = { lanes: [{ id: 'a', beneficiaries: [{ iso_n3: '032' }, { iso_n3: '076' }] }] };
    expect(deepDiff(before, after, '').map(e => e.path)).toEqual(['lanes[a].beneficiaries[076]']);
  });

  test('reports removed and changed fields', () => {
    const before = { blocs: [{ id: 'x', strength: 1, notes: 'old' }] };
    const after = { blocs: [{ id: 'x', strength: 0.5 }] };
    const paths = deepDiff(before, after, '').map(e => `${e.kind}:${e.path}`);
    expect(paths).toContain('changed:blocs[x].strength');
    expect(paths).toContain('removed:blocs[x].notes');
  });
});

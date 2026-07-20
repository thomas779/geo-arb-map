import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCanonicalPilot } from '../scripts/lib/canonical-pilot';
import { importCanonicalPilot } from '../scripts/lib/canonical-store';
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
    expect(loaded.dbState).toEqual({ releases: 0, approved_revisions: 0, published_releases: 0 });
  });

  test('fails clearly when the database is missing', () => {
    expect(() => loadCanonicalDatabase(path.join(tmp, 'does-not-exist.sqlite'), REPO_ROOT))
      .toThrow(/Canonical database not found/);
  });
});

describe('data:build parity gates', () => {
  test('every gate passes without approving or publishing', () => {
    expect(release.parity.passed).toBe(true);
    expect(release.parity.gates.map(g => g.status)).not.toContain('fail');
    expect(gate('unreleased_draft_state').detail).toEqual({
      releases: 0,
      approved_revisions: 0,
      published_releases: 0,
    });
    expect(release.manifest.mode).toBe('canonical_release_draft');
    expect(release.manifest.published_at).toBeNull();
    expect(release.manifest.database.path).toBe(dbPath);
  });

  test('arrangement projection round-trips eu_eea/mercosur and only corrects Spain', () => {
    const detail = gate('arrangement_projection_parity').detail as {
      sanctioned: unknown[];
      unsanctioned: unknown[];
    };
    expect(detail.unsanctioned).toEqual([]);
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
      unsanctioned: unknown[];
    };
    expect(detail.public_edges).toBe(1953);
    expect(detail.generated_edges).toBeGreaterThan(detail.public_edges);
    expect(detail.unsanctioned).toEqual([]);
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

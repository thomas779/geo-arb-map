import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  compileDataRelease,
  computeChangelog,
  deepDiff,
  isSanctioned,
  SANCTIONED_DIFFERENCES,
  writeDataRelease,
  type CompiledDataRelease,
} from '../scripts/lib/data-build';

// Compiled once and shared across read-only tests. The SQLite handle is closed
// in afterAll; tests that mutate (determinism, idempotency) compile their own.
let release: CompiledDataRelease;

beforeAll(() => {
  release = compileDataRelease();
});

afterAll(() => {
  release.database.close();
});

describe('data:build deterministic release compiler', () => {
  test('every parity gate passes without approving or publishing', () => {
    expect(release.parity.passed).toBe(true);
    expect(release.parity.gates.map(gate => gate.status)).not.toContain('fail');
    const unreleased = release.parity.gates.find(
      gate => gate.gate === 'unreleased_draft_state',
    );
    expect(unreleased?.detail).toEqual({
      releases: 0,
      approved_revisions: 0,
      published_releases: 0,
    });
    expect(release.manifest.mode).toBe('canonical_release_draft');
    expect(release.manifest.published_at).toBeNull();
  });

  test('compiles the full pilot scope from SQL-derived projections', () => {
    expect(release.manifest.scope.jurisdictions).toEqual(['250', '620', '724']);
    expect(release.manifest.scope.arrangements).toEqual([
      'eu_eea',
      'mercosur',
      'spain_iberoamerican',
    ]);
    expect(release.manifest.counts.sources).toBe(15);
    expect(release.manifest.counts.jurisdictions).toBe(3);
    expect(release.manifest.counts.arrangements).toBe(3);
    expect(release.manifest.counts.edges).toBeGreaterThan(0);
    expect(release.api_release_rows).toHaveLength(release.manifest.counts.canonical_entities);
    expect(release.api_release_rows.every(row => row.review_status === 'draft')).toBe(true);
  });

  test('canonical regional arrangements reproduce legacy membership exactly', () => {
    const gate = release.parity.gates.find(item => item.gate === 'pilot_participant_parity');
    expect(gate?.status).toBe('pass');
    const reviewed = (gate?.detail as { reviewed: Array<{ arrangement_id: string }> }).reviewed;
    // Only the Spain beneficiary set is a sanctioned participant difference.
    expect(reviewed.map(item => item.arrangement_id)).toEqual(['spain_iberoamerican']);
  });

  test('compatibility mobility differs from public only by the sanctioned Spain beneficiaries', () => {
    const spainPrefix = 'bilateral_lanes[spain_iberoamerican].beneficiaries';
    for (const entry of release.compatibility_diff.mobility) {
      expect(isSanctioned(entry, SANCTIONED_DIFFERENCES)).toBe(true);
      expect(entry.path.startsWith(spainPrefix)).toBe(true);
    }
    expect(release.compatibility_diff.mobility.every(entry => entry.kind === 'added')).toBe(true);
    const added = release.compatibility_diff.mobility
      .map(entry => /\[(\d{3})\]$/.exec(entry.path)?.[1])
      .sort();
    expect(added).toEqual(['188', '192', '214', '222', '320', '340', '558', '591']);
  });

  test('compatibility citizenship is byte-identical to the curated source', () => {
    expect(release.compatibility_diff.citizenship).toEqual([]);
    expect(release.manifest.compatibility_hashes.citizenship_projected).toBe(
      release.manifest.compatibility_hashes.citizenship_source,
    );
  });

  test('Spain correction adds the eight missing Ibero-American beneficiaries and removes none', () => {
    const gate = release.parity.gates.find(item => item.gate === 'pilot_participant_parity');
    const reviewed = (gate?.detail as {
      reviewed: Array<{ before: string[]; after: string[] }>;
    }).reviewed[0];
    const added = reviewed.after.filter(iso => !reviewed.before.includes(iso));
    const removed = reviewed.before.filter(iso => !reviewed.after.includes(iso));
    expect(added.sort()).toEqual(['188', '192', '214', '222', '320', '340', '558', '591']);
    expect(removed).toEqual([]);
  });
});

describe('data:build determinism and writes', () => {
  test('two compiles produce identical release id and byte-identical artifacts', () => {
    const second = compileDataRelease();
    try {
      expect(second.manifest.release_id).toBe(release.manifest.release_id);
      expect(JSON.stringify(second.manifest)).toBe(JSON.stringify(release.manifest));
      expect(JSON.stringify(second.projections)).toBe(JSON.stringify(release.projections));
      expect(JSON.stringify(second.api_release_rows)).toBe(JSON.stringify(release.api_release_rows));
      expect(JSON.stringify(second.compatibility)).toBe(JSON.stringify(release.compatibility));
    } finally {
      second.database.close();
    }
  });

  test('writes the full draft bundle and is idempotent on rebuild', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'data-build-'));
    try {
      const inputs = [
        'public/blocs_data.json',
        'data/citizenship_routes.json',
        'data/registry.json',
        'data/migration-pilot.json',
        'data/manual_edges.json',
        'data/timeline_rules.json',
        'data/d1/migrations/0001_canonical_data.sql',
      ];
      for (const file of inputs) {
        const src = path.join(process.cwd(), file);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(tmp, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }

      const first = compileDataRelease({ root: tmp });
      try {
        const out = writeDataRelease(first, tmp);
        const manifestPath = path.join(out, 'manifest.json');
        const firstManifest = fs.readFileSync(manifestPath, 'utf8');
        for (const artifact of [
          'catalog.json',
          'projections.json',
          'graph.json',
          'api_release_rows.json',
          'compatibility/blocs_data.json',
          'compatibility/citizenship_routes.json',
          'parity-report.json',
          'changes.json',
        ]) {
          expect(fs.existsSync(path.join(out, artifact)), artifact).toBe(true);
        }

        const rewritten = compileDataRelease({ root: tmp });
        try {
          writeDataRelease(rewritten, tmp);
          expect(fs.readFileSync(manifestPath, 'utf8')).toBe(firstManifest);
        } finally {
          rewritten.database.close();
        }
      } finally {
        first.database.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('data:build changelog', () => {
  test('reports all pilot entities as added against an empty baseline', () => {
    const changelog = computeChangelog(release, null);
    expect(changelog.baseline_release_id).toBeNull();
    expect(changelog.added).toHaveLength(release.api_release_rows.length);
    expect(changelog.changed).toEqual([]);
    expect(changelog.removed).toEqual([]);
  });

  test('classifies added, changed, and removed entities vs a prior manifest', () => {
    const rows = release.api_release_rows;
    const prior = {
      release_id: 'prior',
      entity_hashes: {
        [rows[0]!.entity_id]: rows[0]!.content_hash, // unchanged
        [rows[1]!.entity_id]: 'stale-hash', // changed
        'jurisdiction:999': 'gone', // removed
      },
    };
    const changelog = computeChangelog(release, prior);
    expect(changelog.baseline_release_id).toBe('prior');
    expect(changelog.changed).toEqual([rows[1]!.entity_id]);
    expect(changelog.removed).toEqual(['jurisdiction:999']);
    expect(changelog.added).toContain(rows[2]!.entity_id);
  });
});

describe('deepDiff drift engine', () => {
  test('indexes arrays by id or iso_n3 and reports field-level changes', () => {
    const before = { lanes: [{ id: 'a', beneficiaries: [{ iso_n3: '032' }] }] };
    const after = {
      lanes: [
        { id: 'a', beneficiaries: [{ iso_n3: '032' }, { iso_n3: '076' }] },
      ],
    };
    const diff = deepDiff(before, after, '');
    expect(diff.map(entry => entry.path)).toEqual(['lanes[a].beneficiaries[076]']);
    expect(diff[0]!.kind).toBe('added');
  });

  test('flags unsanctioned drift outside the Spain beneficiary path', () => {
    const entry = { path: 'blocs[eu_eea].name', kind: 'changed' as const, before: 'x', after: 'y' };
    expect(isSanctioned(entry, SANCTIONED_DIFFERENCES)).toBe(false);
  });

  test('recognizes sanctioned beneficiary paths continuing into array indices', () => {
    const entry = {
      path: 'bilateral_lanes[spain_iberoamerican].beneficiaries[188]',
      kind: 'added' as const,
      before: undefined,
      after: {},
    };
    expect(isSanctioned(entry, SANCTIONED_DIFFERENCES)).toBe(true);
  });
});

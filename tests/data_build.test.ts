import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCanonicalPilot, CANONICAL_SOURCE_IS_SAMPLE } from '../scripts/lib/canonical-source';
import { readCanonicalMigrations } from '../scripts/lib/d1-migrations';
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
const MIGRATION = readCanonicalMigrations(REPO_ROOT);

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
    `SELECT revision.id, revision.payload_json
     FROM canonical_revisions AS revision
     WHERE revision.entity_id = ?1
       AND NOT EXISTS (
         SELECT 1 FROM canonical_revisions AS newer
         WHERE newer.supersedes_revision_id = revision.id
       )`,
  ).get(entityId) as { id: string; payload_json: string };
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  mutate(payload);
  db.exec('DROP TRIGGER canonical_revision_content_immutable');
  db.query(
    `UPDATE canonical_revisions
     SET payload_json = ?1, content_hash = ?2
     WHERE id = ?3`,
  ).run(JSON.stringify(payload), hashJson(payload), row.id);
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

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('data:build reads the canonical database', () => {
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
    expect(loaded.projections.coverage).toHaveLength(buildCanonicalPilot().jurisdictions.length);
    expect(loaded.projections.mode_coverage)
      .toHaveLength(buildCanonicalPilot().jurisdictions.length * 4);
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
  }, { timeout: 20_000 });

  test('stages the generated superseding import over an exported database', () => {
    const pilot = buildCanonicalPilot();
    const basePlan = buildCanonicalImportPlan(pilot);
    const baseExport = path.join(tmp, 'stage-base.sql');
    const supersedingImport = path.join(tmp, 'stage-import.sql');
    const staged = path.join(tmp, 'stage-output.sqlite');
    fs.writeFileSync(baseExport, `${MIGRATION}\n${renderCanonicalSql(basePlan.mutations)}`);
    const changedPilot = structuredClone(pilot);
    changedPilot.jurisdictions[0]!.review.note =
      `${changedPilot.jurisdictions[0]!.review.note ?? ''} Staging regression.`;
    fs.writeFileSync(
      supersedingImport,
      renderCanonicalSql(
        buildCanonicalImportPlan(changedPilot, basePlan.revision_by_entity).mutations,
      ),
    );

    const result = Bun.spawnSync([
      'bun',
      'scripts/stage_canonical_database.ts',
      '--base', baseExport,
      '--import', supersedingImport,
      '--output', staged,
    ], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(loadCanonicalDatabase(staged, REPO_ROOT).entities)
      .toHaveLength(pilot.sources.length + pilot.jurisdictions.length + pilot.arrangements.length);
  }, { timeout: 20_000 });

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
    expect(loaded.entities).toHaveLength(
      buildCanonicalPilot().sources.length
        + buildCanonicalPilot().jurisdictions.length
        + buildCanonicalPilot().arrangements.length,
    );
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

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('data:build adversarial parity', () => {
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
    expect(() => compileDataRelease({ dbPath: mutationPath, root: REPO_ROOT }))
      .toThrow('Coverage finding present requires a naturalization route');
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
       SELECT 'reviewed-release', revision.entity_id, revision.id
       FROM canonical_revisions AS revision
       WHERE NOT EXISTS (
         SELECT 1 FROM canonical_revisions AS newer
         WHERE newer.supersedes_revision_id = revision.id
       )`,
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
    expect(pinned.api_release_rows).toHaveLength(
      buildCanonicalPilot().sources.length
        + buildCanonicalPilot().jurisdictions.length
        + buildCanonicalPilot().arrangements.length,
    );
  });
});

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('data:build parity gates', () => {
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
      canonical_additions: string[];
      legacy_carried_fields: string[];
    };
    expect(detail.drift).toEqual([]);
    expect(detail.canonical_additions).toEqual([
      'afghanistan-citizenship-at-birth-by-parent',
      'afghanistan-citizenship-by-parent',
      'afghanistan-naturalization',
      'aland-islands-citizenship-at-birth',
      'aland-islands-nationality-by-descent',
      'aland-islands-naturalization',
      'albania-citizenship-at-birth-by-parent',
      'albania-citizenship-by-marriage',
      'albania-citizenship-by-parent',
      'albania-naturalization',
      'algeria-citizenship-at-birth-by-parent',
      'algeria-citizenship-by-marriage',
      'algeria-citizenship-by-parent',
      'algeria-naturalization',
      'american-samoa-naturalization',
      'andorra-citizenship-at-birth-by-parent',
      'andorra-citizenship-by-parent',
      'andorra-naturalization',
      'angola-citizenship-at-birth-by-parent',
      'angola-citizenship-by-marriage',
      'angola-citizenship-by-parent',
      'angola-naturalization',
      'anguilla-citizenship-at-birth',
      'anguilla-nationality-by-descent',
      'anguilla-naturalization',
      'antigua-barbuda-citizenship-by-birth',
      'antigua-barbuda-citizenship-by-parent',
      'antigua-barbuda-naturalization',
      'argentina-citizenship-by-birth',
      'argentina-citizenship-by-parent',
      'argentina-naturalization-after-residence',
      'argentina-relevant-investment-citizenship',
      'armenia-citizenship-at-birth-by-parent',
      'armenia-citizenship-by-armenian-descent',
      'armenia-citizenship-by-marriage',
      'armenia-citizenship-by-parent',
      'armenia-naturalization',
      'aruba-citizenship-at-birth',
      'aruba-nationality-by-descent',
      'aruba-naturalization',
      'australia-citizenship-by-birth',
      'australia-citizenship-by-conferral',
      'australia-citizenship-by-descent',
      'austria-citizenship-at-birth-by-parent',
      'austria-citizenship-by-marriage',
      'austria-citizenship-by-parent',
      'austria-naturalization',
      'azerbaijan-citizenship-at-birth-by-parent',
      'azerbaijan-citizenship-by-parent',
      'azerbaijan-naturalization',
      'bahamas-citizenship-by-parent',
      'bahamas-citizenship-connected-to-birth',
      'bahamas-naturalization',
      'bahrain-citizenship-at-birth-by-parent',
      'bahrain-citizenship-by-parent',
      'bahrain-naturalization',
      'bangladesh-citizenship-at-birth-by-parent',
      'bangladesh-citizenship-by-parent',
      'bangladesh-investment-citizenship',
      'bangladesh-naturalization',
      'barbados-citizenship-by-birth',
      'barbados-citizenship-by-parent',
      'barbados-naturalization',
      'belarus-citizenship-at-birth-by-parent',
      'belarus-citizenship-by-parent',
      'belarus-naturalization',
      'belgium-citizenship-at-birth-by-parent',
      'belgium-citizenship-by-parent',
      'belgium-naturalization',
      'belize-citizenship-at-birth-by-parent',
      'belize-citizenship-by-parent',
      'belize-economic-citizenship-closed',
      'belize-naturalization',
      'benin-citizenship-at-birth-by-parent',
      'benin-citizenship-by-marriage',
      'benin-citizenship-by-parent',
      'benin-naturalization',
      'bermuda-citizenship-at-birth',
      'bermuda-nationality-by-descent',
      'bermuda-naturalization',
      'bhutan-citizenship-at-birth-by-parents',
      'bhutan-citizenship-by-marriage',
      'bhutan-citizenship-by-parents',
      'bhutan-naturalization',
      'bolivia-citizenship-by-birth',
      'bolivia-citizenship-by-marriage',
      'bolivia-citizenship-by-parent',
      'bolivia-naturalization',
      'bosnia-herzegovina-citizenship-at-birth-by-parent',
      'bosnia-herzegovina-citizenship-by-marriage',
      'bosnia-herzegovina-citizenship-by-parent',
      'bosnia-herzegovina-naturalization',
      'botswana-citizenship-at-birth-by-parent',
      'botswana-citizenship-by-parent',
      'botswana-naturalization',
      'brazil-citizenship-by-birth',
      'brazil-citizenship-by-marriage',
      'brazil-citizenship-by-parent',
      'brazil-naturalization-by-residence',
      'british-virgin-islands-citizenship-at-birth',
      'british-virgin-islands-nationality-by-descent',
      'british-virgin-islands-naturalization',
      'brunei-citizenship-at-birth-by-parent',
      'brunei-citizenship-by-parent',
      'brunei-naturalization',
      'bulgaria-citizenship-by-birth-statelessness',
      'bulgaria-citizenship-by-marriage',
      'burkina-faso-citizenship-at-birth-by-parent',
      'burkina-faso-citizenship-by-parent',
      'burkina-faso-naturalization',
      'burundi-citizenship-at-birth-by-parent',
      'burundi-citizenship-by-marriage',
      'burundi-citizenship-by-parent',
      'burundi-naturalization',
      'cabo-verde-citizenship-at-birth-by-parent',
      'cabo-verde-citizenship-by-parent',
      'cabo-verde-naturalization',
      'cambodia-citizenship-at-birth-by-parent',
      'cambodia-citizenship-by-marriage',
      'cambodia-citizenship-by-parent',
      'cambodia-naturalization',
      'cameroon-citizenship-at-birth-by-parent',
      'cameroon-citizenship-by-marriage',
      'cameroon-citizenship-by-parent',
      'cameroon-naturalization',
      'canada-citizenship-by-birth',
      'canada-citizenship-by-descent',
      'canada-citizenship-grant',
      'caribbean-netherlands-citizenship-at-birth',
      'caribbean-netherlands-nationality-by-descent',
      'caribbean-netherlands-naturalization',
      'cayman-botc-by-birth',
      'cayman-botc-by-descent',
      'cayman-botc-naturalization',
      'central-african-republic-citizenship-at-birth-by-parent',
      'central-african-republic-citizenship-by-marriage',
      'central-african-republic-citizenship-by-parent',
      'central-african-republic-naturalization',
      'chad-citizenship-at-birth-by-parent',
      'chad-citizenship-by-parent',
      'chad-naturalization',
      'chile-citizenship-by-birth',
      'chile-citizenship-by-marriage',
      'chile-citizenship-by-parent-or-grandparent',
      'chile-naturalization',
      'china-citizenship-at-birth-by-parent',
      'china-citizenship-by-parent',
      'china-naturalization',
      'colombia-citizenship-by-conditional-birth',
      'colombia-citizenship-by-marriage',
      'colombia-citizenship-by-parent',
      'colombia-naturalization-by-residence',
      'comoros-citizenship-at-birth-by-parent',
      'comoros-citizenship-by-parent',
      'comoros-economic-citizenship-closed',
      'comoros-naturalization',
      'congo-citizenship-at-birth-by-parent',
      'congo-citizenship-by-marriage',
      'congo-citizenship-by-parent',
      'congo-naturalization',
      'cook-islands-citizenship-at-birth',
      'cook-islands-nationality-by-descent',
      'cook-islands-naturalization',
      'costa-rica-citizenship-by-birth',
      'costa-rica-citizenship-by-parent',
      'costa-rica-naturalization-by-residence',
      'cote-divoire-citizenship-at-birth-by-parent',
      'cote-divoire-citizenship-by-marriage',
      'cote-divoire-citizenship-by-parent',
      'cote-divoire-naturalization',
      'croatia-citizenship-at-birth-by-parent',
      'croatia-citizenship-by-marriage',
      'croatia-citizenship-by-parent',
      'croatia-naturalization',
      'cuba-citizenship-at-birth-by-parent',
      'cuba-citizenship-by-parent',
      'cuba-naturalization',
      'curacao-citizenship-at-birth',
      'curacao-nationality-by-descent',
      'curacao-naturalization',
      'cyprus-citizenship-at-birth-by-parent',
      'cyprus-citizenship-by-marriage',
      'cyprus-citizenship-by-origin',
      'cyprus-investment-programme-closed',
      'cyprus-naturalization-by-residence',
      'czechia-citizenship-at-birth-by-parent',
      'czechia-citizenship-by-parent',
      'czechia-naturalization',
      'denmark-citizenship-at-birth-by-parent',
      'denmark-citizenship-by-marriage',
      'denmark-citizenship-by-parent',
      'denmark-naturalization',
      'djibouti-citizenship-at-birth-by-parent',
      'djibouti-citizenship-by-marriage',
      'djibouti-citizenship-by-parent',
      'djibouti-naturalization',
      'dominica-citizenship-by-birth',
      'dominica-citizenship-by-parent',
      'dominica-naturalization-after-residence',
      'dominican-republic-citizenship-by-birth',
      'dominican-republic-citizenship-by-parent',
      'dominican-republic-naturalization',
      'drc-citizenship-at-birth-by-parent',
      'drc-citizenship-by-marriage',
      'drc-citizenship-by-parent',
      'drc-naturalization',
      'ecuador-citizenship-at-birth',
      'ecuador-citizenship-by-marriage',
      'ecuador-citizenship-by-parent',
      'ecuador-naturalization',
      'egypt-citizenship-by-birth',
      'egypt-citizenship-by-marriage',
      'egypt-citizenship-by-parent',
      'egypt-naturalization',
      'el-salvador-central-american-option',
      'el-salvador-citizenship-by-birth',
      'el-salvador-citizenship-by-parent',
      'el-salvador-naturalization-by-residence',
      'equatorial-guinea-citizenship-at-birth-by-parent',
      'equatorial-guinea-citizenship-by-marriage',
      'equatorial-guinea-citizenship-by-parent',
      'equatorial-guinea-naturalization',
      'eritrea-citizenship-at-birth-by-parent',
      'eritrea-citizenship-by-marriage',
      'eritrea-citizenship-by-parent',
      'eritrea-naturalization',
      'estonia-citizenship-at-birth-by-parent',
      'estonia-citizenship-by-parent',
      'estonia-naturalization',
      'eswatini-citizenship-at-birth-by-parent',
      'eswatini-citizenship-by-marriage',
      'eswatini-citizenship-by-parent',
      'eswatini-naturalization',
      'ethiopia-citizenship-at-birth-by-parent',
      'ethiopia-citizenship-by-marriage',
      'ethiopia-citizenship-by-parent',
      'ethiopia-naturalization',
      'falkland-islands-citizenship-at-birth',
      'falkland-islands-nationality-by-descent',
      'falkland-islands-naturalization',
      'faroe-islands-citizenship-at-birth',
      'faroe-islands-nationality-by-descent',
      'faroe-islands-naturalization',
      'fiji-citizenship-at-birth-by-parent',
      'fiji-citizenship-by-parent',
      'fiji-naturalization',
      'finland-citizenship-at-birth-by-parent',
      'finland-citizenship-by-marriage',
      'finland-citizenship-by-parent',
      'finland-naturalization',
      'france-birth-and-residence',
      'france-citizenship-by-marriage',
      'france-citizenship-by-parent',
      'france-exceptional-naturalization',
      'france-reintegration',
      'french-polynesia-citizenship-at-birth',
      'french-polynesia-nationality-by-descent',
      'french-polynesia-naturalization',
      'gabon-citizenship-at-birth-by-parent',
      'gabon-citizenship-by-marriage',
      'gabon-citizenship-by-parent',
      'gabon-naturalization',
      'gambia-citizenship-at-birth-by-parent',
      'gambia-citizenship-by-marriage',
      'gambia-citizenship-by-parent',
      'gambia-naturalization',
      'georgia-citizenship-by-marriage',
      'georgia-citizenship-by-parent',
      'georgia-citizenship-by-protected-birth',
      'georgia-ordinary-naturalization',
      'germany-citizenship-by-birth',
      'germany-citizenship-by-parent',
      'germany-naturalization-by-residence',
      'germany-restoration-nazi-persecution',
      'ghana-citizenship-at-birth-by-parent',
      'ghana-citizenship-by-marriage',
      'ghana-citizenship-by-parent',
      'ghana-naturalization',
      'gibraltar-citizenship-at-birth',
      'gibraltar-nationality-by-descent',
      'gibraltar-naturalization',
      'greece-citizenship-birth-and-school',
      'greenland-citizenship-at-birth',
      'greenland-nationality-by-descent',
      'greenland-naturalization',
      'grenada-citizenship-by-birth',
      'grenada-citizenship-by-parent',
      'grenada-naturalization',
      'guam-citizenship-at-birth',
      'guam-nationality-by-descent',
      'guam-naturalization',
      'guatemala-citizenship-by-birth',
      'guatemala-citizenship-by-parent',
      'guatemala-naturalization-by-residence',
      'guernsey-citizenship-at-birth',
      'guernsey-nationality-by-descent',
      'guernsey-naturalization',
      'guinea-bissau-citizenship-at-birth-by-parent',
      'guinea-bissau-citizenship-by-marriage',
      'guinea-bissau-citizenship-by-parent',
      'guinea-bissau-naturalization',
      'guinea-citizenship-at-birth-by-parent',
      'guinea-citizenship-by-marriage',
      'guinea-citizenship-by-parent',
      'guinea-naturalization',
      'guyana-citizenship-at-birth-by-parent',
      'guyana-citizenship-by-parent',
      'guyana-naturalization',
      'haiti-citizenship-at-birth-by-parent',
      'haiti-citizenship-by-parent',
      'haiti-naturalization',
      'honduras-citizenship-by-birth',
      'honduras-citizenship-by-parent',
      'honduras-naturalization-by-residence',
      'hong-kong-citizenship-at-birth',
      'hong-kong-nationality-by-descent',
      'hong-kong-naturalization',
      'hungary-citizenship-at-birth-by-parent',
      'hungary-citizenship-by-marriage',
      'hungary-citizenship-by-parent-or-simplified-origin',
      'hungary-ordinary-naturalization',
      'iceland-citizenship-at-birth-by-parent',
      'iceland-citizenship-by-marriage',
      'iceland-citizenship-by-parent',
      'iceland-naturalization',
      'india-citizenship-at-birth-by-parent',
      'india-citizenship-by-marriage',
      'india-citizenship-by-parent',
      'india-naturalization',
      'indonesia-citizenship-at-birth-by-parent',
      'indonesia-citizenship-by-marriage',
      'indonesia-citizenship-by-parent',
      'indonesia-naturalization',
      'iran-citizenship-at-birth-by-parent',
      'iran-citizenship-by-marriage',
      'iran-citizenship-by-parent',
      'iran-naturalization',
      'iraq-citizenship-at-birth-by-parent',
      'iraq-citizenship-by-marriage',
      'iraq-citizenship-by-parent',
      'iraq-naturalization',
      'ireland-citizenship-by-birth',
      'ireland-citizenship-by-descent',
      'ireland-citizenship-by-marriage',
      'ireland-irish-associations',
      'ireland-naturalization-by-residence',
      'ireland-resumption',
      'isle-of-man-citizenship-at-birth',
      'isle-of-man-nationality-by-descent',
      'isle-of-man-naturalization',
      'israel-citizenship-at-birth-by-parent',
      'israel-citizenship-by-marriage',
      'israel-citizenship-by-return-or-parent',
      'israel-naturalization',
      'italy-citizenship-by-descent',
      'italy-citizenship-by-marriage',
      'italy-citizenship-connected-to-birth',
      'italy-exceptional-merit',
      'italy-naturalization-by-residence',
      'italy-reacquisition',
      'jamaica-citizenship-at-birth-by-parent',
      'jamaica-citizenship-by-parent',
      'jamaica-naturalization',
      'japan-citizenship-at-birth-by-parent',
      'japan-citizenship-by-marriage',
      'japan-citizenship-by-parent',
      'japan-naturalization',
      'jersey-citizenship-at-birth',
      'jersey-nationality-by-descent',
      'jersey-naturalization',
      'jordan-citizenship-by-birth-limited',
      'jordan-citizenship-by-father',
      'jordan-citizenship-by-marriage',
      'jordan-naturalization',
      'kazakhstan-citizenship-at-birth-by-parent',
      'kazakhstan-citizenship-by-kandas-status',
      'kazakhstan-citizenship-by-marriage',
      'kazakhstan-citizenship-by-parent',
      'kazakhstan-naturalization',
      'kenya-citizenship-at-birth-by-parent',
      'kenya-citizenship-by-marriage',
      'kenya-citizenship-by-parent',
      'kenya-registration-by-residence',
      'kiribati-citizenship-at-birth-by-parent',
      'kiribati-citizenship-by-parent',
      'kiribati-naturalization',
      'korea-citizenship-at-birth-by-parent',
      'korea-citizenship-by-marriage',
      'korea-citizenship-by-parent-or-simple-origin',
      'korea-general-naturalization',
      'kuwait-citizenship-at-birth-by-parent',
      'kuwait-citizenship-by-parent',
      'kuwait-naturalization',
      'kyrgyzstan-citizenship-at-birth-by-parent',
      'kyrgyzstan-citizenship-by-kyrgyz-origin',
      'kyrgyzstan-citizenship-by-parent',
      'kyrgyzstan-naturalization',
      'laos-citizenship-at-birth-by-parent',
      'laos-citizenship-by-parent',
      'laos-naturalization',
      'latvia-citizenship-at-birth-by-parent',
      'latvia-citizenship-by-parent',
      'latvia-naturalization',
      'lebanon-citizenship-at-birth-by-parent',
      'lebanon-citizenship-by-marriage',
      'lebanon-citizenship-by-parent',
      'lebanon-naturalization',
      'lesotho-citizenship-at-birth-by-parent',
      'lesotho-citizenship-by-marriage',
      'lesotho-citizenship-by-parent',
      'lesotho-naturalization',
      'liberia-citizenship-at-birth-by-parent',
      'liberia-citizenship-by-parent',
      'liberia-naturalization',
      'libya-citizenship-at-birth-by-parent',
      'libya-citizenship-by-marriage',
      'libya-citizenship-by-parent',
      'libya-naturalization',
      'liechtenstein-citizenship-at-birth-by-parent',
      'liechtenstein-citizenship-by-marriage',
      'liechtenstein-citizenship-by-parent',
      'liechtenstein-naturalization',
      'lithuania-citizenship-at-birth-by-parent',
      'lithuania-citizenship-by-marriage',
      'lithuania-citizenship-by-parent',
      'lithuania-naturalization',
      'luxembourg-citizenship-at-birth-by-parent',
      'luxembourg-citizenship-by-marriage',
      'luxembourg-citizenship-by-parent',
      'luxembourg-naturalization',
      'macao-citizenship-at-birth',
      'macao-nationality-by-descent',
      'macao-naturalization',
      'madagascar-citizenship-at-birth-by-parent',
      'madagascar-citizenship-by-marriage',
      'madagascar-citizenship-by-parent',
      'madagascar-naturalization',
      'malawi-citizenship-at-birth-by-parent',
      'malawi-citizenship-by-marriage',
      'malawi-citizenship-by-parent',
      'malawi-naturalization',
      'malaysia-citizenship-at-birth-by-parent',
      'malaysia-citizenship-by-marriage',
      'malaysia-citizenship-by-parent',
      'malaysia-naturalization',
      'maldives-citizenship-at-birth-by-parent',
      'maldives-citizenship-by-parent',
      'maldives-naturalization',
      'mali-citizenship-at-birth-by-parent',
      'mali-citizenship-by-parent',
      'mali-naturalization',
      'malta-citizenship-by-birth',
      'malta-citizenship-by-marriage',
      'marshall-islands-citizenship-at-birth-by-parent',
      'marshall-islands-citizenship-by-parent',
      'marshall-islands-naturalization',
      'mauritania-citizenship-at-birth-by-parent',
      'mauritania-citizenship-by-marriage',
      'mauritania-citizenship-by-parent',
      'mauritania-naturalization',
      'mauritius-citizenship-by-descent',
      'mauritius-citizenship-by-marriage',
      'mauritius-citizenship-connected-to-birth',
      'mauritius-investor-naturalization',
      'mauritius-naturalization',
      'mexico-citizenship-by-birth',
      'mexico-citizenship-by-marriage',
      'mexico-citizenship-by-parent',
      'mexico-naturalization-by-residence',
      'micronesia-citizenship-at-birth-by-parent',
      'micronesia-citizenship-by-parent',
      'micronesia-naturalization',
      'moldova-citizenship-at-birth-by-parent',
      'moldova-citizenship-by-marriage',
      'moldova-citizenship-by-parent',
      'moldova-naturalization',
      'monaco-citizenship-at-birth-by-parent',
      'monaco-citizenship-by-marriage',
      'monaco-citizenship-by-parent',
      'monaco-naturalization',
      'mongolia-citizenship-at-birth-by-parent',
      'mongolia-citizenship-by-parent',
      'mongolia-naturalization',
      'montenegro-citizenship-at-birth-by-parent',
      'montenegro-citizenship-by-marriage',
      'montenegro-citizenship-by-parent',
      'montenegro-economic-citizenship-closed',
      'montenegro-naturalization',
      'montserrat-citizenship-at-birth',
      'montserrat-nationality-by-descent',
      'montserrat-naturalization',
      'morocco-citizenship-at-birth-by-parent',
      'morocco-citizenship-by-marriage',
      'morocco-citizenship-by-parent',
      'morocco-naturalization',
      'mozambique-citizenship-at-birth-by-parent',
      'mozambique-citizenship-by-marriage',
      'mozambique-citizenship-by-parent',
      'mozambique-naturalization',
      'myanmar-citizenship-at-birth-by-parent',
      'myanmar-citizenship-by-parent',
      'myanmar-naturalization',
      'namibia-citizenship-at-birth-by-parent',
      'namibia-citizenship-by-parent',
      'namibia-naturalization',
      'nauru-citizenship-by-descent',
      'nauru-citizenship-connected-to-birth',
      'nauru-naturalization-by-marriage',
      'nepal-citizenship-at-birth-by-parent',
      'nepal-citizenship-by-descent',
      'nepal-citizenship-by-marriage',
      'nepal-naturalization',
      'netherlands-citizenship-by-marriage',
      'netherlands-citizenship-by-parent',
      'netherlands-naturalization-by-residence',
      'netherlands-third-generation-birth',
      'new-caledonia-citizenship-at-birth',
      'new-caledonia-nationality-by-descent',
      'new-caledonia-naturalization',
      'nicaragua-central-american-option',
      'nicaragua-citizenship-by-birth',
      'nicaragua-citizenship-by-parent',
      'nicaragua-naturalization',
      'niger-citizenship-at-birth-by-parent',
      'niger-citizenship-by-parent',
      'niger-naturalization',
      'nigeria-citizenship-at-birth-by-parent',
      'nigeria-citizenship-by-marriage',
      'nigeria-citizenship-by-parent',
      'nigeria-naturalization',
      'niue-citizenship-at-birth',
      'niue-nationality-by-descent',
      'niue-naturalization',
      'norfolk-island-citizenship-at-birth',
      'norfolk-island-nationality-by-descent',
      'norfolk-island-naturalization',
      'north-korea-citizenship-at-birth-by-parent',
      'north-korea-citizenship-by-parent',
      'north-korea-naturalization-by-petition',
      'north-macedonia-citizenship-at-birth-by-parent',
      'north-macedonia-citizenship-by-marriage',
      'north-macedonia-citizenship-by-parent',
      'north-macedonia-naturalization',
      'northern-mariana-islands-citizenship-at-birth',
      'northern-mariana-islands-nationality-by-descent',
      'northern-mariana-islands-naturalization',
      'norway-citizenship-at-birth-by-parent',
      'norway-citizenship-by-marriage',
      'norway-citizenship-by-parent',
      'norway-naturalization',
      'nz-citizenship-by-birth',
      'nz-citizenship-by-descent',
      'nz-citizenship-by-grant',
      'oman-citizenship-at-birth-by-parent',
      'oman-citizenship-by-marriage',
      'oman-citizenship-by-parent',
      'oman-naturalization',
      'pakistan-citizenship-at-birth-by-parent',
      'pakistan-citizenship-by-marriage',
      'pakistan-citizenship-by-parent',
      'pakistan-commonwealth-investment-citizenship',
      'pakistan-naturalization',
      'palau-citizenship-at-birth-by-parent',
      'palau-citizenship-by-parent',
      'palau-naturalization',
      'palestine-status-at-birth',
      'palestine-status-by-descent',
      'panama-family-naturalization',
      'panama-nationality-by-birth',
      'panama-nationality-through-parent',
      'panama-ordinary-naturalization',
      'panama-spain-latin-american-reciprocity-naturalization',
      'papua-new-guinea-citizenship-at-birth-by-parent',
      'papua-new-guinea-citizenship-by-parent',
      'papua-new-guinea-investor-naturalization',
      'papua-new-guinea-naturalization',
      'paraguay-citizenship-by-birth',
      'paraguay-citizenship-by-parent',
      'paraguay-naturalization',
      'peru-citizenship-at-birth',
      'peru-citizenship-by-marriage',
      'peru-citizenship-by-parent',
      'peru-naturalization',
      'philippines-citizenship-at-birth-by-parent',
      'philippines-citizenship-by-marriage',
      'philippines-citizenship-by-parent-or-reacquisition',
      'philippines-naturalization',
      'pitcairn-islands-citizenship-at-birth',
      'pitcairn-islands-nationality-by-descent',
      'pitcairn-islands-naturalization',
      'poland-citizenship-at-birth-by-parent',
      'poland-citizenship-by-marriage',
      'poland-citizenship-by-parent',
      'poland-recognition-by-residence',
      'portugal-citizenship-by-marriage',
      'portugal-citizenship-by-parent',
      'portugal-great-grandchild-naturalization',
      'portugal-sephardic-naturalization',
      'puerto-rico-citizenship-at-birth',
      'puerto-rico-nationality-by-descent',
      'puerto-rico-naturalization',
      'qatar-citizenship-at-birth-by-parent',
      'qatar-citizenship-by-marriage',
      'qatar-citizenship-by-parent',
      'qatar-naturalization',
      'romania-citizenship-at-birth-by-parent',
      'romania-citizenship-by-marriage',
      'romania-citizenship-by-parent',
      'romania-naturalization',
      'russia-citizenship-at-birth-by-parent',
      'russia-citizenship-by-marriage',
      'russia-citizenship-by-parent',
      'russia-naturalization',
      'russia-simplified-naturalization-heritage',
      'rwanda-citizenship-at-birth-by-parent',
      'rwanda-citizenship-by-marriage',
      'rwanda-citizenship-by-parent',
      'rwanda-naturalization',
      'saint-barthelemy-citizenship-at-birth',
      'saint-barthelemy-nationality-by-descent',
      'saint-barthelemy-naturalization',
      'saint-helena-citizenship-at-birth',
      'saint-helena-nationality-by-descent',
      'saint-helena-naturalization',
      'saint-lucia-citizenship-by-birth',
      'saint-lucia-citizenship-by-parent-or-grandparent',
      'saint-lucia-naturalization',
      'saint-martin-citizenship-at-birth',
      'saint-martin-nationality-by-descent',
      'saint-martin-naturalization',
      'saint-pierre-and-miquelon-citizenship-at-birth',
      'saint-pierre-and-miquelon-nationality-by-descent',
      'saint-pierre-and-miquelon-naturalization',
      'saint-vincent-citizenship-at-birth-by-parent',
      'saint-vincent-citizenship-by-parent',
      'saint-vincent-naturalization',
      'samoa-citizenship-at-birth-by-parent',
      'samoa-citizenship-by-parent',
      'samoa-naturalization',
      'san-marino-citizenship-at-birth-by-parent',
      'san-marino-citizenship-by-parent',
      'san-marino-naturalization',
      'sao-tome-citizenship-by-birth',
      'sao-tome-citizenship-by-marriage',
      'sao-tome-citizenship-by-parent-or-grandparent',
      'sao-tome-naturalization',
      'saudi-arabia-citizenship-at-birth-by-parent',
      'saudi-arabia-citizenship-by-parent',
      'saudi-arabia-naturalization',
      'senegal-citizenship-at-birth-by-parent',
      'senegal-citizenship-by-marriage',
      'senegal-citizenship-by-parent',
      'senegal-naturalization',
      'serbia-admission-after-permanent-residence',
      'serbia-citizenship-by-birth-statelessness',
      'serbia-citizenship-by-descent',
      'serbia-citizenship-by-marriage',
      'seychelles-citizenship-at-birth-by-parent',
      'seychelles-citizenship-by-parent',
      'seychelles-naturalization',
      'sierra-leone-citizenship-at-birth-by-parent',
      'sierra-leone-citizenship-by-parent',
      'sierra-leone-naturalization',
      'singapore-citizenship-after-pr',
      'singapore-citizenship-by-birth',
      'singapore-citizenship-by-descent',
      'singapore-citizenship-by-marriage',
      'sint-maarten-citizenship-at-birth',
      'sint-maarten-nationality-by-descent',
      'sint-maarten-naturalization',
      'slovakia-citizenship-at-birth-by-parent',
      'slovakia-citizenship-by-marriage',
      'slovakia-citizenship-by-parent',
      'slovakia-naturalization',
      'slovenia-citizenship-at-birth-by-parent',
      'slovenia-citizenship-by-marriage',
      'slovenia-citizenship-by-parent',
      'slovenia-naturalization',
      'solomon-islands-citizenship-at-birth-by-parent',
      'solomon-islands-citizenship-by-parent',
      'solomon-islands-naturalization',
      'somalia-citizenship-at-birth-by-parent',
      'somalia-citizenship-by-marriage',
      'somalia-citizenship-by-parent',
      'somalia-naturalization',
      'south-africa-citizenship-at-birth-by-parent',
      'south-africa-citizenship-by-marriage',
      'south-africa-citizenship-by-parent',
      'south-africa-naturalization',
      'south-sudan-citizenship-at-birth-by-parent',
      'south-sudan-citizenship-by-marriage',
      'south-sudan-citizenship-by-parent',
      'south-sudan-naturalization',
      'spain-carta-de-naturaleza',
      'spain-citizenship-by-birth',
      'spain-citizenship-by-parent-or-option',
      'spain-democratic-memory-option',
      'spain-naturalization-by-residence',
      'sri-lanka-citizenship-at-birth-by-parent',
      'sri-lanka-citizenship-by-descent',
      'sri-lanka-naturalization',
      'st-kitts-nevis-citizenship-by-birth',
      'st-kitts-nevis-citizenship-by-parent',
      'st-kitts-nevis-naturalization',
      'sudan-citizenship-at-birth-by-parent',
      'sudan-citizenship-by-marriage',
      'sudan-citizenship-by-parent',
      'sudan-naturalization',
      'suriname-citizenship-at-birth-by-parent',
      'suriname-citizenship-by-parent',
      'suriname-naturalization',
      'sweden-citizenship-at-birth-by-parent',
      'sweden-citizenship-by-parent',
      'sweden-naturalization',
      'switzerland-citizenship-by-descent',
      'switzerland-citizenship-by-marriage',
      'switzerland-ordinary-naturalization',
      'switzerland-third-generation-naturalization',
      'syria-citizenship-at-birth-by-parent',
      'syria-citizenship-by-parent',
      'syria-naturalization',
      'taiwan-citizenship-at-birth-by-parent',
      'taiwan-citizenship-by-marriage',
      'taiwan-citizenship-by-parent',
      'taiwan-naturalization',
      'tajikistan-citizenship-at-birth-by-parent',
      'tajikistan-citizenship-by-parent',
      'tajikistan-naturalization',
      'tanzania-citizenship-at-birth-by-parent',
      'tanzania-citizenship-by-marriage',
      'tanzania-citizenship-by-parent',
      'tanzania-naturalization',
      'thailand-citizenship-at-birth-by-parent',
      'thailand-citizenship-by-marriage',
      'thailand-citizenship-by-parent',
      'thailand-naturalization',
      'timor-leste-citizenship-at-birth-by-parent',
      'timor-leste-citizenship-by-marriage',
      'timor-leste-citizenship-by-parent',
      'timor-leste-naturalization',
      'togo-citizenship-at-birth-by-parent',
      'togo-citizenship-by-marriage',
      'togo-citizenship-by-parent',
      'togo-naturalization',
      'tokelau-citizenship-at-birth',
      'tokelau-nationality-by-descent',
      'tokelau-naturalization',
      'tonga-citizenship-at-birth-by-parent',
      'tonga-citizenship-by-parent',
      'tonga-naturalization',
      'trinidad-and-tobago-citizenship-at-birth-by-parent',
      'trinidad-and-tobago-citizenship-by-parent',
      'trinidad-and-tobago-naturalization',
      'tunisia-citizenship-at-birth-by-parent',
      'tunisia-citizenship-by-marriage',
      'tunisia-citizenship-by-parent',
      'tunisia-naturalization',
      'turkiye-citizenship-by-birth-statelessness',
      'turkiye-citizenship-by-descent',
      'turkiye-naturalization-by-residence',
      'turkmenistan-citizenship-at-birth-by-parent',
      'turkmenistan-citizenship-by-parent',
      'turkmenistan-naturalization',
      'turks-and-caicos-citizenship-at-birth',
      'turks-and-caicos-nationality-by-descent',
      'turks-and-caicos-naturalization',
      'tuvalu-citizenship-at-birth-by-parent',
      'tuvalu-citizenship-by-parent',
      'tuvalu-naturalization',
      'uae-citizenship-at-birth-qualifying-parent',
      'uae-citizenship-by-father',
      'uae-citizenship-by-marriage',
      'uae-exceptional-naturalization',
      'uae-investor-nationality-nomination',
      'uganda-citizenship-at-birth-by-parent',
      'uganda-citizenship-by-marriage',
      'uganda-citizenship-by-parent',
      'uganda-naturalization',
      'uk-citizenship-by-birth',
      'uk-citizenship-by-parent',
      'uk-naturalization-after-settlement',
      'ukraine-citizenship-at-birth-by-parent',
      'ukraine-citizenship-by-marriage',
      'ukraine-citizenship-by-parent',
      'ukraine-naturalization',
      'uruguay-citizenship-by-marriage',
      'uruguay-legal-citizenship-by-residence',
      'uruguay-nationality-by-birth',
      'uruguay-nationality-by-parent',
      'us-citizenship-at-birth-abroad',
      'us-citizenship-by-birth',
      'us-citizenship-by-marriage',
      'us-naturalization-after-lpr',
      'us-virgin-islands-citizenship-at-birth',
      'us-virgin-islands-nationality-by-descent',
      'us-virgin-islands-naturalization',
      'uzbekistan-citizenship-at-birth-by-parent',
      'uzbekistan-citizenship-by-parent',
      'uzbekistan-naturalization',
      'vanuatu-citizenship-at-birth-by-parent',
      'vanuatu-citizenship-by-parent',
      'vanuatu-naturalization',
      'vatican-citizenship-by-office',
      'vatican-derivative-family-citizenship',
      'venezuela-citizenship-by-birth',
      'venezuela-citizenship-by-parent',
      'venezuela-naturalization-by-residence',
      'vietnam-citizenship-at-birth-by-parent',
      'vietnam-citizenship-by-marriage',
      'vietnam-citizenship-by-parent',
      'vietnam-naturalization',
      'wallis-and-futuna-citizenship-at-birth',
      'wallis-and-futuna-nationality-by-descent',
      'wallis-and-futuna-naturalization',
      'yemen-citizenship-at-birth-by-parent',
      'yemen-citizenship-by-parent',
      'yemen-naturalization',
      'zambia-citizenship-at-birth-by-parent',
      'zambia-citizenship-by-marriage',
      'zambia-citizenship-by-parent',
      'zambia-naturalization',
      'zimbabwe-citizenship-at-birth-by-parent',
      'zimbabwe-citizenship-by-marriage',
      'zimbabwe-citizenship-by-parent',
      'zimbabwe-naturalization',
    ])
    expect(release.frontend.citizenship.routes.filter(
      route => route.country.iso_n3 === '250',
    )).toHaveLength(6);
    expect(release.frontend.citizenship.routes.find(
      route => route.id === 'portugal-citizenship-by-parent',
    )?.sources.length).toBeGreaterThan(0);
  });

  test('frontend country details preserve named canonical pathways', () => {
    const spainResidence = release.frontend.citizenship.routes.find(
      route => route.id === 'spain-naturalization-by-residence',
    );
    expect(spainResidence?.pathways?.map(pathway => pathway.id)).toEqual([
      'ordinary',
      'recognized_refugee',
      'iberoamerican_two_years',
      'sephardic_two_years',
      'married_to_spanish_one_year',
      'born_in_spain',
    ]);
    expect(spainResidence?.pathways).toContainEqual(expect.objectContaining({
      id: 'iberoamerican_two_years',
      eligibility_months: 24,
      allocation: 'discretionary',
    }));
    expect(spainResidence?.pathways).toContainEqual(expect.objectContaining({
      id: 'born_in_spain',
      eligibility_months: 12,
      allocation: 'discretionary',
    }));
    expect(spainResidence?.summary).toContain('two for nationals of Ibero-American countries');

    const colombiaNat = release.frontend.citizenship.routes.find(
      route => route.id === 'colombia-naturalization-by-residence',
    );
    expect(colombiaNat?.pathways?.map(pathway => pathway.id)).toEqual([
      'ordinary_five_years',
      'family_two_years',
      'spanish_national_two_years',
      'reciprocal_origin_two_years',
    ]);
    expect(colombiaNat?.pathways).toContainEqual(expect.objectContaining({
      id: 'spanish_national_two_years',
      eligibility_months: 24,
    }));
    expect(colombiaNat?.summary).toContain('Spanish national');

    const panamaReciprocity = release.frontend.citizenship.routes.find(
      route => route.id === 'panama-spain-latin-american-reciprocity-naturalization',
    );
    expect(panamaReciprocity?.pathways).toContainEqual(expect.objectContaining({
      id: 'spanish_birth_national_two_years',
      eligibility_months: 24,
    }));
    expect(panamaReciprocity?.summary).toContain('Article 10(3)');

    const franceBirth = release.frontend.citizenship.routes.find(
      route => route.id === 'france-birth-and-residence',
    );
    expect(franceBirth?.pathways?.map(pathway => pathway.id)).toEqual([
      'parent_born_in_france',
      'no_nationality_transmitted',
      'declaration_from_age_13',
      'declaration_from_age_16',
      'automatic_at_majority',
    ]);
    expect(franceBirth?.summary).toContain('Birth in France alone is not generally enough');
  });

  test('legacy remainder byte parity partitions source and pilot exactly', () => {
    expect(gate('legacy_remainder_byte_parity').status).toBe('pass');
  });
});

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('data:build determinism and writes', () => {
  test('two compiles from the same database are byte-identical', () => {
    const second = compileDataRelease({ dbPath, root: REPO_ROOT });
    expect(second.manifest.release_id).toBe(release.manifest.release_id);
    expect(JSON.stringify(second.manifest)).toBe(JSON.stringify(release.manifest));
    expect(JSON.stringify(second.frontend)).toBe(JSON.stringify(release.frontend));
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
        'data/citizenship_routes.json',
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
        'mode-coverage.json',
        'timelines.json',
        'arrangement-projections.json',
        'api_release_rows.json',
        'compatibility/blocs_data.json',
        'compatibility/citizenship_routes.json',
        'frontend/citizenship_routes.json',
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

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('data:build changelog uses an explicit baseline', () => {
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

describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)('deepDiff drift engine', () => {
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

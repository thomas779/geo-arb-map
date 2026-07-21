import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCanonicalPilot } from '../scripts/lib/canonical-pilot';
import { readCanonicalMigrations } from '../scripts/lib/d1-migrations';
import { importCanonicalPilot } from '../scripts/lib/canonical-store';
import { compileDataRelease } from '../scripts/lib/data-build';
import { renderDataReview } from '../scripts/lib/data-review';

describe('canonical review packet', () => {
  test('covers every selected revision and material review section deterministically', () => {
    const root = process.cwd();
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'data-review-'));
    const databasePath = path.join(temporary, 'canonical.sqlite');
    const migration = readCanonicalMigrations(root);
    const pilot = buildCanonicalPilot();
    const database = new Database(databasePath, { create: true, strict: true });
    database.exec(migration);
    importCanonicalPilot(database, pilot);
    database.close();
    const release = compileDataRelease({ dbPath: databasePath, root });

    const first = renderDataReview(release);
    const second = renderDataReview(release);

    expect(first).toBe(second);
    for (const row of release.api_release_rows) {
      expect(first).toContain(row.entity_id);
      expect(first).toContain(row.revision_id);
      expect(first).toContain(row.content_hash);
    }
    for (const source of release.sources) {
      expect(first).toContain(source.url);
    }
    expect(first).toContain('## Approval checklist');
    expect(first).toContain('## Sanctioned differences');
    expect(first).toContain('## Parity gates');
    expect(first).toContain('Spain 2-year naturalization (Ibero-American)');
    expect(first).toContain('Overall parity: **passed**');

    fs.rmSync(temporary, { recursive: true, force: true });
  });
});

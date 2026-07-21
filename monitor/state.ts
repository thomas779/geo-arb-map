import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type PageHealth = 'healthy' | 'redirected' | 'missing' | 'blocked' | 'error';
export type ChangeKind = 'baseline' | 'unchanged' | 'page_changed' | 'access_changed' | 'fetch_failed';

export interface MonitorPageState {
  page_id: string;
  source_id: string;
  url: string;
  jurisdiction: string;
  state: PageHealth;
  last_success_hash: string | null;
  previous_text: string | null;
  current_text: string | null;
  etag: string | null;
  last_modified: string | null;
  final_url: string | null;
  last_http_status: number | null;
  last_attempted_at: string;
  last_success_retrieved_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
  updated_at: string;
}

export interface PageObservation {
  page_id: string;
  source_id: string;
  jurisdiction: string;
  attempted_at: string;
  state: PageHealth;
  change_kind: ChangeKind;
  http_status: number | null;
  requested_url: string;
  final_url: string | null;
  previous_hash: string | null;
  current_hash: string | null;
  previous_text: string | null;
  current_text: string | null;
  text_diff: string | null;
  etag: string | null;
  last_modified: string | null;
  error: string | null;
}

function sql(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function observationId(observation: PageObservation): string {
  return createHash('sha256').update(JSON.stringify([
    observation.page_id,
    observation.attempted_at,
    observation.state,
    observation.change_kind,
    observation.current_hash,
  ])).digest('hex').slice(0, 24);
}

export class MonitorStateStore {
  readonly database: Database;
  readonly mutations: string[] = [];
  private temporaryDirectory: string | null = null;

  constructor(root: string, inputPath?: string | null) {
    if (inputPath?.endsWith('.sql')) {
      this.temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-paths-monitor-'));
      const sqlitePath = path.join(this.temporaryDirectory, 'state.sqlite');
      this.database = new Database(sqlitePath, { create: true, strict: true });
      this.database.exec(fs.readFileSync(inputPath, 'utf8'));
    } else {
      this.database = new Database(inputPath || ':memory:', { create: true, strict: true });
    }
    this.database.exec(fs.readFileSync(
      path.join(root, 'data/d1/migrations/0003_monitor_state.sql'),
      'utf8',
    ));
  }

  getPage(pageId: string): MonitorPageState | null {
    return this.database.query(
      'SELECT * FROM monitor_pages WHERE page_id = ?1',
    ).get(pageId) as MonitorPageState | null;
  }

  record(observation: PageObservation): void {
    const existing = this.getPage(observation.page_id);
    const success = observation.state === 'healthy' || observation.state === 'redirected';
    const changed = observation.change_kind === 'page_changed';
    const previousText = success
      ? (changed ? observation.previous_text : existing?.previous_text ?? null)
      : existing?.previous_text ?? null;
    const currentText = success ? observation.current_text : existing?.current_text ?? null;
    const lastSuccessHash = success ? observation.current_hash : existing?.last_success_hash ?? null;
    const lastSuccessAt = success
      ? observation.attempted_at
      : existing?.last_success_retrieved_at ?? null;
    const failures = success ? 0 : (existing?.consecutive_failures ?? 0) + 1;

    const pageValues = [
      observation.page_id, observation.source_id, observation.requested_url,
      observation.jurisdiction, observation.state, lastSuccessHash, previousText,
      currentText, observation.etag ?? existing?.etag ?? null,
      observation.last_modified ?? existing?.last_modified ?? null,
      observation.final_url, observation.http_status, observation.attempted_at,
      lastSuccessAt, failures, observation.error, observation.attempted_at,
    ];
    const pageSql = `INSERT INTO monitor_pages (
      page_id, source_id, url, jurisdiction, state, last_success_hash,
      previous_text, current_text, etag, last_modified, final_url,
      last_http_status, last_attempted_at, last_success_retrieved_at,
      consecutive_failures, last_error, updated_at
    ) VALUES (${pageValues.map(sql).join(', ')})
    ON CONFLICT(page_id) DO UPDATE SET
      source_id=excluded.source_id, url=excluded.url, jurisdiction=excluded.jurisdiction,
      state=excluded.state, last_success_hash=excluded.last_success_hash,
      previous_text=excluded.previous_text, current_text=excluded.current_text,
      etag=excluded.etag, last_modified=excluded.last_modified,
      final_url=excluded.final_url, last_http_status=excluded.last_http_status,
      last_attempted_at=excluded.last_attempted_at,
      last_success_retrieved_at=excluded.last_success_retrieved_at,
      consecutive_failures=excluded.consecutive_failures,
      last_error=excluded.last_error, updated_at=excluded.updated_at;`;

    const observationValues = [
      observationId(observation), observation.page_id, observation.source_id,
      observation.attempted_at, observation.state, observation.change_kind,
      observation.http_status, observation.requested_url, observation.final_url,
      observation.previous_hash, observation.current_hash, observation.previous_text,
      observation.current_text, observation.text_diff, observation.etag,
      observation.last_modified, observation.error,
    ];
    const observationSql = `INSERT OR IGNORE INTO monitor_observations (
      id, page_id, source_id, attempted_at, state, change_kind, http_status,
      requested_url, final_url, previous_hash, current_hash, previous_text,
      current_text, text_diff, etag, last_modified, error
    ) VALUES (${observationValues.map(sql).join(', ')});`;

    this.database.transaction(() => {
      this.database.exec(pageSql);
      this.database.exec(observationSql);
    })();
    this.mutations.push(pageSql, observationSql);
  }

  writeMutations(outputPath: string): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${this.mutations.join('\n')}\n`);
  }

  close(): void {
    this.database.close();
    if (this.temporaryDirectory) fs.rmSync(this.temporaryDirectory, { recursive: true, force: true });
  }
}

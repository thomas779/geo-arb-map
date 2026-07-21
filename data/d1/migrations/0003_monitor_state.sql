CREATE TABLE IF NOT EXISTS monitor_pages (
  page_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('healthy', 'redirected', 'missing', 'blocked', 'error')
  ),
  last_success_hash TEXT,
  previous_text TEXT,
  current_text TEXT,
  etag TEXT,
  last_modified TEXT,
  final_url TEXT,
  last_http_status INTEGER,
  last_attempted_at TEXT NOT NULL,
  last_success_retrieved_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS monitor_pages_source
  ON monitor_pages (source_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS monitor_observations (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('healthy', 'redirected', 'missing', 'blocked', 'error')
  ),
  change_kind TEXT NOT NULL CHECK (
    change_kind IN ('baseline', 'unchanged', 'page_changed', 'access_changed', 'fetch_failed')
  ),
  http_status INTEGER,
  requested_url TEXT NOT NULL,
  final_url TEXT,
  previous_hash TEXT,
  current_hash TEXT,
  previous_text TEXT,
  current_text TEXT,
  text_diff TEXT,
  etag TEXT,
  last_modified TEXT,
  error TEXT,
  FOREIGN KEY (page_id) REFERENCES monitor_pages(page_id)
);

CREATE INDEX IF NOT EXISTS monitor_observations_page
  ON monitor_observations (page_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS monitor_observations_review_queue
  ON monitor_observations (change_kind, attempted_at DESC);

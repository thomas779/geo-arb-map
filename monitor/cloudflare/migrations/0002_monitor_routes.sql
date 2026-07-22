CREATE TABLE IF NOT EXISTS monitor_routes (
  source_id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  allowed_sender_domains TEXT NOT NULL, -- JSON array of lowercased sender domains
  canonical_hosts TEXT NOT NULL,        -- JSON array of lowercased canonical hosts
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS monitor_routes_recipient
  ON monitor_routes (recipient);

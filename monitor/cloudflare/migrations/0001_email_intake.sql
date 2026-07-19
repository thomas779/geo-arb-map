CREATE TABLE IF NOT EXISTS email_intake (
  message_hash TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'ignored', 'dispatched', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_key TEXT,
  canonical_url TEXT,
  subject TEXT,
  last_error TEXT,
  dispatched_at TEXT
);

CREATE INDEX IF NOT EXISTS email_intake_source_received
  ON email_intake (source_id, received_at DESC);

CREATE INDEX IF NOT EXISTS email_intake_status_updated
  ON email_intake (status, updated_at DESC);

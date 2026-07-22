-- Dedup ledger for auto-published Telegram news. One row per published change so
-- the same finding is never posted twice across runs. Lives on flag-paths-data.
CREATE TABLE IF NOT EXISTS monitor_posts (
  fingerprint TEXT PRIMARY KEY,          -- sha1(iso_n3 | normalized_claim | effective_date)
  iso_n3 TEXT NOT NULL,
  category TEXT,
  status TEXT,
  telegram_message_id INTEGER,
  primary_url TEXT,
  posted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS monitor_posts_iso_posted
  ON monitor_posts (iso_n3, posted_at DESC);

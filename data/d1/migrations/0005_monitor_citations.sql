-- Discovery citation ledger. Every grounded sweep cites the outlets it read to
-- surface a change; those citations are the empirical answer to "which outlets
-- report on mobility law changes, and for which countries." We accumulate one
-- row per unique cited URL so the candidate-source analyzer
-- (monitor:sources:candidates) can rank outlets by how often — and for how many
-- jurisdictions — they surface real changes, and propose feeds to subscribe to.
-- Lives on flag-paths-data alongside monitor_posts.
CREATE TABLE IF NOT EXISTS monitor_citations (
  url TEXT PRIMARY KEY,          -- unique cited source URL (repeats collapse here)
  domain TEXT NOT NULL,          -- host without leading www., for aggregation
  source_key TEXT NOT NULL,      -- domain, or domain/@account for social hosts
  iso_n3 TEXT,                   -- jurisdiction of the finding that cited it
  status TEXT,                   -- finding status; 'confirmed' weighs highest
  title TEXT,
  seen_at TEXT NOT NULL          -- first time we recorded this URL
);

CREATE INDEX IF NOT EXISTS monitor_citations_key_seen
  ON monitor_citations (source_key, seen_at DESC);

-- display_strength is a legacy display TIER, not a normalised score: 1 is the
-- strongest rung, 3 the weakest, and 0 is reserved for bilateral lanes, which
-- project no strength at all and carry the column as structural filler.
--
-- 0001 declared `display_strength >= 0 AND display_strength <= 1`. That bound was
-- never modelled — it was generalised from the only two blocs canonical at the
-- time (eu_eea and mercosur, both tier 1) plus the lanes' 0, and it read the
-- column as a 0-1 fraction. Fourteen of the 24 legacy blocs are tier 2 or 3, so
-- the constraint rejected valid source data the moment #162 migrated a third
-- bloc. Corrected to the domain the data actually has, and narrowed at the same
-- time: the column is now an integer tier, not an arbitrary real in a range.
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt. This is
-- append-only migration history rather than an edit to 0001, so that a fresh
-- local build and the deployed D1 database converge on the same schema.
--
-- Safe to run against populated data: rows are copied before the swap, and every
-- existing row already satisfies the new constraint (tiers 0 and 1 were all the
-- old bound permitted, and both remain legal). Dependent tables key on
-- revision_id, which is preserved verbatim.

PRAGMA foreign_keys = OFF;

CREATE TABLE arrangement_index_new (
  revision_id TEXT PRIMARY KEY,
  arrangement_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('regional', 'bilateral', 'heritage')
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'pending')),
  directionality TEXT NOT NULL CHECK (
    directionality IN ('symmetric', 'asymmetric')
  ),
  name TEXT NOT NULL,
  display_category TEXT NOT NULL CHECK (
    display_category IN ('full', 'partial', 'hub_spoke', 'one_way', 'closed', 'proto')
  ),
  display_strength INTEGER NOT NULL CHECK (
    display_strength >= 0 AND display_strength <= 3
  ),
  review_state TEXT NOT NULL CHECK (
    review_state IN ('unchecked', 'legacy', 'pending', 'partial', 'reviewed')
  ),
  review_confidence TEXT NOT NULL CHECK (
    review_confidence IN ('high', 'medium', 'low')
  ),
  last_checked TEXT,
  FOREIGN KEY (revision_id) REFERENCES canonical_revisions(id) ON DELETE CASCADE
);

INSERT INTO arrangement_index_new (
  revision_id, arrangement_id, kind, status, directionality, name,
  display_category, display_strength, review_state, review_confidence, last_checked
)
SELECT
  revision_id, arrangement_id, kind, status, directionality, name,
  display_category, CAST(display_strength AS INTEGER), review_state,
  review_confidence, last_checked
FROM arrangement_index;

DROP TABLE arrangement_index;

ALTER TABLE arrangement_index_new RENAME TO arrangement_index;

CREATE INDEX arrangement_index_kind_status
  ON arrangement_index (kind, status);

-- Recreated with the table: dropping arrangement_index dropped its trigger too.
CREATE TRIGGER arrangement_index_requires_arrangement_entity
BEFORE INSERT ON arrangement_index
WHEN NOT EXISTS (
  SELECT 1
  FROM canonical_revisions AS revision
  JOIN canonical_entities AS entity ON entity.id = revision.entity_id
  WHERE revision.id = NEW.revision_id
    AND entity.entity_type = 'arrangement'
)
BEGIN
  SELECT RAISE(ABORT, 'arrangement index revision must belong to an arrangement entity');
END;

PRAGMA foreign_keys = ON;

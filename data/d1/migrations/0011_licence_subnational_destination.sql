-- #210 follow-on: a DESTINATION can be a province or a state, and then it has no
-- ISO at all.
--
-- Thirteen of the destinations authored from the Americas research are sub-units
-- that publish their own recognised-jurisdiction lists: Alberta, British Columbia
-- and Ontario, and the states of Connecticut, Delaware, Georgia, Indiana, Kentucky,
-- Louisiana, Oregon, Vermont, Virginia and Wisconsin. There is no Canadian or US
-- federal driving licence and no federal exchange list, so writing a row for Canada
-- or for the United States would assert a federal arrangement that does not exist —
-- the same finding the Swiss bilaterals forced on the ORIGIN side (0007's
-- subnational_label column), arriving here on the destination side.
--
-- 0007 declared destination_iso_n3 NOT NULL, and SQLite cannot ALTER a NOT NULL
-- away, so the table is rebuilt exactly as 0010 rebuilt licence_agreement_index.
-- The licence tables are wipe-and-reimport on every sync, so the data loss is
-- nominal: the rows are rewritten from data/compiled/licence_exchange.json
-- immediately afterwards.

DELETE FROM licence_exchange_index;

CREATE TABLE licence_exchange_index_new (
  -- NULL for a sub-national destination. NOT a placeholder ISO and NOT the parent
  -- federation's code: either would put Canada or the United States into a query
  -- that asks which states grant an exchange, which is the claim this column exists
  -- to avoid making.
  destination_iso_n3 TEXT,
  -- The destination sub-unit's own name ("Alberta", "Kentucky"), set exactly where
  -- destination_iso_n3 is NULL. Distinct from subnational_label below, which names
  -- the ORIGIN sub-unit — a row can carry both (Ontario exchanging a U.S. state
  -- licence) and collapsing them into one column would make that row unreadable.
  destination_subnational_label TEXT,
  agreement_id TEXT REFERENCES licence_agreement_index (agreement_id) ON DELETE SET NULL,
  origin_iso_n3 TEXT,
  subnational_label TEXT,
  origin_label_en TEXT NOT NULL,
  classes TEXT,
  -- NULL means NOT RECORDED, never "not required". Unchanged from 0007, and the
  -- rebuild is the moment that rule is easiest to lose.
  theory_test_required INTEGER CHECK (theory_test_required IN (0, 1)),
  practical_test_required INTEGER CHECK (practical_test_required IN (0, 1)),
  nationality_gate TEXT CHECK (nationality_gate IN ('all', 'nationals_only', 'gcc')),
  exchange_deadline_months INTEGER,
  foreign_licence_grace_months INTEGER,
  row_id INTEGER PRIMARY KEY AUTOINCREMENT
);

DROP TABLE licence_exchange_index;

ALTER TABLE licence_exchange_index_new RENAME TO licence_exchange_index;

-- COALESCE on the destination columns too, not only on the origin ones. NULLs never
-- compare equal in SQLite, so a plain composite over a now-nullable
-- destination_iso_n3 would let every sub-national destination duplicate silently —
-- Oregon, Virginia and Wisconsin all list Taiwan, and all three would key as
-- (NULL, 'Taiwan', '', '').
CREATE UNIQUE INDEX IF NOT EXISTS licence_exchange_natural_key
  ON licence_exchange_index (
    COALESCE(destination_iso_n3, ''), COALESCE(destination_subnational_label, ''),
    origin_label_en, COALESCE(subnational_label, ''), COALESCE(classes, '')
  );

CREATE INDEX IF NOT EXISTS licence_exchange_by_origin
  ON licence_exchange_index (origin_iso_n3);
CREATE INDEX IF NOT EXISTS licence_exchange_by_gate
  ON licence_exchange_index (nationality_gate);
-- "Which sub-units grant an exchange without a federal instrument" is now a query.
CREATE INDEX IF NOT EXISTS licence_exchange_by_destination
  ON licence_exchange_index (destination_iso_n3, destination_subnational_label);

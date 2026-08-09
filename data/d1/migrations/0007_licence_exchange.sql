-- Driving-licence exchange: agreements between states, and the rows they cover.
--
-- Deliberately STANDALONE, following the monitor_* pattern (0003-0005) rather than
-- the canonical one. `arrangement_index` is the wrong model to copy: it is keyed on
-- a revision_id and carries a trigger requiring a canonical entity of type
-- 'arrangement', which binds it to the citizenship/residence corpus, its parity
-- gates and its release pipeline. Driving licences are a different rights domain —
-- who may drive on what document, not who may live and work where — and forcing
-- them through the canonical entity model would put a licence annex behind gates
-- designed for nationality law.
--
-- What this buys by living in D1 at all: durability beyond a served static file,
-- coverage by the backup-d1 job, and queryability. The source of truth stays
-- public/licence_exchange.json, which is version-controlled; these tables are its
-- indexed projection, wiped and re-imported on each sync exactly like the canonical
-- indexes.

CREATE TABLE IF NOT EXISTS licence_agreement_index (
  agreement_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- The distinction the whole layer exists for. A treaty binds a counterparty; a
  -- domestic annex can be amended by one ministry alone. Denmark is the case that
  -- proves it matters: the foreign state APPLIES to join, so it looks bilateral,
  -- but no agreement is concluded and the decision is unappealable.
  kind TEXT NOT NULL CHECK (
    kind IN ('multilateral_instrument', 'bilateral_agreement', 'unilateral_recognition', 'unknown')
  ),
  directionality TEXT NOT NULL CHECK (
    directionality IN ('symmetric', 'asymmetric', 'unknown')
  ),
  instrument TEXT NOT NULL,
  source_url TEXT NOT NULL,
  -- What the instrument actually confers. Recognition (you may drive on what you
  -- hold) and exchange (you may swap it) are different rights in different
  -- articles — 2(1) and 11 of Directive 2006/126/EC. Conflating them overstates
  -- every EU row.
  grants TEXT CHECK (grants IN ('recognition', 'exchange', 'recognition_and_exchange')),
  basis TEXT,
  -- 0 = the KIND is unconfirmed against the instrument, NOT that the arrangement is
  -- doubtful. Typing an arrangement from the title of the page that publishes it is
  -- a hypothesis. Mirrors BLOC_RIGHTS.verified in the canonical corpus.
  kind_verified INTEGER NOT NULL DEFAULT 0 CHECK (kind_verified IN (0, 1)),
  superseded_from TEXT
);

-- Who is on each side. Kept as rows rather than a JSON blob so "which agreements
-- cover Paraguay" is a query, and so direction survives: under a unilateral annex
-- one side grants and the other receives, and merging them would imply a
-- reciprocity that does not exist.
CREATE TABLE IF NOT EXISTS licence_agreement_participants (
  agreement_id TEXT NOT NULL REFERENCES licence_agreement_index (agreement_id) ON DELETE CASCADE,
  iso_n3 TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('destination', 'beneficiary')),
  PRIMARY KEY (agreement_id, iso_n3, role)
);

-- One row per exchangeable origin, per destination.
CREATE TABLE IF NOT EXISTS licence_exchange_index (
  destination_iso_n3 TEXT NOT NULL,
  agreement_id TEXT REFERENCES licence_agreement_index (agreement_id) ON DELETE SET NULL,
  origin_iso_n3 TEXT,
  -- Set for sub-national origins (US states, Canadian provinces, Australian
  -- states), which is why origin_iso_n3 alone cannot be the key.
  subnational_label TEXT,
  origin_label_en TEXT NOT NULL,
  classes TEXT,
  -- NULL means NOT RECORDED, never "not required". A missing test flag must not
  -- render as "no test needed" — the same rule that governs max_age and
  -- work_rights in the canonical corpus.
  theory_test_required INTEGER CHECK (theory_test_required IN (0, 1)),
  practical_test_required INTEGER CHECK (practical_test_required IN (0, 1)),
  row_id INTEGER PRIMARY KEY AUTOINCREMENT
);

-- Uniqueness is on the natural key, which INCLUDES the class set. One origin can
-- appear more than once for the same destination with different requirements per
-- licence class: Germany lists Albania twice, once for A1/A2/A/B/BE/C/D (no test)
-- and once for AM alone (practical test required). Keying without `classes` silently
-- dropped the moped row — the constraint caught it, which is the point of having it.
--
-- An expression index rather than a table constraint because SQLite forbids
-- expressions in PRIMARY KEY and UNIQUE, and subnational_label is legitimately NULL
-- for national rows (NULLs never compare equal, so a plain composite would admit
-- duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS licence_exchange_natural_key
  ON licence_exchange_index (
    destination_iso_n3, origin_label_en, COALESCE(subnational_label, ''), COALESCE(classes, '')
  );

CREATE INDEX IF NOT EXISTS licence_exchange_by_origin
  ON licence_exchange_index (origin_iso_n3);
CREATE INDEX IF NOT EXISTS licence_agreement_participants_by_iso
  ON licence_agreement_participants (iso_n3, role);
CREATE INDEX IF NOT EXISTS licence_agreement_by_kind
  ON licence_agreement_index (kind);

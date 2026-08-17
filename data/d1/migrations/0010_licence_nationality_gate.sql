-- #210: the nationality gate, the two exchange clocks, and a `grants` that can
-- decline to assert.
--
-- 0007 is already applied to the live database, and `ensureLicenceSchema` in
-- scripts/sync_canonical_d1.ts is pure CREATE IF NOT EXISTS — it converges a MISSING
-- table and does nothing at all to an existing one. So a column added to 0007 would
-- never reach D1, and the next sync would fail mid-write inserting a column the
-- remote table does not have. This is that ALTER path, applied by inspection the way
-- 0006 is (see migrateRemoteSchema): read the live DDL, run this only when the new
-- shape is absent.
--
-- The licence tables are wipe-and-reimport on every sync, so the DELETEs below cost
-- nothing: the rows are rewritten from public JSON immediately afterwards, and
-- emptying the children first is what lets licence_agreement_index be rebuilt
-- without PRAGMA foreign_keys juggling (which the D1 REST endpoint rejects anyway).

DELETE FROM licence_exchange_index;
DELETE FROM licence_agreement_participants;
DELETE FROM licence_agreement_index;

-- ── 1. The nationality gate ──
--
-- RTA Dubai gates each origin on the HOLDER'S NATIONALITY, not on the licence: 20 of
-- its 60 origins accept the licence from anyone, 35 only from that country's own
-- nationals, and 5 (the GCC states) from nationals of any state on RTA's own
-- exception list. A German licence held by an Indian national exchanges in Dubai; a
-- Portuguese one held by the same person does not.
--
-- NULL means NOT RECORDED, never "open to all". Most destinations publish no
-- nationality rule anywhere, and that is SILENCE — defaulting it to 'all' would mint
-- a right for 44 destinations out of the fact that nobody wrote a restriction down.
-- Same rule as theory_test_required above it, and the reason there is no DEFAULT
-- clause on this column: a default is exactly how a silence becomes a claim.
ALTER TABLE licence_exchange_index ADD COLUMN nationality_gate TEXT
  CHECK (nationality_gate IN ('all', 'nationals_only', 'gcc'));

-- ── 2. Two clocks, never one ──
--
-- exchange_deadline_months is a deadline to CLAIM the exchange before the right
-- lapses. foreign_licence_grace_months is Türkiye's opposite: Karayolları Trafik
-- Yönetmeliği m.88(b) gives six months from the date of ENTRY during which you may
-- keep driving on the foreign licence, after which exchange becomes COMPULSORY. The
-- research files carry both as one `exchange_window_months`, where 6 means "hurry or
-- lose it" in one row and "you have time before you must" in the next. Two columns
-- that cannot be read as each other, rather than one column plus a direction flag
-- that a reader can forget to join.
--
-- Both are the RESOLVED value for the row (entry value, else the destination's),
-- because Italy's window varies by origin — four years for Albania, Argentina,
-- Switzerland and Ukraine, six for everyone else — and a destination-level column
-- could not hold that at all.
ALTER TABLE licence_exchange_index ADD COLUMN exchange_deadline_months INTEGER;
ALTER TABLE licence_exchange_index ADD COLUMN foreign_licence_grace_months INTEGER;

-- ── 3. grants gains a way to say "not established" ──
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt, exactly as 0006
-- rebuilt arrangement_index. Six of the destinations researched for #210 came back
-- cannot_determine — moi.gov.sa times out, mobilit.belgium.be serves a bot challenge
-- — and with only three affirmative values the row had to pick one and then deny it
-- in prose. A destination that asserts nothing must be able to say nothing.
CREATE TABLE licence_agreement_index_new (
  agreement_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('multilateral_instrument', 'bilateral_agreement', 'unilateral_recognition', 'unknown')
  ),
  directionality TEXT NOT NULL CHECK (
    directionality IN ('symmetric', 'asymmetric', 'unknown')
  ),
  instrument TEXT NOT NULL,
  source_url TEXT NOT NULL,
  grants TEXT CHECK (
    grants IN ('recognition', 'exchange', 'recognition_and_exchange', 'not_established')
  ),
  basis TEXT,
  kind_verified INTEGER NOT NULL DEFAULT 0 CHECK (kind_verified IN (0, 1)),
  superseded_from TEXT
);

DROP TABLE licence_agreement_index;

ALTER TABLE licence_agreement_index_new RENAME TO licence_agreement_index;

-- Recreated with the table: dropping licence_agreement_index dropped its index too.
CREATE INDEX IF NOT EXISTS licence_agreement_by_kind
  ON licence_agreement_index (kind);

-- "Which origins are open to any nationality" is now a query rather than a scan of
-- the note column, which is the point of holding the gate structurally.
CREATE INDEX IF NOT EXISTS licence_exchange_by_gate
  ON licence_exchange_index (nationality_gate);

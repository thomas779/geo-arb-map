-- Reference data: the lists the site renders from that had no representation in D1.
--
-- Three files, none of which were mirrored anywhere: public/blocs_data.json (the
-- bloc/lane/dual-nationality layer the browser actually fetches), data/registry.json
-- (the locked jurisdiction registry every build validates against) and
-- monitor/sources/manifest.json (the 289 feeds the monitor sweeps). Losing any of
-- them loses data that exists in no other store.
--
-- Deliberately STANDALONE, following monitor_* (0003-0005) and licence_* (0007)
-- rather than the canonical model. `arrangement_index` is the wrong thing to copy:
-- it is keyed on a revision_id and carries a trigger requiring a canonical entity of
-- type 'arrangement', so mirroring these lists through it would drag them into the
-- revision/parity machinery built for nationality-law claims. A bloc membership list
-- and a feed manifest are not claims under review; they are reference tables.
--
-- Source of truth stays the version-controlled JSON. These tables are its indexed,
-- durable projection: wiped and re-imported on each sync, covered by the backup-d1
-- job, and queryable ("which blocs list Mali as a former member", "which feeds are
-- planned but not active") without a client-side scan.
--
-- NULL means NOT RECORDED throughout. A missing `notes` is NULL, never ''; a missing
-- confidence is NULL, never a guessed default.

-- ---------------------------------------------------------------------------
-- Blocs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bloc_index (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- The file's own taxonomy, not the canonical corpus's. 'closed' and 'proto' have
  -- no canonical analogue and describe the bloc's LIFECYCLE (a signed-but-unentered
  -- instrument vs a lapsed one), which is exactly what a reader needs to know before
  -- planning around it.
  category TEXT NOT NULL CHECK (
    category IN ('full', 'partial', 'closed', 'hub_spoke', 'one_way', 'proto')
  ),
  -- 1-3 tier, matching 0006's move away from a 0-1 real. Lower is stronger.
  strength INTEGER NOT NULL CHECK (strength IN (1, 2, 3)),
  color TEXT NOT NULL,
  fastest_entry TEXT,
  notes TEXT,
  -- One bloc (CSME) names an inner group whose members are ALSO full members --
  -- the Enhanced Cooperation Four. Held as the file's own JSON object rather than
  -- promoted to rows, because emitting those four as bloc_members would double-count
  -- them, and a second membership table for a single named subgroup is more
  -- structure than one occurrence earns.
  sub_bloc TEXT
);

-- Rows, not a blob, because rights is a three-key object and "which blocs confer
-- CIT" must be answerable as a query. TR/PR/CIT is the file's fixed key set: every
-- bloc carries all three, so a missing tier here would be a real defect.
CREATE TABLE IF NOT EXISTS bloc_rights (
  bloc_id TEXT NOT NULL REFERENCES bloc_index (id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('TR', 'PR', 'CIT')),
  text TEXT NOT NULL,
  PRIMARY KEY (bloc_id, tier)
);

CREATE TABLE IF NOT EXISTS bloc_members (
  bloc_id TEXT NOT NULL REFERENCES bloc_index (id) ON DELETE CASCADE,
  iso_n3 TEXT NOT NULL,
  name TEXT NOT NULL,
  -- NOT a nullable "unknown": membership status is recorded for every row by which
  -- array of the source file it came from, so 0/1 is always known. ECOWAS is why the
  -- column exists at all -- Mali, Burkina Faso and Niger left, and the file keeps
  -- them under `former_members`, disjoint from the current list. Flattening the two
  -- arrays without this flag would readmit three states to a bloc they withdrew from.
  former INTEGER NOT NULL CHECK (former IN (0, 1)),
  PRIMARY KEY (bloc_id, iso_n3)
);

CREATE INDEX IF NOT EXISTS bloc_members_by_iso ON bloc_members (iso_n3, former);

-- ---------------------------------------------------------------------------
-- Bilateral lanes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bilateral_lane_index (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  destination_iso_n3 TEXT NOT NULL,
  destination_name TEXT NOT NULL,
  grants TEXT NOT NULL,
  limits TEXT NOT NULL,
  leads_to_settlement INTEGER NOT NULL CHECK (leads_to_settlement IN (0, 1)),
  -- How the lane is rationed, and the difference that decides whether a reader can
  -- plan on it. A 'right' is claimable; a 'ballot' is a lottery you can lose every
  -- year forever. NULL where the file does not say -- absent rationing is not
  -- evidence of an unrationed lane.
  allocation TEXT CHECK (allocation IN ('right', 'discretionary', 'ballot', 'quota_queue')),
  -- Present on some lanes only. Kept because a lane whose beneficiary list is
  -- qualified in prose ("~50 friendly nations") is not the same claim as an
  -- enumerated one, and dropping the qualifier would overstate the enumeration.
  beneficiaries_note TEXT,
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  volatility TEXT CHECK (volatility IN ('high', 'medium', 'low')),
  -- Whether taking the lane costs the previous nationality. NULL is NOT RECORDED,
  -- emphatically not "keeps it".
  renounces_previous INTEGER CHECK (renounces_previous IN (0, 1)),
  -- The file's source list is free-text citation labels, not URLs, so it is stored
  -- as the JSON array it is rather than promoted to an evidence table it could not
  -- populate honestly.
  sources TEXT
);

CREATE TABLE IF NOT EXISTS bilateral_lane_beneficiaries (
  lane_id TEXT NOT NULL REFERENCES bilateral_lane_index (id) ON DELETE CASCADE,
  iso_n3 TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (lane_id, iso_n3)
);

CREATE INDEX IF NOT EXISTS bilateral_lane_beneficiaries_by_iso
  ON bilateral_lane_beneficiaries (iso_n3);
CREATE INDEX IF NOT EXISTS bilateral_lane_by_destination
  ON bilateral_lane_index (destination_iso_n3);

-- ---------------------------------------------------------------------------
-- Dual nationality
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dual_nationality_policy (
  iso_n3 TEXT PRIMARY KEY,
  -- 'banned' is the FILE'S word and is kept deliberately. The canonical corpus says
  -- 'prohibited' for the same concept (scripts/lib/canonical-schema.ts, and
  -- src/types.ts carries BOTH enums, one per model). These are rival vocabularies
  -- over the same question and issue #144 exists to reconcile them; harmonising here
  -- would erase the evidence that the divergence is real and silently pick a winner.
  -- tests/reference_data.test.ts asserts 'banned' survives, so a tidy-up that
  -- normalises it fails loudly instead of quietly.
  status TEXT NOT NULL CHECK (status IN ('allowed', 'banned', 'conditional')),
  note TEXT,
  volatility TEXT CHECK (volatility IN ('high', 'medium', 'low')),
  sources TEXT
);

CREATE TABLE IF NOT EXISTS dual_nationality_treaty_exception (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- What the treaty actually changes, which in every recorded case is narrower than
  -- "permits dual citizenship": Russia-Tajikistan alters conflict-of-laws treatment
  -- while general Russian law is what allows the second passport. Kept as prose
  -- because collapsing it to a flag is precisely the overstatement to avoid.
  effect TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  last_checked TEXT,
  sources TEXT
);

CREATE TABLE IF NOT EXISTS dual_nationality_treaty_parties (
  exception_id TEXT NOT NULL
    REFERENCES dual_nationality_treaty_exception (id) ON DELETE CASCADE,
  iso_n3 TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (exception_id, iso_n3)
);

CREATE INDEX IF NOT EXISTS dual_nationality_treaty_parties_by_iso
  ON dual_nationality_treaty_parties (iso_n3);

-- ---------------------------------------------------------------------------
-- Jurisdiction registry
-- ---------------------------------------------------------------------------

-- data/registry.json is the locked list every build validates ISO codes against, and
-- it existed only as a file. `class` is the distinction that makes it worth storing:
-- a territory is not a sovereign and must not be counted as one in coverage figures.
CREATE TABLE IF NOT EXISTS jurisdiction_registry (
  -- Not always an ISO 3166-1 numeric code, which is the point of the `special`
  -- class: Kosovo is 'XKX' because M49 assigns it no numeric code at all. Typing
  -- this column as an integer would silently lose it.
  iso_n3 TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('sovereign', 'territory', 'special')),
  -- Only the `special` entries carry one, explaining why they are special. NULL for
  -- the other two classes means NOT RECORDED, not "nothing to say".
  note TEXT
);

CREATE INDEX IF NOT EXISTS jurisdiction_registry_by_class
  ON jurisdiction_registry (class);

-- ---------------------------------------------------------------------------
-- Monitor source manifest
-- ---------------------------------------------------------------------------

-- The inventory of what the monitor watches. Mirrored so "which feeds are planned
-- but never yet collected" and "which jurisdictions have no verification-tier source"
-- are queries against the same database that already holds monitor_pages and
-- monitor_observations -- the run history was in D1 while the roster of things being
-- run against was not.
CREATE TABLE IF NOT EXISTS monitor_source_manifest (
  id TEXT PRIMARY KEY,
  -- discovery finds candidates; verification is what a claim may be sourced to.
  -- Never collapse them: a discovery hit is a lead, not evidence.
  tier TEXT NOT NULL CHECK (tier IN ('discovery', 'verification')),
  adapter TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'planned')),
  url TEXT,
  notes TEXT
  -- Deliberately NOT mirrored: keywords, pages, keyword_match, max_items, channel,
  -- kind, subscription_url, archive_url. Those are fetcher CONFIGURATION -- they tell
  -- the collector how to walk a site, and they change with the site's markup rather
  -- than with what the source is. The manifest file remains their only home.
);

CREATE INDEX IF NOT EXISTS monitor_source_manifest_by_tier
  ON monitor_source_manifest (tier, status);

CREATE TABLE IF NOT EXISTS monitor_source_jurisdictions (
  source_id TEXT NOT NULL
    REFERENCES monitor_source_manifest (id) ON DELETE CASCADE,
  -- Not an ISO code: the manifest uses labels including 'multi' for cross-border
  -- feeds. Constraining this to the registry would reject the aggregators.
  jurisdiction TEXT NOT NULL,
  PRIMARY KEY (source_id, jurisdiction)
);

CREATE INDEX IF NOT EXISTS monitor_source_jurisdictions_by_jurisdiction
  ON monitor_source_jurisdictions (jurisdiction);

-- ---------------------------------------------------------------------------
-- Small irregular lists
-- ---------------------------------------------------------------------------

-- The next three are 6, 3 and 6 rows and each has its own shape. A typed identifier
-- plus a JSON payload is the honest design: over-modelling a three-row table invents
-- a schema the data has not earned, and the columns that ARE typed are the ones a
-- query would ever filter on.

-- Worked examples of which passport unlocks which blocs. Keyed on `passport`, which
-- is the file's only identifier -- there is no id field, and the values are not all
-- country names ('Falklands-born', 'Dominica (CBI)'), so this cannot be an ISO key.
CREATE TABLE IF NOT EXISTS stacking_play_index (
  passport TEXT PRIMARY KEY,
  timeline TEXT NOT NULL,
  -- {blocs, footprint}
  payload TEXT NOT NULL
);

-- Where a child born in a jurisdiction acquires rights the parents cannot, and the
-- parents then acquire rights through the child.
CREATE TABLE IF NOT EXISTS generational_event_index (
  id TEXT PRIMARY KEY,
  country_iso_n3 TEXT NOT NULL,
  country_name TEXT NOT NULL,
  -- {child, parent, sources}
  payload TEXT NOT NULL
);

-- The queue of arrangements believed real but not yet typed against an instrument.
-- It lives in the served file so the atlas can say what it does not yet claim; it
-- belongs in D1 for the same reason.
CREATE TABLE IF NOT EXISTS pending_verification_index (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  volatility TEXT CHECK (volatility IN ('high', 'medium', 'low')),
  -- {proposed_shape, reason, sources}
  payload TEXT NOT NULL
);

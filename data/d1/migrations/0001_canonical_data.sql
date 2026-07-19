PRAGMA foreign_keys = ON;

CREATE TABLE canonical_entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('source', 'jurisdiction', 'arrangement')
  ),
  created_at TEXT NOT NULL
);

CREATE TABLE canonical_revisions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  content_hash TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (
    review_status IN ('draft', 'approved', 'rejected')
  ),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  supersedes_revision_id TEXT,
  FOREIGN KEY (entity_id) REFERENCES canonical_entities(id),
  FOREIGN KEY (supersedes_revision_id) REFERENCES canonical_revisions(id),
  UNIQUE (entity_id, id),
  UNIQUE (entity_id, content_hash),
  CHECK (
    (review_status = 'approved' AND approved_at IS NOT NULL)
    OR (review_status != 'approved' AND approved_at IS NULL)
  )
);

CREATE INDEX canonical_revisions_entity_created
  ON canonical_revisions (entity_id, created_at DESC);

CREATE TABLE source_index (
  revision_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  publisher TEXT NOT NULL,
  source_type TEXT NOT NULL,
  last_checked TEXT NOT NULL,
  FOREIGN KEY (revision_id) REFERENCES canonical_revisions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX source_index_url_revision
  ON source_index (url, revision_id);

CREATE TRIGGER source_index_requires_source_entity
BEFORE INSERT ON source_index
WHEN NOT EXISTS (
  SELECT 1
  FROM canonical_revisions AS revision
  JOIN canonical_entities AS entity ON entity.id = revision.entity_id
  WHERE revision.id = NEW.revision_id
    AND entity.entity_type = 'source'
)
BEGIN
  SELECT RAISE(ABORT, 'source index revision must belong to a source entity');
END;

CREATE TABLE source_jurisdictions (
  revision_id TEXT NOT NULL,
  iso_n3 TEXT NOT NULL CHECK (
    length(iso_n3) = 3 AND iso_n3 NOT GLOB '*[^0-9]*'
  ),
  PRIMARY KEY (revision_id, iso_n3),
  FOREIGN KEY (revision_id) REFERENCES source_index(revision_id) ON DELETE CASCADE
);

CREATE TABLE jurisdiction_index (
  revision_id TEXT PRIMARY KEY,
  iso_n3 TEXT NOT NULL CHECK (
    length(iso_n3) = 3 AND iso_n3 NOT GLOB '*[^0-9]*'
  ),
  name TEXT NOT NULL,
  jurisdiction_type TEXT NOT NULL CHECK (
    jurisdiction_type IN ('sovereign', 'territory', 'special')
  ),
  FOREIGN KEY (revision_id) REFERENCES canonical_revisions(id) ON DELETE CASCADE
);

CREATE INDEX jurisdiction_index_iso
  ON jurisdiction_index (iso_n3);

CREATE TRIGGER jurisdiction_index_requires_jurisdiction_entity
BEFORE INSERT ON jurisdiction_index
WHEN NOT EXISTS (
  SELECT 1
  FROM canonical_revisions AS revision
  JOIN canonical_entities AS entity ON entity.id = revision.entity_id
  WHERE revision.id = NEW.revision_id
    AND entity.entity_type = 'jurisdiction'
)
BEGIN
  SELECT RAISE(ABORT, 'jurisdiction index revision must belong to a jurisdiction entity');
END;

CREATE TABLE route_index (
  revision_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (
    mode IN ('ancestry', 'naturalization', 'birth', 'investment')
  ),
  route_status TEXT NOT NULL CHECK (
    route_status IN ('active', 'inactive', 'verified_negative', 'pending_verification')
  ),
  title TEXT NOT NULL,
  PRIMARY KEY (revision_id, route_id),
  FOREIGN KEY (revision_id) REFERENCES jurisdiction_index(revision_id) ON DELETE CASCADE
);

CREATE INDEX route_index_mode_status
  ON route_index (mode, route_status);

CREATE TABLE route_variant_index (
  revision_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('citizenship', 'residence', 'permanent_residence', 'work')
  ),
  allocation TEXT NOT NULL CHECK (
    allocation IN ('right', 'discretionary', 'ballot', 'quota_queue')
  ),
  eligibility_minimum_months INTEGER CHECK (
    eligibility_minimum_months IS NULL OR eligibility_minimum_months >= 0
  ),
  processing_typical_months INTEGER CHECK (
    processing_typical_months IS NULL OR processing_typical_months > 0
  ),
  PRIMARY KEY (revision_id, route_id, variant_id),
  FOREIGN KEY (revision_id, route_id)
    REFERENCES route_index(revision_id, route_id) ON DELETE CASCADE
);

CREATE INDEX route_variant_index_query
  ON route_variant_index (
    outcome,
    allocation,
    eligibility_minimum_months
  );

CREATE TABLE arrangement_index (
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
  FOREIGN KEY (revision_id) REFERENCES canonical_revisions(id) ON DELETE CASCADE
);

CREATE INDEX arrangement_index_kind_status
  ON arrangement_index (kind, status);

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

CREATE TABLE arrangement_participants (
  revision_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN ('member', 'former_member', 'destination', 'beneficiary')
  ),
  iso_n3 TEXT NOT NULL CHECK (
    length(iso_n3) = 3 AND iso_n3 NOT GLOB '*[^0-9]*'
  ),
  PRIMARY KEY (revision_id, role, iso_n3),
  FOREIGN KEY (revision_id) REFERENCES arrangement_index(revision_id) ON DELETE CASCADE
);

CREATE INDEX arrangement_participants_country
  ON arrangement_participants (iso_n3, role);

CREATE TABLE arrangement_pathway_index (
  revision_id TEXT NOT NULL,
  pathway_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('citizenship', 'residence', 'permanent_residence', 'work')
  ),
  allocation TEXT NOT NULL CHECK (
    allocation IN ('right', 'discretionary', 'ballot', 'quota_queue')
  ),
  eligibility_minimum_months INTEGER CHECK (
    eligibility_minimum_months IS NULL OR eligibility_minimum_months >= 0
  ),
  processing_typical_months INTEGER CHECK (
    processing_typical_months IS NULL OR processing_typical_months > 0
  ),
  PRIMARY KEY (revision_id, pathway_id),
  FOREIGN KEY (revision_id) REFERENCES arrangement_index(revision_id) ON DELETE CASCADE
);

CREATE TABLE evidence_links (
  target_revision_id TEXT NOT NULL,
  source_revision_id TEXT NOT NULL,
  field_path TEXT NOT NULL CHECK (substr(field_path, 1, 1) = '/'),
  note TEXT,
  PRIMARY KEY (target_revision_id, source_revision_id, field_path),
  FOREIGN KEY (target_revision_id)
    REFERENCES canonical_revisions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_revision_id)
    REFERENCES source_index(revision_id)
);

CREATE INDEX evidence_links_source
  ON evidence_links (source_revision_id, target_revision_id);

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN ('building', 'published', 'withdrawn')
  ),
  manifest_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR (status != 'published')
  )
);

CREATE TABLE release_items (
  release_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  PRIMARY KEY (release_id, entity_id),
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id, revision_id)
    REFERENCES canonical_revisions(entity_id, id)
);

CREATE TRIGGER canonical_entity_type_immutable
BEFORE UPDATE OF entity_type ON canonical_entities
BEGIN
  SELECT RAISE(ABORT, 'canonical entity type is immutable');
END;

CREATE TRIGGER canonical_revision_content_immutable
BEFORE UPDATE OF
  entity_id,
  schema_version,
  payload_json,
  content_hash,
  created_at,
  supersedes_revision_id
ON canonical_revisions
BEGIN
  SELECT RAISE(ABORT, 'canonical revision content is immutable');
END;

CREATE TRIGGER evidence_source_must_be_source
BEFORE INSERT ON evidence_links
WHEN NOT EXISTS (
  SELECT 1 FROM source_index WHERE revision_id = NEW.source_revision_id
)
BEGIN
  SELECT RAISE(ABORT, 'evidence source revision is not a source');
END;

CREATE TRIGGER release_item_requires_approval
BEFORE INSERT ON release_items
WHEN (
  SELECT review_status
  FROM canonical_revisions
  WHERE id = NEW.revision_id AND entity_id = NEW.entity_id
) != 'approved'
BEGIN
  SELECT RAISE(ABORT, 'release items must be approved revisions');
END;

CREATE TRIGGER published_release_items_immutable_insert
BEFORE INSERT ON release_items
WHEN (
  SELECT status FROM releases WHERE id = NEW.release_id
) != 'building'
BEGIN
  SELECT RAISE(ABORT, 'published release membership is immutable');
END;

CREATE TRIGGER published_release_items_immutable_update
BEFORE UPDATE ON release_items
WHEN (
  SELECT status FROM releases WHERE id = OLD.release_id
) != 'building'
BEGIN
  SELECT RAISE(ABORT, 'published release membership is immutable');
END;

CREATE TRIGGER published_release_items_immutable_delete
BEFORE DELETE ON release_items
WHEN (
  SELECT status FROM releases WHERE id = OLD.release_id
) != 'building'
BEGIN
  SELECT RAISE(ABORT, 'published release membership is immutable');
END;

CREATE TRIGGER release_publish_requires_items
BEFORE UPDATE OF status ON releases
WHEN NEW.status = 'published' AND NOT EXISTS (
  SELECT 1 FROM release_items WHERE release_id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'cannot publish an empty release');
END;

CREATE TRIGGER release_publish_requires_approved_items
BEFORE UPDATE OF status ON releases
WHEN NEW.status = 'published' AND EXISTS (
  SELECT 1
  FROM release_items AS item
  JOIN canonical_revisions AS revision ON revision.id = item.revision_id
  WHERE item.release_id = NEW.id
    AND revision.review_status != 'approved'
)
BEGIN
  SELECT RAISE(ABORT, 'cannot publish a release with unapproved revisions');
END;

CREATE TRIGGER release_status_transition
BEFORE UPDATE OF status ON releases
WHEN
  (OLD.status = 'published' AND NEW.status != 'withdrawn')
  OR OLD.status = 'withdrawn'
BEGIN
  SELECT RAISE(ABORT, 'invalid release status transition');
END;

CREATE TRIGGER finalized_release_metadata_immutable
BEFORE UPDATE OF id, manifest_hash, created_at, published_at ON releases
WHEN OLD.status != 'building'
BEGIN
  SELECT RAISE(ABORT, 'finalized release metadata is immutable');
END;

CREATE TRIGGER finalized_release_not_deletable
BEFORE DELETE ON releases
WHEN OLD.status != 'building'
BEGIN
  SELECT RAISE(ABORT, 'finalized releases cannot be deleted');
END;

CREATE TRIGGER published_revision_immutable
BEFORE UPDATE ON canonical_revisions
WHEN EXISTS (
  SELECT 1
  FROM release_items AS item
  JOIN releases AS release ON release.id = item.release_id
  WHERE item.revision_id = OLD.id
    AND release.status IN ('published', 'withdrawn')
)
BEGIN
  SELECT RAISE(ABORT, 'published revisions are immutable');
END;

CREATE TRIGGER published_revision_not_deletable
BEFORE DELETE ON canonical_revisions
WHEN EXISTS (
  SELECT 1
  FROM release_items AS item
  JOIN releases AS release ON release.id = item.release_id
  WHERE item.revision_id = OLD.id
    AND release.status IN ('published', 'withdrawn')
)
BEGIN
  SELECT RAISE(ABORT, 'published revisions cannot be deleted');
END;

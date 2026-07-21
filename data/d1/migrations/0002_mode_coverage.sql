CREATE TABLE jurisdiction_mode_coverage (
  revision_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (
    mode IN ('ancestry', 'naturalization', 'birth', 'investment')
  ),
  finding TEXT NOT NULL CHECK (
    finding IN ('unknown', 'present', 'verified_none')
  ),
  review_state TEXT NOT NULL CHECK (
    review_state IN ('unchecked', 'legacy', 'pending', 'partial', 'reviewed')
  ),
  review_confidence TEXT NOT NULL CHECK (
    review_confidence IN ('high', 'medium', 'low')
  ),
  last_checked TEXT,
  review_note TEXT,
  PRIMARY KEY (revision_id, mode),
  FOREIGN KEY (revision_id) REFERENCES jurisdiction_index(revision_id) ON DELETE CASCADE
);

CREATE INDEX jurisdiction_mode_coverage_queue
  ON jurisdiction_mode_coverage (review_state, mode, finding, last_checked);

CREATE TRIGGER jurisdiction_mode_verified_none_requires_review
BEFORE INSERT ON jurisdiction_mode_coverage
WHEN NEW.finding = 'verified_none' AND NEW.review_state != 'reviewed'
BEGIN
  SELECT RAISE(ABORT, 'verified negative coverage must be reviewed');
END;

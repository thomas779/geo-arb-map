# Data migration plan

Status: **Phase 1 in progress — canonical schemas and candidates active**

The migration separates the system into two planes:

- **Public data plane:** versioned static artifacts deployed with the Atlas
  Worker. No database request is required to load the map or planner.
- **Editorial control plane:** Cloudflare Email Workers, D1, and R2 collect,
  normalize, query, review, and publish evidence-backed changes.

During migration, the existing Git JSON remains authoritative. After the D1
cutover gate passes, D1 becomes the sole editable store for normalized facts
and workflow state. Git keeps schemas, migrations, approved change proposals,
release manifests, and application code; public JSON becomes generated output.
There is no permanent dual-write path.

## Non-negotiable invariants

- `public/*.json` keeps working until its replacement passes parity.
- A monitoring signal cannot directly update a reviewed fact.
- Every published fact has stable entity and route IDs, evidence, review date,
  confidence, and field-level support.
- Unknown values remain `null` or explicitly unchecked.
- Arrangement prose never supplies computational timeline values.
- A release is immutable and identified by a content hash.
- Code, schemas, and the static data release deploy as one Worker version.
- Rollback restores a compatible code-and-data version without a database
  migration.
- Only approved revisions can enter a release.
- A published row is append-only: corrections supersede a revision instead of
  overwriting its history.

## Architecture decision

### Static release data plane

The public application will eventually load:

```text
data/releases/<content-hash>/
  catalog.json
  graph.json
  jurisdictions/250.json
  arrangements/eu-eea.json
  changes.json
data/manifest.json
```

`catalog.json` is the small initial search/map index. Country and arrangement
details load on demand. Release files are immutable and cacheable. The
application bundle embeds the release ID during the same build, so runtime
navigation never depends on a mutable `latest` pointer. The top-level manifest
is informational and used by monitors, not required to render Atlas.

This matters because Cloudflare Worker versions include their static assets,
but do not version D1, KV, or R2 state with the deployment. Keeping the public
release beside the application code makes rollback atomic at the product
boundary:

- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Workers versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)

### Cloudflare editorial control plane

Use two D1 databases across the trust boundary:

- `flag-paths-monitor` accepts untrusted internet/email signals and stores
  intake workflow state;
- `flag-paths-data` stores reviewed canonical facts, projections, and releases.

The intake Worker receives no binding to `flag-paths-data`. A compromised or
malformed newsletter path therefore cannot write legal facts. Approved
proposals cross the boundary only through the review/publication service.

| Service | Responsibility | Excluded responsibility |
|---|---|---|
| Monitor D1 | signal deduplication, source health, intake workflow and delivery state | canonical facts |
| Data D1 | normalized facts, source links, temporal revisions, review queue, immutable release membership | untrusted intake and serving mutable working rows directly to the public map |
| R2 | short-retention raw email and large evidence artifacts | public legal-data source of truth |
| Worker | ingestion, validation, reviewer and public APIs, release compilation, publication orchestration | unreviewed mutation of published facts |
| Static assets | public catalog, country records, graph, release changelog | mutable workflow state |

D1 is the right normalized authoring store because country, source, route,
participant, evidence, coverage, and change-history relationships are naturally
relational. SQL can power review queries, coverage reports, graph compilation,
and a future API. The public map still reads an immutable compiled release, so
ordinary navigation does not acquire a database round trip.

The public API may query release-scoped D1 rows for filters that are impractical
to precompute, but it must require or resolve an immutable `release_id`; it
must never expose unapproved working revisions as current facts.

If global reviewer or API latency matters, use the Sessions API with read
replication and bookmarks for sequential consistency. Public map users do not
pay that database latency because Atlas reads the static release:

- [D1 global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)

KV is not used as the authoritative release pointer because its globally cached
reads are eventually consistent. R2 remains appropriate for private raw
evidence with lifecycle deletion. D1 Time Travel provides short-window recovery;
scheduled SQL exports to private R2 provide longer retention:

- [Workers KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)

### Source-of-truth cutover

The system deliberately changes authority once:

1. transform the legacy JSON into typed canonical records;
2. import those records into a local SQLite database using the exact D1
   migrations;
3. compile the compatibility JSON and release artifacts from SQL;
4. prove structural parity, reference integrity, and deterministic hashes;
5. import the same reviewed rows into D1 and record the first release;
6. freeze the legacy JSON as an input and switch all future edits to reviewed
   D1 revisions.

Before step 6, Git JSON is authoritative and D1 is not. After step 6, D1 is
authoritative and checked-in JSON is not editable. This avoids the most
dangerous version of the architecture: two stores that can independently
change the same fact.

## Canonical v1 record requirements

The shadow candidates intentionally preserve the old shape; they are extraction
proofs, not the final schema. Before promotion, canonical records must:

- store a jurisdiction identity once rather than repeating it in every route;
- give routes and sources stable IDs;
- reference sources by ID with stable ID-addressed `supports_fields` paths
  rather than reorder-sensitive array indexes;
- separate structured eligibility, milestones, and timelines from editorial
  summaries;
- store `effective_from`, optional `effective_to`, and supersession links so a
  law change does not erase history;
- distinguish eligibility time from processing-time estimates;
- attach review state, confidence, and `last_checked` to each material rule;
- allow unknown values explicitly without manufacturing defaults; and
- validate all country, arrangement, route, source, and timeline references.

The existing free-form `facts` object remains available only during migration.
New machine-consumed facts must have a typed canonical field before they can
affect planner or graph output.

## Phases and gates

### Phase 0 — shadow migration foundation

- [x] Record the pilot: France, Portugal, Spain, EU/EEA, Mercosur, and the
  Spain Ibero-American lane.
- [x] Generate separate jurisdiction and arrangement candidates without
  changing live inputs.
- [x] Reassemble compatibility documents from the split candidates and legacy
  remainder.
- [x] Require structural parity and content hashes in tests.
- [x] Review generated pilot candidates for the canonical v1 schema.

**Exit gate:** shadow output is structurally identical to both current source
documents and the full test/build suite passes.

### Phase 1 — canonical schemas and first cutover

- [x] Add versioned JSON schemas for jurisdiction, arrangement, source,
  timeline, and change-proposal records.
- [x] Transform the shadow candidates against those schemas.
- [x] Add initial primary and official sources for the pilot arrangements.
- [ ] Review country-level implementation exceptions before arrangement cutover.
- [ ] Promote reviewed pilot candidates into `data/jurisdictions/` and
  `data/arrangements/`.
- [ ] Make canonical records authoritative for migrated IDs while keeping the
  monolith as a read-only legacy remainder.
- [ ] Compile the existing public shapes from canonical plus legacy records.
- [ ] Reject duplicate ownership and missing IDs.

**Exit gate:** editing a pilot fact in one canonical file updates every derived
consumer while parity tests prove no unrelated record changed.

### Phase 2 — D1 cutover and one deterministic data build

- [x] Add the canonical D1 schema with relational projections, append-only
  revisions, evidence joins, approval state, and immutable releases.
- [x] Import the pilot deterministically into local SQLite and derive
  release-scoped coverage, route, arrangement, and graph projections with SQL.
- [x] Generate one parameterized import plan for local SQLite and D1 rather
  than maintaining a second production write path.
- [x] Refuse release compilation until every selected revision is approved.
- [x] Create the isolated Western Europe Data D1 deployment and import the
  canonical pilot as draft records with no published release.
- [x] Add `bun run data:build` against local SQLite/D1.
- [x] Validate schemas, temporal constraints, approvals, and references.
- [x] Compile catalog, country details, arrangements, coverage, timelines,
  graph, API release rows, and release changelog from SQL.
- [x] Fail CI on stale generated output or an unsupported source field.
- [x] Generate changed entity IDs by comparing release manifests.
- [ ] Back up D1 to private R2 on a schedule and test restoration.

**Exit gate:** a clean checkout plus an approved database export can reproduce
the release byte-for-byte, and no canonical fact has two editable homes.

### Phase 3 — versioned browser reads

- [ ] Deploy content-addressed release files with the Worker.
- [ ] Load only catalog and graph at startup.
- [ ] Lazy-load country and arrangement details.
- [ ] Keep the previous release available for rollback.
- [ ] Stop committing browser artifacts after CI/deployment reproducibility is
  proven.

**Exit gate:** UI regression tests pass, first-load data is smaller, and a
release rollback restores the matching data without D1.

### Phase 4 — evidence-to-PR automation

- [ ] Convert verified monitor leads into typed change proposals.
- [ ] Resolve proposals against stable entity, route, and source IDs.
- [ ] Open a focused data PR with sources and affected fields.
- [ ] Run schema, parity, graph, and UI tests.
- [ ] Produce website and Telegram drafts from `changes.json`.
- [ ] Require human approval before merge and publication.

**Exit gate:** a real newsletter lead can become one reviewed source-file PR,
one immutable release, and one source-backed Telegram post without hand-editing
generated JSON.

## Rollout policy

Migrate in small batches. Start with the pilot, then countries with reviewed
route-level data, then high-value arrangements, and finally unchecked coverage
rows. Never combine a storage cutover with a UI redesign or monitoring-policy
change in the same release.

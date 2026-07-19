# Data migration plan

Status: **Phase 0 in progress — shadow compiler active**

The migration separates the system into two planes:

- **Public data plane:** versioned static artifacts deployed with the Atlas
  Worker. No database request is required to load the map or planner.
- **Monitoring control plane:** Cloudflare Email Workers, D1, and R2 collect,
  deduplicate, review, and publish evidence-backed changes.

Git remains the canonical history for reviewed legal facts. D1 records workflow
state; it does not silently become a second legal source of truth.

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

### Cloudflare control plane

| Service | Responsibility | Excluded responsibility |
|---|---|---|
| D1 | signal deduplication, review queue, source health, subscriptions, delivery state | serving canonical map facts on every page load |
| R2 | short-retention raw email and large evidence artifacts | public legal-data source of truth |
| Worker | ingestion, validation, admin APIs, publication orchestration | unreviewed mutation of public facts |
| Static assets | public catalog, country records, graph, release changelog | mutable workflow state |

D1 can later power an authenticated reviewer dashboard. If global reviewer
latency matters, use the Sessions API with read replication and bookmarks for
sequential consistency. Public users do not pay that database latency because
Atlas reads the static release:

- [D1 global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)

KV is not used as the authoritative release pointer because its globally cached
reads are eventually consistent. R2 remains appropriate for private raw
evidence with lifecycle deletion:

- [Workers KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

## Canonical v1 record requirements

The shadow candidates intentionally preserve the old shape; they are extraction
proofs, not the final schema. Before promotion, canonical records must:

- store a jurisdiction identity once rather than repeating it in every route;
- give routes and sources stable IDs;
- reference sources by ID with `supports_fields` paths;
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
- [ ] Review generated pilot candidates for the canonical v1 schema.

**Exit gate:** shadow output is structurally identical to both current source
documents and the full test/build suite passes.

### Phase 1 — canonical schemas and first cutover

- [ ] Add versioned JSON schemas for jurisdiction, arrangement, source,
  timeline, and change-proposal records.
- [ ] Transform and review the shadow candidates against those schemas.
- [ ] Promote reviewed pilot candidates into `data/jurisdictions/` and
  `data/arrangements/`.
- [ ] Make canonical records authoritative for migrated IDs while keeping the
  monolith as a read-only legacy remainder.
- [ ] Compile the existing public shapes from canonical plus legacy records.
- [ ] Reject duplicate ownership and missing IDs.

**Exit gate:** editing a pilot fact in one canonical file updates every derived
consumer while parity tests prove no unrelated record changed.

### Phase 2 — one deterministic data build

- [ ] Add `bun run data:build`.
- [ ] Validate schemas and references.
- [ ] Compile catalog, country details, arrangements, coverage, timelines,
  graph, and release changelog.
- [ ] Fail CI on stale generated output or an unsupported source field.
- [ ] Generate changed entity IDs by comparing release manifests.

**Exit gate:** a clean checkout can reproduce the release byte-for-byte.

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

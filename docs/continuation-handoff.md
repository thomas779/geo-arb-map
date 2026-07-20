# Continuation handoff

Updated: 2026-07-19
Branch: `main`
Repository: `/Users/thomashumphreys/ghq/github.com/thomas779/geo-arb-map`

## Objective

Finish migrating Flag Paths from manually maintained monolithic JSON to an
evidence-backed D1 authoring database that compiles immutable static releases
for the public website.

D1 is the editable source of truth after cutover. JSON remains the public
delivery format, not an independently editable database.

## Current architecture

- `flag-paths-monitor` D1 accepts untrusted newsletter intake only.
- `flag-paths-data` D1 stores reviewed canonical facts and releases.
- The two databases are deliberately isolated across the trust boundary.
- Canonical records retain their complete typed JSON payload in D1.
- Relational projections support route, coverage, arrangement, evidence, graph,
  and future API queries.
- Only approved revisions may enter an immutable release.
- The public map continues to read static JSON bundled with the Worker, avoiding
  D1 latency during normal navigation.

## Completed

Recent commits:

- `feat: compile d1 sql exports`
- `fix: harden data release compiler`
- `feat: compile data release from d1`
- `feat: add deterministic data:build compiler`
- `b287a0a docs: add migration handoff`
- `6d52686 feat: connect canonical d1`
- `a998d5d feat: add canonical sql build`
- `0e8da2b feat: add canonical data store`
- `4ffd2a0 fix: source pilot arrangements`
- `11ef266 feat: define canonical data schemas`
- `bc62a9f feat: add data migration shadow`

Implemented:

- canonical Zod and JSON schemas;
- field-level evidence references with stable IDs;
- pilot records for France, Portugal, Spain, EU/EEA, Mercosur, and the Spain
  Ibero-American route;
- deterministic local SQLite import;
- one provider-neutral mutation plan rendered as D1-compatible SQL;
- SQL-derived coverage, route, arrangement, and graph projections;
- approval-gated immutable releases;
- isolated `flag-paths-data` D1 in Western Europe;
- `bun run data:build`, a DB-driven release compiler. Compilation and seeding
  are now separate stages: `bun run data:db` seeds a persistent SQLite database
  from Git, and `bun run data:build` reads `canonical_revisions.payload_json`
  from that database (or materializes the `.sql` produced by
  `wrangler d1 export` when passed via `--db`). Draft,
  approved-head, and explicit release-item selection modes each choose exactly
  one immutable revision per entity. The compiler reconstructs the migrated
  entities, merges them with the read-only legacy remainder, derives the
  complete graph, and writes a draft release to
  `.generated/data-canonical/releases/<release_id>/`.
- content-addressed release IDs exclude local database paths and changelog
  baselines; stored revision hashes are recomputed and verified before use;
- release bundles now include SQL-derived `projections.json`, `coverage.json`,
  `timelines.json`, and `arrangement-projections.json`.

The compiler's parity gates prove the database round-trips every canonical-owned
field and that the only compatibility drift is the sanctioned Spain
Ibero-American beneficiary correction plus its direct graph propagation:

- `exclusive_ownership` — pilot IDs are owned once and exist in the legacy baseline;
- `arrangement_projection_parity` — every compatibility-owned arrangement field
  is projected from the DB and must match the legacy blocs/lanes exactly except
  the eight named Spain beneficiary additions; removals and other edits fail;
- `citizenship_roundtrip_parity` — every canonical-owned route field (mode,
  status, summary, confidence, `last_checked`, source URL set) round-trips; the
  free-form `facts` object and the descriptive `title` are explicitly
  legacy-carried until the canonical schema owns them. Pilot route-ID set
  equality prevents missing or additional routes from passing;
- `graph_parity` — the full derived graph (1,961 edges) differs from
  `public/edges.json` (1,953) only by the eight Spain settlement edges and the
  three Spain two-year-naturalization conditional edges whose `needs` widened;
- `legacy_remainder_byte_parity` — the non-pilot slice of the source is
  reconstructed and hash-compared;
- `selected_revision_state` — draft previews accept draft/approved heads, while
  approved-head and explicit-release builds require approved revisions;
- `canonical_reference_integrity` — every route and arrangement source
  reference resolves inside the selected revision set;
- `relational_projection_completeness` — payload counts must match the
  release-scoped SQL coverage, timeline, arrangement, and edge projections.

The compiler never approves D1 revisions, publishes a release, replaces
`public/*.json`, or deploys.

Remote D1 state:

- 15 sources;
- 3 jurisdictions;
- 3 arrangements;
- 21 total revisions, all `draft`;
- 0 releases;
- 0 unresolved evidence references.

Remote export verification completed on 2026-07-20:

- `wrangler d1 export flag-paths-data --remote` produced a SQL export;
- `data:build -- --db <export.sql>` materialized and compiled that export;
- the remote export and local mirror produced the same database content hash,
  the same 21 selected entities, and the same release ID
  (`d87a3807edbbebac`);
- all 34 generated release files had identical paths and bytes.

The public website has not been cut over or redeployed for this migration.
`atlas.thomphreys.com` still reads the existing public JSON.

Validation at handoff:

- 118 tests pass, including adversarial compiler mutations and SQL-export parity;
- TypeScript passes (root `tsc` now includes `scripts/`);
- Vite production build passes;
- existing warning: main JS chunk is approximately 520 kB.

## Honest status and remaining work

`data:build` is a real DB→release compiler with passing parity gates, but this
is still **Phase 2 in progress**, not a completed cutover. Before approving D1
revisions or cutting over:

1. **Schedule D1 backups.** Back up `flag-paths-data` to private R2 on a
   schedule and test restoration, so a reviewed release has a recovery path.
2. **Human review of the draft revisions.** The 21 canonical revisions are all
   `draft`. A reviewer approves the pilot scope through the publication service
   (never the intake Worker).
3. **First immutable release from approved D1 rows**, then **Phase 3 versioned
   browser reads** (content-addressed release files shipped with the Worker).

Do not approve D1 revisions, publish a release, replace `public/*.json`, or
deploy the website until parity passes against an approved export and a
backup/restore has been demonstrated.

## Scripts-folder direction

The folder is transitional, not the future source of truth.

Keep a small compiler/operations layer:

- schema and migration generation;
- D1/local SQLite import;
- deterministic release compilation;
- parity and integrity checks;
- deployment and rollback commands.

Retire these legacy JSON-to-JSON builders after SQL output reaches parity:

- `build_coverage.js`;
- `build_citizenship_routes.js`;
- `build_edges.js`;
- `build_timeline_rules.js`;
- the shadow/candidate migration builders once cutover is complete.

Do not delete them early: they currently define compatibility behavior and are
needed as parity oracles. After cutover, consolidate the surviving commands
behind `bun run data:build`; moving the implementation from `scripts/` into a
dedicated `data-pipeline/` package is optional organization, not an
architectural requirement.

## Useful commands

```sh
git status --short
bun install
bun run data:schemas
bun run data:migrate:canonical
bun run data:db          # Git → persistent SQLite (seeds the database)
bun run data:build       # SQLite/D1 export → draft release (reads the database)
bun run data:build -- --db path/to/export.sql --mode approved
bun run data:build -- --db path/to/export.sql --mode release --release <release_id>
bun run data:build -- --baseline <prior_release_id>
bun run build
```

D1 configuration and operational commands are documented in
`data/d1/README.md`. Never apply canonical migrations or imports to
`flag-paths-monitor`.

## Working preferences

- Prefer TypeScript.
- Use short conventional commit messages.
- Split materially different work into separate commits.
- Push completed validated work to `main`.
- Preserve existing user changes.
- Keep legal data review-first: monitoring signals and AI output cannot directly
  publish facts.

## Prompt for the next LLM

> Continue the Flag Paths D1 migration in this repository. Read
> `docs/continuation-handoff.md` and `docs/data-migration-plan.md` completely,
> inspect `git status` and the recent commits, then implement the immediate next
> task. `bun run data:build` is a DB-driven release compiler that reads
> `canonical_revisions.payload_json` and passes its parity gates; do not rebuild
> it — build on it. This is still Phase 2 in progress, not a cutover: the
> real `flag-paths-data` D1 export has already reproduced release
> `d87a3807edbbebac` byte-for-byte against the local mirror. The remaining work
> is scheduling and restoring an R2 backup, then human approval of the draft
> revisions. The
> compiler already supports draft, approved-head, and explicit-release modes
> and bundles SQL coverage/timeline projections. Keep D1 as the authoring source
> and static JSON as
> generated public output. Do not approve or publish the current draft
> revisions and do not cutover or deploy until parity passes against an approved
> export and a backup/restore has been demonstrated. Use TypeScript, run the full
> build, make short logical commits, and push validated work.

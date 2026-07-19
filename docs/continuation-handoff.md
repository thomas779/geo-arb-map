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

- `bc62a9f feat: add data migration shadow`
- `11ef266 feat: define canonical data schemas`
- `4ffd2a0 fix: source pilot arrangements`
- `0e8da2b feat: add canonical data store`
- `a998d5d feat: add canonical sql build`
- `6d52686 feat: connect canonical d1`

Implemented:

- canonical Zod and JSON schemas;
- field-level evidence references with stable IDs;
- pilot records for France, Portugal, Spain, EU/EEA, Mercosur, and the Spain
  Ibero-American route;
- deterministic local SQLite import;
- one provider-neutral mutation plan rendered as D1-compatible SQL;
- SQL-derived coverage, route, arrangement, and graph projections;
- approval-gated immutable releases;
- isolated `flag-paths-data` D1 in Western Europe.

Remote D1 state:

- 15 sources;
- 3 jurisdictions;
- 3 arrangements;
- 21 total revisions, all `draft`;
- 0 releases;
- 0 unresolved evidence references.

The public website has not been cut over or redeployed for this migration.
`atlas.thomphreys.com` still reads the existing public JSON.

Validation at handoff:

- 90 tests pass;
- TypeScript passes;
- Vite production build passes;
- existing warning: main JS chunk is approximately 520 kB.

## Immediate next task

Build `bun run data:build` as the single deterministic release compiler:

1. read an explicit canonical revision/release scope from local SQLite/D1;
2. combine migrated canonical entities with the read-only legacy remainder;
3. generate catalog, country details, arrangements, coverage, timelines,
   graph edges, API release rows, and a changelog;
4. compare generated compatibility documents with the existing public files;
5. fail on duplicate ownership, missing IDs, unsupported evidence paths, or
   unexpected drift;
6. permit the known Spain beneficiary correction only as an explicit reviewed
   difference;
7. do not approve D1 revisions, publish a release, replace public JSON, or
   deploy the website until parity gates pass.

The detailed checklist is in `docs/data-migration-plan.md`.

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
bun run data:db
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
> task. Keep D1 as the authoring source and static JSON as generated public
> output. Do not approve or publish the current draft revisions and do not cut
> over or deploy until the SQL-plus-legacy compatibility build passes explicit
> parity tests. Use TypeScript, run the full build, make short logical commits,
> and push validated work.

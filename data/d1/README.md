# Canonical data database

This directory defines the local-SQLite and Cloudflare D1 schema for reviewed
Atlas facts. It is intentionally separate from
`monitor/cloudflare/migrations/`, which accepts untrusted newsletter intake.

The storage model is hybrid:

- immutable canonical JSON records preserve the complete typed legal record;
- relational projections index the fields used by coverage, route, graph, and
  API queries;
- evidence links pin a source revision to a stable field path;
- immutable releases select exactly one approved revision of each entity.

This avoids fully normalizing every evolving eligibility rule while still
making important relationships and filters queryable in SQL.

Do not apply these migrations to `flag-paths-monitor`. Production will use a
separate `flag-paths-data` D1 database and a reviewer/publication Worker that is
not reachable from the email intake binding.

During the migration, generated local databases belong under `.generated/`.
The existing JSON remains authoritative until the parity and cutover gates in
`docs/data-migration-plan.md` pass.

Run:

```sh
bun run data:db
```

This creates three ignored artifacts:

- `.generated/data-canonical/canonical.sqlite` for local inspection;
- `.generated/data-canonical/canonical-projections.json` for parity review;
- `.generated/data-canonical/canonical-import.sql` for D1 import.

The SQLite database and D1 SQL come from the same parameterized mutation plan.
The import is idempotent and creates draft revisions only. It does not create or
publish a release.

Do not apply the SQL file to `flag-paths-monitor`. Once the separate
`flag-paths-data` database and its least-privilege deployment configuration
exist, apply the schema migration first and the generated import second.
Approval and publication remain separate operations guarded by database
constraints.

Current remote pilot state:

- 15 source revisions, 3 jurisdiction revisions, and 3 arrangement revisions;
- all 21 revisions are `draft`;
- all evidence references resolve; and
- the release table is empty.

The isolated database is configured in `wrangler.jsonc`. Apply schema
migrations with:

```sh
bunx wrangler d1 migrations apply flag-paths-data \
  --remote \
  --config data/d1/wrangler.jsonc
```

Import the generated draft records with:

```sh
bunx wrangler d1 execute flag-paths-data \
  --remote \
  --config data/d1/wrangler.jsonc \
  --file .generated/data-canonical/canonical-import.sql
```

Export the remote database and run the same release compiler against it before
approval or publication:

```sh
mkdir -p .generated/data-canonical/remote
bunx wrangler d1 export flag-paths-data \
  --remote \
  --config data/d1/wrangler.jsonc \
  --output .generated/data-canonical/remote/flag-paths-data.sql
bun run data:build -- \
  --db .generated/data-canonical/remote/flag-paths-data.sql
```

Wrangler exports D1 as SQL rather than as a SQLite file. `data:build`
materializes that SQL in a temporary SQLite database, validates it, and removes
the temporary database after compilation. The SQL export remains local and
ignored under `.generated/`.

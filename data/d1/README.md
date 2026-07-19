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

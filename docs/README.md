# Documentation

The repository intentionally keeps only two detailed design documents:

- [`data-migration-plan.md`](data-migration-plan.md) — D1 authoring, compiled
  releases, country-review order, and cutover gates.
- [`explorer-spec.md`](explorer-spec.md) — pathfinding invariants that remain
  enforced by tests while the planner is a preview.
- [`adding-jurisdictions.md`](adding-jurisdictions.md) — turnkey procedure for
  adding reviewed jurisdictions and expanding route-level coverage.

Operational instructions live beside the code they operate:

- [`../monitor/README.md`](../monitor/README.md) — collection, triage, Telegram,
  and the offline pipeline test.
- [`../monitor/cloudflare/README.md`](../monitor/cloudflare/README.md) — email
  intake deployment.
- [`community-distribution.md`](community-distribution.md) — authentic, no-ads
  playbook for growing the Telegram channel and Atlas.
- [`../data/d1/README.md`](../data/d1/README.md) — canonical D1, backups, restore,
  review, and release commands.

Public v1 is the Atlas plus the `@flagpaths` update channel. The planner,
profiles, accounts, tax modeling, and discussion community are later work.

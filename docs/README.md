# Documentation map

This index defines which Flag Paths documents control current work. A document
that is not marked **current** is context, not an instruction to change the
product or data pipeline.

## Current

- [`data-migration-plan.md`](data-migration-plan.md) — the single engineering
  roadmap for moving canonical legal data into D1 and compiling public releases.
- [`gtm-v1.md`](gtm-v1.md) — the product and launch scope for the public Atlas.

## Durable reference

- [`data-architecture.md`](data-architecture.md) — domain boundaries, source
  policy, timeline ownership, and canonical modeling rules.
- [`explorer-spec.md`](explorer-spec.md) — shipped pathfinding invariants and
  acceptance rules. It is not an implementation roadmap.
- [`strategic-map.md`](strategic-map.md) — long-term product direction beyond v1.

## Operations

- [`operations/data-backups.md`](operations/data-backups.md) — D1 backup and
  restoration runbook.
- [`monitoring-pipeline-v0.md`](monitoring-pipeline-v0.md) — current source
  discovery, triage, and review-lead pipeline.
- [`telegram-publishing-v0.md`](telegram-publishing-v0.md) — reviewed public
  update workflow for `@flagpaths`.

## Archived or deferred context

- [`continuation-handoff.md`](continuation-handoff.md) — historical snapshot;
  superseded by this index and the migration plan.
- [`community-strategy.md`](community-strategy.md) — deferred discussion-community
  proposal. The v1 community surface is the Telegram broadcast.
- [`monitoring-architecture.md`](monitoring-architecture.md) — deferred
  account-backed monitoring proposal. It must not override the v0 runbook.

## Decision hierarchy

When documents disagree, use this order:

1. tested schemas, migrations, and compiler invariants;
2. `data-migration-plan.md` for engineering sequence;
3. `gtm-v1.md` for public product scope;
4. durable reference documents;
5. archived or deferred context.


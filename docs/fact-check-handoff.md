# Fact-check handoff

This is the entry point for a human or another model reviewing Flag Paths data.
It points to canonical records instead of copying legal claims into a second,
stale document.

## Reproduce the review surface

```sh
bun run data:db
bun run data:build
bun run data:review
bun run monitor:audit
bun run build
```

The canonical jurisdiction facts and field-level evidence are authored in
`scripts/lib/canonical-pilot.ts`. `data/migration-pilot.json` lists the country
records owned by D1. The generated review packet is written to
`.generated/data-canonical/reviews/<release-id>.md`; the country/source coverage
audit is `.generated/monitor/source-coverage.json`.

## Review checklist

For every jurisdiction in `data/migration-pilot.json`:

1. Review all four coverage modes: ancestry, naturalization, birth, and direct
   citizenship by investment. A sourced `verified_none` is a finding, not an
   empty record.
2. Open every `source_ref`; prefer current consolidated law and official
   government guidance. Confirm that each `supports_fields` path is actually
   supported by that source.
3. Separate citizenship at birth, later acquisition because of birthplace,
   descent, residence eligibility, and administrative processing time.
4. Check exceptions, effective dates, territorial scope, parental status,
   residence continuity, age, declaration, language, and renunciation rules.
5. Treat investor residence or permanent residence as distinct from direct
   citizenship by investment.
6. Report disagreements using the canonical record ID, JSON pointer, source
   URL, proposed correction, and the date the source was checked.

Do not approve a generated packet merely because it validates. Schema and
parity gates prove reproducibility, not legal correctness.

## Monitoring boundary

`monitor/sources/manifest.json` is the machine-readable watchlist. Official
feeds, APIs, gazettes, and stable government pages may produce verification
signals. Newsletters, agencies, Telegram, YouTube, and social media are only
discovery signals; every accepted claim must be resolved to primary evidence.

The monitor creates review leads and never edits canonical facts. A legal
change becomes data only through evidence review, a canonical revision, the D1
release compiler, tests, and human approval.

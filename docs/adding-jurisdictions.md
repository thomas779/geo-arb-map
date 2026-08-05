# Adding jurisdictions (expanding route-level coverage)

This is the turnkey procedure for adding reviewed jurisdictions to the Atlas —
the same flow used for the Europe, Americas, Africa, Pacific, and Asia batches.
It exists because two of the required steps are non-obvious and break CI if
skipped: wiring a monitor **verification** source per jurisdiction, and updating
the hand-pinned iso/route-id lists in the test suite.

## What "coverage" means

The public "Route-level coverage" figure (`src/App.tsx`, `TrustCenter.tsx`) is:

```
reviewedModes / (meta.counts.jurisdictions × 4)
```

Each jurisdiction has four acquisition modes — `ancestry`, `naturalization`,
`birth`, `investment` — and a mode "counts" only when its coverage
`review.state === 'reviewed'`. The denominator is **all 240 registry entries**
(200 sovereigns + 38 territories + 2 special), so every jurisdiction fully
reviewed adds `4 / 960 ≈ 0.42` points. A jurisdiction is "done" when all four of
its mode-coverage cells are `reviewed`, each finding is `present` or a sourced
`verified_none`, and it has an active verification source.

## Files you touch per batch

> **Private dataset.** `scripts/lib/canonical-pilot.ts` is the master dataset
> and is **gitignored** — it lives only in the maintainer's environment and is
> synced to the D1 canonical store (backed up to R2). It is never committed;
> keep your local copy backed up. Forks and public CI fall back to
> `canonical-pilot.sample.json` through `scripts/lib/canonical-source.ts`. After
> editing the master, refresh the public sample with
> `bun scripts/build_canonical_sample.ts`.

Hand-edited inputs:

1. **`scripts/lib/canonical-pilot.ts`** — the authoring source of truth
   (private; see the note above).
   - Add the official source URL(s) to the `OFFICIAL_URLS` map.
   - Add a row to the `jurisdictionSources()` tuple table:
     `['<Title>', OFFICIAL_URLS.<key>, '<iso_n3>', '<lang>', '<source_type>', '<monitor-id>']`.
     The last element (`monitor-id`) must match a manifest source id (step 3).
   - Write one `xxxRecord(shadow, officialSources)` builder. Copy a recent
     cohort record such as `maliRecord` (single-source, three routes) or
     `argentinaRecord` (adds a `pending_verification` investment route).
   - Add the record to the `jurisdictions` array inside `buildCanonicalPilot`,
     in alphabetical position.
2. **`data/migration-pilot.json`** — add each `iso_n3` to the `jurisdictions`
   array (kept numerically sorted). The iso must already exist in
   `data/registry.json` (all 240 do).
3. **`monitor/sources/manifest.json`** — add **one active `tier:"verification"`
   source per jurisdiction**. Required — `tests/monitor-source-audit.test.ts`
   fails otherwise. Constraints:
   - `adapter` must be one of `rss`, `html_index`, `telegram_html`
     (`monitor/sources/audit.ts` `IMPLEMENTED_ACTIVE_ADAPTERS`).
   - `status: "active"`, `jurisdictions: ["<iso>"]`.
   - `id` must equal the `monitor-id` used in the tuple row. The canonical
     source's `monitoring.source_id` (auto-set to that id, `method: "http"`,
     which maps to adapter `html_index`) must line up, or the audit reports a
     `structural_error`.

Regenerated artifacts — **do not hand-edit, and do not try to commit**:

4. **`data/compiled/citizenship_routes.json`** and **`data/compiled/data_release.json`** —
   produced by `data:db` → `data:promote` (below). Both are **gitignored** since
   2026-08-04: the compiled dataset lives in the private `flag-paths-data` repo,
   which CI and the deploy fetch with a deploy key. A commit does not ship data;
   `bun run data:publish` does.

Pinned test lists to refresh (they break by design on any jurisdiction change):

5. `tests/data_migration.test.ts` — the `iso_n3` list and
   `counts.jurisdictions`.
6. `tests/canonical_store.test.ts` — the `projections.coverage` iso list.
7. `tests/canonical_schema.test.ts` — the ordered `routeIds` list (array order =
   `buildCanonicalPilot` order × route order).
8. `tests/data_build.test.ts` — the sorted `detail.canonical_additions` route-id
   list.
9. `tests/data_invariants.test.ts` — **only if** the batch adds an investment
   route: the active-CBI count (`toBe(13)`) or the pending-investment iso list.

Do **not** transcribe these lists by hand. Regenerate them from the built pilot
(see below).

## Modeling notes (from `docs/fact-check-handoff.md`)

- Reuse the helpers: `officialSource`, `reviewedCountryRecord`,
  `principalCitizenshipRoute`, `requireSource`. `principalCitizenshipRoute`
  accepts `confidence: 'high' | 'medium'` only — for a genuinely low-confidence
  figure, set `'medium'` and say "Low confidence:" in the `note`, or hand-author
  the route object (which allows `'low'` per `RouteSchema`).
- One route per `present` mode minimum; add extra routes for distinctive
  leverage (e.g. ethnic-origin descent, heritage fast-tracks).
- **A URL in prose is not a citation.** Every new claim needs a registered source:
  add the URL to `OFFICIAL_URLS`, add a tuple to the official-sources table, and
  pass the resolved record into the route's `source`. A link pasted into a
  `summary` or `note` string is invisible to `source_refs`, to the evidence index,
  to the citation ledger and to the source-verification monitor. If a claim has no
  citable URL, it does not go in the artifact — record the lead in the note
  qualitatively and leave the number out (see `indonesia-naturalization`).
- **`summary` is the machine-readable field**; `note` is the caveat. The Atlas
  publishes per-country slices for model ingestion, so a hedged figure in a note
  becomes an unhedged fact the moment something extracts it. Never let the summary
  assert what the note qualifies: if the gazette has not been read, the summary
  says "reported" and does not state a gazette date.
- **`last_checked` means "the whole route was read against its sources on this
  date"**, not "someone touched this row". Adding a fee note after verifying one
  page does not re-verify the residence clock. Bump it only when the route's
  substantive claims were re-read; otherwise leave it and date the new finding
  inside the `note`.
- `investment` = a **direct** citizenship-by-investment programme. Investor
  *residence* (Gulf premium residency, golden visas) is **not** CBI → mark
  `verified_none` and note the residence programme. A statutory-but-uncertain
  investment route → a `pending_verification` route with coverage `present`
  (see `argentinaRecord`); this moves the pending-CBI pin in
  `data_invariants.test.ts`.
- `verified_none` requires `review.state === 'reviewed'` plus a source — a
  sourced negative, never an empty record.
- Keep the constitution/nationality-law as a stable, monitorable primary source
  (Constitute Project constitutions are the common baseline); push exact
  statutory specifics into route `summary`/`note` with honest confidence.
- During every new review, populate the typed fields when the official evidence
  supports them: `parent_residence_right` for birth routes,
  `transmission_abroad` for birth/ancestry routes,
  `nationality_eligibility` for direct CBI or residence routes, and the
  jurisdiction-level `dual_nationality` finding. Each object carries its own
  `source_refs`; omission means not recorded and must never be treated as a
  negative finding.

## Command sequence

```sh
bun run data:db                        # import canonical records → SQLite
bun run data:build                     # parity gates (non-zero exit blocks cutover)
bun run monitor:audit                  # expect no `no_active_verification_source` gaps
bun run data:promote -- --allow-draft  # rewrite data/compiled/{citizenship_routes,data_release}.json
bun test                               # regenerate the pinned lists (below) until green
bun run build                          # tsc + monitor tsc + tests + vite (what CI runs)
bun run data:publish                   # push the release to flag-paths-data (nothing ships without this)
```

`data:publish` is not optional and not covered by `git push`. The compiled files
above are gitignored, and both public CI and the deploy workflow read the dataset
from the private `flag-paths-data` repo. Skip it and the live Atlas keeps serving
the previous release while the repo looks up to date. Before promoting, diff the
built JSON against what is already published: another agent's canonical-only
routes exist nowhere else and a blind promote drops them.

### Persisting to the D1 canonical store

The committed `public/*.json` is what the live site serves, but the durable
canonical store is D1 (backed up to R2). Because `canonical-pilot.ts` is
gitignored, **CI cannot sync it** — `sync-canonical-d1.yml` only ever sees the
public sample. Persist from your local machine with:

```sh
export CLOUDFLARE_API_TOKEN=…          # scoped: Account · D1:Edit is enough
bun run data:sync -- verify            # counts + head-ambiguity report (read-only)
bun run data:sync -- sync              # backup → wipe canonical tables → fresh import → verify
```

`data:sync` talks to the D1 **REST API**, not `wrangler`: a least-privilege
`D1:Edit` token cannot use `wrangler d1 export` or `execute --remote --file`
(both stage through R2 and silently no-op). `sync` is a clean rebuild — it backs
up the current canonical tables to `.generated/data-canonical/backups/` first,
never touches the `monitor_*` tables, and refuses to run against the sample
dataset. It resolves drifted/ambiguous revision heads that the additive
`sync-canonical-d1.yml` import cannot.

### Regenerating the pinned test lists

After `data:db`, print the exact arrays and paste them into the four test files
(or script the replacement). The arrays come straight from the built pilot:

- iso list / coverage list: `buildDataShadow().jurisdictions.map(j => j.jurisdiction.iso_n3)`
  (numerically sorted; identical for `data_migration` and `canonical_store`).
- `routeIds`: `buildCanonicalPilot().jurisdictions.flatMap(j => j.routes.map(r => r.id))`.
- `canonical_additions`: the sorted route-id list in the
  `citizenship_roundtrip_parity` gate of the release `parity-report.json`.

## Acceptance

- `bun run build` is green (parity gates + all pinned suites + vite).
- `monitor:audit` shows `jurisdictions_with_active_verification` equal to
  `canonical_jurisdictions` (no verification gaps).
- The TrustCenter percentage rises by ~0.42 points per fully-reviewed
  jurisdiction.

## Out of scope / later passes

- The 38 territories and 2 special entries in the denominator (territories
  frequently inherit routes from a parent sovereign).
- Edge/uninhabited registry sovereigns (Vatican, San Marino, Somaliland, Åland,
  BIOT, S. Georgia, Heard/McDonald) — several need special-case treatment rather
  than the standard four-mode template.

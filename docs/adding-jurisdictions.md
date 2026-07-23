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

Regenerated committed artifacts — **do not hand-edit**:

4. **`public/citizenship_routes.json`** and **`public/data_release.json`** —
   produced by `data:db` → `data:promote` (below).

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

## Command sequence

```sh
bun run data:db                        # import canonical records → SQLite
bun run data:build                     # parity gates (non-zero exit blocks cutover)
bun run monitor:audit                  # expect no `no_active_verification_source` gaps
bun run data:promote -- --allow-draft  # rewrite public/citizenship_routes.json + data_release.json
bun test                               # regenerate the pinned lists (below) until green
bun run build                          # tsc + monitor tsc + tests + vite (what CI runs)
```

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

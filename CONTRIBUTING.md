# Contributing

This is a community handbook. The most valuable contribution is a **data
correction with a source** — rules change constantly and no one person can
watch every country.

## Fix or add data

1. Open a correction or monitoring issue with the primary source and affected
   country, route, or arrangement. Public JSON is compatibility output during
   the D1 cutover; do not introduce another editable source of truth.
2. Make the smallest canonical or compatibility change and run:

   ```sh
   bun install
   bun run build   # tsc → invariant tests → vite build
   ```

   The test suite (`tests/`) blocks anything that reintroduces a previously
   fixed mistake, breaks the schema, or forgets required fields (identity
   lanes need a `beneficiaries_note`; ballot/quota lanes need an explicit
   `allocation`; etc.).
3. If you touched a compatibility route or arrangement, regenerate only the
   affected outputs:

   ```sh
   bun run data:citizenship
   bun run data:edges
   ```

4. Open a PR. CI runs the same gate.

## Ground rules (from `docs/explorer-spec.md`)

- **Privileged access only** — never add a country's ordinary immigration or
  naturalization rules as an "arrangement".
- **Confidence is honest**: below-high-confidence findings go in
  `pending_verification`, not on the map. Checked-and-empty results go in
  `meta.excluded` with a reason — absence of evidence is never displayed as
  evidence of absence.
- Work-only routes never chain into settlement; ballot/quota/discretionary
  routes never appear as guaranteed plans.
- When you fix a factual mistake, **add an invariant test** so it stays fixed.

## Not sure? Open an issue

A link to a changed law or a "this looks stale" note with a source is a
perfectly good contribution.

Dataset: CC BY 4.0 · Code: MIT · Nothing here is legal advice.

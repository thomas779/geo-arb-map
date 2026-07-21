# Strategy Explorer — Locked Design Decisions

Status: **engine SHIPPED (2026-07-17): `scripts/build_edges.js` → `public/edges.json`,
`src/lib/pathfinder.ts` (multi-source Dijkstra, needs-gating, allocation filtering),
acceptance tests in `tests/pathfinder.test.ts` — all green. The planner's Next moves
now uses multi-hop paths with retained-citizenship and renunciation history.
Still open: dedicated explorer page, coverage page, money/presence lexicographic
dimensions (currently years-only + hops tiebreak).**
This file records decisions locked on 2026-07-16 (from batch-3 external research review
plus owner rulings) so the feature lands cleanly when requested. Concepts win over
naming: where the research doc's field names differ from the repo's, the repo's win.

## Data layer (already built)

- `public/blocs_data.json` — blocs, bilateral_lanes, stacking_plays, meta.excluded,
  `pending_verification` (below-high confidence, never rendered/never in graph),
  `dual_citizenship` (per-country policies + treaty_exceptions).
- `data/registry.json` — canonical jurisdiction registry: M49-style core sovereigns
  plus the territory and special-jurisdiction supplement.
- `data/manual_edges.json` — hand-audited overrides. Every entry carries
  `reason_code` (`event_accelerator | treaty_exception | status_rendering_override |
  coverage_negative_seed`), sources, and date.
- canonical D1 mode coverage — records `unknown`, `present`, and sourced
  `verified_none` independently for all four acquisition modes.

## Node design (locked)

Legal-status nodes: `cit:ISO`, `pr:ISO`, `tr:ISO`, `work:ISO`.
Virtual entitlement nodes: `settle_full:ISO`, `settle_partial:ISO` — bloc mobility
rights are NOT domestic PR and must not be conflated with `pr:ISO`.

Derivation rules (conservative):
- Bloc category `full` → `cit:X` → `settle_full:Y` (0-year edges) for co-members.
- `partial` / `hub_spoke` / `one_way` → `settle_partial:Y` per what the arrangement
  actually grants.
- `proto` blocs → **no edges at all**.
- Work-only lanes (`leads_to_settlement: false`) terminate at `work:ISO`, no successors —
  they can never chain into naturalization.
- Identity lanes (empty beneficiaries) → conditional edges gated by a machine-readable
  `needs` array (e.g. `["irish_ancestry"]`, `["jewish_heritage"]`,
  `["spouse_nationality:724"]`, `["willing_to_have_child_abroad"]`).
- Naturalization edges into `cit:Y` only from high-confidence records or audited
  overrides. `pending_verification` records generate no edges.

## Allocation semantics (locked)

`allocation`: `right` (default, absent) | `ballot` | `quota_queue` | `discretionary`.
- `ballot`: Australia PEV, NZ Samoan Quota, NZ Pacific Access.
- `quota_queue`: Japan EPA lanes; Mainland→HK/Macau one-way permit (150/day, score-based).
- `discretionary`: Falklands→Argentina recognition, Russia Compatriot programme.
Non-`right` edges NEVER appear in deterministic plans or footprint counts — they render
in a separate "chance-based routes" panel with explicit non-guarantee badges.

## Dual citizenship (locked, incl. Russia correction)

- Renunciation-required set: Japan, India, Kazakhstan, DR Congo, China, Andorra.
- **Russia is NOT in that set**: requirement eliminated 2020; 138-FZ (2023) needs only
  an unverified declaration. Caveat carried in data: naturalized citizens face broad
  revocation grounds (138-FZ art. 22–24, expanded July 2025) — acquired citizenship is
  legally weaker than birth citizenship. `volatility: high`.
- Russia–Tajikistan treaty = conflict-of-laws record in `dual_citizenship.treaty_exceptions`,
  not a mobility lane and not the thing that permits keeping both.
- Renunciation math: applied AFTER a path reaches a naturalization edge, BEFORE the
  footprint delta renders. Show losses explicitly ("lose Mercosur", "lose CPLP",
  "lose Spain 2-yr leverage"), never just "+N countries".

## Event accelerators (locked)

- Brazil: child born there → child `cit:076`; parent naturalization at 1 yr (MJ source).
- Mexico: child born there → child `cit:484`; parent naturalization at 2 yrs (SRE source).
- Argentina: child `cit:032`; parent gets family-based `pr:032` ONLY — no verified
  parent citizenship fast-track. Parent then uses the ordinary 2-yr track.

## Greater China (locked, permanent)

One-way status cards only — never bloc-style map fills, never in footprint counts for
non-Chinese nationals. HK/Macau 7-yr PR is ordinary immigration law: context text, never
a lane. Mainland→HK/Macau settlement is quota-scored family reunion (`quota_queue`).
HK/Macau Gold Card explicitly cannot be used for settlement in Taiwan.

## Footprint math (locked)

Multi-source expansion from the user's citizenship nodes along `allocation: right` edges
only. Exclude: proto blocs, work-only terminals, ballot/quota/discretionary edges,
pending_verification. Deduplicate jurisdictions across overlapping blocs (Bolivia's
CAN+Mercosur must not double-count). Count `settle_full` and `settle_partial` separately.

## Pathfinder (when built)

Legal logic (which edges exist for THIS user) separated from graph logic (ranking).
Multi-source Dijkstra from active citizenships carries the citizenship set through
each state so later nationality-gated edges and renunciation are evaluated correctly;
max 4 edges. Ranking is currently years then hops; money and physical presence remain
future lexicographic dimensions.

## Build order (locked)

1. ~~normalizer~~ → 2. ~~coverage registry~~ → 3. ~~build_edges.js~~ →
4. ~~renunciation + allocation semantics~~ → 5. ~~pathfinder + footprint engine~~
(all done 2026-07-17) → 6. explorer page → 7. coverage page → 8. map-panel
indicators + Greater China card renderer.

Nationality-conditioned naturalization is represented as a general ordinary edge
plus a faster edge gated by `citizenship_any:<ISO,...>`. Spain therefore uses the
ordinary 10-year track unless the path's retained citizenship set contains an
audited Ibero-American beneficiary. Add future conditional timelines to
`data/timeline_rules.json`, referencing a reviewed route fact whenever one
exists. Arrangement and playbook prose never generates graph durations. Event
accelerators and CBI durations are modeled separately, and conditional snippets
without a user-checkable fact do not generate deterministic naturalization edges.

## Acceptance tests (implement as real tests before shipping the explorer)

a. US citizen, no conditional facts: TN never chains into US settlement.
b. Checking "Jewish heritage" reveals only the Law of Return edge; other identity lanes stay hidden.
c. Samoan citizen sees the Samoan Quota only in chance-based routes, never the plan list.
d. A Brazilian pathway into a renunciation-requiring destination displays footprint losses alongside gains.
e. A non-Chinese national clicking HK/Macau gets the one-way rules card, never a bloc fill.

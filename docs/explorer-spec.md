# Strategy Explorer — Locked Design Decisions

Status: **deferred with the planner. The experimental pathfinder remains covered by
acceptance tests, but no graph artifact is shipped to the Atlas. A future planner
should derive its graph from canonical D1 records rather than committing a second
public data source.**
This file records decisions locked on 2026-07-16 (from batch-3 external research review
plus owner rulings) so the feature lands cleanly when requested. Concepts win over
naming: where the research doc's field names differ from the repo's, the repo's win.

## Data layer (prototype reference)

- `public/blocs_data.json` — blocs, bilateral_lanes, stacking_plays, meta.excluded,
  `pending_verification` (below-high confidence, never rendered/never in graph),
  `dual_citizenship` — `treaty_exceptions` ONLY. The per-country policy map that used
  to live here was a rival model of the canonical `dual_nationality` field on its own
  enum (`banned` vs `prohibited`); #144 migrated it out and retired it.
- `data/registry.json` — canonical jurisdiction registry: M49-style core sovereigns
  plus the territory and special-jurisdiction supplement.
- `data/manual_edges.json` — retained prototype inputs pending migration into D1.
  Every entry carries
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
  predicate list: `{subject, attribute, op, value, provenance}` per
  `src/lib/predicates.ts`. `subject` (`self` | `partner` | `parent` | `child`) is what
  lets a gate name someone other than the applicant; `provenance` keeps "the law says"
  (`sourced`) apart from "you told us" (`self_attested`). The older flat
  `needs: string[]` vocabulary (`ancestor:ISO`, `heritage:<claimId>`,
  `citizenship_any:<CSV>`, `willing_child_abroad`) is frozen but still honoured: every
  edge carries both, the strings translated by a shim.
- **An unrecognised gate must fail loudly.** Unknown attribute, unsupported op,
  unreadable subject or malformed value is a `build_edges.js` failure; at solve time
  the pathfinder throws. It must never evaluate to false, because a false gate deletes
  the edge from the graph without an error and the only symptom is a quieter planner.
- Naturalization edges into `cit:Y` only from high-confidence records or audited
  overrides. `pending_verification` records generate no edges.

## Allocation semantics (locked)

`allocation`: `right` (default, absent) | `ballot` | `quota_queue` | `discretionary`.
- `ballot`: Australia PEV, NZ Samoan Quota, NZ Pacific Access.
- `quota_queue`: Japan EPA lanes; Mainland→HK/Macau one-way permit (150/day, score-based).
- `discretionary`: Falklands→Argentina recognition, Russia Compatriot programme.
**Amended 2026-08-20 — the filter is RATIONING, not formal discretion.** The rule above
read `allocation === 'right'` as the test for a deterministic plan. Measured against the
corpus that removes 96 of every 100 naturalisation routes, because 338 of 412 pathways
are `discretionary` and correctly so: almost every naturalisation statute lets the
minister refuse an otherwise-qualifying applicant.

Owner's ruling: a state that reserves a refusal and then refuses almost nobody has not
given you a lottery, so formal discretion is a poor discriminator. What actually stops a
qualifying person is rationing — a ballot, a queue, a cap.

So `ballot` and `quota_queue` are rationed and NEVER appear in deterministic plans or
footprint counts; they render in the chance-based panel with non-guarantee badges.
`discretionary` stays in plans and carries its allocation, so the UI can say the grant
is not automatic. See `isRationed` in `src/lib/pathfinder.ts`.

The signal we would rather have is an approval rate. The corpus holds none — zero uses
of `approval_rate`, `refusal_rate` or `grants_per_year` across 1,139 routes — so
rationing is a proxy, and sourcing refusal rates would replace it.

## Dual citizenship (locked, incl. Russia correction)

- Source of truth since #144: `jurisdictions[].dual_nationality` in the compiled corpus,
  which the planner reads via `pluralityIndex()`. It is not a flat enum: retention splits
  into `by_birth` / `by_naturalisation`, the inbound renunciation condition is a separate
  `acquisition` limb, and `asymmetry` names the axis a rule splits on. `provenance:
  'legacy_import'` marks the seventeen rows inherited unsourced from the retired model —
  they carry a status and prose and no limbs at all.
- The renunciation flag reads the INBOUND limb only, and only `renunciation_required`
  sets it. `renunciation_with_exceptions` (Spain, the Netherlands, Ukraine) does not,
  because whether it bites depends on which nationality the applicant already holds and
  the model cannot evaluate that; the exceptions are in the limb's detail.
- **Russia is NOT in that set**: requirement eliminated 2020; 138-FZ (2023) needs only
  an unverified declaration. Caveat carried in data: naturalized citizens face broad
  revocation grounds (138-FZ art. 22–24, expanded July 2025) — acquired citizenship is
  legally weaker than birth citizenship.
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
- Both halves reach the graph. The child grant is an `actor: 'child'` edge gated on a
  PARENT's declared intent (the child does not intend their own birth); the parent
  grant runs through `grant.via`, the residence the statute counts its clock from,
  rather than landing on the nationality directly.

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

## Household solving (locked)

The unit of planning is a household, not an applicant. Members are `self`, `partner`
(once nationalities are declared for one) and `child` (once a parent declares
`child_abroad` — the only fact that asserts a child into existence). Each has its
own status set, so renunciation, acquisition and loss are per member: one member
renouncing never strips another's citizenship.

- **Bounded by construction.** A joint search over the product of two members'
  states is what explodes, so members are solved SEPARATELY and communicate only
  through a summary of each other: nationality → earliest year they can hold it.
  Cost is members × rounds single-actor searches (≤ 6, and exactly one for a
  profile with no partner and no declared child), never the product. Two rounds,
  because the second is what turns an ACQUIRED nationality into a gate and nothing
  in the corpus gates on a nationality that itself needed a cross-actor gate.
- **A cross-actor gate costs time.** An edge unlocked by another member's status
  cannot fire before that status exists, so the step starts at
  `max(now, availableAt)`. Charging nothing would invent years the household does
  not have.
- **Absence of a member is loud.** A `HouseholdView` entry that is EMPTY means "we
  know there is nobody", which may fail a gate. An entry that is MISSING means the
  solve never modelled that person, and that throws. `parent` resolves only in a
  child's search, so an edge naming it must declare `actor: 'child'`
  (`edgeSubjectProblem`, enforced by build_edges) — otherwise it lands in a search
  that cannot answer it.
- **Availability is what a member can HOLD**, not what they passed through: a path
  that renounces on the way cannot lend the surrendered nationality to anyone.
  Known bound: the year comes from that member's own cheapest path, so a gate
  naming TWO of one member's nationalities at once is not verified against a
  single path of theirs. `eq` names one and `in` is a disjunction, so nothing in
  the corpus reaches that case.
- **Goals carry an actor**: `self` (absent = self, so old profiles and share URLs
  round-trip), `partner`, or `household` — which is answered by the BINDING member,
  the slowest or an unsolved one, because "we can all live there" is only true when
  the last of us can. `viaPartner` is intent-aware and present-tense: a partner who
  can only work somewhere does not cover a citizenship goal, their settlement
  rights do not pass as citizenship coverage, and their own multi-year
  naturalisation route is a plan in `perActor` rather than a badge saying the
  problem is solved.

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

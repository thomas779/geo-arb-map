# Rights Index — Locked Design Decisions

Status: **criteria locked, data programme open.** No index is computed or published
yet. `bun run index:audit` is the authority for coverage and every figure below is
copied from it, never hand-typed. Read as of 2026-08-09: **5 of 15 dimensions are
scoreable**, split Axis A 0 of 7 and Axis B 5 of 8. Re-run the audit before quoting
any of these numbers; they move with the corpus.

This file records decisions locked on 2026-08-04 so the feature lands cleanly when the
inputs exist. Concepts win over naming: where a future proposal's field names differ
from the repo's, the repo's win.

## Why this exists

Published passport rankings score **temporary** access: how many countries you may
visit without arranging a visa first. That is a real measure of convenience and a poor
measure of freedom. It says nothing about where you may actually live, whether you may
work when you get there, whether you can pass the status to your children, or whether
it can be taken away from you.

This index scores **permanent** access and rights instead. It is the reason the project
holds primary-sourced legal data rather than a travel matrix, and it is the one number
the corpus can produce that nobody else is producing.

`.agents/product-marketing.md` records the competitor gap. This file is the spec.

## Owner decisions (2026-08-04)

1. **Two axes, never blended.** "What a citizenship is worth once held" and "how open it
   is to outsiders" are separate published axes. A blend would score an easy-to-get,
   weak-to-hold citizenship identically to a hard-to-get, strong one, which is precisely
   the information the index exists to separate.
2. **Sub-scores plus one composite per axis.** Every dimension is published with its own
   visible score. Each axis also gets one headline composite so there is something
   shareable, with its weights stated in the open.
3. **The downside dimensions are in scope**, including conscription liability and
   citizenship-based taxation, accepting these are the largest and least-well-sourced
   additions in the programme.

## Axis A — Held: what the citizenship is worth once you have it

| # | Dimension | Measure |
|---|---|---|
| A1 | Settlement by right | jurisdictions where the holder may reside indefinitely without applying, by treaty or bloc membership. **Direction-aware.** |
| A2 | Work by right | the subset of A1 where labour-market access needs no permit. Residence without work is a materially weaker right and must not score the same. |
| A3 | Transmission to children | `unlimited` / `registration_required` / `first_generation_only` / none. The generational limit is the point: a citizenship that stops at the first child born abroad is a different asset from one that does not. |
| A4 | Plurality | whether other nationalities may be held alongside: allowed / conditional / prohibited. A citizenship that forces renunciation has a cost, not just a benefit. |
| A5 | Security of status | revocation grounds, loss by residing abroad, and any asymmetry between citizenship by birth and by acquisition. |
| A6 | Obligations | conscription liability, citizenship-based taxation, exit taxes, residence required to retain the status. |
| A7 | Onward acceleration | whether holding it shortens naturalisation elsewhere (the Ibero-American two-year track in Spain, CPLP, Mercosur). |

## Axis B — Openness: how obtainable the citizenship is

| # | Dimension | Measure |
|---|---|---|
| B1 | Jus soli | unconditional / conditional / none. |
| B1b | Jus soli condition | the severity of the condition on the conditional third (a parent's settled status is a higher bar than a parent's lawful presence). Audited separately from B1 because the tri-state can be complete while the condition is not. |
| B2 | Descent depth | the qualifying ancestral relation recorded per route. |
| B2b | Descent ceiling | how deep descent runs: the stated generational or date cutoff. Separate from B2 because absence of a cutoff is unknown, never a cutoff, so it cannot be derived from B2 and must be sourced. |
| B3 | Naturalisation period | the ordinary residence requirement in months. Ordinary track only, never the marriage or merit variant. |
| B4 | Investment | the lowest qualifying price. |
| B5 | Family | spouse and partner routes, and their duration requirement. |
| B6 | Discretion | whether the grant is as-of-right or discretionary. A discretionary route is not equivalent to an entitlement even at identical duration. |

## Scoring rules (locked)

These rules, not the dimension list, are what makes the index defensible.

1. **Unrecorded is never zero.** A `null` propagates as *not scored*. It never becomes a
   0, and it never becomes a favourable default. This is the most important rule in the
   file: the three route-level rights schemas, `transmission_abroad`,
   `parent_residence_right` and `nationality_eligibility`, are validated, projected,
   documented and tested, and each is populated on **0 of the 876 routes**. A scorer that
   read that absence as zero would rank every country identically low while looking
   precise. The audit reports this as A3 `EMPTY`.
2. **Completeness is published beside every score.** A rank resting on 3 of 7 dimensions
   must be visibly weaker than one resting on 7. Without this the index cannot be
   published honestly before the sourcing programme finishes, and with it, it can.
3. **Axis A and Axis B never combine into a single number.** One composite per axis.
4. **Direction-aware or not scored.** A1 and A2 read `participants.destinations` and
   `participants.beneficiaries`. A flat member list is not acceptable input: crediting a
   one-way right symmetrically would wrongly boost the UK on BN(O) and the Overseas
   Territories, and the US on the Compact of Free Association.
5. **No population, GDP, or desirability weighting.** Thirty-one EU peers counts Malta
   equal to Germany, deliberately. The index measures legal rights, not economic appeal.
   This is a choice and is stated as one, because it is the main axis on which the index
   will be criticised.
6. **Every dimension traces to an instrument.** A composite that cannot be walked back
   to primary law is the opaque number this index exists to replace.
7. **Weights are deferred, not undecided.** The rule is locked: weights are explicit,
   published, and sum to 1 within each axis. The numbers stay open until the inputs
   exist, because weights chosen now would be fitted to whichever five dimensions
   happen to be populated today, all five of them on Axis B.

## Deliberately excluded

- **Tourist visa-free access.** This is the thesis, not an oversight.
- **A comparison column against commercial rankings, for v1.** The contrast would be the
  strongest possible presentation of the argument, and the data cost is the objection:
  roughly 62,000 ordered country pairs, no official aggregate source, each state
  publishing only its own list, and the one comprehensive commercial matrix licensed.
  It also competes directly with the sourcing still open under #127. The absence of a
  visa column is the editorial position.
- **Any score for a person rather than a citizenship.** Combining two passports is a
  planner question and belongs in the planner, where the profile stays client-side for
  the Article 9 reasons recorded in `docs/operations.md`.

## Data status

`bun run index:audit` is the authority and the progress metric. It reports, per
dimension, one of:

- `READY` enough structured data to score today
- `THIN` populated below a level a score could rest on
- `PROSE` recorded, but as free text no scorer can read
- `EMPTY` schema exists and validates, zero rows
- `ABSENT` no schema; the field must be designed before sourcing

It then runs the composite model over dimension *availability* to answer whether either
axis could be published at all. That check is programme readiness, not a country score:
the input is whether a dimension is scoreable, not any country's value, and the weights
are equal because the real weights are deferred under rule 7. At 2026-08-09 it reports
Axis A 0 of 7 (0%, NOT RANKABLE) and Axis B 5 of 8 (63%, RANKABLE against the
`MIN_RANKABLE_COMPLETENESS = 0.5` floor in `scripts/lib/rights-score.ts`). Axis B
clearing the floor is an availability result only. It says the dimensions exist, not
that a per-country composite carries them.

### The A1 provenance problem

Dimension A1 is the centre of the index, and rule 6 is what it has to satisfy. The
migration is most of the way done and the sourcing is not: **34 of 46 arrangements are
canonical** (12 blocs, 22 lanes) and 12 remain legacy passthrough with no
`directionality`, no `destinations`/`beneficiaries` split and no evidence links. Of the
34 canonical, only **13 carry `source_refs`**. Migrating is not sourcing, and the audit
reports the two counts separately so they cannot be confused again.

Blocs are the sourced half: all **12 canonical blocs carry `source_refs`**, so the
settle-by-right peer counts that make the thesis work, Ireland at 35 peers and the
Nordic group at 33, now trace to instruments rather than to unsourced membership lists.
The 12 blocs still legacy are the `closed`, `one_way`, `hub_spoke` and `proto`
categories, which confer no settlement, so they are the cheap remainder rather than the
blocker. Lanes are the unsourced half: 15 of 22 carry a `sources` array and **not one
entry is a URL**, they are prose, so they cannot become source entities.

A1 is therefore no longer blocked on provenance for the settlement blocs. It is blocked
on `rights_by_status` still being free text: the audit reads A1 as `THIN` at 12 of 24
and A2 at 11 of 24 off the structured rights matrix, and only 8 of the 12 rows were read
against the instrument, the rest being prose-derived and marked `UNVERIFIED` in their
detail. A1 can be scored over the sourced subset, never over the full set.

The audit also reports three **structural blockers** that are code fixes rather than
sourcing, and which would silently corrupt the index if left in place:

1. **Directionality served.** `projectBloc` now carries `directionality` and the
   destinations/beneficiaries split (2026-08-08), so the pipe is correct. Still blocked
   because `public/blocs_data.json` is the legacy source the browser reads, not a
   projection output. It clears when the remaining arrangements reach canonical and the
   served file is generated from the projection.
2. **`eligibility[]` is dropped in projection**, taking descent degree with it.
3. ~~**`willing_child_abroad` is hard-coded unsatisfiable**~~ — CLEARED. The gate is now
   the typed predicate `{subject: self, attribute: intent, op: eq, value: child_abroad,
   provenance: self_attested}` read off `Profile.intents`, so the three child-birth
   accelerator edges fire once the intent is declared. The remaining half of those
   events — the `who: 'child'` grants, i.e. the child's own jus-soli citizenship — is
   still dropped by `build_edges.js`, because a `subject: 'child'` predicate is
   expressible but not yet evaluable. That waits on the household solver.

Do not hand-type coverage figures into issues or copy. Regenerate them:
`bun run index:audit -- --json`.

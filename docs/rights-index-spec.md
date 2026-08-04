# Rights Index — Locked Design Decisions

Status: **criteria locked, data programme open.** No index is computed or published
yet. Run `bun run index:audit` for live coverage; at the time of writing 3 of 13
dimensions carry enough structured data to score.

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
| B1 | Jus soli | unconditional / conditional / none, plus the severity of the condition (a parent's settled status is a higher bar than a parent's lawful presence). |
| B2 | Descent depth | the maximum qualifying ancestral degree, plus any cutoff, whether generational or a date. |
| B3 | Naturalisation period | the ordinary residence requirement in months. Ordinary track only, never the marriage or merit variant. |
| B4 | Investment | the lowest qualifying price. |
| B5 | Family | spouse and partner routes, and their duration requirement. |
| B6 | Discretion | whether the grant is as-of-right or discretionary. A discretionary route is not equivalent to an entitlement even at identical duration. |

## Scoring rules (locked)

These rules, not the dimension list, are what makes the index defensible.

1. **Unrecorded is never zero.** A `null` propagates as *not scored*. It never becomes a
   0, and it never becomes a favourable default. This is the most important rule in the
   file: four schemas in this repo are fully built and carry no rows, so a scorer that
   read absence as zero would rank every country identically low while looking precise.
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
   exist, because weights chosen now would be fitted to whichever three dimensions
   happen to be populated today.

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

It also reports three **structural blockers** that are code fixes rather than sourcing,
and which would silently corrupt the index if left in place: arrangement directionality
is dropped in projection, `eligibility[]` is dropped in projection (taking descent
degree with it), and `willing_child_abroad` is hard-coded unsatisfiable in
`src/lib/pathfinder.ts`, so three child-birth accelerator edges exist in the graph and
can never fire.

Do not hand-type coverage figures into issues or copy. Regenerate them:
`bun run index:audit -- --json`.

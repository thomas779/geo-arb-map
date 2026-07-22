# Data migration and review plan

Status: **D1 cutover in progress**

## Architecture

- `flag-paths-monitor` accepts untrusted discovery signals.
- `flag-paths-data` stores immutable canonical revisions, evidence links,
  relational projections, review state, and release membership.
- `bun run data:build` compiles one reviewed database snapshot into immutable
  static assets shipped with the Atlas.
- The browser does not query mutable D1 state during ordinary navigation.
- Monitoring and AI may create review leads; neither may approve a legal fact.

D1 becomes the only editable source after the first approved release. The
remaining `public/*.json` and legacy inputs are compatibility oracles until the
browser cutover passes. They are deleted once they no longer participate in a
test or production read.

## Invariants

- Every material fact has a stable ID, review state, confidence, review date,
  and field-level evidence.
- Each country has explicit ancestry, naturalization, birth, and investment
  coverage: `unknown`, `present`, or sourced `verified_none`.
- Empty routes never imply that no route exists.
- Eligibility time and processing time are separate.
- Arrangement prose never supplies computational timelines.
- Only approved revisions enter an immutable release.
- Corrections supersede history instead of overwriting it.
- A clean checkout plus a D1 export reproduces release bytes deterministically.

## Current state

Completed:

- versioned canonical schemas and D1 migrations;
- immutable revisions, evidence joins, approval gates, and release membership;
- France, Portugal, Spain, EU/EEA, Mercosur, and Spain's Ibero-American lane;
- four-mode SQL coverage projections;
- deterministic database import, review packet, release compiler, and parity
  gates;
- remote mode-coverage migration, immutable supersession import, and draft
  reproduction from a fresh D1 export;
- Atlas country-detail cutover for the France, Portugal, and Spain pilot; the
  planner graph is no longer shipped as a public artifact;
- real D1 export reproduction and private R2 backup/restore rehearsal; and
- automated D1 backup workflow.
- reviewed four-mode records for the United States, Canada, Australia, New
  Zealand, United Kingdom, Ireland, Germany, France, Portugal, Spain, Italy,
  Netherlands, Switzerland, Singapore, Malta, Cyprus, Türkiye, Uruguay,
  Bulgaria, Greece, Serbia, the United Arab Emirates, Egypt, Jordan, Nauru,
  and São Tomé and Príncipe; and
- active dedicated official-page monitoring for every reviewed jurisdiction.

Still required:

1. Continue the second reviewed country batch through the same evidence and
   release gates.
2. Approve reviewed revisions and create the first immutable release.
3. Switch the Atlas to content-addressed release assets and delete compatibility
   builders and inputs.
4. Exercise the monitor with real email/RSS signals through issue draft,
   evidence review, data change, release change, and Telegram preview.

## Country review order

Review order is a product queue, not a judgment about a country. Prioritize with
observable demand, route leverage, arrangement connectivity, primary-source
quality, monitoring feasibility, and review effort. Sanctions or access problems
may lower operational priority but never manufacture a legal conclusion.

Initial batches:

1. United States, Canada, United Kingdom, Ireland, Australia, New Zealand,
   Germany, France, Portugal, Spain, Italy, Netherlands, Switzerland, Singapore.
2. Argentina, Brazil, Mexico, Colombia, Uruguay, Paraguay, Chile, Malta, Greece,
   Cyprus, Türkiye, Israel, Poland, Hungary.
3. Subsequent batches selected from privacy-safe Atlas inspections, searches,
   source availability, and correction requests.

For each country, review all four acquisition modes. A `verified_none` result
requires official evidence just as a positive route does. Discovery begins with
government guidance and legislation; commercial publishers and social channels
only identify leads.

The birth review must not collapse distinct rules into a single “birthright”
label. Record separately: citizenship at birth by descent; territorial
citizenship at birth; foundling and otherwise-stateless safeguards; citizenship
available later because of birth in the country; and every parental status,
parental residence, child residence, age, declaration, or application condition.
Spain's one-year residence route and France's age-and-residence routes belong in
the last category, not in unconditional citizenship at birth.

## Batch acceptance gate

A country batch can enter a release only when:

- canonical payload and SQL projection counts agree;
- all source IDs and supported field paths resolve;
- every mode has an explicit review state;
- active routes have structured eligibility, outcome, allocation, and timeline;
- reviewed negatives have evidence;
- compatibility changes are fully attributed;
- the review packet is signed off by a human; and
- the full test and production build pass.

Do not combine a data cutover with a UI redesign. Do not publish the current
draft revisions merely to make the Atlas appear more complete.

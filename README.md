# Flag Paths — Global Mobility Pathfinder

**Find the citizenship and residence paths hidden in your profile.**

Some passports and residencies quietly unlock whole regions: Mercosur residency
opens most of South America; a child born in Mexico can one day work in the US
without a lottery; an Irish grandparent is a two-year paper trail away from the
entire EU. These windows exist today, and only a handful of people know how to
stack them. The window to arb them leads to generations of opportunity.

This project maps all of it on one interactive atlas — blocs, bilateral fast
lanes, ancestry routes, generational moves — and gives you a **planner**: plant
the statuses you hold (citizenship, PR, even an OCI), your birthplace, and where
your parents were born, and it computes what you've already unlocked and the
best next flag, as an actual multi-step plan ("Karta Polaka → EU free movement →
naturalize"). Maximize your footprint; set your kids up with a bigger one.

It's open data, open code, and built to be contributed to — corrections are
welcome, and the test suite makes it impossible to silently reintroduce a
mistake we've already fixed.

## What public v1 is

Flag Paths is a citizenship and immigration-residence pathfinder for
individuals and households. A user can:

- explore settlement blocs and mobility lanes without an account;
- create a private, local profile from held statuses, relevant family facts, a
  partner's citizenships, and a destination goal;
- see personalized deterministic and chance-based routes kept clearly separate; and
- watch a route locally as the foundation for reviewed change alerts.

The product uses Flag Theory as a long-term worldview, but v1 does **not** model tax
residence, company structures, banking, assets, or investments. The focused public
launch plan is in [`docs/gtm-v1.md`](docs/gtm-v1.md); the staged Flag Theory direction
and identity architecture are in
[`docs/strategic-map.md`](docs/strategic-map.md).

> ## ⚠️ Not legal advice
>
> **Everything here is informational only.** Immigration and nationality rules
> change constantly — several entries changed within the last twelve months —
> and much of this dataset was researched with AI assistance at varying,
> clearly-labeled confidence levels. Verify with an immigration lawyer in the
> specific country before acting on anything shown here.

## Stack

React 19 + TypeScript + Vite 8, shadcn/ui + Tailwind v4 for the shell, D3 +
world-atlas TopoJSON for the map (imperative layer wrapped in a thin React
component). Bun for package management, tests, and scripts. There is currently no
backend: the dataset ships as static JSON and the profile stays in the user's browser.

## Where the data comes from

The dataset is **LLM-researched and human-curated**, not authoritative:

1. External research arrives as batches in `data/research_batches/` (a foreign
   schema: category codes A–E, TR/PR/CIT booleans, iso_numeric).
2. `scripts/normalize_research.js` classifies each record: settlement-leading +
   high confidence → candidate for the live dataset; medium/low confidence →
   `pending_verification` (stored, never rendered); temporary-only → out of scope;
   citizenship-compatibility treaties → `dual_citizenship`.
3. Live records are merged **manually** into `public/blocs_data.json` with
   editorial text; hand-audited exceptions live in `data/manual_edges.json`
   (every entry carries a `reason_code`, sources, and date).
4. `scripts/build_registry.js` + `scripts/build_coverage.js` generate
   `public/coverage.json` — an all-jurisdiction matrix of research coverage
   (`verified / verified_none / partial / unchecked`) so absence of evidence is
   never displayed as evidence of absence.
5. `data/citizenship_routes.json` stores reviewed country-level rules across four
   acquisition modes: ancestry, naturalization, birth, and investment.
   `scripts/build_citizenship_routes.js` expands those records over all 239 registry
   jurisdictions in `public/citizenship_routes.json`. Every mode is explicit:
   `reviewed / partial / pending / unchecked`; “unchecked” never means no route exists.
6. `data/timeline_rules.json` is the single computational source for planner and
   graph durations. Values are stored in months and may reference a reviewed
   citizenship route or mapped arrangement. UI prose is never parsed for years.

Known single-source items (several naturalization timelines) are flagged in the
research docs and should be re-verified against primary law before being treated
as authoritative.

## Fixing mistakes (and keeping them fixed)

Hard-won corrections are **locked in by tests**: `tests/data_invariants.test.ts`
pins regression facts (e.g. Russia's dual-citizenship status, which took three
attempts to land correctly) plus schema, ISO, and referential invariants.
`bun run build` runs the suite, and the Pages deploy is gated on it — a data
edit that reintroduces a corrected error fails CI. When you fix a dataset
mistake, add an invariant for it.

## Development

```sh
bun install        # dependencies
bun run dev        # dev server → http://localhost:5173/
bun test           # dataset invariant + regression suite
bun run build      # tsc → bun test → vite build (what CI runs)

# data tooling
bun scripts/normalize_research.js data/research_batches/<batch>.json
bun scripts/build_registry.js     # regenerate data/registry.json
bun scripts/build_coverage.js     # regenerate public/coverage.json
bun run data:citizenship          # regenerate public/citizenship_routes.json
bun run data:migrate:shadow       # split the pilot and prove legacy-shape parity
bun run data:schemas              # regenerate canonical v1 JSON Schemas
bun run data:migrate:canonical    # build validated canonical pilot candidates
bun run data:db                   # import candidates and build SQL projections locally
bun run data:timelines            # compile reviewed fact references for browser/graph use
bun run data:edges                # compile timelines, then regenerate public/edges.json

# reviewed source monitoring (writes only to monitor/.out/)
bun run monitor:collect
bun run monitor:triage
bun run monitor:draft
```

## Deployment

The public site is deployed to [atlas.thomphreys.com](https://atlas.thomphreys.com/)
as a Cloudflare Worker with static assets. Cloudflare is the sole production
host:

```sh
bun run deploy:web
```

The website Worker is separate from the newsletter-intake Worker and does not
handle email.

## Repository layout

```
public/           blocs_data.json, coverage.json, citizenship_routes.json
src/              React shell (App, components/) + imperative D3 map layer (map.ts)
src/components/ui shadcn/ui primitives (generated)
data/             registry, citizenship routes, canonical timelines, manual overrides, research batches
scripts/          normalizer + registry/coverage/route generators (bun)
monitor/          source collectors, bounded triage, and review-lead drafts
tests/            dataset invariant + regression suite
docs/             explorer-spec.md — locked design for the strategy explorer
```

Product and launch documents:

- [`docs/strategic-map.md`](docs/strategic-map.md) — long-term Flag Theory map,
  expansion gates, and progressive identity decision.
- [`docs/gtm-v1.md`](docs/gtm-v1.md) — v1 positioning, launch phases, metrics, and
  release checklist.
- [`docs/community-strategy.md`](docs/community-strategy.md) — small founding-community
  pilot around real routes and reviewed knowledge.
- [`docs/monitoring-architecture.md`](docs/monitoring-architecture.md) — source
  monitoring, reviewed changes, account-backed watches, and alert delivery.
- [`docs/monitoring-pipeline-v0.md`](docs/monitoring-pipeline-v0.md) — the
  implemented, review-first source monitor and its activation gate.
- [`docs/data-architecture.md`](docs/data-architecture.md) — country nationality-law
  files, cross-border arrangements, generated indexes, and source policy.
- [`docs/explorer-spec.md`](docs/explorer-spec.md) — engine and explorer design
  decisions.

## License

Code is licensed under [MIT](LICENSE). The dataset
(`public/blocs_data.json`, `public/coverage.json`, `data/`) is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — attribute
"geo-arb-map contributors".

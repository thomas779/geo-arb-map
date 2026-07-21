# Flag Paths — Global Mobility Pathfinder

**Explore citizenship, residence, and mobility rules across countries.**

Some passports and residencies quietly unlock whole regions: Mercosur residency
opens most of South America; a child born in Mexico can one day work in the US
without a lottery; an Irish grandparent is a two-year paper trail away from the
entire EU. These windows exist today, and only a handful of people know how to
stack them. The window to arb them leads to generations of opportunity.

The public product is an interactive Atlas of regional rights, bilateral lanes,
heritage routes, and country nationality laws. The personalized planner is a
later release; it stays behind a clear preview until the underlying country data
is sufficiently reviewed.

It's open data, open code, and built to be contributed to — corrections are
welcome, and the test suite makes it impossible to silently reintroduce a
mistake we've already fixed.

## What public v1 is

Flag Paths v1 is a public citizenship and immigration-residence Atlas. A user can:

- explore settlement blocs and mobility lanes without an account;
- inspect country and route details with visible source and review state; and
- join the public Telegram channel for reviewed updates.

V1 does **not** collect profiles or model tax residence, company structures,
banking, or assets. Current priorities are reviewed country coverage, testing the
monitoring pipeline, and publishing useful Atlas updates.

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
component). Bun handles package management, tests, and scripts. Reviewed
authoring data lives in D1; the public site receives immutable, cacheable JSON
compiled with the application.

## Data pipeline

Discovery signals enter through the monitor and can only create review leads;
they never edit legal facts. Human-reviewed canonical revisions are stored in
`flag-paths-data` D1 and compiled by `bun run data:build` into an immutable
release. During the remaining cutover, the live compatibility files under
`public/` are retained as tested inputs and outputs.

Country coverage is explicit for ancestry, naturalization, birth, and
investment. `unknown` never means that no route exists; a negative conclusion
must be reviewed and sourced.

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
bun run data:citizenship          # regenerate public/citizenship_routes.json
bun run data:db                   # import candidates and build SQL projections locally
bun run data:build                # compile a deterministic draft release from SQLite/D1
bun run data:review               # render the human review packet
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

For current implementation authority and document status, start with
[`docs/README.md`](docs/README.md). The active data roadmap is
[`docs/data-migration-plan.md`](docs/data-migration-plan.md).

```sh
bun run deploy:web
```

The website Worker is separate from the newsletter-intake Worker and does not
handle email.

## Repository layout

```
public/           current compatibility artifacts; generated after D1 cutover
src/              React shell (App, components/) + imperative D3 map layer (map.ts)
src/components/ui shadcn/ui primitives (generated)
data/             D1 migrations and compatibility inputs still used by the build
scripts/          deterministic data compiler, migration, parity, and deployment tools
monitor/          source collectors, bounded triage, and review-lead drafts
tests/            dataset invariant + regression suite
docs/             indexed product, data, and operational documentation
```

The concise documentation index is [`docs/README.md`](docs/README.md).

## License

Code is licensed under [MIT](LICENSE). The dataset
(`public/*.json`, `data/`) is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — attribute
"geo-arb-map contributors".

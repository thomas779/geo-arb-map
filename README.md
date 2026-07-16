# Settlement Blocs — Global Mobility Atlas

An interactive world map of **settlement blocs and bilateral fast lanes**: groups of
countries where holding citizenship (or sometimes residency) in one member unlocks
legal rights to live, work, or settle in the others — the EU/EEA, Mercosur, ECOWAS,
GCC, CARICOM, plus one-way arrangements (BN(O), UK–Overseas Territories), bilateral
fast lanes (Spain's 2-year Ibero-American naturalization, France–Maghreb accords),
and ancestry/diaspora routes (Law of Return, OCI, Karta Polaka, descent citizenship).

> ## ⚠️ Not legal advice
>
> **Everything in this project is informational only.** Immigration and nationality
> rules change constantly — several entries changed within the last twelve months —
> and much of this dataset was researched with LLM assistance at varying confidence
> levels. Verify with an immigration lawyer in the specific country before acting
> on anything shown here.

Live site: deployed to GitHub Pages on every push to `main` (Vite `base` is now `/` — requires a user site or custom domain to serve from the root).

## Stack

React 19 + TypeScript + Vite 8, shadcn/ui + Tailwind v4 for the shell, D3 +
world-atlas TopoJSON for the map (imperative layer wrapped in a thin React
component). Bun for package management, tests, and scripts. No backend — the
dataset ships as static JSON.

## Data provenance & confidence tiers

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

Known single-source items (several naturalization timelines) are flagged in the
research docs and should be re-verified against primary law before being treated
as authoritative.

## Data corrections

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
```

## Repository layout

```
public/           blocs_data.json (the dataset), coverage.json
src/              React shell (App, components/) + imperative D3 map layer (map.ts)
src/components/ui shadcn/ui primitives (generated)
data/             registry, manual edge overrides, raw research batches
scripts/          normalizer + registry/coverage generators (bun)
tests/            dataset invariant + regression suite
docs/             explorer-spec.md — locked design for the strategy explorer
```

## License

Code is licensed under [MIT](LICENSE). The dataset
(`public/blocs_data.json`, `public/coverage.json`, `data/`) is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — attribute
"geo-arb-map contributors".

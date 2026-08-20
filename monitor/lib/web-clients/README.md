# Reusable web clients (Exa / Tavily / Firecrawl)

Thin, credit-aware HTTP wrappers for use **anywhere** in the monitor (or
scripts) — not only the weekly discovery job.

| Module | Endpoint | Default cost posture |
| --- | --- | --- |
| `exa.ts` | `POST https://api.exa.ai/search` | Prefer `deep-lite` + compact `outputSchema` (≤10 props/object) |
| `tavily.ts` | `POST https://api.tavily.com/search` | Always `search_depth: basic` (1 credit); no `raw_content` |
| `firecrawl.ts` | `/v2/search`, `/v2/scrape` | Search without scrape; scrape only when you already filtered URLs |

Env keys: `EXA_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`.

Discovery-specific mapping (leads, region packs) lives in
`monitor/collectors/web_providers/`. Import clients from here when you need
search/scrape in another path (quote-gate enrichment, one-off research scripts,
Telegram evidence fetch, etc.).

See also: `monitor/prompts/web-discover-efficiency.md`.

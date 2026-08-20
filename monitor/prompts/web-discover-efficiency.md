# Free-tier efficiency notes (Exa / Tavily / Firecrawl)

Practical rules baked into `monitor:web-discover`. Credits reset monthly and do
**not** roll over on self-serve plans — spend deliberately.

## Budget sketch (7 regions / week ≈ 4 weeks / month)

| Provider | Default call | Est. credits / week | Monthly headroom (1k free) |
| --- | --- | --- | --- |
| Exa | `deep-lite` × 7 | $ (Exa meter) | Prefer lite; use `deep` only for hard regions |
| Tavily | `basic` search × 7 | ~7 | Plenty (1k/mo) |
| Tavily (official-publisher pass) | `basic` search × 7, allowlisted | ~7 | Plenty (1k/mo) |
| Firecrawl | web search, limit 3, **no scrape** × 7 | ~14 | Plenty if scrape stays off |

## Exa

- Use **`deep-lite`** as the weekly default for structured `outputSchema` synthesis.
- Escalate to **`deep` / `deep-reasoning`** only for a single sticky region via
  `workflow_dispatch` / `--exa-type`.
- Keep `numResults` modest; synthesis cost dominates, not result count.
- Long instructions belong in `systemPrompt` (we load `exa-weekly-discovery.md`),
  not in the short region query.
- **`excludeDomains`** defaults to the social/promo list, same as the other two.
  Exa had no domain filter at all before the official-publisher pass landed, so
  "social domains excluded" used to be true of two providers in three.
- **`includeDomains`** and `userLocation` are plumbed and currently unused: the
  constrained pass is Tavily-only on purpose, so its yield can be measured
  before Exa credits are spent on the same idea.

## Tavily ([credits](https://docs.tavily.com/documentation/api-credits), [search best practices](https://docs.tavily.com/documentation/best-practices/best-practices-search))

- **`search_depth: basic` = 1 credit**; `advanced` = 2. Always set depth explicitly.
- Never enable `auto_parameters` without forcing `search_depth: basic` — auto can
  bump you to advanced.
- Leave **`include_raw_content` off**. Search first; extract only shortlisted URLs
  (Extract: 1 credit / 5 successful URLs on basic).
- Cap **`max_results`** (we default to 3). High limits return lower-quality tails.
- Use **`topic: news`** + `time_range` for dated mobility stories.
- **`exclude_domains`** social/promo hosts (facebook, x, tiktok, …).
- Post-filter on **`score`** (we drop &lt; 0.45) before turning hits into leads.
- Keep queries short (&lt; 1500 chars). Break multi-topic asks into separate calls.
- **`include_domains` RESTRICTS** — it is an allowlist, not a preference. The
  weekly run therefore makes **two** Tavily calls per region: the open query, and
  a second one allowlisted to that region's manifest hosts (`--gazette-pass`,
  default on; `--no-gazette-pass` / `WEB_DISCOVER_GAZETTE_PASS=0` to skip). Never
  put the allowlist on the open query: it could then only ever re-find hosts we
  already watch, which is the opposite of discovery.
- A region with no manifest hosts is **skipped**, not sent an empty allowlist —
  Tavily reads `[]` as no filter, i.e. an open search billed as a constrained one.
- **`country`** is plumbed but unset: Tavily honours it only under
  `topic: 'general'` and we run `topic: 'news'`.

## Firecrawl ([search](https://docs.firecrawl.dev/features/search), pricing)

- Search is **2 credits / 10 results** (rounded up). `limit` is **per source type**.
- Prefer a **single** `sources: [{ type: "web" }]` with `tbs: qdr:w`. Requesting
  `web` + `news` doubles result volume for little gain on free tier.
- **`tbs` only filters `web`**, not `news`.
- **Do not** set `scrapeOptions` on the weekly path. Scrape = +1 credit / page
  (+ PDF pages, + JSON mode). Use search → filter → selective scrape later.
- If scraping PDFs, set `parsers: []` unless you truly need page-by-page parse
  (PDF parsing bills per page).
- Use **`excludeDomains`** the same way as Tavily.
- Two-step pattern (search, then scrape chosen URLs) is the documented way to
  avoid paying for junk pages.

## Operational checklist

1. Weekly cron: all three providers, 7 regions, defaults above, plus the
   official-publisher pass.
2. Mid-month pinch: `--providers tavily,firecrawl`, fewer `--regions`, or
   `--no-gazette-pass` (saves ~7 credits and loses the gazette recall).
3. Hard fact-check: Exa `deep` on one region, or Firecrawl scrape of 1–3 primaries.
4. Issues: umbrella table for everything; **separate `monitor-lead` issues only** for
   Exa medium/high `verify_and_author` / `pending_enactment` rows (`--open-leads`).
5. Telegram for pending enactment: allowed **only** with a primary cite and a brief
   that says the change is not yet in force; keep `pending-enactment` label.

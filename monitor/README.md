# Source monitor

The review-first monitoring loop for Flag Paths. It discovers possible mobility-rule
changes, **verifies them against current primary sources with a grounded LLM**, publishes
verified news to the public Telegram channel, and opens human-review issues for anything
that would change the dataset.

It never edits the public datasets directly. **AI ranks and challenges evidence; it never
approves or publishes a legal fact into the canonical data.** A finding only becomes a data
change through the normal primary-source review, test, and pull-request process.

**Operator guide:** see [`PUBLISHING_RUNBOOK.md`](PUBLISHING_RUNBOOK.md).

```text
discovery feeds (RSS + aggregators + country locals + curated Telegram)
    │  cheap keyword pre-filter (no AI)
    ▼
AI per-jurisdiction sweep  (Gemini + Google Search grounding, delta-aware)
    ▼
findings.json ──► confirmed news ──► Telegram @flagpaths   (LLM evidence-audit + dedup)
              └─► affects_dataset ─► GitHub issue (ChangeProposal) ─► human review ─► dataset
```

## Commands

```sh
# Collect discovery signals (RSS + curated Telegram + X/Bluesky; official-page crawl retired).
# x_search (xAI, once/day, watchlist-scoped) runs only on the 06:00 UTC cycle or a dispatch.
bun run monitor:collect -- --adapters rss,telegram_html,x_search,bluesky,bluesky_search --lookback-days 1

# Grounded per-jurisdiction sweep. Reads .out/signals.json for hybrid RSS hints.
#   --mode discovery : verify only jurisdictions with fresh, relevant signals (default cadence)
#   --mode rotation  : rotate through all registry jurisdictions (backstop)
#   --only 470,124   : force specific iso_n3
bun run monitor:sweep -- --mode discovery --concurrency 5 --max-calls 12

# Preview / publish the confirmed findings to Telegram (audit-gated, deduped).
bun run monitor:news -- --dry-run
bun run monitor:news -- --apply --state-db <d1-export.sql> --state-sql .out/monitor-posts.sql

# Render / open reviewed-lead issues for dataset-affecting findings.
bun run monitor:draft            # dry run → .out/issue-drafts.json
GH_TOKEN=... bun run monitor:open  # --apply, creates issues

# Verify the Telegram bot/channel without posting.
bun run monitor:telegram -- --check

# Newsletter push path (Cloudflare email Worker → repository_dispatch).
bun run monitor:email:dispatch --event tests/fixtures/monitor/newsletter-dispatch.json

# Discovery-layer growth (self-improving; see monitor/discovery/).
bun run monitor:sources:record                                    # log the sweep's cited outlets to the D1 citation ledger
bun run monitor:sources:candidates -- --state-db <d1-export.sql>  # rank cited outlets worth subscribing to (+ probe feeds)
bun run monitor:sources:x-seed -- --mode directory                # propose X watchlist accounts (evidence-required, review-first)
```

Offline: `monitor:sweep --fixture-response <array.json>` and `monitor:collect --fixture-dir …`
run the full path with zero API calls.

## LLM configuration

Provider-neutral; do not commit keys.

| Variable | Purpose |
| --- | --- |
| `MONITOR_LLM_PROVIDER` | `anthropic` or `openai-compatible` (Gemini via its OpenAI-compatible base) |
| `MONITOR_LLM_BASE_URL` / `MONITOR_GEMINI_BASE_URL` | OpenAI-compatible base / native Gemini base for grounding |
| `MONITOR_LLM_MODEL` | Cheap model for the non-grounded audit + triage (e.g. `gemini-3.5-flash-lite`) |
| `MONITOR_SWEEP_MODEL` | Model for the grounded sweep (e.g. `gemini-3.5-flash-lite`; `gemini-3.5-flash` for fuller coverage) |
| `MONITOR_LLM_API_KEY` | Credential (secret) |
| `MONITOR_XAI_API_KEY` | xAI key for X (Twitter) discovery via the Agent Tools `x_search` (secret; optional — X skips cleanly without it) |
| `MONITOR_XAI_MODEL` / `_LOOKBACK_HOURS` / `_TIMEOUT_MS` | X search model (default `grok-4.3`), lookback window (24h), request timeout |

Grounding uses the **native Gemini Interactions API** (`/v1beta/interactions`, `tools:[{type:google_search}]`);
the OpenAI-compatible endpoint cannot ground. The sweep asks for a few targeted searches to keep cost low.

## Cadence & cost

`.github/workflows/monitor.yml` runs **daily** in `discovery` mode: the RSS scan is free, a
keyword pre-filter drops off-topic items before any AI call, and the grounded sweep fires
**only for jurisdictions with fresh relevant news** (zero calls on a quiet day). Knobs:
`MONITOR_SWEEP_MODE`, `MONITOR_SWEEP_MAX_CALLS` (hard cap), `MONITOR_SWEEP_CONCURRENCY`.
`rotation` mode (via `workflow_dispatch`) sweeps the full registry as a backstop.

**X (Twitter) discovery** runs **once/day** (the 06:00 UTC cycle) via xAI's `x_search`, scoped to a
curated watchlist (`monitor/sources/x-watchlist.json`) via `from:` operators with a broad, multilingual
fallback — ≈ **$0.02/run** (grok-4.3). It flags jurisdictions like any other signal; it never verifies.
Bluesky (keyless AppView) and the citation ledger add no API cost. The manual **`x-watchlist-seed`**
workflow grows the watchlist from real data (Grok, evidence-required) — agentic, so ≈ **$0.50–1/run**;
run it sparingly.

## How a verified change reaches the dataset

The sweep **compares** each jurisdiction against what we already record (delta-aware prompt) and
flags `affects_dataset` findings. Those open a `ChangeProposal`-shaped GitHub issue (see
`scripts/lib/canonical-schema.ts`). A reviewer confirms the primary source, then the change enters
the canonical store as a **draft revision → approved** (`data:db` / `data:stage`), is compiled by
`data:build`, promoted by `data:promote`, and shipped by `data:publish` (the compiled dataset is
gitignored here and lives in the private `flag-paths-data` repo, so a commit alone ships nothing).
The dataset is never hand-edited or auto-written from a
finding — that gate + the regression invariants are the integrity guarantee.

## Telegram publication

Public channel `@flagpaths`. Confirmed news auto-publishes when `MONITOR_AUTO_PUBLISH=true`, through
`publish/telegram.ts`'s LLM evidence-audit (every claim must be backed by cited evidence) and the
`monitor_posts` D1 dedup ledger. Set `MONITOR_AUTO_PUBLISH=false` to pause instantly. GitHub environment
`telegram-publication` holds `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHANNEL_ID`.

## Operating boundaries

- Discovery (RSS, aggregators, country locals, curated Telegram, email) can only propose leads.
- A `confirmed` finding requires the model to have actually searched (proof-of-search gate) and to
  carry a primary/official-source URL; auto-publish is `confirmed`-only.
- A dataset change additionally requires human review against a current primary legal, government,
  court, or tax-authority source plus an effective date (or explicit unknown).
- Tax claims must distinguish residence, source, filing, treaty, and incentive rules.

## Layout

```text
sources/manifest.json    watched discovery + reference (official-source lookup) sources
schema/signal.ts         shared Signal contract
collectors/              rss, curated Telegram, typed email boundary (+ run.ts orchestrator)
llm/client.ts            Anthropic / OpenAI-compatible + native Gemini grounded generation
sweep/run.ts             registry-driven grounded per-jurisdiction sweep → findings + leads
triage/                  dataset context, bounded email-signal triage, issue renderer/opener
publish/telegram.ts      reviewed-issue Telegram gate + evidence audit
publish/news.ts          auto-publish confirmed findings + monitor_posts dedup
cloudflare/              email intake Worker, D1 migrations, deploy guide
.out/                    generated run artifacts (gitignored)
```

Email intake deployment: [`cloudflare/README.md`](cloudflare/README.md). Source watchlist:
[`sources/README.md`](sources/README.md). Community growth: [`../docs/community-distribution.md`](../docs/community-distribution.md).

# Source monitor

This directory contains the review-first monitoring loop for Flag Paths:

```text
source manifest → collectors → signals → LLM triage → issue drafts → human review
```

It never edits the public datasets. A lead only becomes a data change through the
normal primary-source review, test, and pull-request process.

## Commands

```sh
# Fetch active sources from the last 14 days.
bun run monitor:collect

# Triage unseen signals. With no LLM config this safely writes an empty lead file
# and a report explaining that triage was skipped.
MONITOR_LLM_PROVIDER=openai-compatible \
MONITOR_LLM_BASE_URL=https://gateway.example/v1 \
MONITOR_LLM_API_KEY=... \
MONITOR_LLM_MODEL=creator/model \
bun run monitor:triage

# Render monitor/.out/issue-drafts.json. This is always a dry run.
bun run monitor:draft

# Explicitly publish drafts with the GitHub CLI.
GH_TOKEN=... bun run monitor:open

# Preview a fully reviewed GitHub issue as a Telegram brief.
bun run monitor:telegram -- --issue 123 --dry-run

# Normalize a local repository-dispatch fixture.
bun run monitor:email:dispatch \
  --event tests/fixtures/monitor/newsletter-dispatch.json
```

Do not paste API keys into chat or commit them. The provider-neutral configuration is:

| Name | Kind | Purpose |
| --- | --- | --- |
| `MONITOR_LLM_PROVIDER` | variable | `anthropic` or `openai-compatible` |
| `MONITOR_LLM_BASE_URL` | variable | Required for an OpenAI-compatible endpoint |
| `MONITOR_LLM_MODEL` | variable | Provider model ID |
| `MONITOR_LLM_API_KEY` | secret | Credential for that provider or endpoint |
| `MONITOR_LLM_TIMEOUT_MS` | variable | Optional; defaults to 10 minutes for cold starts |

Runpod Serverless vLLM and Vercel AI Gateway both use
`MONITOR_LLM_PROVIDER=openai-compatible`. Existing `ANTHROPIC_API_KEY` and
`MONITOR_TRIAGE_MODEL` settings remain supported for backwards compatibility.

For an entirely offline smoke test:

```sh
bun run monitor:collect --source globalcit-rss \
  --fixture-dir tests/fixtures/monitor --lookback-days 0
bun run monitor:triage \
  --fixture-response tests/fixtures/monitor/triage-response.json
bun run monitor:draft
```

The `.github/workflows/monitor.yml` workflow runs weekly and uploads every
collection report, triage report, signal file, lead file, and issue draft as a
30-day artifact. It creates issues only when:

- a manual run checks `open_issues`; or
- the repository variable `MONITOR_OPEN_ISSUES` is exactly `true`.

## Operating boundaries

- RSS, newsletters, specialist publishers, and Telegram are discovery only.
- A verified change requires a current primary legal, government, court, or
  tax-authority source plus an effective date or an explicit unknown date.
- AI ranks and challenges evidence; it never approves or publishes a fact.
- The first real runs stay draft-only. Inspect `issue-drafts.json` before
  enabling issue creation.
- Tax claims must distinguish residence, source, filing, treaty, and incentive
  rules rather than collapsing them into a country label.

## Telegram publication

The public destination is `@flagpaths`. GitHub environment
`telegram-publication` holds `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID`.
The bot needs only permission to post.

To publish, a monitoring issue must contain primary evidence, a completed
reviewer checklist, and exact copy under `## Public brief`. Then run the
`publish-telegram.yml` workflow with the issue number. The workflow previews the
post, performs a claim-versus-evidence audit, refuses duplicate publication, and
posts only after every gate passes.

## Layout

```text
sources/manifest.json       watched and planned sources
sources/CONTRIBUTING.md     source quality and contribution rules
schema/signal.ts            shared, validated Signal contract
collectors/                 feeds, curated Telegram, typed email boundary
cloudflare/                  Email Worker, D1 migration, and deployment guide
llm/client.ts               Anthropic and OpenAI-compatible model boundary
triage/context.ts           dataset context and country inference
triage/triage.ts            bounded LLM triage and output validation
triage/issues.ts            pure issue-draft renderer
triage/open-issues.ts       dry-run by default; --apply publishes
publish/telegram.ts         reviewed-issue gate and Telegram Bot API publisher
.out/                       generated local/CI run artifacts (gitignored)
```

The source watchlist and onboarding state live in
[`sources/README.md`](sources/README.md). Email intake deployment is documented
in [`cloudflare/README.md`](cloudflare/README.md).

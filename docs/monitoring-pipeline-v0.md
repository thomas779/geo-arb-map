# Source monitoring — v0

Status: implemented, safe by default (discovery lane) · Date: 2026-07-17

`docs/monitoring-architecture.md` retains a deferred account-backed v2 proposal.
This document is the v0 that ships first,
inside this repo, reusing what already exists: GitHub issues as lead intake,
PRs as review, the invariant suite as QA.

## Two lanes, one contract

A law change is usually reported by a community or trade press days before it
reaches an official gazette. Polling only official APIs makes this pipeline
structurally last to know. So sourcing splits into two lanes that both
produce the same shape:

- **Discovery** (fast, noisy) — publisher RSS/Atom, agency and law-firm client
  alerts, specialist newsletters, and curated YouTube publisher feeds. Can
  open a lead. Cannot verify one.
- **Verification** (slow, authoritative) — government gazettes and
  legislation databases with open APIs (Spain's BOE, Portugal's DRE,
  Argentina's Boletín Oficial, UK legislation.gov.uk, France via the
  PISTE gateway). Confirms or kills a lead.

**No lead merges into `public/blocs_data.json` without a primary-source
citation** — the same confidence gate the dataset already runs
(`pending_verification`, `meta.excluded`, the invariant suite).

Every collector, regardless of lane or transport, emits the same
`Signal` shape (`monitor/schema/signal.ts`). That's the actual interface.
Any collector is disposable — swap RSS for changedetection.io later, add a
provider-specific email adapter — nothing downstream notices, because triage and
issue-creation only ever read Signals.

## Source priority

The registry should grow in this order:

1. official gazettes, legislation databases, and government programme pages;
2. immigration law-firm client alerts and specialist agency newsletters that
   link to a public canonical article;
3. established academic or trade publishers with RSS/Atom;
4. curated agency or specialist YouTube channels, only when a transcript is
   available.

Broad social listening is intentionally excluded. It adds access fragility and
large amounts of anecdotal noise without improving verification. A narrow
allowlist can make an exception for a source with demonstrated original
reporting; `@thewanderinginvestor` is the first such exception and is collected
from its public Telegram preview. Newsletter
messages are reduced to source metadata and a 500-character excerpt in the
pipeline; full private messages must not be published in GitHub artifacts or
issues.

## Pipeline

```
sources/manifest.json
        ↓
collectors (RSS/Atom, email later) ──▶ Signal[]
        ↓
triage (LLM, reads dataset context) ──▶ Lead[]
        ↓
GitHub issue (label: monitor-lead, tagged <!-- signal:ID --> for dedup)
        ↓
human review + PR ──▶ invariant suite ──▶ merge ──▶ release
```

Triage is the step a "just poll official APIs" design skips. Detecting that
bytes changed is cheap; deciding whether an agency alert or trade-press
headline plausibly changes a field this dataset publishes is the actual
work, and it's LLM work — `monitor/triage/triage.ts` gives the model each new
signal plus relevant citizenship routes, coverage records, blocs, and lanes.
For cross-jurisdiction sources, a deterministic name pass first infers the
countries in play. Model output is then allow-listed and capped before it can
become an issue draft.

## What's built (v0.1 — discovery lane only)

- `monitor/schema/signal.ts` — the typed Signal contract
- `monitor/sources/manifest.json` — source registry; `status: "active"`
  sources run, `status: "planned"` sources are documented but not yet wired
  (they need auth, like PISTE registration, or an unbuilt fetch strategy)
- `monitor/collectors/rss.ts` — zero-auth, zero-dependency RSS 2.0/Atom
  collector used by the active sources
- `monitor/collectors/email.ts` — provider-neutral normalization for agency
  client alerts; requires a public canonical article URL so issues stay
  auditable and do not expose private mailbox links
- `monitor/collectors/telegram.ts` — narrow parser for allow-listed public
  Telegram previews; currently used only for `@thewanderinginvestor`
- `monitor/collectors/run.ts` — orchestrator → `monitor/.out/signals.json`
- `monitor/.out/collection-report.json` — per-source health, counts, failures,
  lookback, and duplicate totals
- `monitor/llm/client.ts` — provider-neutral boundary supporting native Anthropic
  and any OpenAI-compatible endpoint, including Runpod Serverless vLLM and Vercel
  AI Gateway
- `monitor/triage/triage.ts` — bounded batches through the configured model;
  without a complete LLM configuration it writes an explicit skipped report and
  no leads
- `monitor/triage/open-issues.ts` — renders drafts by default; publishing
  requires the explicit `--apply` flag
- `.github/workflows/monitor.yml` — weekly cron, dedups against previously
  opened lead issues by the `<!-- signal:ID -->` marker, uploads run artifacts,
  and opens issues only behind a manual input or repository variable
- `tests/monitor.test.ts` plus fixtures — offline contract, parser, inference,
  triage, deduplication, and issue-rendering coverage

Infrastructure is GitHub Actions on the public repository. The only variable
spend is LLM triage. The workflow caps each run at 100 signals and 10 leads by
default (`MONITOR_MAX_SIGNALS`, `MONITOR_MAX_LEADS`) to bound cost and noise.

## Operating gate

The first few runs should remain draft-only. Inspect the uploaded
`issue-drafts.json`, tune the source manifest and prompt, then enable issue
creation with either the manual `open_issues` input or a repository variable:
`MONITOR_OPEN_ISSUES=true`. Discovery leads always carry
`needs_primary_source: true`, regardless of model output.

## Not built yet

- **Verification-lane adapters** (BOE, DRE, legislation.gov.uk, PISTE) —
  listed in the manifest as `planned`. These are the pieces that let a lead
  actually get confirmed automatically instead of by a human reading the
  cited law by hand. Spain is the natural first pick: the Ibero-American
  naturalization track is the single most load-bearing edge in the
  pathfinder graph, and BOE has a genuinely open API.
- **Email source operation** — the Cloudflare Worker, private archive, D1
  idempotency, sanitized repository dispatch, GitHub event adapter, domain, and
  production deployment are configured. Publisher subscriptions and routine
  end-to-end review of real messages remain operational work.
- **Curated YouTube feeds** — use the official per-channel RSS feed only for
  an allowlist of agencies and country specialists. A transcript/caption step
  is required because titles alone are too weak for legal-change triage.
- **Client-side watch alerts** — each dataset release should carry a
  changelog of changed entity IDs; the client diffs a user's
  `watchedRoutes` against it on load. Doesn't depend on any of the above —
  can be built independently once a release actually changes something the
  monitor caught.

## Sequence

- **v0** (this doc): publisher RSS/Atom + LLM triage → lead issue drafts.
  Prove the loop produces real, useful leads before adding sources.
- **v1**: verification-lane official APIs (Spain first), agency/newsletter
  email intake, curated YouTube transcripts, and client-side watch-diff alerts.
- **v2**: revisit the deferred account-backed proposal only once alert
  subscribers exist to justify accounts, row-level policies, and delivery.

## Cloudflare newsletter intake

Cloudflare is the email transport. The production Worker is deployed; the
remaining activation work is subscribing publishers and exercising the boundary
with real messages:

```text
newsletter subscriptions
        ↓
shared address on Cloudflare Email Routing
        ↓
TypeScript Email Worker (sender attribution + MIME parsing)
        ↓
private raw-message archive + NormalizedNewsletterMessage
        ↓
Signal → bounded triage → issue draft → primary-source review → data PR
```

The Worker must never update `public/*.json`. It should:

- attribute each shared-address message to one source ID using a non-overlapping
  envelope-sender allowlist;
- reject unexpected senders and oversized messages;
- parse MIME using a maintained parser rather than regular expressions;
- retain raw email only in private storage with a short retention period;
- extract a public canonical publisher URL and emit only a short excerpt;
- deduplicate on `Message-ID`; and
- dispatch the normalized message into this pipeline.

`monitor/cloudflare/` now contains the TypeScript Worker, R2/D1 bindings, schema,
route validation, canonical-URL extraction, deployment guide, and tests.
`monitor/collectors/github-dispatch.ts` converts the sanitized event into the same
`Signal` contract used by every other collector.

Deployment still needs a Cloudflare-managed domain, Email Routing aliases, a
30-day R2 lifecycle rule, a D1 database, and a narrowly scoped GitHub dispatch
credential. Those account-level resources are intentionally not invented or
deployed by the repository code. Follow `monitor/cloudflare/README.md`.

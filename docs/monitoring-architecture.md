# Flag Paths — Monitoring and Account Architecture

Status: proposed implementation plan  
Date: 2026-07-17  
Goal: turn a locally watched path into a trustworthy, account-backed change alert

## Product decision

Monitoring is the retention loop. A watch is initially free and local. An account is
required only when a user asks to sync the watch or receive alerts.

This is a subscription to a path, not a paid SaaS plan:

1. Explore and build a profile without an account.
2. Reach a useful path.
3. Watch it locally.
4. Choose **Save and get alerts**.
5. Sign in and consent to the minimum cloud data needed for that watch.

Do not put sign-in before the first useful result. Do not launch paid plans until
reviewed alerts produce repeat usage.

## Core pipeline

```text
official source / Telegram lead
              ↓
      fetch and snapshot
              ↓
       structured diff
              ↓
     candidate change queue
              ↓
        human review gate
              ↓
 versioned rule + graph release
              ↓
 watched-path impact matching
              ↓
 email / Telegram / in-app delivery
```

Automation discovers and explains changes. It never publishes a legal conclusion by
itself.

## Source hierarchy

### Tier 1 — primary

- government gazettes and legislation databases;
- immigration, nationality, foreign affairs, and interior-ministry pages;
- official program notices, application guidance, and fee schedules;
- treaty repositories, parliamentary records, and court decisions.

### Tier 2 — high-quality secondary

- established immigration law firms with named authors and dates;
- professional associations and recognized mobility research;
- specialist newsletters that link to the underlying instrument.

### Tier 3 — leads

- Telegram channels and forwarded messages;
- social posts, forum reports, and individual anecdotes.

A Tier 3 item can open a candidate but cannot produce a verified alert until it is
resolved to a primary source or explicitly published as an unverified field report.

## Telegram intake

Start with a private research-inbox bot:

- forward relevant Telegram messages to the bot;
- capture text, URLs, attachments, message date, and `forward_origin` when Telegram
  provides it;
- create a source lead rather than a live data update;
- resolve the lead to the original article, government notice, or legal instrument;
- deduplicate repeated forwards using normalized URLs and content hashes.

The Bot API can receive messages forwarded to a bot and channel posts known to that
bot, but it does not give a bot general access to arbitrary private chats. This makes
manual forwarding a safe first workflow. Automatic monitoring through a Telegram user
session or TDLib would add account-security, operating, and policy complexity and
should wait until manual intake volume proves the need.

Reference: [Telegram Bot API](https://core.telegram.org/bots/api).

## Change detection

Each source has a fetch strategy and cadence:

- RSS/Atom: poll the feed and archive new items;
- HTML: store raw HTML, a normalized text extraction, relevant selectors, and a hash;
- PDF: store the file, extracted text, page hashes, and OCR status;
- API: store the response and important headers;
- manual/Telegram: store the submitted artifact and its provenance.

When content changes:

1. compare normalized snapshots;
2. identify added, removed, and modified sections;
3. classify the possible impact;
4. match the candidate to stable rule IDs;
5. put it into review with both versions and source evidence.

Suggested impact types:

- eligibility;
- status or right granted;
- physical-presence requirement;
- processing time;
- cost or investment threshold;
- quota, ballot, or opening/closure;
- document requirement;
- dependent or family rule;
- dual-citizenship or renunciation rule;
- source-only/editorial change.

An LLM may summarize a diff and propose structured fields. The reviewer must see the
source, extracted passage, previous value, proposed value, and affected graph edges.

## Stable IDs are the key

A user should not merely watch “Portugal.” A watch must store:

- goal and intent;
- graph release used to calculate the path;
- stable rule and edge IDs used by the path;
- important assumptions and chance-based steps;
- a fingerprint of the path shown to the user.

When a reviewed rule changes, impact matching becomes a deterministic join from the
changed rule ID to affected watches. The alert can then say what changed, which step is
affected, whether the path still resolves, and what the user should re-check.

## Proposed data model

| Table | Purpose |
|---|---|
| `sources` | Registry of URLs, jurisdictions, source tier, fetch method, cadence, owner, and health |
| `source_snapshots` | Immutable raw artifact location, extracted text, hash, headers, and fetch time |
| `source_leads` | Telegram/manual leads awaiting primary-source resolution |
| `change_candidates` | Structured diff, proposed impact, severity, evidence, and review state |
| `rules` | Stable, versioned legal or editorial claims referenced by graph edges |
| `rule_sources` | Many-to-many evidence links with passage and retrieval date |
| `reviews` | Reviewer, decision, notes, and timestamps |
| `graph_releases` | Dataset/edge version, checksum, build result, and publish time |
| `profiles` | Minimum account-owned profile data required for sync |
| `watches` | Goal, path fingerprint, graph release, and account owner |
| `watch_dependencies` | Stable rule/edge IDs used by each watched path |
| `alert_events` | Reviewed change matched to a watch, with generated explanation |
| `deliveries` | Channel, address reference, attempts, result, and timestamps |

All profile, watch, and delivery rows must be owned through row-level policies.
Public source, rule, and release data can remain readable without an account.

## Recommended infrastructure

Use Supabase for the first operating version:

- Auth: Google and email magic link first; Apple after its rotation process has an
  owner; Ethereum under “More sign-in options” only when users request it.
- Postgres: sources, rules, watches, review records, and alert audit trail.
- Storage: immutable HTML/PDF/source snapshots.
- Cron: enqueue due source checks.
- Queues: durable fetch, extraction, review-notification, impact, and delivery jobs.
- Edge Functions: small fetch/webhook/delivery workers, not one large fan-out job.
- Row Level Security: account-owned profiles, watches, and delivery preferences.

Supabase documents scheduled Edge Functions with `pg_cron`, durable Postgres queues
with PGMQ, authentication integrated with row-level security, and optional Google,
Apple, and Ethereum providers:

- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Postgres queues](https://supabase.com/docs/guides/queues/pgmq)
- [Auth and RLS](https://supabase.com/docs/guides/auth)
- [Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Web3](https://supabase.com/docs/guides/auth/auth-web3)

## Delivery order

1. In-product change history on a watched path.
2. Email digest and urgent email.
3. Telegram bot linking through a one-time account code.
4. Other channels only after demand.

Do not choose Discord as the primary alert channel. Discord is useful for a community,
but personal legal-status alerts, identity linking, and delivery receipts fit email and
Telegram better. A future Discord community can receive public reviewed-change posts
without holding private profile data.

## Privacy boundaries

- Keep anonymous/local use fully functional.
- Sync only after explicit consent.
- Store normalized facts, not passport scans or identity documents.
- Treat partner data as sensitive and optional.
- Keep delivery addresses/tokens separate from route facts where practical.
- Provide export, cloud deletion, sign-out, and delivery revocation.
- Never include profile facts in analytics, logs, URLs, email subjects, or public
  community messages.
- A wallet proves control of an address, not citizenship or legal identity.

## Operating controls

Every source and job needs observable health:

- last successful fetch and expected cadence;
- consecutive failures and backoff;
- content extraction coverage;
- unresolved-lead age;
- review queue age by severity;
- candidate-to-publish time;
- graph build/test status;
- watch-impact count;
- delivery failure and retry rate.

Urgent closures or loss-of-right changes should have a short review target. Editorial
rewrites and low-impact source changes can wait for a digest.

## Build sequence

### Phase 0 — prove the editorial loop

- Add stable rule IDs to the existing graph data.
- Create a source registry for the 20–30 highest-value routes.
- Build a Telegram research-inbox bot.
- Store snapshots and produce a reviewable diff.
- Use a GitHub pull request as the first review interface.

### Phase 1 — account-backed watches

- Add Supabase Auth and row-level policies.
- Migrate selected local watches only after user confirmation.
- Persist watch dependencies and graph release IDs.
- Add account export/deletion and auth failure tests.

### Phase 2 — reviewed alerts

- Publish accepted rule versions and rebuild the graph.
- Match changes to watch dependencies.
- Show in-product change history.
- Deliver email; add Telegram account linking after email is reliable.

### Phase 3 — scale sources and review

- Add queues, source-health dashboards, severity targets, and reviewer assignment.
- Expand the source registry by observed watch demand, not by country count alone.
- Add an internal review UI only when GitHub review becomes the bottleneck.

## V1 acceptance criteria

- A source change produces an immutable before/after record.
- No candidate can publish without a recorded human decision.
- Every published change identifies its source and graph release.
- A watched path stores exact rule dependencies.
- A test account can export and delete its cloud data.
- An alert states what changed and why the watch is affected.
- Failed jobs and failed deliveries are visible and retryable.

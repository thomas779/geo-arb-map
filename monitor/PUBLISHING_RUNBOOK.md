# Publishing runbook: discovery → verify → Telegram

Operator guide to get Flag Paths news onto the Telegram channel. Complements
`monitor/README.md` (architecture) and `monitor/cloudflare/README.md` (email).

## Target loop

```text
discovery (RSS / email / curated social)
  → LLM triage → GitHub issue
  → verify (official-biased web search)
  → human checklist + Public brief
  → publish-telegram workflow
```

## Phase 0 — Telegram connectivity

1. GitHub environment **`telegram-publication`**:
   - Secret: `TELEGRAM_BOT_TOKEN`
   - Variable: `TELEGRAM_CHANNEL_ID`
2. Bot can post to the channel (admin or post permission).
3. Run Actions: **Check Telegram connection**  
   (`bun run monitor:telegram -- --check`).

## Phase 1 — First post (bootstrap)

Do not wait for email. Create one real issue and publish.

### Issue shape (required sections)

From `monitor/triage/issues.ts` / publish gate:

- **Reviewer checklist** — every box `- [x]`
- **Verified evidence** — at least one `https://` **primary** URL + short quote/effective date
- **Public brief** — final copy only (no “Replace this…”)

### Publish

```sh
# local dry-run
bun run monitor:telegram -- --issue N --dry-run

# or GitHub Actions: "Publish reviewed Telegram brief" with issue_number
```

## Phase 2 — Discovery

### Already active (no credentials)

```sh
bun run monitor:collect --lookback-days 14
# needs MONITOR_LLM_* for real triage
bun run monitor:triage
bun run monitor:draft
```

Active discovery includes global feeds plus **local specialists**, e.g.:

| Source | Role |
|--------|------|
| `globalcit-rss` | Academic nationality-law |
| `imidaily-rss` | CBI/RBI trade press |
| `wandering-investor-blog` / `-telegram` | Field discovery |
| `expathub-georgia-rss` | **Local Georgia** residency/tax/immigration |
| `bal-insights-rss` | Firm insights bridge until BAL email works |
| `cbi-ch-news-rss` | Commercial CBI news (high noise) |

### Forward-looking programme posts

Local and specialist posts often say a programme *will* open/close (e.g. tax residency
rumours). Treat as:

1. Discovery lead (`needs_primary_source: true`)
2. Verify only with official gazette / ministry / CIP unit
3. Public brief only after confirmation (or explicit “proposal only, not in force”)

### Email intake test (no publisher required)

Fixtures:

| File | Use |
|------|-----|
| `tests/fixtures/monitor/sample-self-send.eml` | Download and send to the Worker intake address (after `SOURCE_ROUTES` allows the From domain / host) |
| `tests/fixtures/monitor/sample-self-send-dispatch.json` | Bypass Worker; test GitHub path only |

**Dispatch-only (no Cloudflare):**

```sh
bun run monitor:email:dispatch \
  --event tests/fixtures/monitor/sample-self-send-dispatch.json
```

That source id is `expathub-georgia-newsletter` (planned email). To exercise
dispatch against an **active** email source in the manifest, temporarily point
the fixture `source_id` at a planned email id after marking it active for the
test, or use the existing `newsletter-dispatch.json` Fragomen-shaped fixture.

**Full Worker path (once deployed):**

1. Deploy per `cloudflare/README.md`.
2. In `SOURCE_ROUTES`, map your intake recipient + allowlisted sender domain +
   `canonical_hosts` (e.g. `expathub.ge` for ExpatHub tests).
3. Send `sample-self-send.eml` from a domain you control **or** replay a real
   ExpatHub newsletter to the intake address (best test if you have prior mail).
4. Confirm D1 status `dispatched` and a GitHub `repository_dispatch`.

**Using your prior ExpatHub emails:** forward one that contains a public
`https://expathub.ge/...` article link to the intake address. Capture the real
envelope From domain (may be Mailchimp/SendGrid) and put **that** domain in
`allowed_sender_domains`, not a guess.

## Cheap serverless LLM for verification look-ups

Goal: low cost, reliable enough to find **current** official pages when a lead
arrives. Not for auto-publishing.

| Option | Why | Caveat |
|--------|-----|--------|
| **Google Gemini Flash + Search grounding** | Very cheap; search grounding is built for “current web” | Use Google AI Studio / Vertex; configure as OpenAI-compatible if using a gateway |
| **OpenRouter cheap model + web tool** | Serverless; pick any cheap model; you already have OpenAI-compatible client | You must supply search (MCP/web_search); model alone is stale |
| **Perplexity Sonar API** | Search-native answers with citations | Less flexible for structured JSON; still discovery/verify only |
| **Groq / Cerebras only** | Ultra-cheap tokens | **No** web search — bad as sole verifier |

**Recommendation:**

1. **Triage** (classify signals): cheapest chat model via existing
   `MONITOR_LLM_PROVIDER=openai-compatible` (Flash / small OpenRouter model).
2. **Verify** (find official primary): **Gemini Flash with Google Search
   grounding**, or OpenRouter + explicit web search tool that prefers
   `.gov` / gazette / ministry hosts.
3. Never write D1 or Telegram from the verify model alone — attach evidence to
   the issue; human still checks the box.

Structured verify output (for a later agent step):

```json
{
  "jurisdiction": "268",
  "claim": "…",
  "status": "confirmed|proposed|rumour|not_found",
  "primary_urls": ["https://…"],
  "effective_date": "YYYY-MM-DD or null",
  "notes": "forward-looking / not yet in force"
}
```

## Expand local discovery (playbook)

Global agencies miss local product detail. Prefer **country specialists** with RSS
or newsletter:

1. WordPress sites often expose `/feed/` (like ExpatHub).
2. Add as `tier: discovery`, single `jurisdictions: ["ISO"]`, keywords for
   residency/citizenship/tax residency/forward-looking terms.
3. Email route when you have mail — map real sender domain after first delivery.
4. Triage must force primary for discovery tier (already does for discovery).

Candidate pattern to repeat: one local hub per high-interest ISO (Georgia,
Portugal, Panama, UAE, Armenia, etc.) — quality over 50 mediocre blogs.

## Weekly ops (once live)

1. Collect + triage (cron or manual).
2. Review top 3–5 issues.
3. Official search for primary.
4. Fill evidence + brief; check all boxes.
5. Run **Publish reviewed Telegram brief**.
6. Optional: atlas data PR if facts changed.

## Out of scope for first posts

- X/Twitter firehose filters  
- Replacing all standing HTML verification monitors  
- Auto-publish without checklist  

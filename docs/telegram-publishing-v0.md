# Telegram publishing v0

Status: implemented, awaiting bot and channel credentials
Purpose: turn reviewed monitoring leads into a useful public news feed without
letting a model publish legal or tax conclusions autonomously

## Product shape

Start with one **public broadcast channel**, not a public group:

- the bot posts short, source-backed briefs;
- only the owner and bot can publish;
- readers receive a clean feed rather than an empty or unmoderated community;
- a linked discussion group can be added later if posts consistently generate
  substantive questions.

Suggested positioning: **Flag Paths Briefing** — verified changes to citizenship,
residence, mobility, tax, and investment-migration rules.

## Publication flow

```text
source signal
  → AI relevance triage
  → GitHub monitoring issue
  → primary-source evidence
  → AI claim/evidence challenge
  → human checks every review item
  → human writes or approves the exact Public brief
  → manual GitHub Actions run
  → Telegram channel
```

The AI step is an evidence check, not the final fact-checker. It should identify
unsupported claims, conflicting dates, missing transition rules, and places where a
secondary source has not been resolved to the underlying authority. The human reviewer
remains accountable for the publication decision.

## What can be published

V0 publishes only a **verified update** with:

- at least one current primary legal, government, court, or tax-authority source;
- an effective date or an explicit statement that no effective date is available;
- applicable transition rules, if any;
- jurisdiction and affected rule or programme;
- every reviewer checkbox completed;
- exact final copy in the issue's `Public brief` section.

Commercial newsletters, Telegram posts, and law-firm alerts are discovery sources.
They can open a lead but cannot be the sole evidence for a verified public brief.

Tax claims require particular care: distinguish tax residence, citizenship-based
taxation, source rules, filing duties, treaties, and incentives. Never generalize a
rule across taxpayers without the primary authority and its scope.

## Editorial taxonomy

Use one clear topic per post:

- Citizenship
- Residence & visas
- Tax
- Work access
- Investment migration
- Quotas & deadlines
- Court or policy interpretation
- Correction

Do not publish generic opinion, promotional programmes, personal anecdotes, or
evergreen explainers as change alerts.

## Telegram setup

1. In Telegram, create a new public **Channel** and choose its public username.
2. Message [@BotFather](https://t.me/BotFather), run `/newbot`, and create a dedicated
   publication bot.
3. Add the bot to the channel as an administrator. Grant only **Post Messages**.
   Editing messages can be added later if correction tooling needs it.
4. In GitHub, create an environment named `telegram-publication`.
5. Add `TELEGRAM_BOT_TOKEN` as an environment secret. Never paste or commit it.
6. Add `TELEGRAM_CHANNEL_ID` as an environment variable using the public username,
   such as `@flagpathsbriefing`.
7. Configure a model for real publications using the provider-neutral variables below.
8. Optionally configure required reviewers on the environment for a second approval
   click.

Telegram's Bot API accepts a public channel username as `chat_id`; the bot must be a
channel administrator with permission to post.

Run **Check Telegram connection** in GitHub Actions first. It verifies the token,
resolves the configured `@channelusername`, and confirms the bot has permission to
post. It does not send a public message and does not require an AI model.

## Model providers

The connection test needs no model. AI triage and publication audits use a small,
provider-neutral interface:

| Environment value | Anthropic | Vercel AI Gateway | Runpod Serverless vLLM |
| --- | --- | --- | --- |
| `MONITOR_LLM_PROVIDER` | `anthropic` | `openai-compatible` | `openai-compatible` |
| `MONITOR_LLM_BASE_URL` | leave unset | `https://ai-gateway.vercel.sh/v1` | `https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1` |
| `MONITOR_LLM_MODEL` | e.g. `claude-sonnet-5` | e.g. `anthropic/claude-sonnet-5` | deployed Hugging Face or served model name |
| `MONITOR_LLM_API_KEY` | Anthropic key | Vercel AI Gateway key | Runpod API key |

Store `MONITOR_LLM_API_KEY` as an environment secret. Store the other values as
environment variables. `MONITOR_LLM_TIMEOUT_MS` can be increased for a cold-starting
self-hosted model; the default is 600,000 milliseconds.

Any future host that supports OpenAI Chat Completions can be used by changing only
these values. Provider-specific code does not enter triage or publication logic.

## Operating a publication

1. Open or select a monitoring issue.
2. Add the verified evidence and relevant passage.
3. Write the exact public copy under `## Public brief`.
4. Check every item under `## Reviewer checklist`.
5. Run **Publish reviewed Telegram brief** in GitHub Actions and provide the issue
   number.

The workflow previews the post, runs a second AI claim-versus-evidence audit, and sends
only if that audit returns no unsupported claims or missing context. After a successful
send, it comments on the issue with a hidden publication marker. A later run refuses
to republish the same issue.

Local dry run:

```sh
bun run monitor:telegram -- --issue 123 --dry-run
```

Local publication:

```sh
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_CHANNEL_ID=@yourchannel \
bun run monitor:telegram -- --issue 123 --apply
```

## Corrections

Do not silently rewrite a material error. Publish a correction that links to the
original post and the corrected primary source, then update the GitHub review trail.
Message-edit automation can be added after the channel has enough volume to justify
it.

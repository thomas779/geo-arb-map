# Operations

How the Atlas actually runs: deploy pipeline, Cloudflare tokens, the
private-data flow, and the security posture. Operator-focused — for the *how do
I add data* procedure see [`adding-jurisdictions.md`](adding-jurisdictions.md),
and for licensing see the repo `README.md`.

## Architecture at a glance

- **Web app** — a Vite build served as static assets from a Cloudflare Worker
  (`flag-paths-web`) at `flagpaths.com`. Config: `wrangler.web.jsonc`.
- **Legacy redirect** — a tiny Worker (`flag-paths-redirect`) 301s
  `www.flagpaths.com` and the old `atlas.thomphreys.com` to the apex,
  preserving paths. Config: `scripts/redirect-worker/wrangler.jsonc`
  (deployed manually: `bunx wrangler deploy -c scripts/redirect-worker/wrangler.jsonc`).
- **Email intake** — a separate Worker (`flag-paths-newsletter-intake`) that
  turns allow-listed inbound newsletters into GitHub `repository_dispatch`
  events. Config: `monitor/cloudflare/wrangler.jsonc`.
- **Monitor pipeline** — GitHub Actions cron that runs the grounded AI sweep and
  publishes to the `@flagpaths` Telegram channel (see `monitor/README.md`).
- **Canonical data** — authored privately, stored in Cloudflare **D1**
  (`flag-paths-data`), compiled to the public `public/*.json` the Atlas renders.

## Deploy pipeline (web)

> **Cutover in progress (2026-08-04).** Deployment is moving to GitHub Actions
> (`.github/workflows/deploy.yml`) because the compiled dataset now lives in the
> private `flag-paths-data` repo, which a Cloudflare-side build cannot authenticate
> to without a dashboard-managed secret. The new workflow is live and proven: it
> fetches the dataset, runs `bun run build` (tsc plus the full suite, so the deploy
> is gated on tests), asserts the corpus is not served, and then **skips the deploy
> until `CLOUDFLARE_DEPLOY_TOKEN` exists**. Two remaining steps, both dashboard:
>
> 1. Create a Cloudflare API token with **Workers Scripts: Edit** and add it as the
>    `CLOUDFLARE_DEPLOY_TOKEN` GitHub secret. (The existing `CLOUDFLARE_API_TOKEN`
>    is D1 + R2 only; verified 403 against the Workers API.)
> 2. Disable the Workers Builds git integration for `flag-paths-web`, then remove
>    `data/compiled/citizenship_routes.json` and `data/citizenship_routes.json`
>    from this repo (they stay committed until then, so the current deploy keeps
>    working).
>
> ### Dataset flow after the cutover
>
> | Step | Command | Effect |
> |---|---|---|
> | Compile | `bun run data:db && data:build && data:promote -- --allow-draft` | writes `data/compiled/` locally, guarded against dropping routes |
> | Publish | `bun run data:publish` | pushes the release to `flag-paths-data` (the source CI and the deploy read) |
> | Sync D1 | `bun run data:sync sync` | canonical store |
>
> `data:publish` refuses a corpus under 500 routes, so a sample-built or truncated
> release cannot reach the source the deploy trusts.

The web app currently deploys via **Cloudflare Workers Builds git integration**. On every push to `main`, Cloudflare builds and deploys; other
branches get preview builds. Configure it in the Cloudflare dashboard under the
`flag-paths-web` Worker → Settings → Build:

| Setting | Value |
| --- | --- |
| Build command | `bun run build` |
| Deploy command (production) | `bunx wrangler deploy -c wrangler.web.jsonc` |
| Version command (preview branches) | `bunx wrangler versions upload -c wrangler.web.jsonc` |
| Root directory | `/` |
| Production branch | `main` |

`bun run build` is deliberate: it runs TypeScript, the monitor Worker type-check,
the artifact-level invariant suite, and then Vite. The private canonical source
is absent from Cloudflare and public CI, so canonical database parity remains a
separate local/D1-export gate; committed public artifacts are still fully checked.

The `-c wrangler.web.jsonc` is **required** on both the deploy *and* version
commands — the config is not the default filename, and the repo has a second
worker config. Package manager is auto-detected from `bun.lock`.

The email-intake worker is deployed manually: `bun run monitor:email:deploy`.

## Cloudflare API tokens

There are **two** tokens, deliberately minimal and distinct:

**1. `flag-paths-web build`** — used by Workers Builds to deploy the site.
- Account → **Workers Scripts: Edit**
- Zone (`flagpaths.com`) → **Workers Routes: Edit** + **Zone: Read**
- Zone (`thomphreys.com`) → **Workers Routes: Edit** + **Zone: Read** (legacy
  `atlas.thomphreys.com` 301-redirect route, `scripts/redirect-worker/`)
- Account Settings: Read · User Details: Read · Memberships: Read
- (Cloudflare's "Edit Cloudflare Workers" template, scoped to this account +
  both zones.)

**2. `CLOUDFLARE_API_TOKEN`** (GitHub Actions secret) — used by
`monitor.yml`, `backup-d1.yml`, `sync-canonical-d1.yml`.
- Account → **D1: Edit** (migrations + queries)
- Account → **Workers R2 Storage: Edit** (backup uploads)
- Scoped to this account only. **No** Workers Scripts — CI never deploys a
  worker.

Cloudflare `account_id` / `database_id` / bucket names in the `wrangler.jsonc`
files are non-secret identifiers (useless without a token) and are fine to
commit.

## Canonical data flow & privacy

The master dataset (`scripts/lib/canonical-pilot.ts`, ~200 per-country records)
is **gitignored** — it lives only in the maintainer's environment and is never
committed. Public forks/CI fall back to a committed sample.

```
canonical-pilot.ts (private, local)
        │  bun run data:db            → .generated/data-canonical/canonical-import.sql
        │  sync-canonical-d1 workflow → remote D1 (flag-paths-data)   [private store]
        │  backup-d1 workflow (daily) → private R2 bucket             [backups]
        ▼
data:promote / compiled public/*.json  → committed → served by the Atlas   [public subset]
```

- **Resolver:** `scripts/lib/canonical-source.ts` loads the real file if present,
  else `canonical-pilot.sample.{ts,json}`. All build scripts and tests import
  from the resolver, never the raw data module. Regenerate the sample after
  editing the master: `bun scripts/build_canonical_sample.ts`.
- **Type without data:** `scripts/lib/canonical-pilot-types.ts` exposes the
  `CanonicalPilot` shape so consumers don't need the data module.
- **Sample→prod guard:** `sync-canonical-d1` refuses to write D1 if fewer than
  100 jurisdictions resolve, so a public/sample build can never overwrite the
  real dataset.
- **Test gating:** the five data/content tests run only when the real dataset is
  present (they `describe.skipIf(CANONICAL_SOURCE_IS_SAMPLE)`); non-data tests
  always run.
- **Pull safety:** because the file is untracked, pulling any commit that
  removed it deletes the working copy. Keep a backup and restore after pulling:
  `cp ~/canonical-pilot.backup.ts scripts/lib/canonical-pilot.ts`.

D1 is the durable home for the data; it carries revision history and is backed
up to R2 daily. If D1 accumulates ambiguous revision heads (from partial
stagings), reconcile via the stage → compile-release → promote flow rather than
a raw re-import — see [`../data/d1/README.md`](../data/d1/README.md).

## GitHub Actions

| Workflow | Trigger | Purpose | Cloudflare token |
| --- | --- | --- | --- |
| `monitor.yml` | daily cron + dispatch | RSS/Telegram/X/Bluesky discovery + AI sweep + citation ledger + Telegram publish | D1 (dedup + citations) |
| `source-candidates.yml` | manual | rank cited outlets worth subscribing to (from the citation ledger) | D1 |
| `x-watchlist-seed.yml` | manual | propose X watchlist accounts via Grok (evidence-required, review-first) | D1 (reverse mode) |
| `backup-d1.yml` | daily cron + dispatch | export D1, validate, upload to R2 | D1 + R2 |
| `sync-canonical-d1.yml` | manual | re-import canonical → D1 (guarded) | D1 |
| `publish-telegram.yml` | manual | publish one reviewed brief | — |
| `check-telegram.yml` | manual | Telegram connection check | — |

X discovery needs the `MONITOR_XAI_API_KEY` secret (optional — X skips cleanly
without it); the daily X call is ~$0.02, the manual seed ~$0.50–1. Third-party
actions are pinned to commit SHAs; dispatch inputs are passed via `env:` vars,
never interpolated into shell lines.

## Security posture

- Repository is public; **secret scanning + push protection are enabled**.
- **Branch protection on `main`**: PR + 1 approval required, no force-push, no
  deletion. Admins (the owner) can bypass — the gate is for outside
  contributions.
- No secrets are committed or in git history; all credentials flow through
  GitHub Secrets / environment variables / Worker secret bindings.
- Only the owner has repo write access. Installed GitHub Apps: Cloudflare
  Workers Builds.

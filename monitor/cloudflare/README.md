# Cloudflare newsletter intake

This package is the event-driven email edge for the review-first monitor. It:

1. accepts one configured newsletter address and attributes publishers from
   non-overlapping sender-domain allowlists;
2. rejects messages larger than the configured limit;
3. parses MIME with `postal-mime`;
4. archives the raw RFC 822 message privately in R2;
5. deduplicates and records processing state in D1;
6. extracts an allow-listed public publisher URL; and
7. sends only a sanitized `newsletter_signal` repository dispatch to GitHub.

It never writes to the public datasets. Messages without a public canonical article
URL are archived as `ignored` and do not reach triage.

## Account setup

Do not commit tokens, real intake addresses, or Cloudflare resource IDs.

```sh
# Authenticate Wrangler.
bunx wrangler login

# Create private storage.
bunx wrangler r2 bucket create flag-paths-monitor-raw-email
bunx wrangler d1 create flag-paths-monitor
```

Copy the returned D1 `database_id` into `wrangler.jsonc`, then apply the schema:

```sh
bunx wrangler d1 migrations apply flag-paths-monitor \
  --remote \
  --config monitor/cloudflare/wrangler.jsonc
```

Create a fine-grained GitHub token limited to this repository with **Contents:
read and write** permission. GitHub requires that permission for repository
dispatches. Store it only as a Worker secret:

```sh
bunx wrangler secret put GITHUB_TOKEN \
  --config monitor/cloudflare/wrangler.jsonc
```

Copy `source-routes.example.json` somewhere outside the repository, replace the
shared example recipient, and confirm the actual envelope sender domains from a
test message. Every source may use the same recipient, but sender-domain
allowlists for that recipient must not overlap. Store the compact JSON as another
Worker secret:

```sh
bunx wrangler secret put SOURCE_ROUTES \
  --config monitor/cloudflare/wrangler.jsonc
```

Deploy only after both secrets and the D1 ID are configured:

```sh
bun run monitor:email:deploy
```

In the Cloudflare dashboard:

1. enable Email Routing on a dedicated monitoring domain or subdomain;
2. create one custom newsletter address and route it to this Worker;
3. add an R2 lifecycle rule deleting raw email after 30 days; and
4. send a local/test message before subscribing the addresses to publishers.

The example sender domains are conservative starting points, not claims about the
publishers' actual mailing infrastructure. If a real newsletter uses a delegated
sender domain, add only that observed domain to its source mapping. Use a separate
address only when two publishers cannot be distinguished safely by envelope
sender.

## Local verification

Apply the migration locally and start Wrangler:

```sh
bunx wrangler d1 migrations apply flag-paths-monitor \
  --local \
  --config monitor/cloudflare/wrangler.jsonc
bun run monitor:email:dev
```

Cloudflare's local Email Worker endpoint accepts RFC 5322 email at:

```text
POST /cdn-cgi/handler/email?from=<sender>&to=<recipient>
```

Use a `.dev.vars` file for local `GITHUB_TOKEN` and `SOURCE_ROUTES`; it is
gitignored. Do not use a production GitHub token for local parsing tests.

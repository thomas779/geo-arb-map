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

## When to use email intake (vs RSS)

Email intake is for **publisher newsletters that link to their own canonical
articles** — law-firm and agency alerts such as Fragomen, BAL, and Foster. For
those, `canonical_hosts` is the publisher's own domain and the extractor finds a
clean article URL.

It is **not** suited to **aggregator digests** that link outward through an ESP
click-tracker (e.g. ExpatHub's BirdSend e-News, which wraps every link and points
to `matsne.gov.ge` / `parliament.ge` / news sites rather than back to
`expathub.ge`). The extractor cannot unwrap opaque tracker redirects, so such
messages are correctly archived as `ignored`. Ingest those publishers through
their **RSS feed** instead (see `monitor/sources/manifest.json`), which exposes
direct article URLs. ExpatHub, for example, is covered by `expathub-georgia-rss`.

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

### Routing policy (`monitor_routes` D1 table)

The Worker reads its routing policy from the `monitor_routes` table in the
`flag-paths-monitor` D1 database, so routes can be managed as data instead of a
write-only secret. Each row maps one `source_id` to a `recipient` intake
address, a JSON array of `allowed_sender_domains`, and a JSON array of
`canonical_hosts`. Every source may use the same recipient, but sender-domain
allowlists for that recipient must not overlap (each message must attribute to
exactly one source). `source-routes.example.json` shows the equivalent shape.

Add or edit a route (confirm the real envelope sender domain from a delivered
message first — it is often a Mailchimp/SendGrid domain, not the brand domain):

```sh
bunx wrangler d1 execute flag-paths-monitor --remote \
  --config monitor/cloudflare/wrangler.jsonc \
  --command "INSERT OR REPLACE INTO monitor_routes
    (source_id, recipient, allowed_sender_domains, canonical_hosts, enabled, updated_at)
    VALUES ('fragomen-client-alerts', 'newsletters@atlas.example.com',
      '[\"fragomen.com\"]', '[\"fragomen.com\"]', 1, datetime('now'));"
```

Disable a source without deleting it by setting `enabled = 0`.

**Fallback:** if the table is empty or unreadable, the Worker falls back to the
optional `SOURCE_ROUTES` secret (the same JSON array as
`source-routes.example.json`). Keep it only during transition or as DR:

```sh
bunx wrangler secret put SOURCE_ROUTES \
  --config monitor/cloudflare/wrangler.jsonc
```

Deploy only after the `GITHUB_TOKEN` secret, at least one `monitor_routes` row
(or the `SOURCE_ROUTES` fallback), and the D1 ID are configured:

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

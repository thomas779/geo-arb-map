# Adding a monitoring source

Add a source to `manifest.json` when it regularly reports a rule in scope:
nationality acquisition, residence-to-citizenship credit, cross-border work or
settlement rights, dual-citizenship restrictions, quotas, costs, or programme
openings and closures.

Prefer narrow country specialists and primary government publishers over another
general mobility blog. Do not add scraped search-result pages, referral funnels,
or sources that republish without linking to the underlying authority.

For email sources, record a public subscription page and public article archive.
The inbound normalizer must produce a canonical article URL; do not place private
mailbox URLs, tracking links, or complete newsletter bodies in a Signal.

## Tiers

- `discovery`: fast but not authoritative—trade press, researchers, communities,
  podcasts. These sources can generate a lead but can never verify it.
- `verification`: the legal or government publisher itself. These signals may
  support verification, but a reviewer still checks the exact instrument and
  effective date.

## Manifest entry

```json
{
  "id": "stable-lowercase-id",
  "tier": "discovery",
  "adapter": "rss",
  "status": "active",
  "url": "https://example.org/feed/",
  "jurisdictions": ["250"],
  "max_items": 25,
  "notes": "Who publishes it, what it catches, and why it is useful."
}
```

Use `multi` only when the source genuinely spans countries. Set `status` to
`planned` if its adapter or authentication is not implemented. Active sources
currently use `rss` (RSS 2.0 or Atom). Newsletter email and curated YouTube
channel feeds are the next discovery transports; broad social monitoring is
deliberately out of scope because its noise and access fragility are poor fits
for a legal-change monitor.

Before opening a pull request:

```sh
bun run monitor:test
bun run monitor:collect --source stable-lowercase-id
```

The second command performs a real network request; it should return a bounded
number of valid signals and a healthy entry in
`monitor/.out/collection-report.json`.

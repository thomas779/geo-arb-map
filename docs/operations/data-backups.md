# Canonical D1 backup and restore

`flag-paths-data` is the editorial source of truth after cutover. Its private
backup bucket is `flag-paths-data-backups`; the public application never reads
from this bucket.

## Retention and schedule

`.github/workflows/backup-d1.yml` exports the database every day at 04:23 UTC.
The workflow compiles the export with `data:build` before uploading it, so an
unreadable or invalid export never becomes a trusted backup.

Verified backups are stored as compressed SQL with a SHA-256 sidecar:

```text
daily/YYYY/MM/DD/<database>-<release>-<run>-<attempt>.sql.gz
daily/YYYY/MM/DD/<database>-<release>-<run>-<attempt>.sql.sha256
monthly/YYYY/MM/<database>-<release>-<run>-<attempt>.sql.gz
monthly/YYYY/MM/<database>-<release>-<run>-<attempt>.sql.sha256
```

R2 lifecycle rules retain daily objects for 90 days and monthly objects for
730 days. GitHub also retains a copy with the workflow run for seven days.

The Cloudflare account ID is non-secret deployment metadata in
`data/d1/wrangler.jsonc`. The workflow therefore requires only repository secret
`CLOUDFLARE_API_TOKEN`, scoped to read D1 and write the
`flag-paths-data-backups` bucket.

The token must not be shared with the email-intake Worker or committed to Git.

## Restore rehearsal

Choose a matching `.sql.gz` object and `.sql.sha256` sidecar from R2, then run:

```sh
bunx wrangler r2 object get \
  flag-paths-data-backups/<object>.sql.gz \
  --file /tmp/flag-paths-data.sql.gz \
  --remote \
  --config data/d1/wrangler.jsonc
bunx wrangler r2 object get \
  flag-paths-data-backups/<object>.sql.sha256 \
  --file /tmp/flag-paths-data.sql.sha256 \
  --remote \
  --config data/d1/wrangler.jsonc

gzip -dkf /tmp/flag-paths-data.sql.gz
(
  cd /tmp
  sha256sum -c flag-paths-data.sql.sha256
)
bun run data:build -- --db /tmp/flag-paths-data.sql
```

The checksum and every `data:build` gate must pass before the export is used.
This rehearsal materializes the SQL in temporary SQLite and proves that the
backup reproduces a valid release without touching production.

## Disaster restore

Do not import a backup directly over `flag-paths-data`.

1. Retrieve and validate the backup as above.
2. Create a temporary D1 database in Western Europe.
3. Apply `data/d1/migrations/` to the temporary database.
4. Import the validated SQL export into the temporary database.
5. Export the temporary database again and run `data:build` against it.
6. Compare its release ID and generated files with the expected release.
7. Redirect the admin binding only after human review.

D1 Time Travel is the first choice for a recent operational rollback. R2
exports are the independent, longer-retention recovery path.

## First verified backup

On 2026-07-20, the real remote D1 export for release
`d87a3807edbbebac` was uploaded to private R2, downloaded again, and checked:

- SQL SHA-256:
  `5a1a1e037a8c176568d5aeb7476cd038179b1392b6f55d0974da3e1c39823730`;
- gzip SHA-256:
  `37d696b72cbf49ba667f2e929b9f962df904a16302d3e2c945018edb5d957d92`;
- restored scope: 21 canonical entities and 3 routes; and
- restored release: `d87a3807edbbebac`, with all parity gates passing.

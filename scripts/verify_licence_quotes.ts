#!/usr/bin/env bun
/**
 * Re-fetch every source in a licence-bilateral findings file and check that each
 * quote literally appears in the document it cites.
 *
 * Sibling of verify_research_quotes.ts, same discipline, different shape. It exists
 * separately because that script's schema is jus-soli specific (verdict, limb_types)
 * and bending it to carry `grants` and `classes_matched` would make both weaker.
 *
 * The trap this was written for is Swiss. fedlex.admin.ch/eli/... returns 200 with an
 * Angular shell for EVERY path, and — worse — the filestore URL with the wrong
 * consolidation date ALSO returns 200, at a plausible size, containing no legal text.
 * A researcher checking status codes sees 16 hits and cites 16 documents it never
 * read. So a body that carries no legal text is a failure here, not a warning, and
 * the quote match is the only thing that actually proves the fetch.
 *
 * Usage: bun scripts/verify_licence_quotes.ts docs/research/171-licence-bilaterals.json
 * Exit code is non-zero if any row fails, so it can gate authoring.
 */
import fs from 'node:fs';
import { fetchText, norm } from './lib/quote-gate.ts';

interface Row {
  family?: string;
  partner_label_en?: string;
  name?: string;
  iso?: string;
  verdict?: string;
  partner_iso_n3?: string | null;
  subnational_label?: string | null;
  source_url?: string;
  quote_original?: string;
  grants?: string;
  classes_matched?: boolean | null;
  in_force?: boolean;
  notes?: string;
}

const GRANTS = new Set(['recognition', 'exchange', 'recognition_and_exchange']);
/** Aggregators and mirrors that may not stand as the cited authority. */
const BANNED_HOST = /wikipedia|refworld|natlex|constituteproject|\blii\.org/i;






const path = process.argv[2];
if (!path || !fs.existsSync(path)) {
  console.error('usage: bun scripts/verify_licence_quotes.ts <findings.json>');
  process.exit(2);
}

const rows = JSON.parse(fs.readFileSync(path, 'utf8')) as Row[];
// One fetch per distinct URL: 34 rows share 16 documents, and hammering a
// government host 34 times to learn 16 things is how you earn a block.
const cache = new Map<string, Awaited<ReturnType<typeof fetchText>>>();
const results: Array<{ label: string; ok: boolean; detail: string }> = [];

for (const row of rows) {
  // Falls back through the sibling findings schemas so this doubles as a generic
  // quote gate for any file carrying source_url + quote_original.
  const label = row.partner_label_en ?? row.name ?? row.iso ?? '(unnamed)';
  const push = (ok: boolean, detail: string) => results.push({ label, ok, detail });

  // An undetermined row is the researcher declining to claim something, which is the
  // outcome we ask for when a source cannot be reached. Failing it for having no
  // quote would punish exactly the honesty the brief demands. It still has to say WHY.
  if (/cannot_determine/.test(row.verdict ?? '')) {
    results.push({
      label, ok: true, detail: (row.notes ?? '').trim() ? 'undetermined, reason given' : 'UNDETERMINED WITH NO REASON',
    });
    if (!(row.notes ?? '').trim()) results[results.length - 1].ok = false;
    continue;
  }

  if (!row.source_url) { push(false, 'no source_url'); continue; }
  if (BANNED_HOST.test(row.source_url)) { push(false, `aggregator cited: ${row.source_url}`); continue; }
  if (!row.quote_original?.trim()) { push(false, 'no quote_original'); continue; }
  if (row.grants && !GRANTS.has(row.grants)) { push(false, `bad grants: ${row.grants}`); continue; }
  // Sub-national rows must not claim a country. Flattening Quebec to Canada would
  // assert a treaty with Canada that does not exist.
  if (row.subnational_label && row.partner_iso_n3 !== null) {
    push(false, `sub-national row claims iso ${row.partner_iso_n3}`); continue;
  }

  if (!cache.has(row.source_url)) cache.set(row.source_url, await fetchText(row.source_url));
  const got = cache.get(row.source_url)!;

  if (!got.ok) { push(false, `HTTP ${got.status}`); continue; }
  if (got.shell) { push(false, `SPA shell, no legal text (${got.bytes}B)`); continue; }
  if (!got.text) { push(false, got.note || `no extractable text (${got.bytes}B)`); continue; }

  if (norm(got.text).includes(norm(row.quote_original))) {
    push(true, `quote verified (${got.bytes}B)`);
  } else {
    push(false, `QUOTE NOT FOUND in ${row.source_url}`);
  }
}

const failed = results.filter(r => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? ' ok ' : 'FAIL'}  ${r.label.padEnd(28)} ${r.detail}`);
}
console.log(`\n${results.length - failed.length} of ${results.length} verified across ${cache.size} documents; ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);

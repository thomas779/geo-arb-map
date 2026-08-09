#!/usr/bin/env bun
/**
 * Verify a research findings file by re-fetching every source and checking that
 * every quote literally appears in the document it cites.
 *
 * Why this exists. Research for this atlas is increasingly produced by agents
 * with web access, and the failure mode is not sloppiness, it is *plausibility*:
 * in one week we received a fabricated Akoma Ntoso URL for a real Gibraltar
 * regulation, and a GBP 37,500 threshold plus a 6 October 2025 cutoff that appear
 * nowhere in the instrument they were attributed to. All three read perfectly.
 * Reading a report cannot catch that. Re-fetching the source can.
 *
 * The check that does the work is the quote match. A URL that resolves proves
 * only that the agent found a page; a quote that appears character-for-character
 * in that page proves it read it. The subtler fraud this defeats is the
 * metadata-only portal: an official record whose text sits behind a paywall,
 * cited while the words come from somewhere else.
 *
 * Usage:
 *   bun scripts/verify_research_quotes.ts docs/research/127-batch2.json
 *   bun scripts/verify_research_quotes.ts <file> --json
 *
 * Exit code is non-zero if any entry fails, so it can gate a merge.
 */
import fs from 'node:fs';

interface Finding {
  iso?: string;
  name?: string;
  route_id?: string;
  verdict?: string;
  limb_types?: string[];
  source_url?: string;
  instrument?: string;
  language?: string;
  consolidated_as_of?: string;
  quote_original?: string;
  quote_translation?: string;
  notes?: string;
}

const VERDICTS = new Set(['territorial_limb_present', 'no_territorial_limb', 'cannot_determine']);
const LIMBS = new Set(['stateless_safeguard', 'double_jus_soli', 'parent_residence',
  'foundling', 'presumption', 'unconditional']);
/** Aggregators and mirrors that may not stand as the cited authority. */
const BANNED_HOST = /constituteproject|refworld|natlex|ilo\.org|wikipedia|\blii\.org|constitutionnet/i;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120 Safari/537.36';

/**
 * Compare on collapsed whitespace and NFC, and nothing else.
 *
 * Deliberately NOT fuzzy. Accent-stripping or case-folding would let a
 * paraphrase through, which is the whole thing being tested. Whitespace is
 * normalised only because PDF and HTML extraction legitimately reflow it.
 */
const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/** Strip tags/scripts; decode the few entities that matter for legal text. */
function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&laquo;|&raquo;/g, '"');
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string; note: string }> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    const buf = new Uint8Array(await res.arrayBuffer());
    // Some official publishers serve UTF-16 (bdlaws.minlaw.gov.bd). Decoding as
    // UTF-8 yields a space between every character and every search fails silently.
    let decoded: string;
    if (buf[0] === 0xfe && buf[1] === 0xff) decoded = new TextDecoder('utf-16be').decode(buf);
    else if (buf[0] === 0xff && buf[1] === 0xfe) decoded = new TextDecoder('utf-16le').decode(buf);
    else decoded = new TextDecoder('utf-8').decode(buf);
    const isPdf = decoded.slice(0, 5) === '%PDF-';
    return {
      ok: res.ok,
      status: res.status,
      text: isPdf ? '' : textOf(decoded),
      note: isPdf ? 'PDF — extract with pdftotext and re-check by hand' : '',
    };
  } catch (error) {
    return { ok: false, status: 0, text: '', note: `fetch failed: ${(error as Error).message}` };
  }
}

const path = process.argv[2];
const asJson = process.argv.includes('--json');
if (!path || !fs.existsSync(path)) {
  console.error('usage: bun scripts/verify_research_quotes.ts <findings.json> [--json]');
  process.exit(2);
}

const findings = JSON.parse(fs.readFileSync(path, 'utf8')) as Finding[];
const results: Array<{ name: string; verdict: string; status: string; detail: string }> = [];

for (const f of findings) {
  const label = f.name ?? f.iso ?? '(unnamed)';
  const fail = (detail: string) => results.push({
    name: label, verdict: f.verdict ?? '?', status: 'FAIL', detail,
  });

  if (!f.verdict || !VERDICTS.has(f.verdict)) { fail(`bad verdict: ${f.verdict}`); continue; }
  for (const limb of f.limb_types ?? []) {
    if (!LIMBS.has(limb)) { fail(`unknown limb_type: ${limb}`); continue; }
  }
  if (f.verdict === 'territorial_limb_present' && !(f.limb_types ?? []).length) {
    fail('claims a territorial limb but names no limb_types'); continue;
  }
  if (f.verdict === 'cannot_determine') {
    results.push({
      name: label, verdict: f.verdict,
      status: (f.notes ?? '').trim() ? 'OK' : 'FAIL',
      detail: (f.notes ?? '').trim() ? 'undetermined, reason given' : 'cannot_determine with no notes',
    });
    continue;
  }
  if (!f.source_url) { fail('no source_url'); continue; }
  if (BANNED_HOST.test(f.source_url)) { fail(`aggregator/mirror cited: ${f.source_url}`); continue; }
  if (!f.quote_original?.trim()) { fail('no quote_original'); continue; }

  const got = await fetchText(f.source_url);
  if (!got.ok) { fail(`HTTP ${got.status} ${got.note}`.trim()); continue; }
  if (!got.text) { fail(got.note || 'no extractable text'); continue; }

  if (norm(got.text).includes(norm(f.quote_original))) {
    results.push({ name: label, verdict: f.verdict, status: 'OK', detail: `quote verified in ${f.source_url}` });
  } else {
    fail(`QUOTE NOT FOUND in the cited document (${f.source_url})`);
  }
}

const failed = results.filter(r => r.status === 'FAIL');
if (asJson) {
  console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.status === 'OK' ? ' ok ' : 'FAIL'}  ${r.name.padEnd(24)} ${r.verdict.padEnd(26)} ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length} of ${results.length} verified; ${failed.length} failed.`);
}
process.exit(failed.length ? 1 : 0);

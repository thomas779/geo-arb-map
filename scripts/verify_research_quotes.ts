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
 * Two later corrections, both of which had the script scoring files it could not read:
 *
 * 1. The verdict vocabulary was jus-soli only (#127). Run against a residence
 *    findings file, EVERY substantive row was rejected on `bad verdict` before a
 *    single fetch, and the only rows that "passed" were `cannot_determine` credited
 *    for having a reason. That is a gate reporting 7 of 29 while having verified
 *    nothing — worse than no gate, because the number looks like evidence.
 * 2. It never checked that a `route_id` names a route that exists. Three residence
 *    files carried 38 distinct ids, none of which were in the corpus: research-side
 *    ids at a finer grain than the shipped rows. Every one of them read as a row
 *    ready to apply. An id that resolves to nothing is a FAIL here.
 *
 * Usage:
 *   bun scripts/verify_research_quotes.ts docs/research/127-batch2.json
 *   bun scripts/verify_research_quotes.ts <file> --json
 *   bun scripts/verify_research_quotes.ts <file> --corpus <compiled.json>
 *
 * Exit code is non-zero if any entry fails, so it can gate a merge.
 */
import fs from 'node:fs';
import { fetchText, norm } from './lib/quote-gate.ts';

interface Finding {
  iso?: string;
  name?: string;
  route_id?: string | null;
  title?: string;
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

/**
 * Verdicts the jus-soli research family uses (#127). `limb_types` only means
 * anything under these.
 */
const JUS_SOLI_VERDICTS = new Set([
  'territorial_limb_present', 'no_territorial_limb',
]);
/**
 * Verdicts the residence research family uses, harvested from the three residence
 * findings files rather than assumed. They differ from the jus-soli set because they
 * answer a different question: not "does this limb exist in the constitution" but
 * "is this programme real, live, and on these terms today".
 *   confirmed / verified            — read on the instrument, terms as stated
 *   verified_active                 — same, and grantable now
 *   verified_active_threshold_revised — same, and the published figure is stale
 *   verified_closed_to_new_entrants — exists and renews, but no new intake
 *   enacted_but_not_operational     — on the statute book, not yet grantable
 * The distinction the last two carry is the whole point of recording them: a route
 * that cannot be entered is not the same claim as a route that does not exist.
 */
const RESIDENCE_VERDICTS = new Set([
  'confirmed', 'verified', 'verified_active', 'verified_active_threshold_revised',
  'verified_closed_to_new_entrants', 'enacted_but_not_operational',
]);
const VERDICTS = new Set([
  ...JUS_SOLI_VERDICTS, ...RESIDENCE_VERDICTS, 'cannot_determine',
]);
// `foundling` is deliberately NOT a qualifying limb. A rule for a child FOUND on the
// territory of unknown parentage is near-universal (a 1961 Statelessness Convention
// obligation) and does nothing for an ordinary child born there to known foreign
// parents. Counting it would flip almost every jurisdiction and bury the real
// corrections in noise. Kenya art. 14 is the worked example: art. 14(1) confers
// citizenship "whether or not the person is born in Kenya", and the only territorial
// text is a foundling presumption. Slovakia § 5 is what a real limb looks like.
const LIMBS = new Set(['stateless_safeguard', 'double_jus_soli', 'parent_residence',
  'presumption', 'unconditional']);
/** Aggregators and mirrors that may not stand as the cited authority. */
const BANNED_HOST = /constituteproject|refworld|natlex|ilo\.org|wikipedia|\blii\.org|constitutionnet/i;

const DEFAULT_CORPUS = 'data/compiled/citizenship_routes.json';

interface Corpus {
  routes?: Array<{ id?: string }>;
  residence_routes?: Array<{ id?: string }>;
}

/**
 * Every id the atlas actually ships, citizenship and residence together. A findings
 * row may legitimately target either family, and looking in only one would reject
 * correct work.
 *
 * If the corpus cannot be read the gate STOPS. A missing corpus silently downgrading
 * the id check to a no-op is the same failure as the verdict hole: a run that reports
 * a pass count while one of its two checks was never applied.
 */
function loadRouteIds(corpusPath: string): Set<string> {
  if (!fs.existsSync(corpusPath)) {
    console.error(`corpus not found: ${corpusPath}\n`
      + 'The route-id check cannot be skipped — build it (bun run data:build) '
      + 'or pass --corpus <path>.');
    process.exit(2);
  }
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as Corpus;
  const ids = new Set<string>();
  for (const route of [...(corpus.routes ?? []), ...(corpus.residence_routes ?? [])]) {
    if (route.id) ids.add(route.id);
  }
  if (!ids.size) {
    console.error(`corpus ${corpusPath} contains no route ids — refusing to run.`);
    process.exit(2);
  }
  return ids;
}


const args = process.argv.slice(2);
const asJson = args.includes('--json');
const corpusFlag = args.indexOf('--corpus');
const corpusPath = corpusFlag === -1 ? DEFAULT_CORPUS : args[corpusFlag + 1];
const path = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--corpus');
if (!path || !fs.existsSync(path) || !corpusPath) {
  console.error('usage: bun scripts/verify_research_quotes.ts <findings.json> [--json] [--corpus <compiled.json>]');
  process.exit(2);
}

const routeIds = loadRouteIds(corpusPath);
const findings = JSON.parse(fs.readFileSync(path, 'utf8')) as Finding[];

/**
 * `verified` and `undetermined` are counted apart and reported apart, always. Folding
 * an undetermined row into a "verified" total is how a file with two real quote checks
 * gets published as nine verifications — the exact overstatement this gate exists to
 * stop, committed by the gate itself.
 */
type Status = 'verified' | 'undetermined' | 'FAIL';
interface Result {
  name: string;
  verdict: string;
  route_id: string | null;
  /** The quote/verdict outcome ALONE — what the row proves about its source. */
  quote_status: Status;
  quote_detail: string;
  /** null when the row's route_id resolves (or it names none). */
  id_problem: string | null;
  /** The row's overall verdict: a bad id fails a row whose quote is fine. */
  status: Status;
  detail: string;
}
const results: Result[] = [];
// One fetch per distinct URL. Four Honduras rows cite the same gazette PDF and two
// Gibraltar rows the same tax page; re-fetching a government host to learn the same
// thing four times is how you earn a block.
const cache = new Map<string, Awaited<ReturnType<typeof fetchText>>>();

for (const f of findings) {
  // Rows for the same route differ only by title, so include it — a bare country
  // name repeated five times makes the output unreadable exactly where it matters.
  const label = [f.name ?? f.iso ?? '(unnamed)', f.title].filter(Boolean).join(' — ');

  // The id check and the quote check are independent, and neither short-circuits the
  // other. A row can cite its instrument perfectly and still point at a route that
  // does not exist — which is precisely what all three residence files do. Collapsing
  // them into one early `continue` would leave "did the quote check out?"
  // unanswerable for every row, and that answer is what survives the remapping.
  let idProblem: string | null = null;
  if (f.route_id != null) {
    if (!f.route_id.trim()) idProblem = 'route_id is present but empty';
    else if (!routeIds.has(f.route_id)) {
      idProblem = `route_id "${f.route_id}" matches no route in ${corpusPath} `
        + '(neither routes nor residence_routes) — map it to a shipped id, '
        + 'or say it needs a new row';
    }
  }

  const [quoteStatus, quoteDetail] = await checkQuote(f);
  const status: Status = idProblem ? 'FAIL' : quoteStatus;
  results.push({
    name: label,
    verdict: f.verdict ?? '?',
    route_id: f.route_id ?? null,
    quote_status: quoteStatus,
    quote_detail: quoteDetail,
    id_problem: idProblem,
    status,
    detail: idProblem ? `${idProblem} [quote: ${quoteDetail}]` : quoteDetail,
  });
}

async function checkQuote(f: Finding): Promise<[Status, string]> {
  const fail = (detail: string): [Status, string] => ['FAIL', detail];

  if (!f.verdict || !VERDICTS.has(f.verdict)) return fail(`bad verdict: ${f.verdict}`);

  // Must reject the whole ENTRY, not just this limb. A `continue` inside the loop
  // only advanced the inner iteration, so a rejected entry fell through and ALSO
  // recorded an OK row. A failing finding that reads as verified is the single
  // outcome this script exists to prevent.
  const badLimb = (f.limb_types ?? []).find(limb => !LIMBS.has(limb));
  if (badLimb) return fail(`unknown limb_type: ${badLimb}`);
  if (f.verdict === 'territorial_limb_present' && !(f.limb_types ?? []).length) {
    return fail('claims a territorial limb but names no limb_types');
  }
  // limb_types belong to the jus-soli question and mean nothing under a residence
  // verdict; carrying them there is a schema mix-up, not a finding.
  if (RESIDENCE_VERDICTS.has(f.verdict) && (f.limb_types ?? []).length) {
    return fail(`residence verdict ${f.verdict} carries jus-soli limb_types`);
  }
  // An undetermined row is the researcher declining to claim something, which is the
  // outcome the brief asks for when a source cannot be reached. It still has to say
  // WHY — and it is never counted as a verification.
  if (f.verdict === 'cannot_determine') {
    return (f.notes ?? '').trim()
      ? ['undetermined', 'undetermined, reason given']
      : fail('cannot_determine with no notes');
  }
  if (!f.source_url) return fail('no source_url');
  if (BANNED_HOST.test(f.source_url)) return fail(`aggregator/mirror cited: ${f.source_url}`);
  if (!f.quote_original?.trim()) return fail('no quote_original');

  if (!cache.has(f.source_url)) cache.set(f.source_url, await fetchText(f.source_url));
  const got = cache.get(f.source_url)!;
  if (!got.ok) return fail(`HTTP ${got.status} ${got.note}`.trim());
  if (got.shell) return fail(`SPA shell, no legal text (${got.bytes}B)`);
  if (!got.text) return fail(got.note || 'no extractable text');

  return norm(got.text).includes(norm(f.quote_original))
    ? ['verified', `quote verified in ${f.source_url}`]
    : fail(`QUOTE NOT FOUND in the cited document (${f.source_url})`);
}

const failed = results.filter(r => r.status === 'FAIL');
const badIds = results.filter(r => r.id_problem);
const count = (s: Status) => results.filter(r => r.quote_status === s).length;
if (asJson) {
  console.log(JSON.stringify({
    total: results.length,
    failed: failed.length,
    unmapped_route_ids: badIds.length,
    quote_verified: count('verified'),
    undetermined: count('undetermined'),
    quote_failed: count('FAIL'),
    results,
  }, null, 2));
} else {
  const mark = { verified: ' ok ', undetermined: '  ? ', FAIL: 'FAIL' } as const;
  for (const r of results) {
    console.log(`${mark[r.status]}  ${r.name.padEnd(52).slice(0, 52)} ${r.verdict.padEnd(32)} ${r.detail}`);
  }
  console.log(`\n${results.length} rows: ${count('verified')} quote-verified, `
    + `${count('undetermined')} undetermined (reason given), ${count('FAIL')} quote failures.`);
  console.log(`${badIds.length} rows name a route_id that exists in no shipped route.`);
  console.log(`${failed.length} rows fail overall.`);
}
process.exit(failed.length ? 1 : 0);

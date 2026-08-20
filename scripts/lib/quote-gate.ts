/**
 * Fetching and text-extraction shared by the quote gates.
 *
 * Extracted because the two gates had drifted: the licence gate learned to read PDFs
 * and to decode `&pound;`, and the jus-soli gate had not, so the SAME source failed
 * one and passed the other. A gate whose verdict depends on which script you ran is
 * not a gate. Every improvement to extraction has to land for both, which is only
 * enforceable if there is one copy.
 *
 * The discipline these encode, in one line each:
 *   - a 200 proves nothing; only the quote appearing in the body proves a read
 *   - a PDF is a document, not an excuse — extract it
 *   - decode entities generically, because hand-picked lists fail on the next symbol
 *   - never fuzzy-match, because a paraphrase passing is the failure being prevented
 */
import fs from 'node:fs';

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120 Safari/537.36';

/** Single-page-app shells that return 200 for any path. See the Fedlex trap. */
const SPA_SHELL = /<title>\s*Casemates\s*<\/title>/i;

/**
 * Compare on collapsed whitespace and NFC, and nothing else. Deliberately not fuzzy:
 * accent-stripping or case-folding would let a paraphrase through, which is the whole
 * thing being tested. Whitespace is normalised only because PDF and HTML extraction
 * legitimately reflow it.
 */
export const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * Currency symbols bit first: Gibraltar and Jersey serve `&pound;`, so three correct
 * quotes containing `£` looked fabricated. The fix at the time was a hand-picked
 * table, with a comment warning that hand-picked tables fail on the next symbol.
 * They did — vegvesen.no serves `&oslash;` and `&aring;`, and four correct Norwegian
 * quotes failed until a researcher worked around them by choosing different text.
 *
 * So the accented Latin-1 range is generated rather than typed. Those are exactly the
 * characters European legal text is made of, and listing them by hand is how this
 * breaks again on the first Icelandic or Turkish source.
 */
const LATIN1_NAMES = [
  'Agrave', 'Aacute', 'Acirc', 'Atilde', 'Auml', 'Aring', 'AElig', 'Ccedil',
  'Egrave', 'Eacute', 'Ecirc', 'Euml', 'Igrave', 'Iacute', 'Icirc', 'Iuml',
  'ETH', 'Ntilde', 'Ograve', 'Oacute', 'Ocirc', 'Otilde', 'Ouml',
  // times and divide sit INSIDE the accented run, at D7 and F7. Leaving them out
  // shifts every later letter by one and silently decodes Ø as ö — which is worse
  // than not decoding at all, because the quote still fails but now looks like a
  // fabrication rather than a tooling gap.
  'times', 'Oslash',
  'Ugrave', 'Uacute', 'Ucirc', 'Uuml', 'Yacute', 'THORN', 'szlig',
  'agrave', 'aacute', 'acirc', 'atilde', 'auml', 'aring', 'aelig', 'ccedil',
  'egrave', 'eacute', 'ecirc', 'euml', 'igrave', 'iacute', 'icirc', 'iuml',
  'eth', 'ntilde', 'ograve', 'oacute', 'ocirc', 'otilde', 'ouml',
  'divide', 'oslash',
  'ugrave', 'uacute', 'ucirc', 'uuml', 'yacute', 'thorn', 'yuml',
] as const;

/** Latin-1 named entities occupy U+00C0..U+00FF in exactly this order. */
const NAMED: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  pound: '£', euro: '€', yen: '¥', cent: '¢',
  laquo: '"', raquo: '"', ldquo: '"', rdquo: '"', lsquo: '’', rsquo: '’',
  ndash: '–', mdash: '—', hellip: '…', deg: '°', sect: '§', para: '¶',
  middot: '·', times: '×', divide: '÷', ordm: 'º', ordf: 'ª', iexcl: '¡', iquest: '¿',
  ...Object.fromEntries(LATIN1_NAMES.map((name, i) => [name, String.fromCodePoint(0xc0 + i)])),
};

export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    // Case is significant: &Oslash; is Ø and &oslash; is ø. Falling straight to a
    // lowercased lookup silently downcased every capital, so quotes still failed and
    // now looked like the researcher had mistyped the source.
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED[name] ?? NAMED[name.toLowerCase()] ?? whole);
}

/**
 * Official publishers serve legal text as PDF constantly — Honduras, Peru, India and
 * Malaysia all do. Treating a PDF as unreadable failed rows that were fine, and a gate
 * that cries wolf on its own blind spot gets ignored, which is worse than none.
 *
 * An empty return here is meaningful: it means a scan with no text layer, which needs
 * OCR and cannot be gated. That is a different answer from "the quote is absent".
 */
export function pdfText(buf: Uint8Array): string {
  const tmp = `/tmp/quote-gate-${Bun.hash(buf).toString(36)}.pdf`;
  try {
    fs.writeFileSync(tmp, buf);
    const out = Bun.spawnSync(['pdftotext', '-layout', '-enc', 'UTF-8', tmp, '-']);
    return out.success ? new TextDecoder('utf-8').decode(out.stdout) : '';
  } catch {
    return '';
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  }
}

export interface Fetched {
  ok: boolean;
  status: number;
  bytes: number;
  shell: boolean;
  isPdf: boolean;
  text: string;
  note: string;
}

/** A TLS chain that Bun rejects but a chain-chasing client can complete. */
const INCOMPLETE_CHAIN = /unable to verify the first certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i;

/**
 * Some official publishers serve a LEAF certificate with no intermediate. Bun's fetch
 * refuses, while curl completes the chain by following the AIA URI in the leaf and
 * still validates it. Measured on this project: almeezan.qa and adilet.zan.kz both
 * answer curl and both fail Bun.
 *
 * That is a real cost — Qatar's Executive Regulation art. 47 and four sourced Kazakh
 * rows were all marked cannot_determine on a tooling limit rather than on anything
 * about the law.
 *
 * Note this does NOT disable verification. `curl` without -k validates normally; it
 * is simply better at finding the missing link. Skipping verification would defeat
 * the point of a provenance tool, which is knowing you reached the real publisher.
 */
function fetchViaCurl(url: string): Uint8Array | null {
  const out = Bun.spawnSync([
    'curl', '-sSL', '--max-time', '45', '--compressed', '-A', UA, url,
  ]);
  return out.success && out.stdout.length > 0 ? new Uint8Array(out.stdout) : null;
}

/**
 * A dropped socket is not a verdict. Government hosts close connections under load,
 * and a transient failure rendered as "unverified" reads identically to a fabricated
 * quote — which would quietly discard good research. Retried once, briefly, and only
 * for transport-level failures; an HTTP status is an answer and is never retried.
 */
export async function fetchText(url: string): Promise<Fetched> {
  const first = await fetchOnce(url);
  if (first.status !== 0) return first;

  // ANY transport-level failure gets one curl attempt, not just a cert chain.
  // The narrower rule cost a real finding: asamblea.gob.sv hangs Bun's fetch
  // while curl retrieves it fine, so El Salvador's 90-day presence reform came
  // back HTTP 0 — reported as unverifiable when the quote was actually good.
  // Bun's fetch and curl fail on different things; when they disagree, the one
  // that reached the publisher is right.
  const body = fetchViaCurl(url);
  if (body) {
    return decodeBody(body, 200, INCOMPLETE_CHAIN.test(first.note)
      ? ' (chain completed via curl)'
      : ' (retrieved via curl after a transport failure)');
  }

  await new Promise(resolve => setTimeout(resolve, 1500));
  return fetchOnce(url);
}

/** Decode a fetched body the same way whichever client retrieved it. */
function decodeBody(buf: Uint8Array, status: number, noteSuffix = ''): Fetched {
  // Some official publishers serve UTF-16 (bdlaws.minlaw.gov.bd). Decoding as UTF-8
  // yields a space between every character and every search fails silently.
  let decoded: string;
  if (buf[0] === 0xfe && buf[1] === 0xff) decoded = new TextDecoder('utf-16be').decode(buf);
  else if (buf[0] === 0xff && buf[1] === 0xfe) decoded = new TextDecoder('utf-16le').decode(buf);
  else decoded = new TextDecoder('utf-8').decode(buf);

  // Scan for the header rather than demanding it at byte 0. asamblea.gob.sv serves
  // its decretos with eight bytes of junk in front of `%PDF-1.5`, so an offset-0
  // test read a real PDF as HTML, extracted nothing usable, and reported the quote
  // as absent — a false accusation of fabrication caused by the reader, not the
  // publisher. The PDF spec expects a reader to scan for the header, and real
  // servers prepend BOMs and whitespace all the time.
  const headerAt = decoded.indexOf('%PDF-');
  const isPdf = headerAt >= 0 && headerAt < 1024;
  const text = isPdf ? pdfText(headerAt > 0 ? buf.subarray(headerAt) : buf) : textOf(decoded);
  return {
    ok: status >= 200 && status < 400,
    status,
    bytes: buf.length,
    shell: SPA_SHELL.test(decoded),
    isPdf,
    text,
    note: (isPdf && !text ? 'PDF with no text layer — needs OCR, cannot be gated' : '') + noteSuffix,
  };
}

async function fetchOnce(url: string): Promise<Fetched> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    return decodeBody(new Uint8Array(await res.arrayBuffer()), res.status);
  } catch (error) {
    return {
      ok: false, status: 0, bytes: 0, shell: false, isPdf: false, text: '',
      note: `fetch failed: ${(error as Error).message}`,
    };
  }
}

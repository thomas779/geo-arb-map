/**
 * The RTF reader, pinned against the three ways it was wrong before it worked.
 *
 * All three shared one failure mode: the gate reported a correct quote as ABSENT,
 * which in a report that exists to catch fabrication reads as an accusation. The
 * bug was always in the reader. Same shape as the `%PDF-`-at-a-nonzero-offset
 * defect, so these are regression tests, not coverage.
 */

import { describe, expect, test } from 'bun:test';
import { norm, rtfText } from '../scripts/lib/quote-gate';

/**
 * Encode Cyrillic as cp1251 `\'XX` escapes the way parliament.bg does. Derived
 * from the codepage's own А-я arithmetic (U+0410-U+044F → 0xC0-0xFF) rather than
 * read back off the table under test, so a wrong table cannot make this pass.
 */
function esc(text: string): string {
  return [...text]
    .map(ch => {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x80) return ch;
      if (cp >= 0x410 && cp <= 0x44f) {
        return `\\'${(cp - 0x410 + 0xc0).toString(16)}`;
      }
      throw new Error(`fixture needs a byte for ${ch}`);
    })
    .join('');
}

const HEADER = "{\\rtf1\\ansi\\ansicpg1251\\uc1\\deff0";
// The character-formatting run this file restarts constantly, including mid-word.
const RUN = '{\\rtlch\\fcs1\\af512\\ltrch\\fcs0\\f512\\fs28\\cf20\\insrsid15161240';

describe('rtfText', () => {
  test('decodes cp1251 body text rather than returning markup', () => {
    const out = rtfText(`${HEADER}${RUN} ${esc('чужденецът')}}}`);
    expect(norm(out)).toContain('чужденецът');
    expect(out).not.toContain('insrsid');
  });

  test('a hard wrap inside a word is not a space', () => {
    // parliament.bg wraps its bills at a column, mid-word: "Отказ\r\nва се".
    // Treating the break as whitespace split the word and the quote missed by
    // exactly that space. A bare CR/LF in an RTF body is ignorable.
    const out = rtfText(`${HEADER}${RUN} ${esc('Отказ')}\r\n${esc('ва се')}}}`);
    expect(norm(out)).toContain('Отказва се');
  });

  test('a control run inside a word is not a space either', () => {
    // Same two-space failure from the other direction: substituting ' ' for each
    // control word turned "пребиваване" into "пребивава не".
    const out = rtfText(`${HEADER}${RUN} ${esc('пребивава')}}${RUN} ${esc('не')}}}`);
    expect(norm(out)).toContain('пребиваване');
  });

  test('keeps the punctuation that quoted legal text is delimited by', () => {
    // 0x84/0x93 are „ and " in cp1251 — a table covering only А-я maps them to
    // nothing, and a quote lifted from the gazette carries them.
    const out = rtfText(`${HEADER}${RUN} \\'84${esc('24. се установи')}\\'93}}`);
    expect(out).toContain('„24. се установи“');
  });

  test('low escapes are ASCII, not filler', () => {
    // `\'2e` is a full stop. Blanking everything under 0xC0 ate the punctuation
    // that article numbers are made of.
    expect(rtfText(`${HEADER}${RUN} \\'61rt\\'2e 40}}`)).toContain('art. 40');
  });

  test('\\par is a line break and \\u carries non-Latin characters', () => {
    const out = rtfText(`${HEADER}${RUN} one\\par \\u1073 ?\\u1075 ?}}`);
    expect(out).toContain('\n');
    expect(norm(out)).toContain('бг');
  });

  test('drops destination groups, which are never body text', () => {
    const out = rtfText(`${HEADER}{\\*\\generator Riched20 10.0.19041}${RUN} real}}`);
    expect(out).toContain('real');
    expect(out).not.toContain('Riched20');
  });

  test('a non-Cyrillic codepage still reads its ASCII', () => {
    const out = rtfText(`{\\rtf1\\ansi\\ansicpg1252\\deff0${RUN} Act No. 22 of 2025}}`);
    expect(out).toContain('Act No. 22 of 2025');
  });
});

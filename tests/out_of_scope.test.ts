import { describe, test, expect } from 'bun:test';
import { outOfScopeVerdict } from '../monitor/triage/out-of-scope';
import { normalizeRulings, type DroppedLead } from '../monitor/triage/triage';
import { makeSignal } from '../monitor/schema/signal';

/** The seven leads actually closed as out of scope, verbatim from their titles. */
const CLOSED_AS_OUT_OF_SCOPE: Array<[string, string]> = [
  ['#148', 'United States of America: Employment authorization documents for individuals granted Temporary Protected Status (TPS) for Somalia have been extended through August 5, 2026.'],
  ['#149', 'United States of America: Employment authorization documents for individuals with Temporary Protected Status (TPS) for Burma have been extended through August 7, 2026.'],
  ['#173', 'United States of America: Employment authorization documents for individuals granted Temporary Protected Status for Somalia extended.'],
  ['#175', 'United States of America: A federal district court ruling affects TPS for El Salvador, Ukraine and Sudan.'],
  ['#178', 'multi: USCIS extended Temporary Protected Status (TPS) employment authorization documents for South Sudan through August 10, 2026, and for Ethiopia through August 19, 2026.'],
  ['#184', 'United States of America: DHS issued a final rule expanding the 9/11 response fee to H-1B and L-1 extension petitions filed by qualifying employers subject to the fee.'],
  ['#187', 'United States of America: USCIS announced the termination of Temporary Protected Status (TPS) for South Sudan, affecting work authorization validity.'],
];

/** Real leads that WERE in scope and must never be filtered. */
const KEPT: Array<[string, string]> = [
  ['#176 Gibraltar', 'Gibraltar increased the qualifying residency period required for permanent residency via the Gibraltarian Status (Amendment) Act 2026.'],
  ['#177 Syria', 'President Ahmed al-Sharaa issued Presidential Decree No. 13 of 2026 granting Syrian citizenship to residents of Kurdish origin.'],
  ['#180 Gibraltar', 'Gibraltar introduced the Residency Regulations 2026, establishing a new permit-based framework, with employment-based applicants requiring an employment contract paying at least £37,500.'],
  ['#185 UK', 'A higher standard of English is required to settle in the UK, and the qualifying period for settlement rises to 10 years.'],
  ['#179 US', 'A new executive order sets forth attempted restrictions on birthright citizenship and birth tourism.'],
];

describe('the seven leads this filter exists to stop', () => {
  for (const [issue, title] of CLOSED_AS_OUT_OF_SCOPE) {
    test(`${issue} is filtered`, () => {
      const verdict = outOfScopeVerdict(title);
      expect(verdict, `${issue} should be filtered but was not`).not.toBeNull();
    });
  }

  test('each is filtered for the right stated reason', () => {
    expect(outOfScopeVerdict(CLOSED_AS_OUT_OF_SCOPE[0]![1])?.reason).toBe('tps_or_ead');
    // #184 is a petition fee, not TPS, so it must match the fee rule specifically.
    expect(outOfScopeVerdict(CLOSED_AS_OUT_OF_SCOPE[5]![1])?.reason).toBe('temporary_status_fee');
  });

  test('a pre-publication proposal is filtered as such', () => {
    // #186: sent to OMB, no public text, nothing to verify against primary law.
    expect(outOfScopeVerdict(
      'DHS has sent a proposed rule to OMB seeking to eliminate the 60-day nonimmigrant '
      + 'grace period after employment ceases, pending public notice and comment.',
    )?.reason).toBe('pre_publication_proposal');
  });
});

describe('what it must never filter', () => {
  for (const [label, title] of KEPT) {
    test(`${label} survives`, () => {
      expect(outOfScopeVerdict(title), `${label} was wrongly filtered`).toBeNull();
    });
  }

  test('an investment threshold is never mistaken for a fee', () => {
    // The dangerous false positive: CBI and golden-visa prices DEFINE a route, so a
    // change to one is exactly what the atlas exists to track. Checked before the
    // fee rule so it cannot be lost to it.
    expect(outOfScopeVerdict(
      'Malta raised the citizenship-by-investment contribution and revised the petition fee.',
    )).toBeNull();
    expect(outOfScopeVerdict('Portugal golden visa fees increased for 2027')).toBeNull();
    expect(outOfScopeVerdict('Indonesia revised the naturalization fee schedule')).toBeNull();
  });

  test('the word "fee" alone does not filter anything', () => {
    // "fee" is far too common to match on its own; the rule is anchored to a
    // petition or nonimmigrant context.
    expect(outOfScopeVerdict('Ireland raised the citizenship application fee to EUR 1,000')).toBeNull();
    expect(outOfScopeVerdict('A new fee applies to residence permit renewals')).toBeNull();
  });

  test('empty or missing text is not a verdict', () => {
    expect(outOfScopeVerdict('')).toBeNull();
    expect(outOfScopeVerdict('   ')).toBeNull();
  });
});

describe('drops are reported, never silent', () => {
  // makeSignal derives the id by hashing sourceId:externalId, so the ruling has to
  // reference the generated value rather than a literal.
  const signal = () => makeSignal({
    externalId: 'ext-1',
    sourceId: 'test',
    tier: 'verification',
    jurisdiction: 'United States of America',
    title: 'test',
    url: 'https://example.gov/a',
    excerpt: '',
    publishedAt: '2026-08-08T00:00:00.000Z',
  });
  const ruling = (summary: string) => ({
    signal_id: signal().id,
    jurisdiction: 'United States of America',
    impact_type: 'status_or_right_granted',
    summary,
    confidence: 'high',
    needs_primary_source: false,
  });

  test('a filtered lead is pushed to the report with its reason', () => {
    // The safety story: the filter may be wrong, it may not be invisible.
    const dropped: DroppedLead[] = [];
    const leads = normalizeRulings(
      [ruling('USCIS extended Temporary Protected Status (TPS) employment authorization documents.')],
      [signal()], {}, {}, dropped,
    );
    expect(leads).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toBe('tps_or_ead');
    expect(dropped[0]!.matched).toBeTruthy();
    expect(dropped[0]!.signal_id).toBe(signal().id);
  });

  test('an in-scope lead is returned and nothing is dropped', () => {
    const dropped: DroppedLead[] = [];
    const leads = normalizeRulings(
      [ruling('Gibraltar raised the qualifying residence for Gibraltarian Status to twenty years.')],
      [signal()], {}, {}, dropped,
    );
    expect(leads).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  test('callers that do not ask for drops still work', () => {
    // The out-parameter is optional so existing call sites are untouched.
    expect(() => normalizeRulings([ruling('TPS extended')], [signal()], {}, {})).not.toThrow();
  });
});

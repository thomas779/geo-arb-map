import { describe, test, expect } from 'bun:test';
import {
  MATERIAL_WEIGHT_SHARE,
  MIN_RANKABLE_COMPLETENESS,
  rankAxis,
  scoreAxis,
  type Confidence,
  type DimensionScore,
} from '../scripts/lib/rights-score';

const dim = (
  id: string,
  weight: number,
  value: number | null,
  confidence: Confidence | null = value === null ? null : 'high',
): DimensionScore => ({ id, weight, value, confidence });

describe('unrecorded is never zero', () => {
  test('a null is excluded from the mean, not counted as 0', () => {
    // The rule the whole module exists for. Two dimensions at 80, one unrecorded:
    // the answer is 80, not 53. Treating the null as 0 would rank a country with
    // missing data below an identical country whose data we happen to hold.
    const result = scoreAxis([dim('a', 1, 80), dim('b', 1, 80), dim('c', 1, null)]);
    expect(result.score).toBe(80);
    expect(result.scored).toBe(2);
    expect(result.total).toBe(3);
  });

  test('a null never becomes a favourable default either', () => {
    // The mirror failure, and the more dangerous one for the downside dimensions:
    // no recorded conscription must not read as "no conscription". An unrecorded
    // obligation cannot lift the score any more than it can lower it.
    const withNull = scoreAxis([dim('rights', 1, 60), dim('obligations', 1, null)]);
    const withGood = scoreAxis([dim('rights', 1, 60), dim('obligations', 1, 100)]);
    expect(withNull.score).toBe(60);
    expect(withGood.score).toBe(80);
    expect(withNull.score).toBeLessThan(withGood.score!);
    expect(withNull.missing).toEqual(['obligations']);
  });

  test('nothing recorded yields null, not zero', () => {
    const result = scoreAxis([dim('a', 1, null), dim('b', 2, null)]);
    expect(result.score).toBeNull();
    expect(result.completeness).toBe(0);
    expect(result.confidence).toBeNull();
    expect(result.rankable).toBe(false);
    // Absence of evidence must be distinguishable from a measured zero.
    const measuredZero = scoreAxis([dim('a', 1, 0)]);
    expect(measuredZero.score).toBe(0);
    expect(measuredZero.completeness).toBe(1);
  });

  test('weights renormalise over the scored dimensions', () => {
    // A heavy null must not drag the mean toward its neighbours' weights either.
    const result = scoreAxis([dim('heavy', 9, null), dim('light', 1, 42)]);
    expect(result.score).toBe(42);
    // But completeness records that 90% of the weight is missing.
    expect(result.completeness).toBeCloseTo(0.1, 10);
    expect(result.rankable).toBe(false);
  });
});

describe('completeness travels with the score', () => {
  test('completeness is a weight share, not a count', () => {
    // A missing heavy dimension matters more than a missing light one, so counting
    // dimensions would understate the damage.
    const result = scoreAxis([dim('a', 7, 50), dim('b', 1, null), dim('c', 1, null), dim('d', 1, null)]);
    expect(result.scored).toBe(1);
    expect(result.total).toBe(4);
    expect(result.completeness).toBeCloseTo(0.7, 10);
  });

  test('a high score on thin data is reported but not rankable', () => {
    // This looks like a bug until you see the alternative. Renormalising means a
    // country measured only on its best dimension scores high, so `rankable` is
    // what stops it appearing above a fully-measured country in a league table.
    const thin = scoreAxis([dim('best', 1, 100), dim('b', 1, null), dim('c', 1, null)]);
    expect(thin.score).toBe(100);
    expect(thin.completeness).toBeCloseTo(1 / 3, 10);
    expect(thin.rankable).toBe(false);
  });

  test('the rankable floor is exactly at the boundary, not above it', () => {
    const atFloor = scoreAxis([dim('a', 1, 50), dim('b', 1, null)]);
    expect(atFloor.completeness).toBe(MIN_RANKABLE_COMPLETENESS);
    expect(atFloor.rankable).toBe(true);
  });
});

describe('a composite cannot outrank its weakest material input', () => {
  test('confidence is the weakest among material dimensions', () => {
    const result = scoreAxis([
      dim('a', 1, 90, 'high'),
      dim('b', 1, 90, 'medium'),
    ]);
    expect(result.confidence).toBe('medium');
    expect(result.confidenceMix.high).toBeCloseTo(0.5, 10);
    expect(result.confidenceMix.medium).toBeCloseTo(0.5, 10);
  });

  test('nineteen strong inputs cannot launder one weak material input', () => {
    const dims = Array.from({ length: 19 }, (_, i) => dim(`s${i}`, 1, 100, 'high'));
    // 19 high at weight 1 each, one low at weight 5 = 5/24 share, above the floor.
    const result = scoreAxis([...dims, dim('weak', 5, 100, 'low')]);
    expect(result.confidence).toBe('low');
  });

  test('an immaterial weak input does not brand the whole composite', () => {
    // Without this floor, authors would be pushed to DROP weak dimensions to keep
    // a decent label, which loses information. The mix stays auditable either way.
    const result = scoreAxis([
      dim('main', 100, 90, 'high'),
      dim('sliver', 1, 90, 'low'),
    ]);
    expect(1 / 101).toBeLessThan(MATERIAL_WEIGHT_SHARE);
    expect(result.confidence).toBe('high');
    expect(result.confidenceMix.low).toBeGreaterThan(0);
  });

  test('when every dimension is immaterial a confidence is still reported', () => {
    // 20 equal dimensions are each 5%, below the 10% floor. Returning null here
    // would say "no confidence" about a fully scored axis.
    const dims = Array.from({ length: 20 }, (_, i) => dim(`d${i}`, 1, 50, i === 0 ? 'low' : 'high'));
    const result = scoreAxis(dims);
    expect(result.completeness).toBe(1);
    expect(result.confidence).toBe('low');
  });
});

describe('malformed dimensions fail the build rather than scoring', () => {
  test('a value without confidence is rejected', () => {
    expect(() => scoreAxis([{ id: 'a', weight: 1, value: 50, confidence: null }]))
      .toThrow(/has a value but no confidence/);
  });

  test('confidence on an unrecorded value is rejected', () => {
    // Claiming confidence about something we did not record is the precise error
    // that lets absence masquerade as a finding.
    expect(() => scoreAxis([{ id: 'a', weight: 1, value: null, confidence: 'high' }]))
      .toThrow(/no value but claims confidence/);
  });

  test('out-of-range and non-finite values are rejected', () => {
    expect(() => scoreAxis([dim('a', 1, 101)])).toThrow(/must be 0\.\.100/);
    expect(() => scoreAxis([dim('a', 1, -1)])).toThrow(/must be 0\.\.100/);
    expect(() => scoreAxis([dim('a', 1, NaN)])).toThrow(/must be 0\.\.100/);
  });

  test('zero, negative and infinite weights are rejected', () => {
    expect(() => scoreAxis([dim('a', 0, 50)])).toThrow(/positive finite weight/);
    expect(() => scoreAxis([dim('a', -1, 50)])).toThrow(/positive finite weight/);
    expect(() => scoreAxis([dim('a', Infinity, 50)])).toThrow(/positive finite weight/);
  });

  test('a duplicate dimension id is rejected', () => {
    // Otherwise a copy-paste in the weight table silently double-counts.
    expect(() => scoreAxis([dim('a', 1, 50), dim('a', 1, 90)])).toThrow(/Duplicate dimension a/);
  });
});

describe('ranking refuses to compare unlike things', () => {
  test('unrankable entries sort after every rankable one, regardless of score', () => {
    const ranked = rankAxis([
      { key: 'thin-but-perfect', axis: scoreAxis([dim('a', 1, 100), dim('b', 1, null), dim('c', 1, null)]) },
      { key: 'measured-and-good', axis: scoreAxis([dim('a', 1, 70), dim('b', 1, 70), dim('c', 1, 70)]) },
      { key: 'measured-and-poor', axis: scoreAxis([dim('a', 1, 10), dim('b', 1, 10), dim('c', 1, 10)]) },
    ]);
    expect(ranked.map(entry => entry.key)).toEqual([
      'measured-and-good',
      'measured-and-poor',
      'thin-but-perfect',
    ]);
    expect(ranked.map(entry => entry.rank)).toEqual([1, 2, null]);
  });

  test('ties break deterministically so the artifact is reproducible', () => {
    const tie = () => scoreAxis([dim('a', 1, 50), dim('b', 1, 50)]);
    const ranked = rankAxis([{ key: 'zzz', axis: tie() }, { key: 'aaa', axis: tie() }]);
    expect(ranked.map(entry => entry.key)).toEqual(['aaa', 'zzz']);
  });

  test('a country with nothing recorded is returned, not dropped', () => {
    // Silently omitting it would read as "we checked and it has no rights".
    const ranked = rankAxis([
      { key: 'unknown', axis: scoreAxis([dim('a', 1, null)]) },
      { key: 'known', axis: scoreAxis([dim('a', 1, 50)]) },
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked.find(entry => entry.key === 'unknown')?.rank).toBeNull();
    expect(ranked.find(entry => entry.key === 'unknown')?.axis.score).toBeNull();
  });
});

describe('the two axes stay apart', () => {
  test('scoreAxis has no way to blend two axes', () => {
    // Structural, not a convention: there is no combine() to reach for, so the
    // spec rule that Axis A and Axis B never merge cannot be broken by accident.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require('../scripts/lib/rights-score') as Record<string, unknown>;
    const exported = Object.keys(module).sort();
    expect(exported).toEqual([
      'CONFIDENCE_ORDER',
      'MATERIAL_WEIGHT_SHARE',
      'MIN_RANKABLE_COMPLETENESS',
      'rankAxis',
      'scoreAxis',
    ]);
  });
});

import { describe, test, expect } from 'bun:test';
import { effectiveConfidence, unsupportedHighClaims, type RouteClaim } from '../scripts/lib/claim-confidence';
import { scoreAxis } from '../scripts/lib/rights-score';

const claim = (
  id: string,
  confidence: RouteClaim['confidence'],
  sourced = true,
): RouteClaim => ({
  id,
  statement: `claim ${id}`,
  confidence,
  source_refs: sourced ? [{ source_id: 'source:x', supports_fields: ['/summary'] }] : [],
});

describe('the Nepal case this exists for', () => {
  test('a statutory core stays high while a press-reported detail lowers what is shown', () => {
    // s. 3(1) descent is high from the 2006 Act; the Fourth Amendment procedure is
    // press-reported. Previously the author could only downgrade the whole route or
    // hedge in prose, and prose does not survive extraction into a country slice.
    const result = effectiveConfidence('high', [claim('fourth-amendment', 'medium', false)]);
    expect(result.route).toBe('high');
    expect(result.effective).toBe('medium');
    expect(result.weakenedBy.map(c => c.id)).toEqual(['fourth-amendment']);
  });

  test('an unsourced claim is reported as such, not merely as weak', () => {
    // Empty source_refs is legal and meaningful: it records that a claim rests on
    // nothing registered. Surfacing it separately stops that being discovered only
    // when someone re-reads the note.
    const result = effectiveConfidence('high', [claim('a', 'medium', false), claim('b', 'medium')]);
    expect(result.unsourced.map(c => c.id)).toEqual(['a']);
  });
});

describe('a claim can only ever lower what a consumer sees', () => {
  test('a high claim never raises a medium route', () => {
    // The asymmetry is deliberate. A high-confidence footnote on a medium route
    // tells you nothing useful; the reverse is the case that must be visible.
    expect(effectiveConfidence('medium', [claim('a', 'high')]).effective).toBe('medium');
  });

  test('the weakest claim wins, not the average or the last', () => {
    const result = effectiveConfidence('high', [
      claim('a', 'high'), claim('b', 'low'), claim('c', 'medium'),
    ]);
    expect(result.effective).toBe('low');
  });

  test('no claims leaves the badge untouched', () => {
    // Nothing changes until a claim is authored, so this cannot silently move
    // existing routes.
    expect(effectiveConfidence('high').effective).toBe('high');
    expect(effectiveConfidence('high', []).effective).toBe('high');
    expect(effectiveConfidence('low', []).weakenedBy).toEqual([]);
  });

  test('claims at or above the badge are not listed as weakening it', () => {
    const result = effectiveConfidence('medium', [claim('a', 'medium'), claim('b', 'high')]);
    expect(result.weakenedBy).toEqual([]);
    expect(result.effective).toBe('medium');
  });
});

describe('the authoring guard', () => {
  test('a high claim with no source is flagged', () => {
    // High confidence resting on nothing registered is the combination that let a
    // fabricated citation look settled.
    expect(unsupportedHighClaims([claim('a', 'high', false)]).map(c => c.id)).toEqual(['a']);
  });

  test('a low or medium claim with no source is allowed', () => {
    // Recording an unsourced claim honestly at medium is the intended use; only
    // claiming HIGH without evidence is the error.
    expect(unsupportedHighClaims([claim('a', 'medium', false), claim('b', 'low', false)]))
      .toEqual([]);
  });

  test('a sourced high claim is fine', () => {
    expect(unsupportedHighClaims([claim('a', 'high')])).toEqual([]);
  });
});

describe('it closes the gap under the index confidence model', () => {
  test('the composite floor is only as good as the granularity beneath it', () => {
    // docs/rights-index-spec.md requires a composite not to outrank its weakest
    // material input, and rights-score implements that. But feeding it a per-route
    // badge that has already averaged over strong and weak claims launders the
    // weakness one level down. Feeding the EFFECTIVE value restores the floor.
    const laundered = scoreAxis([
      { id: 'a', weight: 1, value: 80, confidence: 'high' },   // Nepal's badge
    ]);
    const honest = scoreAxis([
      { id: 'a', weight: 1, value: 80, confidence: 'medium' }, // Nepal's effective
    ]);
    expect(laundered.confidence).toBe('high');
    expect(honest.confidence).toBe('medium');
    // Same score, different confidence: the number was never the problem.
    expect(laundered.score).toBe(honest.score);
  });
});

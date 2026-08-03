import { describe, expect, test } from 'bun:test';
import {
  assertPromotionPreservesHead,
  promotionRegressions,
  type PromotionArtifact,
} from '../scripts/lib/promotion-guard';

function artifact(overrides: Partial<PromotionArtifact> = {}): PromotionArtifact {
  return {
    jurisdictions: [{
      iso_n3: '620',
      coverage: {
        ancestry: 'reviewed',
        naturalization: 'reviewed',
        birth: 'reviewed',
        investment: 'reviewed',
      },
    }],
    routes: [{ id: 'portugal-naturalization' }],
    residence_routes: [{ id: 'portugal-d8-digital-nomad' }],
    ...overrides,
  };
}

describe('data promotion reconciliation guard', () => {
  test('accepts additions and edits that preserve committed identities and reviewed coverage', () => {
    const candidate = artifact({
      routes: [{ id: 'portugal-naturalization' }, { id: 'portugal-citizenship-by-parent' }],
      residence_routes: [{ id: 'portugal-d8-digital-nomad' }, { id: 'portugal-d7-passive-income' }],
    });
    expect(promotionRegressions(artifact(), candidate)).toEqual([]);
    expect(() => assertPromotionPreservesHead(artifact(), candidate)).not.toThrow();
  });

  test('blocks a stale candidate that removes committed citizenship or residence routes', () => {
    const candidate = artifact({ routes: [], residence_routes: [] });
    expect(promotionRegressions(artifact(), candidate)).toEqual([
      { kind: 'citizenship_route_removed', id: 'portugal-naturalization' },
      { kind: 'residence_route_removed', id: 'portugal-d8-digital-nomad' },
    ]);
    expect(() => assertPromotionPreservesHead(artifact(), candidate))
      .toThrow(/Reconcile the private canonical source/);
  });

  test('blocks reviewed coverage falling back to unchecked or disappearing', () => {
    const candidate = artifact({
      jurisdictions: [{
        iso_n3: '620',
        coverage: {
          ancestry: 'reviewed',
          naturalization: 'unchecked',
          birth: 'reviewed',
          investment: 'reviewed',
        },
      }],
    });
    expect(promotionRegressions(artifact(), candidate)).toContainEqual({
      kind: 'coverage_downgraded',
      id: '620:naturalization',
      before: 'reviewed',
      after: 'unchecked',
    });
  });
});

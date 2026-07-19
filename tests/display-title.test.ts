import { describe, expect, test } from 'bun:test';
import { displayRouteTitle } from '../src/lib/display-title';

describe('route display titles', () => {
  test('moves trailing legal years out of scan-level labels', () => {
    expect(displayRouteTitle('Italy jure sanguinis (post-2025)'))
      .toBe('Italy jure sanguinis');
    expect(displayRouteTitle('India-Nepal Treaty (1950)'))
      .toBe('India-Nepal Treaty');
    expect(displayRouteTitle('Argentina-Spain Nationality Convention (1969, 2001 protocol)'))
      .toBe('Argentina-Spain Nationality Convention');
  });

  test('removes inline instrument years without changing other numbers', () => {
    expect(displayRouteTitle('France-Algeria 1968 Accord'))
      .toBe('France-Algeria Accord');
    expect(displayRouteTitle('South Korea F-4 Overseas Korean visa'))
      .toBe('South Korea F-4 Overseas Korean visa');
  });
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { entitySlug, buildEntitySlugToId } from '../src/lib/slug';
import type { BlocsData } from '../src/types';

// Every bloc gets a /rights/<slug> page. Heritage /route pages were dissolved —
// ancestry and diaspora programmes live on country pages instead.
const data = JSON.parse(
  readFileSync(new URL('../public/blocs_data.json', import.meta.url), 'utf8'),
) as BlocsData;

describe('rights page slugs', () => {
  test('bloc slugs are unique', () => {
    const slugs = data.blocs.map(b => entitySlug(b.id));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('lane slugs are unique', () => {
    const slugs = data.bilateral_lanes.map(l => entitySlug(l.id));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('slug → id round-trips for blocs and lanes', () => {
    const blocRev = buildEntitySlugToId(data.blocs);
    for (const b of data.blocs) expect(blocRev.get(entitySlug(b.id))).toBe(b.id);
    const laneRev = buildEntitySlugToId(data.bilateral_lanes);
    for (const l of data.bilateral_lanes) expect(laneRev.get(entitySlug(l.id))).toBe(l.id);
  });

  test('no empty-beneficiary heritage lanes remain', () => {
    const heritage = data.bilateral_lanes.filter(l => l.beneficiaries.length === 0);
    expect(heritage).toEqual([]);
  });
});

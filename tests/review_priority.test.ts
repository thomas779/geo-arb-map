import { describe, expect, test } from 'bun:test';

interface RegistryMember {
  iso_n3: string;
  name: string;
}

interface ReviewPriority {
  mode_order: string[];
  signals: string[];
  batches: Array<{
    id: string;
    jurisdictions: Array<{
      iso_n3: string;
      name: string;
      signals: string[];
    }>;
  }>;
}

const registry = await Bun.file(
  new URL('../data/registry.json', import.meta.url),
).json() as {
  sovereigns: RegistryMember[];
  territories: RegistryMember[];
};
const priority = await Bun.file(
  new URL('../data/review_priority.json', import.meta.url),
).json() as ReviewPriority;

describe('country review priority', () => {
  test('uses the four canonical acquisition modes', () => {
    expect(priority.mode_order).toEqual([
      'ancestry',
      'naturalization',
      'birth',
      'investment',
    ]);
  });

  test('references each registered jurisdiction at most once', () => {
    const registryByIso = new Map(
      [...registry.sovereigns, ...registry.territories]
        .map(item => [item.iso_n3, item.name]),
    );
    const seen = new Set<string>();
    for (const batch of priority.batches) {
      for (const jurisdiction of batch.jurisdictions) {
        expect(seen.has(jurisdiction.iso_n3), jurisdiction.iso_n3).toBe(false);
        expect(registryByIso.has(jurisdiction.iso_n3), jurisdiction.iso_n3).toBe(true);
        expect(jurisdiction.signals.length).toBeGreaterThan(0);
        expect(jurisdiction.signals.every(signal => priority.signals.includes(signal)))
          .toBe(true);
        seen.add(jurisdiction.iso_n3);
      }
    }
  });
});

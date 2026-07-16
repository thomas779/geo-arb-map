import { describe, test, expect } from 'bun:test';
import type { BlocsData, Bloc, BilateralLane } from '../src/types';

/**
 * Regression + invariant tests for the dataset.
 *
 * Validator choice: hand-rolled, not zod. The shapes are shallow (strings,
 * {name, iso_n3} arrays, small enums) and the failure modes we care about
 * (missing field, wrong enum, malformed ISO) are one-line asserts. Zod would
 * add a dependency plus a second, parallel definition of every type that can
 * drift from src/types.ts exactly as silently as a hand-rolled check — with
 * worse error locality in test output.
 */

const data = (await Bun.file(
  new URL('../public/blocs_data.json', import.meta.url),
).json()) as BlocsData;

const coverage = (await Bun.file(
  new URL('../public/coverage.json', import.meta.url),
).json()) as { rows: Array<{ iso_n3: string; type: string }> };

const ISO_RE = /^\d{3}$/;
const CATEGORIES = ['full', 'partial', 'hub_spoke', 'one_way', 'closed', 'proto'];
const ALLOCATIONS = ['right', 'ballot', 'quota_queue', 'discretionary'];

function memberOk(m: { name: string; iso_n3: string }, ctx: string) {
  expect(typeof m.name, `${ctx}: member name`).toBe('string');
  expect(m.iso_n3, `${ctx}: iso_n3 "${m.iso_n3}"`).toMatch(ISO_RE);
}

describe('regression: Russia dual-citizenship correction', () => {
  test('dual_citizenship.countries["643"].status is "allowed"', () => {
    expect(data.dual_citizenship?.countries['643']?.status).toBe('allowed');
  });

  test('no bloc claims Russia requires renunciation', () => {
    for (const b of data.blocs) {
      for (const text of [b.notes, b.fastest_entry]) {
        expect(text ?? '', `bloc ${b.id}`).not.toMatch(/Russia[^.]*requires renunciation/i);
      }
    }
  });
});

describe('schema conformance (mirrors src/types.ts)', () => {
  test('meta block', () => {
    expect(typeof data.meta.title).toBe('string');
    expect(data.meta.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof data.meta.disclaimer).toBe('string');
    for (const x of data.meta.excluded ?? []) {
      expect(typeof x.name).toBe('string');
      expect(typeof x.reason).toBe('string');
    }
  });

  test('blocs', () => {
    for (const b of data.blocs as Bloc[]) {
      const ctx = `bloc ${b.id}`;
      expect(typeof b.id, ctx).toBe('string');
      expect(typeof b.name, ctx).toBe('string');
      expect(CATEGORIES, `${ctx}: category "${b.category}"`).toContain(b.category);
      expect(b.color, ctx).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(b.members.length, ctx).toBeGreaterThan(0);
      b.members.forEach(m => memberOk(m, ctx));
      b.former_members?.forEach(m => memberOk(m, `${ctx} (former)`));
      for (const tier of ['TR', 'PR', 'CIT'] as const) {
        expect(typeof b.rights[tier], `${ctx}: rights.${tier}`).toBe('string');
      }
      expect(typeof b.fastest_entry, ctx).toBe('string');
      b.sub_bloc?.members_iso.forEach(iso =>
        expect(iso, `${ctx}: sub_bloc iso`).toMatch(ISO_RE));
    }
  });

  test('bilateral lanes', () => {
    for (const l of data.bilateral_lanes as BilateralLane[]) {
      const ctx = `lane ${l.id}`;
      expect(typeof l.id, ctx).toBe('string');
      expect(l.color, ctx).toMatch(/^#[0-9A-Fa-f]{6}$/);
      memberOk(l.destination, `${ctx} (destination)`);
      l.beneficiaries.forEach(m => memberOk(m, `${ctx} (beneficiary)`));
      expect(typeof l.grants, ctx).toBe('string');
      expect(typeof l.limits, ctx).toBe('string');
      expect(typeof l.leads_to_settlement, ctx).toBe('boolean');
      if (l.allocation !== undefined) {
        expect(ALLOCATIONS, `${ctx}: allocation "${l.allocation}"`).toContain(l.allocation);
      }
    }
  });

  test('dual_citizenship block', () => {
    const dc = data.dual_citizenship!;
    for (const [iso, policy] of Object.entries(dc.countries)) {
      expect(iso, `dual_citizenship country key`).toMatch(ISO_RE);
      expect(['allowed', 'banned', 'conditional'], `policy ${iso}`).toContain(policy.status);
    }
    for (const t of dc.treaty_exceptions) {
      t.parties.forEach(p => memberOk(p, `treaty ${t.id}`));
    }
  });

  test('pending_verification entries carry confidence + reason', () => {
    for (const p of data.pending_verification ?? []) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.confidence).toBe('string');
      expect(typeof p.reason).toBe('string');
    }
  });
});

describe('referential integrity', () => {
  test('every stacking_plays bloc id exists in blocs or lanes', () => {
    const known = new Set([
      ...data.blocs.map(b => b.id),
      ...data.bilateral_lanes.map(l => l.id),
    ]);
    for (const play of data.stacking_plays) {
      for (const id of play.blocs) {
        expect(known.has(id), `stacking play "${play.passport}" references "${id}"`).toBe(true);
      }
    }
  });

  test('identity lanes (empty beneficiaries) always have beneficiaries_note', () => {
    for (const l of data.bilateral_lanes) {
      if (l.beneficiaries.length === 0) {
        expect(typeof l.beneficiaries_note, `lane ${l.id}`).toBe('string');
        expect(l.beneficiaries_note!.length, `lane ${l.id}`).toBeGreaterThan(0);
      }
    }
  });

  test('lanes whose text mentions ballot/quota carry an explicit allocation', () => {
    // Negated mentions ("no ballot") are legitimate, so we only require the
    // allocation to be stated explicitly — a text/flag mismatch then needs a
    // deliberate data edit rather than slipping through as an implicit default.
    for (const l of data.bilateral_lanes) {
      if (/\bballot|quota\b/i.test(`${l.grants} ${l.limits}`)) {
        expect(l.allocation, `lane ${l.id} mentions ballot/quota but has no explicit allocation`).toBeDefined();
      }
    }
  });
});

describe('coverage.json', () => {
  test('rows have unique iso_n3', () => {
    const seen = new Set<string>();
    for (const r of coverage.rows) {
      expect(seen.has(r.iso_n3), `duplicate coverage row ${r.iso_n3}`).toBe(false);
      seen.add(r.iso_n3);
    }
  });

  test('non-special rows use numeric iso_n3', () => {
    for (const r of coverage.rows) {
      if (r.type !== 'special') {
        expect(r.iso_n3, `coverage row ${r.iso_n3}`).toMatch(ISO_RE);
      }
    }
  });
});

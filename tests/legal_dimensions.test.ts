import { describe, expect, test } from 'bun:test';
import {
  JurisdictionRecordSchema,
  ResidenceRouteSchema,
  RouteSchema,
} from '../scripts/lib/canonical-schema';

const sourceRef = {
  source_id: 'source:official-law',
  supports_fields: ['/routes[id=test-route]'],
};

const variant = {
  id: 'variant:test',
  label: 'Principal route',
  outcome: 'citizenship' as const,
  allocation: 'right' as const,
  eligibility: [],
  milestones: [],
  timeline: {
    eligibility_minimum_months: null,
    processing_typical_months: null,
    confidence: 'high' as const,
  },
  source_refs: [sourceRef],
};

function route(mode: 'ancestry' | 'naturalization' | 'birth' | 'investment') {
  return {
    id: 'test-route',
    mode,
    status: 'active' as const,
    title: 'Test route',
    summary: 'A schema fixture for a reviewed legal route.',
    effective: { from: null, to: null, supersedes: [] },
    review: { state: 'reviewed' as const, confidence: 'high' as const, last_checked: '2026-08-02' },
    variants: [variant],
  };
}

describe('typed legal dimensions', () => {
  test('accepts evidence-backed nationality eligibility on investment routes', () => {
    const result = RouteSchema.safeParse({
      ...route('investment'),
      nationality_eligibility: {
        kind: 'treaty_list',
        included_iso_n3: ['036', '124'],
        excluded_iso_n3: [],
        detail: 'Only nationals of listed treaty states qualify.',
        source_refs: [sourceRef],
      },
    });
    expect(result.success).toBe(true);
  });

  test('rejects nationality eligibility on non-investment citizenship routes', () => {
    const result = RouteSchema.safeParse({
      ...route('naturalization'),
      nationality_eligibility: {
        kind: 'open',
        included_iso_n3: [],
        excluded_iso_n3: [],
        detail: 'No nationality restriction is stated.',
        source_refs: [sourceRef],
      },
    });
    expect(result.success).toBe(false);
  });

  test('keeps parent effects on birth routes and transmission on birth or ancestry routes', () => {
    expect(RouteSchema.safeParse({
      ...route('birth'),
      parent_residence_right: {
        exists: true,
        wait_months: 12,
        leads_to_citizenship: true,
        instrument: 'Nationality Act section 12',
        source_refs: [sourceRef],
      },
      transmission_abroad: {
        kind: 'registration_required',
        detail: 'A consular registration is required for a child born abroad.',
        source_refs: [sourceRef],
      },
    }).success).toBe(true);

    expect(RouteSchema.safeParse({
      ...route('naturalization'),
      parent_residence_right: {
        exists: false,
        wait_months: null,
        leads_to_citizenship: false,
        instrument: 'Nationality Act section 12',
        source_refs: [sourceRef],
      },
    }).success).toBe(false);
  });

  test('requires internally consistent, sourced nationality lists and negative parent findings', () => {
    expect(RouteSchema.safeParse({
      ...route('investment'),
      nationality_eligibility: {
        kind: 'open',
        included_iso_n3: ['124'],
        excluded_iso_n3: [],
        detail: 'Contradictory fixture.',
        source_refs: [sourceRef],
      },
    }).success).toBe(false);

    expect(RouteSchema.safeParse({
      ...route('birth'),
      parent_residence_right: {
        exists: false,
        wait_months: 12,
        leads_to_citizenship: true,
        instrument: 'Contradictory fixture',
        source_refs: [sourceRef],
      },
    }).success).toBe(false);
  });

  test('supports nationality eligibility on residence routes', () => {
    const result = ResidenceRouteSchema.safeParse({
      id: 'residence:test',
      category: 'investment',
      status: 'active',
      title: 'Investor residence',
      summary: 'A schema fixture for a residence route.',
      effective: { from: null, to: null, supersedes: [] },
      review: { state: 'reviewed', confidence: 'high', last_checked: '2026-08-02' },
      counts_toward_permanent_residence: true,
      counts_toward_naturalization: true,
      min_investment: null,
      min_income_monthly: null,
      physical_presence_days_per_year: null,
      nationality_eligibility: {
        kind: 'exclusions',
        included_iso_n3: [],
        excluded_iso_n3: ['408'],
        detail: 'Nationals of the listed state are excluded.',
        source_refs: [sourceRef],
      },
      variants: [{ ...variant, outcome: 'residence' }],
    });
    expect(result.success).toBe(true);
  });

  test('records dual-nationality policy at jurisdiction level', () => {
    const modes = ['ancestry', 'naturalization', 'birth', 'investment'] as const;
    const result = JurisdictionRecordSchema.safeParse({
      schema_version: 2,
      entity_type: 'jurisdiction',
      id: 'jurisdiction:999',
      jurisdiction: { iso_n3: '999', name: 'Testland', type: 'sovereign' },
      review: { state: 'reviewed', confidence: 'high', last_checked: '2026-08-02' },
      coverage: modes.map(mode => ({
        mode,
        finding: 'unknown',
        review: { state: 'unchecked', confidence: 'low', last_checked: null },
        source_refs: [],
      })),
      routes: [],
      dual_nationality: {
        status: 'conditional',
        detail: 'Retention depends on the acquisition pathway.',
        source_refs: [sourceRef],
      },
    });
    expect(result.success).toBe(true);
  });
});

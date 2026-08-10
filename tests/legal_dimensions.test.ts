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

  const jurisdictionWith = (dual_nationality: unknown) => {
    const modes = ['ancestry', 'naturalization', 'birth', 'investment'] as const;
    return JurisdictionRecordSchema.safeParse({
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
      dual_nationality,
    });
  };

  const silentLimb = { effect: 'unknown', conditions: [], detail: '' };
  const plurality = (overrides: Record<string, unknown> = {}) => ({
    status: 'conditional',
    provenance: 'instrument',
    retention: {
      by_birth: { effect: 'permitted', conditions: [], detail: 'Cannot be deprived.' },
      by_naturalisation: { effect: 'automatic_loss', conditions: [], detail: 'Loses on acquisition.' },
    },
    acquisition: { effect: 'unknown', conditions: [], detail: 'Not read.' },
    asymmetry: {
      present: 'yes',
      basis: ['birth_vs_naturalised'],
      note: 'The same act costs one class their status and the other nothing.',
    },
    detail: 'Retention depends on how the nationality is held.',
    source_refs: [sourceRef],
    ...overrides,
  });

  test('records dual-nationality policy at jurisdiction level, split by limb', () => {
    expect(jurisdictionWith(plurality()).success).toBe(true);
  });

  test('retention limbs that differ must be recorded as an asymmetry', () => {
    // The Paraguay case: natural-born and naturalised sit under opposite regimes.
    // Writing the split into the limbs and then claiming there is none is the exact
    // half-truth the flat enum used to force.
    const result = jurisdictionWith(plurality({
      asymmetry: { present: 'no', basis: [], note: 'No split.' },
    }));
    expect(result.success).toBe(false);
  });

  test('a status may not outrun the limbs that support it', () => {
    // Every limb unknown is a row that says nothing, and it must not be able to
    // claim a finding — absence and `unknown` are not a negative finding.
    expect(jurisdictionWith(plurality({
      status: 'prohibited',
      retention: { by_birth: silentLimb, by_naturalisation: silentLimb },
      acquisition: silentLimb,
      asymmetry: { present: 'unknown', basis: [], note: 'Not examined.' },
    })).success).toBe(false);

    // And `allowed` cannot sit on top of a restrictive limb.
    expect(jurisdictionWith(plurality({ status: 'allowed' })).success).toBe(false);
  });

  test('Cuba-shaped non-exercise is expressible without being forced to an end', () => {
    const limb = {
      effect: 'non_exercise',
      conditions: ['inside_national_territory'],
      detail: 'Citizenship is kept; the foreign one may not be used in the territory.',
    };
    expect(jurisdictionWith(plurality({
      retention: { by_birth: limb, by_naturalisation: limb },
      asymmetry: { present: 'yes', basis: ['public_office'], note: 'Office-holding only.' },
    })).success).toBe(true);
  });

  test('an unsourced legacy import may carry a status and prose, and nothing else', () => {
    const legacy = {
      status: 'prohibited',
      provenance: 'legacy_import',
      retention: { by_birth: silentLimb, by_naturalisation: silentLimb },
      acquisition: silentLimb,
      asymmetry: { present: 'unknown', basis: [], note: 'Never examined.' },
      detail: 'UNVERIFIED import from the retired blocs_data model.',
      source_refs: [],
    };
    expect(jurisdictionWith(legacy).success).toBe(true);

    // It must not be able to grow limbs it never read...
    expect(jurisdictionWith({
      ...legacy,
      acquisition: { effect: 'renunciation_required', conditions: [], detail: 'Asserted.' },
    }).success).toBe(false);
    // ...nor borrow a source record it does not have.
    expect(jurisdictionWith({ ...legacy, source_refs: [sourceRef] }).success).toBe(false);
    // And an instrument row without a source is not a row.
    expect(jurisdictionWith(plurality({ source_refs: [] })).success).toBe(false);
  });
});

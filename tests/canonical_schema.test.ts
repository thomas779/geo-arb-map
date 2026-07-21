import { describe, expect, test } from 'bun:test';
import {
  CANONICAL_SCHEMAS,
  ChangeProposalSchema,
} from '../scripts/lib/canonical-schema';
import { buildCanonicalPilot } from '../scripts/lib/canonical-pilot';

const pilot = buildCanonicalPilot();

describe('canonical data schemas', () => {
  test('all pilot candidates validate against executable schemas', () => {
    for (const source of pilot.sources) {
      expect(CANONICAL_SCHEMAS.source.safeParse(source).success).toBe(true);
    }
    for (const jurisdiction of pilot.jurisdictions) {
      expect(CANONICAL_SCHEMAS.jurisdiction.safeParse(jurisdiction).success).toBe(true);
    }
    for (const arrangement of pilot.arrangements) {
      expect(CANONICAL_SCHEMAS.arrangement.safeParse(arrangement).success).toBe(true);
    }
  });

  test('keeps one jurisdiction identity and preserves existing route IDs while adding reviewed routes', () => {
    const routeIds = pilot.jurisdictions.flatMap(item => item.routes.map(route => route.id));
    expect(routeIds).toEqual([
      'antigua-barbuda-citizenship-by-parent',
      'antigua-barbuda-naturalization',
      'antigua-barbuda-citizenship-by-birth',
      'antigua-barbuda-cip',
      'argentina-citizenship-by-parent',
      'argentina-naturalization-after-residence',
      'argentina-citizenship-by-birth',
      'argentina-relevant-investment-citizenship',
      'australia-citizenship-by-descent',
      'australia-citizenship-by-conferral',
      'australia-citizenship-by-birth',
      'bahamas-citizenship-by-parent',
      'bahamas-naturalization',
      'bahamas-citizenship-connected-to-birth',
      'barbados-citizenship-by-parent',
      'barbados-naturalization',
      'barbados-citizenship-by-birth',
      'brazil-citizenship-by-parent',
      'brazil-naturalization-by-residence',
      'brazil-citizenship-by-birth',
      'bulgaria-bulgarian-origin-naturalization',
      'bulgaria-ordinary-naturalization',
      'bulgaria-citizenship-by-birth-statelessness',
      'bulgaria-investor-citizenship-repealed',
      'canada-citizenship-by-descent',
      'canada-citizenship-grant',
      'canada-citizenship-by-birth',
      'cayman-botc-by-descent',
      'cayman-botc-naturalization',
      'cayman-botc-by-birth',
      'colombia-citizenship-by-parent',
      'colombia-naturalization-by-residence',
      'colombia-citizenship-by-conditional-birth',
      'colombia-study-permanent-residence-credit',
      'cyprus-citizenship-by-origin',
      'cyprus-naturalization-by-residence',
      'cyprus-citizenship-at-birth-by-parent',
      'dominica-citizenship-by-parent',
      'dominica-naturalization-after-residence',
      'dominica-citizenship-by-birth',
      'dominica-cbi',
      'france-citizenship-by-parent',
      'france-study-naturalization-residence',
      'france-birth-and-residence',
      'georgia-citizenship-by-parent',
      'georgia-ordinary-naturalization',
      'georgia-citizenship-by-protected-birth',
      'germany-citizenship-by-parent',
      'germany-naturalization-by-residence',
      'germany-citizenship-by-birth',
      'grenada-citizenship-by-parent',
      'grenada-naturalization',
      'grenada-citizenship-by-birth',
      'grenada-cbi',
      'greece-citizenship-by-greek-parent',
      'greece-ordinary-naturalization',
      'greece-citizenship-birth-and-school',
      'ireland-citizenship-by-descent',
      'ireland-naturalization-by-residence',
      'ireland-citizenship-by-birth',
      'italy-citizenship-by-descent',
      'italy-naturalization-by-residence',
      'italy-citizenship-connected-to-birth',
      'malta-registration-family-descent',
      'malta-residence-naturalization',
      'malta-citizenship-by-birth',
      'malta-transactional-investor-citizenship-ended',
      'mauritius-citizenship-by-descent',
      'mauritius-naturalization',
      'mauritius-citizenship-connected-to-birth',
      'mauritius-investor-naturalization',
      'mexico-citizenship-by-parent',
      'mexico-naturalization-by-residence',
      'mexico-citizenship-by-birth',
      'netherlands-citizenship-by-parent',
      'netherlands-naturalization-by-residence',
      'netherlands-third-generation-birth',
      'vanuatu-citizenship-by-parent',
      'vanuatu-naturalization',
      'vanuatu-citizenship-at-birth-by-parent',
      'vanuatu-investor-citizenship',
      'nz-citizenship-by-descent',
      'nz-citizenship-by-grant',
      'nz-citizenship-by-birth',
      'panama-nationality-through-parent',
      'panama-ordinary-naturalization',
      'panama-family-naturalization',
      'panama-nationality-by-birth',
      'portugal-citizenship-by-parent',
      'portugal-ordinary-naturalization-2026',
      'portugal-birth-parent-residence-2026',
      'saint-lucia-citizenship-by-parent-or-grandparent',
      'saint-lucia-naturalization',
      'saint-lucia-citizenship-by-birth',
      'saint-lucia-cip',
      'st-kitts-nevis-citizenship-by-parent',
      'st-kitts-nevis-naturalization',
      'st-kitts-nevis-citizenship-by-birth',
      'st-kitts-nevis-citizenship-programme',
      'serbia-citizenship-by-descent',
      'serbia-admission-after-permanent-residence',
      'serbia-citizenship-by-birth-statelessness',
      'singapore-citizenship-by-descent',
      'singapore-citizenship-after-pr',
      'singapore-citizenship-by-birth',
      'spain-citizenship-by-parent-or-option',
      'spain-citizenship-by-birth',
      'spain-naturalization-by-residence',
      'switzerland-citizenship-by-descent',
      'switzerland-ordinary-naturalization',
      'switzerland-third-generation-naturalization',
      'turkiye-citizenship-by-descent',
      'turkiye-naturalization-by-residence',
      'turkiye-citizenship-by-birth-statelessness',
      'turkiye-exceptional-investor-citizenship',
      'uae-citizenship-by-father',
      'uae-exceptional-naturalization',
      'uae-citizenship-at-birth-qualifying-parent',
      'uae-investor-nationality-nomination',
      'uk-citizenship-by-parent',
      'uk-naturalization-after-settlement',
      'uk-citizenship-by-birth',
      'us-citizenship-at-birth-abroad',
      'us-naturalization-after-lpr',
      'us-citizenship-by-birth',
      'uruguay-nationality-by-parent',
      'uruguay-legal-citizenship-by-residence',
      'uruguay-nationality-by-birth',
    ]);
    for (const jurisdiction of pilot.jurisdictions) {
      for (const route of jurisdiction.routes) {
        expect(route).not.toHaveProperty('country');
      }
    }
  });

  test('pins the reviewed low-tax and Caribbean findings that are easy to conflate', () => {
    const byIso = new Map(pilot.jurisdictions.map(item => [item.jurisdiction.iso_n3, item]));

    const georgia = byIso.get('268')!;
    expect(georgia.routes.find(route => route.id === 'georgia-ordinary-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(120);
    expect(georgia.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const cayman = byIso.get('136')!;
    expect(cayman.jurisdiction.type).toBe('territory');
    expect(cayman.review.note).toMatch(/distinct/);
    expect(cayman.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const dominica = byIso.get('212')!;
    expect(dominica.routes.find(route => route.id === 'dominica-naturalization-after-residence')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(84);
    expect(dominica.routes.find(route => route.id === 'dominica-cbi')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'investment.minimum_usd', value: 200000 }),
      );

    const stKitts = byIso.get('659')!;
    expect(stKitts.routes.find(route => route.id === 'st-kitts-nevis-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(180);
    expect(stKitts.routes.find(route => route.id === 'st-kitts-nevis-citizenship-programme')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'investment.minimum_usd', value: 250000 }),
      );

    const antigua = byIso.get('028')!;
    expect(antigua.routes.find(route => route.id === 'antigua-barbuda-cip')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'residence.first_five_years_days', value: 5 }),
      );

    const grenada = byIso.get('308')!;
    expect(grenada.routes.find(route => route.id === 'grenada-cbi')
      ?.variants[0]?.eligibility).not.toContainEqual(
        expect.objectContaining({ field: 'investment.minimum_usd' }),
      );

    const saintLucia = byIso.get('662')!;
    expect(saintLucia.routes.find(route => route.id === 'saint-lucia-cip')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'investment.minimum_usd', value: 240000 }),
      );

    const bahamas = byIso.get('044')!;
    expect(bahamas.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const barbados = byIso.get('052')!;
    expect(barbados.routes.find(route => route.id === 'barbados-naturalization')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'residence.prior_seven_years_aggregate_months', value: 60 }),
      );

    const mauritius = byIso.get('480')!;
    expect(mauritius.routes.find(route => route.id === 'mauritius-investor-naturalization')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'investment.minimum_usd', value: 500000 }),
      );
    expect(mauritius.routes.find(route => route.id === 'mauritius-investor-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(24);

    const panama = byIso.get('591')!;
    expect(panama.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');
    expect(panama.routes.find(route => route.id === 'panama-family-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(36);

    const vanuatu = byIso.get('548')!;
    expect(vanuatu.routes.find(route => route.id === 'vanuatu-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(120);
    expect(vanuatu.routes.find(route => route.id === 'vanuatu-investor-citizenship')
      ?.review.last_checked).toBe('2026-07-17');
  });

  test('models eligibility time separately from processing time', () => {
    const france = pilot.jurisdictions.find(item => item.jurisdiction.iso_n3 === '250')!;
    const naturalization = france.routes.find(
      route => route.id === 'france-study-naturalization-residence',
    )!;
    const education = naturalization.variants.find(
      variant => variant.id === 'higher_education',
    )!;
    expect(education.timeline.eligibility_minimum_months).toBe(24);
    expect(education.timeline.processing_typical_months).toBeNull();
  });

  test('pins the reviewed Latin American findings that are easy to misstate', () => {
    const byIso = new Map(pilot.jurisdictions.map(item => [item.jurisdiction.iso_n3, item]));
    const argentina = byIso.get('032')!;
    const argentinaInvestment = argentina.routes.find(route =>
      route.id === 'argentina-relevant-investment-citizenship')!;
    expect(argentinaInvestment.status).toBe('pending_verification');
    expect(argentinaInvestment.summary).not.toMatch(/USD|US\$|\$\d/);

    const brazilNaturalization = byIso.get('076')!.routes.find(route =>
      route.id === 'brazil-naturalization-by-residence')!;
    expect(brazilNaturalization.variants.find(variant =>
      variant.id === 'portuguese_speaking_country')?.timeline.eligibility_minimum_months).toBe(12);
    expect(brazilNaturalization.summary).not.toContain('South American');

    const mexicoNaturalization = byIso.get('484')!.routes.find(route =>
      route.id === 'mexico-naturalization-by-residence')!;
    expect(mexicoNaturalization.variants.find(variant =>
      variant.id === 'latin_american_or_iberian_origin')?.eligibility).toContainEqual(
      expect.objectContaining({ value: ['latin_america', 'iberian_peninsula'] }),
    );

    const colombiaBirth = byIso.get('170')!.routes.find(route =>
      route.id === 'colombia-citizenship-by-conditional-birth')!;
    expect(colombiaBirth.variants[0]?.eligibility).toContainEqual(
      expect.objectContaining({
        field: 'parent.domiciled_in_colombia_at_birth',
        value: true,
      }),
    );
  });

  test('requires one explicit coverage finding for every acquisition mode', () => {
    const france = pilot.jurisdictions.find(item => item.jurisdiction.iso_n3 === '250')!;
    expect(france.schema_version).toBe(2);
    expect(france.coverage.map(item => item.mode).sort()).toEqual([
      'ancestry',
      'birth',
      'investment',
      'naturalization',
    ]);
    const invalid = {
      ...france,
      coverage: france.coverage.filter(item => item.mode !== 'investment'),
    };
    expect(CANONICAL_SCHEMAS.jurisdiction.safeParse(invalid).success).toBe(false);
  });

  test('corrects the incomplete legacy Spain beneficiary enumeration in the candidate', () => {
    const spain = pilot.arrangements.find(item => item.id === 'spain_iberoamerican')!;
    expect(spain.participants.beneficiaries).toHaveLength(23);
    for (const iso of ['188', '192', '214', '222', '320', '340', '558', '591']) {
      expect(spain.participants.beneficiaries).toContain(iso);
    }
  });

  test('resolves every field-level source reference', () => {
    const sourceIds = new Set(pilot.sources.map(source => source.id));
    const references = [
      ...pilot.jurisdictions.flatMap(jurisdiction =>
        [
          ...jurisdiction.coverage.flatMap(item => item.source_refs),
          ...jurisdiction.routes.flatMap(route =>
            route.variants.flatMap(variant => variant.source_refs)),
        ]),
      ...pilot.arrangements.flatMap(arrangement =>
        arrangement.pathways.flatMap(pathway => pathway.source_refs)),
    ];
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(sourceIds.has(reference.source_id), reference.source_id).toBe(true);
      expect(reference.supports_fields.every(field => field.startsWith('/'))).toBe(true);
    }
  });

  test('accepts typed evidence-backed proposals and rejects source-free ones', () => {
    const proposal = {
      schema_version: 1,
      entity_type: 'change_proposal',
      id: 'proposal:france:2026_07',
      signal_ids: ['signal:abc123'],
      target_entity_id: 'jurisdiction:250',
      action: 'update',
      effective_from: '2026-07-01',
      operations: [{
        op: 'replace',
        path: '/routes/france-study-naturalization-residence/variants/higher_education/timeline/eligibility_minimum_months',
        value: 24,
      }],
      source_refs: [{
        source_id: pilot.sources[0]!.id,
        supports_fields: ['/operations/0/value'],
      }],
      rationale: 'Primary-source review confirmed the structured timeline field.',
      review_status: 'draft',
      created_at: '2026-07-19T12:00:00.000Z',
    };
    expect(ChangeProposalSchema.safeParse(proposal).success).toBe(true);
    expect(ChangeProposalSchema.safeParse({ ...proposal, source_refs: [] }).success).toBe(false);
  });
});

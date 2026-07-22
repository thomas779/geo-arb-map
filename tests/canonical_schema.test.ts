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
      'algeria-citizenship-by-parent',
      'algeria-naturalization',
      'algeria-citizenship-at-birth-by-parent',
      'andorra-citizenship-by-parent',
      'andorra-naturalization',
      'andorra-citizenship-at-birth-by-parent',
      'angola-citizenship-by-parent',
      'angola-naturalization',
      'angola-citizenship-at-birth-by-parent',
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
      'austria-citizenship-by-parent',
      'austria-naturalization',
      'austria-citizenship-at-birth-by-parent',
      'bahamas-citizenship-by-parent',
      'bahamas-naturalization',
      'bahamas-citizenship-connected-to-birth',
      'barbados-citizenship-by-parent',
      'barbados-naturalization',
      'barbados-citizenship-by-birth',
      'belgium-citizenship-by-parent',
      'belgium-naturalization',
      'belgium-citizenship-at-birth-by-parent',
      'bolivia-citizenship-by-parent',
      'bolivia-naturalization',
      'bolivia-citizenship-by-birth',
      'botswana-citizenship-by-parent',
      'botswana-naturalization',
      'botswana-citizenship-at-birth-by-parent',
      'brazil-citizenship-by-parent',
      'brazil-naturalization-by-residence',
      'brazil-citizenship-by-birth',
      'brunei-citizenship-by-parent',
      'brunei-naturalization',
      'brunei-citizenship-at-birth-by-parent',
      'bulgaria-bulgarian-origin-naturalization',
      'bulgaria-ordinary-naturalization',
      'bulgaria-citizenship-by-birth-statelessness',
      'bulgaria-investor-citizenship-repealed',
      'cabo-verde-citizenship-by-parent',
      'cabo-verde-naturalization',
      'cabo-verde-citizenship-at-birth-by-parent',
      'cambodia-citizenship-by-parent',
      'cambodia-naturalization',
      'cambodia-citizenship-at-birth-by-parent',
      'cambodia-investor-naturalization-status',
      'cameroon-citizenship-by-parent',
      'cameroon-naturalization',
      'cameroon-citizenship-at-birth-by-parent',
      'canada-citizenship-by-descent',
      'canada-citizenship-grant',
      'canada-citizenship-by-birth',
      'cayman-botc-by-descent',
      'cayman-botc-naturalization',
      'cayman-botc-by-birth',
      'chile-citizenship-by-parent-or-grandparent',
      'chile-naturalization',
      'chile-citizenship-by-birth',
      'china-citizenship-by-parent',
      'china-naturalization',
      'china-citizenship-at-birth-by-parent',
      'colombia-citizenship-by-parent',
      'colombia-naturalization-by-residence',
      'colombia-citizenship-by-conditional-birth',
      'colombia-study-permanent-residence-credit',
      'cote-divoire-citizenship-by-parent',
      'cote-divoire-naturalization',
      'cote-divoire-citizenship-at-birth-by-parent',
      'croatia-citizenship-by-parent',
      'croatia-naturalization',
      'croatia-citizenship-at-birth-by-parent',
      'cyprus-citizenship-by-origin',
      'cyprus-naturalization-by-residence',
      'cyprus-citizenship-at-birth-by-parent',
      'czechia-citizenship-by-parent',
      'czechia-naturalization',
      'czechia-citizenship-at-birth-by-parent',
      'denmark-citizenship-by-parent',
      'denmark-naturalization',
      'denmark-citizenship-at-birth-by-parent',
      'dominica-citizenship-by-parent',
      'dominica-naturalization-after-residence',
      'dominica-citizenship-by-birth',
      'dominica-cbi',
      'ecuador-citizenship-by-parent',
      'ecuador-naturalization',
      'ecuador-citizenship-at-birth',
      'egypt-citizenship-by-parent',
      'egypt-naturalization',
      'egypt-citizenship-by-birth',
      'egypt-investor-citizenship',
      'estonia-citizenship-by-parent',
      'estonia-naturalization',
      'estonia-citizenship-at-birth-by-parent',
      'ethiopia-citizenship-by-parent',
      'ethiopia-naturalization',
      'ethiopia-citizenship-at-birth-by-parent',
      'fiji-citizenship-by-parent',
      'fiji-naturalization',
      'fiji-citizenship-at-birth-by-parent',
      'finland-citizenship-by-parent',
      'finland-naturalization',
      'finland-citizenship-at-birth-by-parent',
      'france-citizenship-by-parent',
      'france-study-naturalization-residence',
      'france-birth-and-residence',
      'georgia-citizenship-by-parent',
      'georgia-ordinary-naturalization',
      'georgia-citizenship-by-protected-birth',
      'germany-citizenship-by-parent',
      'germany-naturalization-by-residence',
      'germany-citizenship-by-birth',
      'ghana-citizenship-by-parent',
      'ghana-naturalization',
      'ghana-citizenship-at-birth-by-parent',
      'grenada-citizenship-by-parent',
      'grenada-naturalization',
      'grenada-citizenship-by-birth',
      'grenada-cbi',
      'greece-citizenship-by-greek-parent',
      'greece-ordinary-naturalization',
      'greece-citizenship-birth-and-school',
      'hungary-citizenship-by-parent-or-simplified-origin',
      'hungary-ordinary-naturalization',
      'hungary-citizenship-at-birth-by-parent',
      'iceland-citizenship-by-parent',
      'iceland-naturalization',
      'iceland-citizenship-at-birth-by-parent',
      'india-citizenship-by-parent',
      'india-naturalization',
      'india-citizenship-at-birth-by-parent',
      'indonesia-citizenship-by-parent',
      'indonesia-naturalization',
      'indonesia-citizenship-at-birth-by-parent',
      'ireland-citizenship-by-descent',
      'ireland-naturalization-by-residence',
      'ireland-citizenship-by-birth',
      'israel-citizenship-by-return-or-parent',
      'israel-naturalization',
      'israel-citizenship-at-birth-by-parent',
      'italy-citizenship-by-descent',
      'italy-naturalization-by-residence',
      'italy-citizenship-connected-to-birth',
      'japan-citizenship-by-parent',
      'japan-naturalization',
      'japan-citizenship-at-birth-by-parent',
      'jordan-citizenship-by-father',
      'jordan-naturalization',
      'jordan-citizenship-by-birth-limited',
      'jordan-investor-citizenship',
      'kenya-citizenship-by-parent',
      'kenya-registration-by-residence',
      'kenya-citizenship-at-birth-by-parent',
      'kiribati-citizenship-by-parent',
      'kiribati-naturalization',
      'kiribati-citizenship-at-birth-by-parent',
      'korea-citizenship-by-parent-or-simple-origin',
      'korea-general-naturalization',
      'korea-citizenship-at-birth-by-parent',
      'latvia-citizenship-by-parent',
      'latvia-naturalization',
      'latvia-citizenship-at-birth-by-parent',
      'liechtenstein-citizenship-by-parent',
      'liechtenstein-naturalization',
      'liechtenstein-citizenship-at-birth-by-parent',
      'lithuania-citizenship-by-parent',
      'lithuania-naturalization',
      'lithuania-citizenship-at-birth-by-parent',
      'luxembourg-citizenship-by-parent',
      'luxembourg-naturalization',
      'luxembourg-citizenship-at-birth-by-parent',
      'malaysia-citizenship-by-parent',
      'malaysia-naturalization',
      'malaysia-citizenship-at-birth-by-parent',
      'malta-registration-family-descent',
      'malta-residence-naturalization',
      'malta-citizenship-by-birth',
      'malta-transactional-investor-citizenship-ended',
      'marshall-islands-citizenship-by-parent',
      'marshall-islands-naturalization',
      'marshall-islands-citizenship-at-birth-by-parent',
      'mauritius-citizenship-by-descent',
      'mauritius-naturalization',
      'mauritius-citizenship-connected-to-birth',
      'mauritius-investor-naturalization',
      'mexico-citizenship-by-parent',
      'mexico-naturalization-by-residence',
      'mexico-citizenship-by-birth',
      'micronesia-citizenship-by-parent',
      'micronesia-naturalization',
      'micronesia-citizenship-at-birth-by-parent',
      'monaco-citizenship-by-parent',
      'monaco-naturalization',
      'monaco-citizenship-at-birth-by-parent',
      'morocco-citizenship-by-parent',
      'morocco-naturalization',
      'morocco-citizenship-at-birth-by-parent',
      'mozambique-citizenship-by-parent',
      'mozambique-naturalization',
      'mozambique-citizenship-at-birth-by-parent',
      'namibia-citizenship-by-parent',
      'namibia-naturalization',
      'namibia-citizenship-at-birth-by-parent',
      'nauru-citizenship-by-descent',
      'nauru-naturalization-by-marriage',
      'nauru-citizenship-connected-to-birth',
      'nauru-climate-resilience-citizenship',
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
      'nigeria-citizenship-by-parent',
      'nigeria-naturalization',
      'nigeria-citizenship-at-birth-by-parent',
      'norway-citizenship-by-parent',
      'norway-naturalization',
      'norway-citizenship-at-birth-by-parent',
      'palau-citizenship-by-parent',
      'palau-naturalization',
      'palau-citizenship-at-birth-by-parent',
      'panama-nationality-through-parent',
      'panama-ordinary-naturalization',
      'panama-family-naturalization',
      'panama-nationality-by-birth',
      'papua-new-guinea-citizenship-by-parent',
      'papua-new-guinea-naturalization',
      'papua-new-guinea-citizenship-at-birth-by-parent',
      'papua-new-guinea-investor-naturalization',
      'paraguay-citizenship-by-parent',
      'paraguay-naturalization',
      'paraguay-citizenship-by-birth',
      'peru-citizenship-by-parent',
      'peru-naturalization',
      'peru-citizenship-at-birth',
      'philippines-citizenship-by-parent-or-reacquisition',
      'philippines-naturalization',
      'philippines-citizenship-at-birth-by-parent',
      'poland-citizenship-by-parent',
      'poland-recognition-by-residence',
      'poland-citizenship-at-birth-by-parent',
      'portugal-citizenship-by-parent',
      'portugal-ordinary-naturalization-2026',
      'portugal-birth-parent-residence-2026',
      'romania-citizenship-by-parent',
      'romania-naturalization',
      'romania-citizenship-at-birth-by-parent',
      'rwanda-citizenship-by-parent',
      'rwanda-naturalization',
      'rwanda-citizenship-at-birth-by-parent',
      'saint-lucia-citizenship-by-parent-or-grandparent',
      'saint-lucia-naturalization',
      'saint-lucia-citizenship-by-birth',
      'saint-lucia-cip',
      'samoa-citizenship-by-parent',
      'samoa-naturalization',
      'samoa-citizenship-at-birth-by-parent',
      'samoa-citizenship-investment-status',
      'senegal-citizenship-by-parent',
      'senegal-naturalization',
      'senegal-citizenship-at-birth-by-parent',
      'sao-tome-citizenship-by-parent-or-grandparent',
      'sao-tome-naturalization',
      'sao-tome-citizenship-by-birth',
      'sao-tome-principe-cbi',
      'st-kitts-nevis-citizenship-by-parent',
      'st-kitts-nevis-naturalization',
      'st-kitts-nevis-citizenship-by-birth',
      'st-kitts-nevis-citizenship-programme',
      'serbia-citizenship-by-descent',
      'serbia-admission-after-permanent-residence',
      'serbia-citizenship-by-birth-statelessness',
      'seychelles-citizenship-by-parent',
      'seychelles-naturalization',
      'seychelles-citizenship-at-birth-by-parent',
      'singapore-citizenship-by-descent',
      'singapore-citizenship-after-pr',
      'singapore-citizenship-by-birth',
      'slovakia-citizenship-by-parent',
      'slovakia-naturalization',
      'slovakia-citizenship-at-birth-by-parent',
      'solomon-islands-citizenship-by-parent',
      'solomon-islands-naturalization',
      'solomon-islands-citizenship-at-birth-by-parent',
      'south-africa-citizenship-by-parent',
      'south-africa-naturalization',
      'south-africa-citizenship-at-birth-by-parent',
      'spain-citizenship-by-parent-or-option',
      'spain-citizenship-by-birth',
      'spain-naturalization-by-residence',
      'sweden-citizenship-by-parent',
      'sweden-naturalization',
      'sweden-citizenship-at-birth-by-parent',
      'switzerland-citizenship-by-descent',
      'switzerland-ordinary-naturalization',
      'switzerland-third-generation-naturalization',
      'taiwan-citizenship-by-parent',
      'taiwan-naturalization',
      'taiwan-citizenship-at-birth-by-parent',
      'tanzania-citizenship-by-parent',
      'tanzania-naturalization',
      'tanzania-citizenship-at-birth-by-parent',
      'thailand-citizenship-by-parent',
      'thailand-naturalization',
      'thailand-citizenship-at-birth-by-parent',
      'timor-leste-citizenship-by-parent',
      'timor-leste-naturalization',
      'timor-leste-citizenship-at-birth-by-parent',
      'tonga-citizenship-by-parent',
      'tonga-naturalization',
      'tonga-citizenship-at-birth-by-parent',
      'tuvalu-citizenship-by-parent',
      'tuvalu-naturalization',
      'tuvalu-citizenship-at-birth-by-parent',
      'tunisia-citizenship-by-parent',
      'tunisia-naturalization',
      'tunisia-citizenship-at-birth-by-parent',
      'turkiye-citizenship-by-descent',
      'turkiye-naturalization-by-residence',
      'turkiye-citizenship-by-birth-statelessness',
      'turkiye-exceptional-investor-citizenship',
      'uganda-citizenship-by-parent',
      'uganda-naturalization',
      'uganda-citizenship-at-birth-by-parent',
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
      'vietnam-citizenship-by-parent',
      'vietnam-naturalization',
      'vietnam-citizenship-at-birth-by-parent',
      'zambia-citizenship-by-parent',
      'zambia-naturalization',
      'zambia-citizenship-at-birth-by-parent',
      'zimbabwe-citizenship-by-parent',
      'zimbabwe-naturalization',
      'zimbabwe-citizenship-at-birth-by-parent',
    ])
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

    const egypt = byIso.get('818')!;
    expect(egypt.routes.find(route => route.id === 'egypt-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(120);
    expect(egypt.routes.find(route => route.id === 'egypt-naturalization')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'residence.consecutive_lawful_years', value: 10 }),
      );
    expect(egypt.routes.find(route => route.id === 'egypt-investor-citizenship')
      ?.variants[0]?.allocation).toBe('discretionary');

    const jordan = byIso.get('400')!;
    expect(jordan.routes.find(route => route.id === 'jordan-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(48);
    expect(jordan.routes.find(route => route.id === 'jordan-naturalization')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'prior_nationality.lost_or_renounced', value: true }),
      );
    expect(jordan.routes.find(route => route.id === 'jordan-investor-citizenship')
      ?.summary).toMatch(/Dual nationality is routinely permitted/i);
    expect(jordan.coverage.find(item => item.mode === 'birth')?.review.note)
      .toMatch(/not general jus soli/i);

    const nauru = byIso.get('520')!;
    expect(nauru.routes.find(route => route.id === 'nauru-naturalization-by-marriage')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(84);
    expect(nauru.routes.find(route => route.id === 'nauru-climate-resilience-citizenship')
      ?.variants[0]?.allocation).toBe('discretionary');
    expect(nauru.routes.find(route => route.id === 'nauru-climate-resilience-citizenship')
      ?.variants[0]?.timeline.note).toMatch(/115,000|promotional/i);

    const saoTome = byIso.get('678')!;
    expect(saoTome.routes.find(route => route.id === 'sao-tome-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(60);
    expect(saoTome.routes.find(route => route.id === 'sao-tome-principe-cbi')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'contribution.national_transformation_fund', value: true }),
      );

    const paraguay = byIso.get('600')!;
    expect(paraguay.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');
    expect(paraguay.routes.find(route => route.id === 'paraguay-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(36);

    const chile = byIso.get('152')!;
    expect(chile.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');
    expect(chile.routes.find(route => route.id === 'chile-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(60);

    const israel = byIso.get('376')!;
    expect(israel.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');
    expect(israel.routes.find(route => route.id === 'israel-naturalization')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'prior_nationality.renounced_or_will_cease', value: true }),
      );

    const poland = byIso.get('616')!;
    expect(poland.routes.find(route => route.id === 'poland-recognition-by-residence')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'language.polish_level', value: 'B1' }),
      );
    expect(poland.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const hungary = byIso.get('348')!;
    expect(hungary.routes.find(route => route.id === 'hungary-ordinary-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(96);
    expect(hungary.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const japan = byIso.get('392')!;
    expect(japan.routes.find(route => route.id === 'japan-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(60);
    expect(japan.routes.find(route => route.id === 'japan-naturalization')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'prior_nationality.renounced_or_will_cease', value: true }),
      );
    expect(japan.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const korea = byIso.get('410')!;
    expect(korea.routes.find(route => route.id === 'korea-general-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(60);
    expect(korea.routes.find(route => route.id === 'korea-general-naturalization')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'status.permanent_residence', value: true }),
      );
    expect(korea.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const philippines = byIso.get('608')!;
    expect(philippines.routes.find(route => route.id === 'philippines-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(120);
    expect(philippines.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const southAfrica = byIso.get('710')!;
    expect(southAfrica.routes.find(route => route.id === 'south-africa-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(60);
    expect(southAfrica.routes.find(route => route.id === 'south-africa-naturalization')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'status.permanent_residence', value: true }),
      );
    expect(southAfrica.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const taiwan = byIso.get('158')!;
    expect(taiwan.routes.find(route => route.id === 'taiwan-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(60);
    expect(taiwan.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const indonesia = byIso.get('360')!;
    expect(indonesia.routes.find(route => route.id === 'indonesia-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(60);
    expect(indonesia.routes.find(route => route.id === 'indonesia-naturalization')
      ?.variants[0]?.eligibility).toContainEqual(
        expect.objectContaining({ field: 'prior_nationality.renounced_or_will_cease', value: true }),
      );
    expect(indonesia.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const thailand = byIso.get('764')!;
    expect(thailand.routes.find(route => route.id === 'thailand-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(60);
    expect(thailand.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    const nigeria = byIso.get('566')!;
    expect(nigeria.routes.find(route => route.id === 'nigeria-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(180);
    expect(nigeria.coverage.find(item => item.mode === 'investment')?.finding)
      .toBe('verified_none');

    expect(byIso.get('604')!.routes.find(r => r.id === 'peru-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(24);
    expect(byIso.get('068')!.routes.find(r => r.id === 'bolivia-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(36);
    expect(byIso.get('218')!.routes.find(r => r.id === 'ecuador-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(36);
    expect(byIso.get('458')!.routes.find(r => r.id === 'malaysia-naturalization')
      ?.variants[0]?.timeline.eligibility_minimum_months).toBe(120);
    for (const iso of ['604', '068', '218', '458']) {
      expect(byIso.get(iso)!.coverage.find(c => c.mode === 'investment')?.finding)
        .toBe('verified_none');
    }
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
    expect(brazilNaturalization.variants.find(variant =>
      variant.id === 'parent_of_brazilian_child')?.timeline.eligibility_minimum_months).toBe(12);
    expect(brazilNaturalization.variants.find(variant =>
      variant.id === 'parent_of_brazilian_child')?.timeline.note).toContain(
        'Grandparents may qualify for family-reunification residence',
      );
    expect(brazilNaturalization.summary).not.toContain('South American');

    const mexicoNaturalization = byIso.get('484')!.routes.find(route =>
      route.id === 'mexico-naturalization-by-residence')!;
    expect(mexicoNaturalization.variants.find(variant =>
      variant.id === 'latin_american_or_iberian_origin')?.eligibility).toContainEqual(
      expect.objectContaining({ value: ['latin_america', 'iberian_peninsula'] }),
    );
    expect(mexicoNaturalization.variants.find(variant =>
      variant.id === 'parent_of_mexican_child_by_birth')?.timeline.eligibility_minimum_months).toBe(24);
    expect(mexicoNaturalization.variants.find(variant =>
      variant.id === 'parent_of_mexican_child_by_birth')?.timeline.note).toContain(
        'Parents and grandparents can qualify for permanent residence',
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

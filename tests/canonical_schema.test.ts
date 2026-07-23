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
      'afghanistan-citizenship-by-parent',
      'afghanistan-naturalization',
      'afghanistan-citizenship-at-birth-by-parent',
      'albania-citizenship-by-parent',
      'albania-naturalization',
      'albania-citizenship-at-birth-by-parent',
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
      'armenia-citizenship-by-parent',
      'armenia-citizenship-by-armenian-descent',
      'armenia-naturalization',
      'armenia-citizenship-at-birth-by-parent',
      'australia-citizenship-by-descent',
      'australia-citizenship-by-conferral',
      'australia-citizenship-by-birth',
      'austria-citizenship-by-parent',
      'austria-naturalization',
      'austria-citizenship-at-birth-by-parent',
      'azerbaijan-citizenship-by-parent',
      'azerbaijan-naturalization',
      'azerbaijan-citizenship-at-birth-by-parent',
      'bahamas-citizenship-by-parent',
      'bahamas-naturalization',
      'bahamas-citizenship-connected-to-birth',
      'bahrain-citizenship-by-parent',
      'bahrain-naturalization',
      'bahrain-citizenship-at-birth-by-parent',
      'bangladesh-citizenship-by-parent',
      'bangladesh-naturalization',
      'bangladesh-citizenship-at-birth-by-parent',
      'bangladesh-investment-citizenship',
      'barbados-citizenship-by-parent',
      'barbados-naturalization',
      'barbados-citizenship-by-birth',
      'belarus-citizenship-by-parent',
      'belarus-naturalization',
      'belarus-citizenship-at-birth-by-parent',
      'belgium-citizenship-by-parent',
      'belgium-naturalization',
      'belgium-citizenship-at-birth-by-parent',
      'belize-citizenship-by-parent',
      'belize-naturalization',
      'belize-citizenship-at-birth-by-parent',
      'belize-economic-citizenship-closed',
      'benin-citizenship-by-parent',
      'benin-naturalization',
      'benin-citizenship-at-birth-by-parent',
      'bhutan-citizenship-by-parents',
      'bhutan-naturalization',
      'bhutan-citizenship-at-birth-by-parents',
      'bolivia-citizenship-by-parent',
      'bolivia-naturalization',
      'bolivia-citizenship-by-birth',
      'bosnia-herzegovina-citizenship-by-parent',
      'bosnia-herzegovina-naturalization',
      'bosnia-herzegovina-citizenship-at-birth-by-parent',
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
      'burkina-faso-citizenship-by-parent',
      'burkina-faso-naturalization',
      'burkina-faso-citizenship-at-birth-by-parent',
      'burundi-citizenship-by-parent',
      'burundi-naturalization',
      'burundi-citizenship-at-birth-by-parent',
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
      'central-african-republic-citizenship-by-parent',
      'central-african-republic-naturalization',
      'central-african-republic-citizenship-at-birth-by-parent',
      'chad-citizenship-by-parent',
      'chad-naturalization',
      'chad-citizenship-at-birth-by-parent',
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
      'comoros-citizenship-by-parent',
      'comoros-naturalization',
      'comoros-citizenship-at-birth-by-parent',
      'comoros-economic-citizenship-closed',
      'congo-citizenship-by-parent',
      'congo-naturalization',
      'congo-citizenship-at-birth-by-parent',
      'costa-rica-citizenship-by-parent',
      'costa-rica-naturalization-by-residence',
      'costa-rica-citizenship-by-birth',
      'cote-divoire-citizenship-by-parent',
      'cote-divoire-naturalization',
      'cote-divoire-citizenship-at-birth-by-parent',
      'croatia-citizenship-by-parent',
      'croatia-naturalization',
      'croatia-citizenship-at-birth-by-parent',
      'cuba-citizenship-by-parent',
      'cuba-naturalization',
      'cuba-citizenship-at-birth-by-parent',
      'cyprus-citizenship-by-origin',
      'cyprus-naturalization-by-residence',
      'cyprus-citizenship-at-birth-by-parent',
      'cyprus-investment-programme-closed',
      'czechia-citizenship-by-parent',
      'czechia-naturalization',
      'czechia-citizenship-at-birth-by-parent',
      'denmark-citizenship-by-parent',
      'denmark-naturalization',
      'denmark-citizenship-at-birth-by-parent',
      'djibouti-citizenship-by-parent',
      'djibouti-naturalization',
      'djibouti-citizenship-at-birth-by-parent',
      'dominican-republic-citizenship-by-parent',
      'dominican-republic-naturalization',
      'dominican-republic-citizenship-by-birth',
      'dominica-citizenship-by-parent',
      'dominica-naturalization-after-residence',
      'dominica-citizenship-by-birth',
      'dominica-cbi',
      'drc-citizenship-by-parent',
      'drc-naturalization',
      'drc-citizenship-at-birth-by-parent',
      'ecuador-citizenship-by-parent',
      'ecuador-naturalization',
      'ecuador-citizenship-at-birth',
      'egypt-citizenship-by-parent',
      'egypt-naturalization',
      'egypt-citizenship-by-birth',
      'egypt-investor-citizenship',
      'el-salvador-citizenship-by-parent',
      'el-salvador-central-american-option',
      'el-salvador-naturalization-by-residence',
      'el-salvador-citizenship-by-birth',
      'equatorial-guinea-citizenship-by-parent',
      'equatorial-guinea-naturalization',
      'equatorial-guinea-citizenship-at-birth-by-parent',
      'eritrea-citizenship-by-parent',
      'eritrea-naturalization',
      'eritrea-citizenship-at-birth-by-parent',
      'estonia-citizenship-by-parent',
      'estonia-naturalization',
      'estonia-citizenship-at-birth-by-parent',
      'eswatini-citizenship-by-parent',
      'eswatini-naturalization',
      'eswatini-citizenship-at-birth-by-parent',
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
      'gabon-citizenship-by-parent',
      'gabon-naturalization',
      'gabon-citizenship-at-birth-by-parent',
      'gambia-citizenship-by-parent',
      'gambia-naturalization',
      'gambia-citizenship-at-birth-by-parent',
      'georgia-citizenship-by-parent',
      'georgia-ordinary-naturalization',
      'georgia-citizenship-by-protected-birth',
      'germany-citizenship-by-parent',
      'germany-naturalization-by-residence',
      'germany-citizenship-by-birth',
      'ghana-citizenship-by-parent',
      'ghana-naturalization',
      'ghana-citizenship-at-birth-by-parent',
      'greece-citizenship-by-greek-parent',
      'greece-ordinary-naturalization',
      'greece-citizenship-birth-and-school',
      'grenada-citizenship-by-parent',
      'grenada-naturalization',
      'grenada-citizenship-by-birth',
      'grenada-cbi',
      'guatemala-citizenship-by-parent',
      'guatemala-naturalization-by-residence',
      'guatemala-citizenship-by-birth',
      'guinea-bissau-citizenship-by-parent',
      'guinea-bissau-naturalization',
      'guinea-bissau-citizenship-at-birth-by-parent',
      'guinea-citizenship-by-parent',
      'guinea-naturalization',
      'guinea-citizenship-at-birth-by-parent',
      'guyana-citizenship-by-parent',
      'guyana-naturalization',
      'guyana-citizenship-at-birth-by-parent',
      'haiti-citizenship-by-parent',
      'haiti-naturalization',
      'haiti-citizenship-at-birth-by-parent',
      'honduras-citizenship-by-parent',
      'honduras-naturalization-by-residence',
      'honduras-citizenship-by-birth',
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
      'iran-citizenship-by-parent',
      'iran-naturalization',
      'iran-citizenship-at-birth-by-parent',
      'iraq-citizenship-by-parent',
      'iraq-naturalization',
      'iraq-citizenship-at-birth-by-parent',
      'ireland-citizenship-by-descent',
      'ireland-naturalization-by-residence',
      'ireland-citizenship-by-birth',
      'israel-citizenship-by-return-or-parent',
      'israel-naturalization',
      'israel-citizenship-at-birth-by-parent',
      'italy-citizenship-by-descent',
      'italy-naturalization-by-residence',
      'italy-citizenship-connected-to-birth',
      'jamaica-citizenship-by-parent',
      'jamaica-naturalization',
      'jamaica-citizenship-at-birth-by-parent',
      'japan-citizenship-by-parent',
      'japan-naturalization',
      'japan-citizenship-at-birth-by-parent',
      'jordan-citizenship-by-father',
      'jordan-naturalization',
      'jordan-citizenship-by-birth-limited',
      'jordan-investor-citizenship',
      'kazakhstan-citizenship-by-parent',
      'kazakhstan-citizenship-by-kandas-status',
      'kazakhstan-naturalization',
      'kazakhstan-citizenship-at-birth-by-parent',
      'kenya-citizenship-by-parent',
      'kenya-registration-by-residence',
      'kenya-citizenship-at-birth-by-parent',
      'kiribati-citizenship-by-parent',
      'kiribati-naturalization',
      'kiribati-citizenship-at-birth-by-parent',
      'korea-citizenship-by-parent-or-simple-origin',
      'korea-general-naturalization',
      'korea-citizenship-at-birth-by-parent',
      'kuwait-citizenship-by-parent',
      'kuwait-naturalization',
      'kuwait-citizenship-at-birth-by-parent',
      'kyrgyzstan-citizenship-by-parent',
      'kyrgyzstan-citizenship-by-kyrgyz-origin',
      'kyrgyzstan-naturalization',
      'kyrgyzstan-citizenship-at-birth-by-parent',
      'laos-citizenship-by-parent',
      'laos-naturalization',
      'laos-citizenship-at-birth-by-parent',
      'latvia-citizenship-by-parent',
      'latvia-naturalization',
      'latvia-citizenship-at-birth-by-parent',
      'lebanon-citizenship-by-parent',
      'lebanon-naturalization',
      'lebanon-citizenship-at-birth-by-parent',
      'lesotho-citizenship-by-parent',
      'lesotho-naturalization',
      'lesotho-citizenship-at-birth-by-parent',
      'liberia-citizenship-by-parent',
      'liberia-naturalization',
      'liberia-citizenship-at-birth-by-parent',
      'libya-citizenship-by-parent',
      'libya-naturalization',
      'libya-citizenship-at-birth-by-parent',
      'liechtenstein-citizenship-by-parent',
      'liechtenstein-naturalization',
      'liechtenstein-citizenship-at-birth-by-parent',
      'lithuania-citizenship-by-parent',
      'lithuania-naturalization',
      'lithuania-citizenship-at-birth-by-parent',
      'luxembourg-citizenship-by-parent',
      'luxembourg-naturalization',
      'luxembourg-citizenship-at-birth-by-parent',
      'madagascar-citizenship-by-parent',
      'madagascar-naturalization',
      'madagascar-citizenship-at-birth-by-parent',
      'malawi-citizenship-by-parent',
      'malawi-naturalization',
      'malawi-citizenship-at-birth-by-parent',
      'malaysia-citizenship-by-parent',
      'malaysia-naturalization',
      'malaysia-citizenship-at-birth-by-parent',
      'maldives-citizenship-by-parent',
      'maldives-naturalization',
      'maldives-citizenship-at-birth-by-parent',
      'mali-citizenship-by-parent',
      'mali-naturalization',
      'mali-citizenship-at-birth-by-parent',
      'malta-registration-family-descent',
      'malta-residence-naturalization',
      'malta-citizenship-by-birth',
      'malta-transactional-investor-citizenship-ended',
      'marshall-islands-citizenship-by-parent',
      'marshall-islands-naturalization',
      'marshall-islands-citizenship-at-birth-by-parent',
      'mauritania-citizenship-by-parent',
      'mauritania-naturalization',
      'mauritania-citizenship-at-birth-by-parent',
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
      'moldova-citizenship-by-parent',
      'moldova-naturalization',
      'moldova-citizenship-at-birth-by-parent',
      'monaco-citizenship-by-parent',
      'monaco-naturalization',
      'monaco-citizenship-at-birth-by-parent',
      'mongolia-citizenship-by-parent',
      'mongolia-naturalization',
      'mongolia-citizenship-at-birth-by-parent',
      'montenegro-citizenship-by-parent',
      'montenegro-naturalization',
      'montenegro-citizenship-at-birth-by-parent',
      'montenegro-economic-citizenship-closed',
      'morocco-citizenship-by-parent',
      'morocco-naturalization',
      'morocco-citizenship-at-birth-by-parent',
      'mozambique-citizenship-by-parent',
      'mozambique-naturalization',
      'mozambique-citizenship-at-birth-by-parent',
      'myanmar-citizenship-by-parent',
      'myanmar-naturalization',
      'myanmar-citizenship-at-birth-by-parent',
      'namibia-citizenship-by-parent',
      'namibia-naturalization',
      'namibia-citizenship-at-birth-by-parent',
      'nauru-citizenship-by-descent',
      'nauru-naturalization-by-marriage',
      'nauru-citizenship-connected-to-birth',
      'nauru-climate-resilience-citizenship',
      'nepal-citizenship-by-descent',
      'nepal-naturalization',
      'nepal-citizenship-at-birth-by-parent',
      'netherlands-citizenship-by-parent',
      'netherlands-naturalization-by-residence',
      'netherlands-third-generation-birth',
      'nz-citizenship-by-descent',
      'nz-citizenship-by-grant',
      'nz-citizenship-by-birth',
      'nicaragua-citizenship-by-parent',
      'nicaragua-central-american-option',
      'nicaragua-naturalization',
      'nicaragua-citizenship-by-birth',
      'nigeria-citizenship-by-parent',
      'nigeria-naturalization',
      'nigeria-citizenship-at-birth-by-parent',
      'niger-citizenship-by-parent',
      'niger-naturalization',
      'niger-citizenship-at-birth-by-parent',
      'north-macedonia-citizenship-by-parent',
      'north-macedonia-naturalization',
      'north-macedonia-citizenship-at-birth-by-parent',
      'norway-citizenship-by-parent',
      'norway-naturalization',
      'norway-citizenship-at-birth-by-parent',
      'oman-citizenship-by-parent',
      'oman-naturalization',
      'oman-citizenship-at-birth-by-parent',
      'pakistan-citizenship-by-parent',
      'pakistan-naturalization',
      'pakistan-citizenship-at-birth-by-parent',
      'pakistan-commonwealth-investment-citizenship',
      'palau-citizenship-by-parent',
      'palau-naturalization',
      'palau-citizenship-at-birth-by-parent',
      'panama-nationality-through-parent',
      'panama-ordinary-naturalization',
      'panama-family-naturalization',
      'panama-spain-latin-american-reciprocity-naturalization',
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
      'qatar-citizenship-by-parent',
      'qatar-naturalization',
      'qatar-citizenship-at-birth-by-parent',
      'romania-citizenship-by-parent',
      'romania-naturalization',
      'romania-citizenship-at-birth-by-parent',
      'russia-citizenship-by-parent',
      'russia-naturalization',
      'russia-simplified-naturalization-heritage',
      'russia-citizenship-at-birth-by-parent',
      'rwanda-citizenship-by-parent',
      'rwanda-naturalization',
      'rwanda-citizenship-at-birth-by-parent',
      'saint-lucia-citizenship-by-parent-or-grandparent',
      'saint-lucia-naturalization',
      'saint-lucia-citizenship-by-birth',
      'saint-lucia-cip',
      'saint-vincent-citizenship-by-parent',
      'saint-vincent-naturalization',
      'saint-vincent-citizenship-at-birth-by-parent',
      'samoa-citizenship-by-parent',
      'samoa-naturalization',
      'samoa-citizenship-at-birth-by-parent',
      'samoa-citizenship-investment-status',
      'san-marino-citizenship-by-parent',
      'san-marino-naturalization',
      'san-marino-citizenship-at-birth-by-parent',
      'sao-tome-citizenship-by-parent-or-grandparent',
      'sao-tome-naturalization',
      'sao-tome-citizenship-by-birth',
      'sao-tome-principe-cbi',
      'saudi-arabia-citizenship-by-parent',
      'saudi-arabia-naturalization',
      'saudi-arabia-citizenship-at-birth-by-parent',
      'senegal-citizenship-by-parent',
      'senegal-naturalization',
      'senegal-citizenship-at-birth-by-parent',
      'serbia-citizenship-by-descent',
      'serbia-admission-after-permanent-residence',
      'serbia-citizenship-by-birth-statelessness',
      'seychelles-citizenship-by-parent',
      'seychelles-naturalization',
      'seychelles-citizenship-at-birth-by-parent',
      'sierra-leone-citizenship-by-parent',
      'sierra-leone-naturalization',
      'sierra-leone-citizenship-at-birth-by-parent',
      'singapore-citizenship-by-descent',
      'singapore-citizenship-after-pr',
      'singapore-citizenship-by-birth',
      'slovakia-citizenship-by-parent',
      'slovakia-naturalization',
      'slovakia-citizenship-at-birth-by-parent',
      'slovenia-citizenship-by-parent',
      'slovenia-naturalization',
      'slovenia-citizenship-at-birth-by-parent',
      'solomon-islands-citizenship-by-parent',
      'solomon-islands-naturalization',
      'solomon-islands-citizenship-at-birth-by-parent',
      'somalia-citizenship-by-parent',
      'somalia-naturalization',
      'somalia-citizenship-at-birth-by-parent',
      'south-africa-citizenship-by-parent',
      'south-africa-naturalization',
      'south-africa-citizenship-at-birth-by-parent',
      'south-sudan-citizenship-by-parent',
      'south-sudan-naturalization',
      'south-sudan-citizenship-at-birth-by-parent',
      'spain-citizenship-by-parent-or-option',
      'spain-citizenship-by-birth',
      'spain-naturalization-by-residence',
      'sri-lanka-citizenship-by-descent',
      'sri-lanka-naturalization',
      'sri-lanka-citizenship-at-birth-by-parent',
      'st-kitts-nevis-citizenship-by-parent',
      'st-kitts-nevis-naturalization',
      'st-kitts-nevis-citizenship-by-birth',
      'st-kitts-nevis-citizenship-programme',
      'sudan-citizenship-by-parent',
      'sudan-naturalization',
      'sudan-citizenship-at-birth-by-parent',
      'suriname-citizenship-by-parent',
      'suriname-naturalization',
      'suriname-citizenship-at-birth-by-parent',
      'sweden-citizenship-by-parent',
      'sweden-naturalization',
      'sweden-citizenship-at-birth-by-parent',
      'switzerland-citizenship-by-descent',
      'switzerland-ordinary-naturalization',
      'switzerland-third-generation-naturalization',
      'syria-citizenship-by-parent',
      'syria-naturalization',
      'syria-citizenship-at-birth-by-parent',
      'taiwan-citizenship-by-parent',
      'taiwan-naturalization',
      'taiwan-citizenship-at-birth-by-parent',
      'tajikistan-citizenship-by-parent',
      'tajikistan-naturalization',
      'tajikistan-citizenship-at-birth-by-parent',
      'tanzania-citizenship-by-parent',
      'tanzania-naturalization',
      'tanzania-citizenship-at-birth-by-parent',
      'thailand-citizenship-by-parent',
      'thailand-naturalization',
      'thailand-citizenship-at-birth-by-parent',
      'timor-leste-citizenship-by-parent',
      'timor-leste-naturalization',
      'timor-leste-citizenship-at-birth-by-parent',
      'togo-citizenship-by-parent',
      'togo-naturalization',
      'togo-citizenship-at-birth-by-parent',
      'tonga-citizenship-by-parent',
      'tonga-naturalization',
      'tonga-citizenship-at-birth-by-parent',
      'trinidad-and-tobago-citizenship-by-parent',
      'trinidad-and-tobago-naturalization',
      'trinidad-and-tobago-citizenship-at-birth-by-parent',
      'tunisia-citizenship-by-parent',
      'tunisia-naturalization',
      'tunisia-citizenship-at-birth-by-parent',
      'turkiye-citizenship-by-descent',
      'turkiye-naturalization-by-residence',
      'turkiye-citizenship-by-birth-statelessness',
      'turkiye-exceptional-investor-citizenship',
      'turkmenistan-citizenship-by-parent',
      'turkmenistan-naturalization',
      'turkmenistan-citizenship-at-birth-by-parent',
      'tuvalu-citizenship-by-parent',
      'tuvalu-naturalization',
      'tuvalu-citizenship-at-birth-by-parent',
      'uganda-citizenship-by-parent',
      'uganda-naturalization',
      'uganda-citizenship-at-birth-by-parent',
      'ukraine-citizenship-by-parent',
      'ukraine-naturalization',
      'ukraine-citizenship-at-birth-by-parent',
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
      'uzbekistan-citizenship-by-parent',
      'uzbekistan-naturalization',
      'uzbekistan-citizenship-at-birth-by-parent',
      'vanuatu-citizenship-by-parent',
      'vanuatu-naturalization',
      'vanuatu-citizenship-at-birth-by-parent',
      'vanuatu-investor-citizenship',
      'vatican-derivative-family-citizenship',
      'vatican-citizenship-by-office',
      'venezuela-citizenship-by-parent',
      'venezuela-naturalization-by-residence',
      'venezuela-citizenship-by-birth',
      'vietnam-citizenship-by-parent',
      'vietnam-naturalization',
      'vietnam-citizenship-at-birth-by-parent',
      'yemen-citizenship-by-parent',
      'yemen-naturalization',
      'yemen-citizenship-at-birth-by-parent',
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

    const spainNaturalization = byIso.get('724')!.routes.find(route =>
      route.id === 'spain-naturalization-by-residence')!;
    expect(spainNaturalization.variants.map(variant => variant.id)).toEqual([
      'ordinary',
      'recognized_refugee',
      'iberoamerican_two_years',
      'sephardic_two_years',
      'married_to_spanish_one_year',
      'born_in_spain',
    ]);
    expect(spainNaturalization.variants.find(variant =>
      variant.id === 'iberoamerican_two_years')?.timeline.eligibility_minimum_months).toBe(24);
    expect(spainNaturalization.variants.find(variant =>
      variant.id === 'iberoamerican_two_years')?.eligibility).toContainEqual(
      expect.objectContaining({ field: 'citizenship.iso_n3', operator: 'in' }),
    );

    const colombiaNaturalization = byIso.get('170')!.routes.find(route =>
      route.id === 'colombia-naturalization-by-residence')!;
    expect(colombiaNaturalization.variants.find(variant =>
      variant.id === 'spanish_national_two_years')?.timeline.eligibility_minimum_months).toBe(24);
    expect(colombiaNaturalization.variants.find(variant =>
      variant.id === 'spanish_national_two_years')?.eligibility).toContainEqual(
      expect.objectContaining({ field: 'citizenship.iso_n3', value: '724' }),
    );

    const panamaReciprocity = byIso.get('591')!.routes.find(route =>
      route.id === 'panama-spain-latin-american-reciprocity-naturalization')!;
    expect(panamaReciprocity.variants.find(variant =>
      variant.id === 'spanish_birth_national_two_years')?.timeline.eligibility_minimum_months).toBe(24);
    expect(panamaReciprocity.variants.find(variant =>
      variant.id === 'el_salvador_birth_national_one_year')?.timeline.eligibility_minimum_months).toBe(12);
    expect(panamaReciprocity.variants.find(variant =>
      variant.id === 'honduras_birth_national_two_years')?.timeline.eligibility_minimum_months).toBe(24);
    expect(panamaReciprocity.variants.find(variant =>
      variant.id === 'costa_rica_birth_national_five_years')?.timeline.eligibility_minimum_months).toBe(60);
    expect(panamaReciprocity.variants.find(variant =>
      variant.id === 'venezuela_birth_national_five_years')?.timeline.eligibility_minimum_months).toBe(60);

    const elSalvadorNaturalization = byIso.get('222')!.routes.find(route =>
      route.id === 'el-salvador-naturalization-by-residence')!;
    expect(elSalvadorNaturalization.variants.find(variant =>
      variant.id === 'spanish_or_hispano_american_one_year')?.timeline.eligibility_minimum_months).toBe(12);

    const hondurasNaturalization = byIso.get('340')!.routes.find(route =>
      route.id === 'honduras-naturalization-by-residence')!;
    expect(hondurasNaturalization.variants.find(variant =>
      variant.id === 'spanish_or_ibero_american_birth_two_years')?.timeline.eligibility_minimum_months).toBe(24);

    const costaRicaNaturalization = byIso.get('188')!.routes.find(route =>
      route.id === 'costa-rica-naturalization-by-residence')!;
    expect(costaRicaNaturalization.variants.find(variant =>
      variant.id === 'central_american_spanish_spanish_american_birth_five_years')
      ?.timeline.eligibility_minimum_months).toBe(60);

    const venezuelaNaturalization = byIso.get('862')!.routes.find(route =>
      route.id === 'venezuela-naturalization-by-residence')!;
    expect(venezuelaNaturalization.variants.find(variant =>
      variant.id === 'spain_portugal_italy_latin_america_caribbean_five_years')
      ?.timeline.eligibility_minimum_months).toBe(60);

    expect(byIso.get('214')!.routes.some(route =>
      route.id === 'dominican-republic-naturalization')).toBe(true);
    expect(byIso.get('320')!.routes.some(route =>
      route.id === 'guatemala-naturalization-by-residence')).toBe(true);
    expect(byIso.get('558')!.routes.some(route =>
      route.id === 'nicaragua-central-american-option')).toBe(true);

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

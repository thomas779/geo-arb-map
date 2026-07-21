import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CitizenshipRouteSource } from '../../src/types';
import {
  ArrangementRecordSchema,
  JurisdictionRecordSchema,
  SourceRecordSchema,
  type ArrangementRecord,
  type JurisdictionRecord,
  type SourceRecord,
} from './canonical-schema';
import { buildDataShadow, type DataShadow } from './data-shadow';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface CanonicalPilot {
  shadow_release_id: string;
  release_id: string;
  sources: SourceRecord[];
  jurisdictions: JurisdictionRecord[];
  arrangements: ArrangementRecord[];
  manifest: {
    schema_version: 1;
    mode: 'canonical_candidate';
    release_id: string;
    shadow_release_id: string;
    counts: {
      sources: number;
      jurisdictions: number;
      arrangements: number;
      routes: number;
    };
  };
}

interface ManualPilotSource {
  record: SourceRecord;
  arrangement_id: string;
  supports_fields: string[];
  note?: string;
}

function hash(value: unknown, length = 64): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

function publisherFromUrl(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

function sourceId(url: string): string {
  const publisher = publisherFromUrl(url).replace(/[^a-z0-9]+/g, '_');
  return `source:${publisher}:${hash(url, 10)}`;
}

function sourceType(url: string): SourceRecord['source_type'] {
  const host = new URL(url).hostname;
  if (host.includes('legifrance.gouv.fr')) return 'primary_law';
  if (host.includes('eur-lex.europa.eu') || host.includes('boe.es')) {
    return 'primary_law';
  }
  if (host.includes('efta.int') || host.includes('mercosur.int')) return 'treaty';
  if (host.includes('justica.gov.pt') || host.includes('service-public.fr')) {
    return 'official_guidance';
  }
  return 'discovery';
}

function toSource(
  source: CitizenshipRouteSource,
  jurisdiction: string,
  lastChecked: string,
): SourceRecord {
  return SourceRecordSchema.parse({
    schema_version: 1,
    entity_type: 'source',
    id: sourceId(source.url),
    title: source.title,
    url: source.url,
    publisher: publisherFromUrl(source.url),
    source_type: sourceType(source.url),
    jurisdictions: [jurisdiction],
    language: null,
    published_at: null,
    last_checked: lastChecked,
  });
}

function refs(
  sources: CitizenshipRouteSource[],
  supportsFields: string[],
): Array<{ source_id: string; supports_fields: string[] }> {
  return sources.map(source => ({
    source_id: sourceId(source.url),
    supports_fields: supportsFields,
  }));
}

function officialSource({
  title,
  url,
  source_type,
  jurisdictions,
  language = null,
  last_checked = '2026-07-21',
  monitoring,
}: {
  title: string;
  url: string;
  source_type: SourceRecord['source_type'];
  jurisdictions: string[];
  language?: string | null;
  last_checked?: string;
  monitoring?: SourceRecord['monitoring'];
}): SourceRecord {
  return SourceRecordSchema.parse({
    schema_version: 1,
    entity_type: 'source',
    id: sourceId(url),
    title,
    url,
    publisher: publisherFromUrl(url),
    source_type,
    jurisdictions,
    language,
    published_at: null,
    last_checked,
    ...(monitoring ? { monitoring } : {}),
  });
}

const OFFICIAL_URLS = {
  france_descent: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419373/',
  france_birth_residence: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039366780/',
  france_birth_guidance: 'https://www.service-public.fr/particuliers/vosdroits/F295',
  france_nationality_code: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006070721/2026-01-01',
  portugal_nationality: 'https://justica.gov.pt/registos/nacionalidade/nacionalidade-portuguesa',
  portugal_applications: 'https://justica.gov.pt/Servicos/Submeter-pedido-de-nacionalidade',
  spain_civil_code: 'https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763',
  germany_nationality_act: 'https://www.gesetze-im-internet.de/englisch_stag/englisch_stag.html',
  ireland_born_abroad: 'https://www.dfa.ie/citizenship/born-abroad/',
  ireland_naturalization: 'https://www.irishimmigration.ie/how-to-become-an-irish-citizen-guide/',
  ireland_birth_law: 'https://www.irishstatutebook.ie/eli/2004/act/38/section/4/enacted/en/html',
  uk_british_parent: 'https://www.gov.uk/apply-citizenship-british-parent',
  uk_born_in_country: 'https://www.gov.uk/apply-citizenship-born-uk/eligibility',
  uk_naturalization: 'https://www.gov.uk/apply-citizenship-indefinite-leave-to-remain',
} as const;

function jurisdictionSources(): SourceRecord[] {
  return [
    officialSource({
      title: 'French Civil Code — French nationality provisions',
      url: OFFICIAL_URLS.france_nationality_code,
      source_type: 'primary_law',
      jurisdictions: ['250'],
      language: 'fr',
      monitoring: {
        source_id: 'legifrance-piste',
        method: 'api',
        url: 'https://piste.gouv.fr/',
        status: 'planned',
      },
    }),
    officialSource({
      title: 'French Civil Code — Article 18',
      url: OFFICIAL_URLS.france_descent,
      source_type: 'primary_law',
      jurisdictions: ['250'],
      language: 'fr',
      monitoring: {
        source_id: 'legifrance-piste',
        method: 'api',
        url: 'https://piste.gouv.fr/',
        status: 'planned',
      },
    }),
    officialSource({
      title: 'French Civil Code — Article 21-7',
      url: OFFICIAL_URLS.france_birth_residence,
      source_type: 'primary_law',
      jurisdictions: ['250'],
      language: 'fr',
      monitoring: {
        source_id: 'legifrance-piste',
        method: 'api',
        url: 'https://piste.gouv.fr/',
        status: 'planned',
      },
    }),
    officialSource({
      title: 'Service-Public — French nationality for a child born in France',
      url: OFFICIAL_URLS.france_birth_guidance,
      source_type: 'official_guidance',
      jurisdictions: ['250'],
      language: 'fr',
      monitoring: {
        source_id: 'france-service-public-nationality',
        method: 'http',
        url: OFFICIAL_URLS.france_birth_guidance,
        status: 'planned',
      },
    }),
    officialSource({
      title: 'Portuguese Ministry of Justice — Portuguese nationality',
      url: OFFICIAL_URLS.portugal_nationality,
      source_type: 'official_guidance',
      jurisdictions: ['620'],
      language: 'pt',
      monitoring: {
        source_id: 'portugal-justice-nationality',
        method: 'http',
        url: OFFICIAL_URLS.portugal_nationality,
        status: 'planned',
      },
    }),
    officialSource({
      title: 'Portuguese Ministry of Justice — Submit a nationality application',
      url: OFFICIAL_URLS.portugal_applications,
      source_type: 'official_guidance',
      jurisdictions: ['620'],
      language: 'pt',
      monitoring: {
        source_id: 'portugal-justice-nationality',
        method: 'http',
        url: OFFICIAL_URLS.portugal_applications,
        status: 'planned',
      },
    }),
    officialSource({
      title: 'Spanish Civil Code — Articles 17, 20 and 22',
      url: OFFICIAL_URLS.spain_civil_code,
      source_type: 'primary_law',
      jurisdictions: ['724'],
      language: 'es',
      monitoring: {
        source_id: 'boe-spain',
        method: 'api',
        url: 'https://www.boe.es/datosabiertos/api/api.php',
        status: 'planned',
      },
    }),
    officialSource({
      title: 'German Nationality Act',
      url: OFFICIAL_URLS.germany_nationality_act,
      source_type: 'primary_law',
      jurisdictions: ['276'],
      language: 'en',
      monitoring: {
        source_id: 'germany-nationality-act',
        method: 'http',
        url: OFFICIAL_URLS.germany_nationality_act,
        status: 'planned',
      },
    }),
    officialSource({
      title: 'Irish Department of Foreign Affairs — Born abroad',
      url: OFFICIAL_URLS.ireland_born_abroad,
      source_type: 'official_guidance',
      jurisdictions: ['372'],
      language: 'en',
      monitoring: {
        source_id: 'ireland-dfa-citizenship',
        method: 'http',
        url: OFFICIAL_URLS.ireland_born_abroad,
        status: 'planned',
      },
    }),
    officialSource({
      title: 'Irish Immigration Service — How to become an Irish citizen',
      url: OFFICIAL_URLS.ireland_naturalization,
      source_type: 'official_guidance',
      jurisdictions: ['372'],
      language: 'en',
      monitoring: {
        source_id: 'ireland-isd-citizenship',
        method: 'http',
        url: OFFICIAL_URLS.ireland_naturalization,
        status: 'planned',
      },
    }),
    officialSource({
      title: 'Irish Nationality and Citizenship Act 2004 — Section 4',
      url: OFFICIAL_URLS.ireland_birth_law,
      source_type: 'primary_law',
      jurisdictions: ['372'],
      language: 'en',
      monitoring: {
        source_id: 'irish-statute-book',
        method: 'http',
        url: OFFICIAL_URLS.ireland_birth_law,
        status: 'planned',
      },
    }),
    officialSource({
      title: 'GOV.UK — British citizenship through a British parent',
      url: OFFICIAL_URLS.uk_british_parent,
      source_type: 'official_guidance',
      jurisdictions: ['826'],
      language: 'en',
      monitoring: {
        source_id: 'gov-uk-citizenship',
        method: 'http',
        url: OFFICIAL_URLS.uk_british_parent,
        status: 'planned',
      },
    }),
    officialSource({
      title: 'GOV.UK — British citizenship for people born in the UK',
      url: OFFICIAL_URLS.uk_born_in_country,
      source_type: 'official_guidance',
      jurisdictions: ['826'],
      language: 'en',
      monitoring: {
        source_id: 'gov-uk-citizenship',
        method: 'http',
        url: OFFICIAL_URLS.uk_born_in_country,
        status: 'planned',
      },
    }),
    officialSource({
      title: 'GOV.UK — Naturalization with indefinite leave or settled status',
      url: OFFICIAL_URLS.uk_naturalization,
      source_type: 'official_guidance',
      jurisdictions: ['826'],
      language: 'en',
      monitoring: {
        source_id: 'gov-uk-citizenship',
        method: 'http',
        url: OFFICIAL_URLS.uk_naturalization,
        status: 'planned',
      },
    }),
  ];
}

function requireSource(sources: SourceRecord[], url: string): SourceRecord {
  const source = sources.find(item => item.url === url);
  if (!source) throw new Error(`Canonical source is missing: ${url}`);
  return source;
}

const IBERO_AMERICAN_BENEFICIARIES = [
  '020', // Andorra
  '032', // Argentina
  '068', // Bolivia
  '076', // Brazil
  '152', // Chile
  '170', // Colombia
  '188', // Costa Rica
  '192', // Cuba
  '214', // Dominican Republic
  '218', // Ecuador
  '222', // El Salvador
  '226', // Equatorial Guinea
  '320', // Guatemala
  '340', // Honduras
  '484', // Mexico
  '558', // Nicaragua
  '591', // Panama
  '600', // Paraguay
  '604', // Peru
  '608', // Philippines
  '620', // Portugal
  '858', // Uruguay
  '862', // Venezuela
] as const;

function arrangementSources(shadow: DataShadow): ManualPilotSource[] {
  const eu = shadow.arrangements.find(item => item.record.id === 'eu_eea');
  const mercosur = shadow.arrangements.find(item => item.record.id === 'mercosur');
  if (!eu || !mercosur) throw new Error('Pilot arrangements are incomplete');
  const euMembers = 'members' in eu.record
    ? eu.record.members.map(member => member.iso_n3)
    : [];
  const mercosurMembers = 'members' in mercosur.record
    ? mercosur.record.members.map(member => member.iso_n3)
    : [];
  return [
    {
      arrangement_id: 'eu_eea',
      record: officialSource({
        title: 'Directive 2004/38/EC — free movement and residence of Union citizens',
        url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32004L0038',
        source_type: 'primary_law',
        jurisdictions: euMembers,
      }),
      supports_fields: ['/rights_by_status/citizenship'],
    },
    {
      arrangement_id: 'eu_eea',
      record: officialSource({
        title: 'Directive 2003/109/EC — status of third-country nationals who are long-term residents',
        url: 'https://eur-lex.europa.eu/eli/dir/2003/109/',
        source_type: 'primary_law',
        jurisdictions: euMembers,
      }),
      supports_fields: ['/rights_by_status/permanent_residence'],
      note: 'Directive scope and participating states require country-level interpretation.',
    },
    {
      arrangement_id: 'eu_eea',
      record: officialSource({
        title: 'EEA Agreement — Main Part, including Article 28',
        url: 'https://www.efta.int/sites/default/files/media/documents/legal-texts/eea/the-eea-agreement/Main%20Text%20of%20the%20Agreement/EEAagreement.pdf',
        source_type: 'treaty',
        jurisdictions: euMembers,
      }),
      supports_fields: ['/participants/members', '/rights_by_status/citizenship'],
      note: 'Supports EEA free-movement coverage; citizenship remains domestic.',
    },
    {
      arrangement_id: 'eu_eea',
      record: officialSource({
        title: 'EU–Switzerland Agreement on the free movement of persons',
        url: 'https://eur-lex.europa.eu/legal-content/en/ALL/?uri=CELEX:22002A0430(01)',
        source_type: 'treaty',
        jurisdictions: euMembers,
      }),
      supports_fields: ['/participants/members', '/rights_by_status/citizenship'],
      note: 'Supports the Swiss linkage; Switzerland is not an EEA member.',
    },
    {
      arrangement_id: 'mercosur',
      record: officialSource({
        title: 'MERCOSUR Decision CMC 28/02 — Residence Agreement',
        url: 'https://sim.mercosur.int/norma/DEC/28/2002',
        source_type: 'treaty',
        jurisdictions: mercosurMembers,
      }),
      supports_fields: [
        '/rights_by_status/temporary_residence',
        '/rights_by_status/permanent_residence',
      ],
    },
    {
      arrangement_id: 'mercosur',
      record: officialSource({
        title: 'MERCOSUR Citizenship Statute — circulation of persons',
        url: 'https://www.mercosur.int/wp-content/uploads/2025/02/estatuto-ciudadania-mercosur-es_MAR2026_ECM.pdf',
        source_type: 'official_guidance',
        jurisdictions: mercosurMembers,
      }),
      supports_fields: [
        '/participants/members',
        '/rights_by_status/temporary_residence',
        '/rights_by_status/permanent_residence',
      ],
    },
    {
      arrangement_id: 'spain_iberoamerican',
      record: officialSource({
        title: 'Spanish Civil Code — Article 22',
        url: 'https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763',
        source_type: 'primary_law',
        jurisdictions: ['724', ...IBERO_AMERICAN_BENEFICIARIES],
      }),
      supports_fields: [
        '/participants/beneficiaries',
        '/pathways/two_year_naturalization/eligibility',
        '/pathways/two_year_naturalization/timeline/eligibility_minimum_months',
      ],
    },
    {
      arrangement_id: 'spain_iberoamerican',
      record: officialSource({
        title: 'Spain General Administration — acquisition of nationality by residence',
        url: 'https://administracion.gob.es/pag_Home/Tu-espacio-europeo/derechos-obligaciones/ciudadanos/residencia/obtencion-nacionalidad.html',
        source_type: 'official_guidance',
        jurisdictions: ['724', ...IBERO_AMERICAN_BENEFICIARIES],
      }),
      supports_fields: [
        '/pathways/two_year_naturalization/eligibility',
        '/pathways/two_year_naturalization/timeline/eligibility_minimum_months',
      ],
    },
    {
      arrangement_id: 'spain_iberoamerican',
      record: officialSource({
        title: 'BOE — full members of the Ibero-American community of nations',
        url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2022-10484',
        source_type: 'official_guidance',
        jurisdictions: ['724', ...IBERO_AMERICAN_BENEFICIARIES],
      }),
      supports_fields: ['/participants/beneficiaries'],
      note: 'Used with Civil Code Article 22 to enumerate the Ibero-American category.',
    },
  ];
}

function franceRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === '250');
  const legacy = candidate?.routes.find(
    route => route.id === 'france-study-naturalization-residence',
  );
  if (!candidate || !legacy) throw new Error('France pilot route is missing');
  const [article17, article18, servicePublic, ceseda] = legacy.sources;
  if (!article17 || !article18 || !servicePublic || !ceseda) {
    throw new Error('France pilot sources are incomplete');
  }
  const descentSource = requireSource(officialSources, OFFICIAL_URLS.france_descent);
  const birthLawSource = requireSource(officialSources, OFFICIAL_URLS.france_birth_residence);
  const birthGuidanceSource = requireSource(officialSources, OFFICIAL_URLS.france_birth_guidance);
  const nationalityCode = requireSource(officialSources, OFFICIAL_URLS.france_nationality_code);
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:250',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'reviewed',
      confidence: legacy.confidence,
      last_checked: legacy.last_checked,
      note: 'All acquisition modes reviewed; the modeled routes focus on the principal public paths.',
    },
    coverage: [
      {
        mode: 'ancestry',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([descentSource], ['/coverage/ancestry']),
      },
      {
        mode: 'naturalization',
        finding: 'present',
        review: {
          state: 'reviewed',
          confidence: legacy.confidence,
          last_checked: legacy.last_checked,
          note: 'The mode is reviewed; ordinary and French higher-education variants are represented.',
        },
        source_refs: refs(
          [nationalityCode, ...legacy.sources],
          ['/coverage/naturalization'],
        ),
      },
      {
        mode: 'birth',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs(
          [birthLawSource, birthGuidanceSource],
          ['/coverage/birth'],
        ),
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        review: {
          state: 'reviewed',
          confidence: 'high',
          last_checked: '2026-07-21',
          note: 'No direct citizenship-by-investment route appears in the reviewed nationality provisions; residence-by-investment is separate.',
        },
        source_refs: refs([nationalityCode], ['/coverage/investment']),
      },
    ],
    routes: [{
      id: 'france-citizenship-by-parent',
      mode: 'ancestry',
      status: 'active',
      title: 'Citizenship through a French parent',
      summary: 'A child is French when at least one parent is French.',
      effective: { from: null, to: null, supersedes: [] },
      review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
      variants: [{
        id: 'french_parent',
        label: 'At least one French parent',
        outcome: 'citizenship',
        allocation: 'right',
        eligibility: [{
          field: 'parent.citizenship.iso_n3',
          operator: 'eq',
          value: '250',
        }],
        milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
        timeline: {
          eligibility_minimum_months: 0,
          processing_typical_months: null,
          confidence: 'high',
          note: 'The entitlement is by filiation; documentation and registration time are separate.',
        },
        source_refs: refs([descentSource], [
          '/routes/france-citizenship-by-parent/summary',
          '/routes/france-citizenship-by-parent/variants/french_parent/eligibility',
          '/routes/france-citizenship-by-parent/variants/french_parent/allocation',
        ]),
      }],
    }, {
      id: legacy.id,
      mode: legacy.mode,
      status: legacy.status,
      title: 'Naturalization after residence',
      summary: legacy.summary,
      effective: { from: null, to: null, supersedes: [] },
      review: {
        state: 'partial',
        confidence: legacy.confidence,
        last_checked: legacy.last_checked,
      },
      variants: [
        {
          id: 'ordinary',
          label: 'Ordinary residence',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [{
            field: 'residence.lawful_months',
            operator: 'gte',
            value: 60,
            unit: 'months',
          }],
          milestones: [
            { status: 'lawful_residence', minimum_months: 60 },
            { status: 'citizenship_application', minimum_months: 0 },
          ],
          timeline: {
            eligibility_minimum_months: 60,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Eligibility period only; naturalization remains discretionary.',
          },
          source_refs: [
            ...refs([article17], [
              '/routes/france-study-naturalization-residence/variants/ordinary/timeline/eligibility_minimum_months',
            ]),
            ...refs([servicePublic], [
              '/routes/france-study-naturalization-residence/variants/ordinary/allocation',
            ]),
          ],
        },
        {
          id: 'higher_education',
          label: 'French higher-education reduction',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [
            {
              field: 'education.completed_months',
              operator: 'gte',
              value: 24,
              unit: 'months',
              note: 'Toward a diploma from a French university or higher-education institution.',
            },
            {
              field: 'residence.status',
              operator: 'eq',
              value: 'student',
            },
          ],
          milestones: [
            { status: 'qualifying_higher_education', minimum_months: 24 },
            { status: 'citizenship_application', minimum_months: 0 },
          ],
          timeline: {
            eligibility_minimum_months: 24,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Reduced eligibility period, not a processing-time promise.',
          },
          source_refs: [
            ...refs([article18], [
              '/routes/france-study-naturalization-residence/variants/higher_education/eligibility/0',
              '/routes/france-study-naturalization-residence/variants/higher_education/timeline/eligibility_minimum_months',
            ]),
            ...refs([ceseda], [
              '/routes/france-study-naturalization-residence/variants/higher_education/eligibility/1',
            ]),
            ...refs([servicePublic], [
              '/routes/france-study-naturalization-residence/variants/higher_education/allocation',
            ]),
          ],
        },
      ],
    }, {
      id: 'france-birth-and-residence',
      mode: 'birth',
      status: 'active',
      title: 'Citizenship after birth and residence in France',
      summary: 'A person born in France to foreign parents can acquire citizenship at adulthood when the statutory residence conditions are met.',
      effective: { from: null, to: null, supersedes: [] },
      review: { state: 'partial', confidence: 'high', last_checked: '2026-07-21' },
      variants: [{
        id: 'automatic_at_majority',
        label: 'Automatic acquisition at adulthood',
        outcome: 'citizenship',
        allocation: 'right',
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '250' },
          { field: 'residence.current_jurisdiction', operator: 'eq', value: '250' },
          {
            field: 'residence.habitual_months_since_age_11',
            operator: 'gte',
            value: 60,
            unit: 'months',
          },
        ],
        milestones: [
          { status: 'birth_in_country', minimum_months: 0 },
          {
            status: 'habitual_residence_since_age_11',
            minimum_months: 60,
            note: 'At least five years in total since age 11.',
          },
          { status: 'citizenship_at_majority', minimum_months: null },
        ],
        timeline: {
          eligibility_minimum_months: null,
          processing_typical_months: null,
          confidence: 'high',
          note: 'This age-based rule cannot be represented as a simple countdown from arrival.',
        },
        source_refs: refs([birthLawSource, birthGuidanceSource], [
          '/routes/france-birth-and-residence/summary',
          '/routes/france-birth-and-residence/variants/automatic_at_majority/eligibility',
          '/routes/france-birth-and-residence/variants/automatic_at_majority/milestones',
        ]),
      }],
    }],
  });
}

function portugalRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === '620');
  const ordinary = candidate?.routes.find(
    route => route.id === 'portugal-ordinary-naturalization-2026',
  );
  const birth = candidate?.routes.find(
    route => route.id === 'portugal-birth-parent-residence-2026',
  );
  if (!candidate || !ordinary || !birth) throw new Error('Portugal pilot routes are missing');
  const nationalitySource = requireSource(officialSources, OFFICIAL_URLS.portugal_nationality);
  const applicationSource = requireSource(officialSources, OFFICIAL_URLS.portugal_applications);
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:620',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'reviewed',
      confidence: 'high',
      last_checked: ordinary.last_checked,
      note: 'All acquisition modes reviewed; the modeled routes focus on the principal public paths.',
    },
    coverage: [
      {
        mode: 'ancestry',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs(
          [nationalitySource, applicationSource],
          ['/coverage/ancestry'],
        ),
      },
      {
        mode: 'naturalization',
        finding: 'present',
        review: {
          state: 'reviewed',
          confidence: ordinary.confidence,
          last_checked: ordinary.last_checked,
        },
        source_refs: refs(ordinary.sources, ['/coverage/naturalization']),
      },
      {
        mode: 'birth',
        finding: 'present',
        review: {
          state: 'reviewed',
          confidence: birth.confidence,
          last_checked: birth.last_checked,
        },
        source_refs: refs(birth.sources, ['/coverage/birth']),
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        review: {
          state: 'reviewed',
          confidence: 'high',
          last_checked: '2026-07-21',
          note: 'The official nationality guide identifies no direct citizenship-by-investment route; investment residence is not citizenship.',
        },
        source_refs: refs(
          [nationalitySource, applicationSource],
          ['/coverage/investment'],
        ),
      },
    ],
    routes: [
      {
        id: 'portugal-citizenship-by-parent',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship through a Portuguese parent',
        summary: 'A person born abroad can obtain Portuguese nationality when a parent was Portuguese at the time of birth.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'portuguese_parent_at_birth',
          label: 'Portuguese parent at birth',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [{
            field: 'parent.citizenship.iso_n3',
            operator: 'eq',
            value: '620',
            note: 'The parent held Portuguese nationality when the child was born.',
          }],
          milestones: [
            { status: 'citizenship_entitlement', minimum_months: 0 },
            { status: 'civil_registration', minimum_months: null },
          ],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Eligibility is by descent; registration and processing time are separate.',
          },
          source_refs: refs([nationalitySource, applicationSource], [
            '/routes/portugal-citizenship-by-parent/summary',
            '/routes/portugal-citizenship-by-parent/variants/portuguese_parent_at_birth/eligibility',
            '/routes/portugal-citizenship-by-parent/variants/portuguese_parent_at_birth/allocation',
          ]),
        }],
      },
      {
        id: ordinary.id,
        mode: ordinary.mode,
        status: ordinary.status,
        title: 'Ordinary naturalization after legal residence',
        summary: ordinary.summary,
        effective: { from: '2026-05-19', to: null, supersedes: [] },
        review: {
          state: 'partial',
          confidence: ordinary.confidence,
          last_checked: ordinary.last_checked,
        },
        variants: [
          {
            id: 'cplp_or_eu_national',
            label: 'CPLP or EU national',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [{
              field: 'citizenship.bloc_any',
              operator: 'in',
              value: ['cplp', 'eu_eea'],
            }],
            milestones: [
              { status: 'legal_residence', minimum_months: 84 },
              { status: 'citizenship_application', minimum_months: 0 },
            ],
            timeline: {
              eligibility_minimum_months: 84,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Eligibility period for applications under the 2026 law.',
            },
            source_refs: refs(ordinary.sources, [
              '/routes/portugal-ordinary-naturalization-2026/effective/from',
              '/routes/portugal-ordinary-naturalization-2026/variants/cplp_or_eu_national/eligibility',
              '/routes/portugal-ordinary-naturalization-2026/variants/cplp_or_eu_national/timeline/eligibility_minimum_months',
            ]),
          },
          {
            id: 'other_national',
            label: 'Other national',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [],
            milestones: [
              { status: 'legal_residence', minimum_months: 120 },
              { status: 'citizenship_application', minimum_months: 0 },
            ],
            timeline: {
              eligibility_minimum_months: 120,
              processing_typical_months: null,
              confidence: 'high',
              note: 'General eligibility period for applications under the 2026 law.',
            },
            source_refs: refs(ordinary.sources, [
              '/routes/portugal-ordinary-naturalization-2026/effective/from',
              '/routes/portugal-ordinary-naturalization-2026/variants/other_national/timeline/eligibility_minimum_months',
            ]),
          },
        ],
      },
      {
        id: birth.id,
        mode: birth.mode,
        status: birth.status,
        title: 'Conditional citizenship through birth in Portugal',
        summary: birth.summary,
        effective: { from: '2026-05-19', to: null, supersedes: [] },
        review: {
          state: 'partial',
          confidence: birth.confidence,
          last_checked: birth.last_checked,
        },
        variants: [{
          id: 'parent_five_year_residence',
          label: 'Parent with five years of legal residence',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            {
              field: 'birth.jurisdiction',
              operator: 'eq',
              value: '620',
            },
            {
              field: 'parent.legal_residence_months',
              operator: 'gte',
              value: 60,
              unit: 'months',
            },
          ],
          milestones: [
            { status: 'parent_legal_residence', minimum_months: 60 },
            { status: 'birth', minimum_months: 0 },
          ],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'The five-year period applies to the parent before the child’s birth.',
          },
          source_refs: refs(birth.sources, [
            '/routes/portugal-birth-parent-residence-2026/effective/from',
            '/routes/portugal-birth-parent-residence-2026/variants/parent_five_year_residence/eligibility',
            '/routes/portugal-birth-parent-residence-2026/variants/parent_five_year_residence/timeline',
          ]),
        }],
      },
    ],
  });
}

function spainRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === '724');
  if (!candidate) throw new Error('Spain pilot jurisdiction is missing');
  const civilCode = requireSource(officialSources, OFFICIAL_URLS.spain_civil_code);
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:724',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'reviewed',
      confidence: 'high',
      last_checked: '2026-07-21',
      note: 'All acquisition modes reviewed; the modeled routes focus on the principal public paths.',
    },
    coverage: [
      {
        mode: 'ancestry',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([civilCode], ['/coverage/ancestry']),
      },
      {
        mode: 'naturalization',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([civilCode], ['/coverage/naturalization']),
      },
      {
        mode: 'birth',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([civilCode], ['/coverage/birth']),
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        review: {
          state: 'reviewed',
          confidence: 'high',
          last_checked: '2026-07-21',
          note: 'The reviewed Civil Code nationality provisions contain no direct citizenship-by-investment route; investment residence is separate.',
        },
        source_refs: refs([civilCode], ['/coverage/investment']),
      },
    ],
    routes: [
      {
        id: 'spain-citizenship-by-parent-or-option',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship through a Spanish parent or option',
        summary: 'Spain recognizes nationality by origin through a Spanish parent and an option route for some children of originally Spanish parents.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'partial', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'spanish_parent',
            label: 'Spanish parent',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [{
              field: 'parent.citizenship.iso_n3',
              operator: 'eq',
              value: '724',
            }],
            milestones: [{ status: 'citizenship_by_origin', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Nationality by origin; documentation time is separate.',
            },
            source_refs: refs([civilCode], [
              '/routes/spain-citizenship-by-parent-or-option/variants/spanish_parent/eligibility',
              '/routes/spain-citizenship-by-parent-or-option/variants/spanish_parent/allocation',
            ]),
          },
          {
            id: 'originally_spanish_parent_born_in_spain',
            label: 'Option through an originally Spanish parent born in Spain',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              {
                field: 'parent.citizenship.originally_spanish',
                operator: 'eq',
                value: true,
              },
              { field: 'parent.birth.jurisdiction', operator: 'eq', value: '724' },
            ],
            milestones: [{ status: 'nationality_option', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'high',
              note: 'A statutory option route under Civil Code Article 20.',
            },
            source_refs: refs([civilCode], [
              '/routes/spain-citizenship-by-parent-or-option/variants/originally_spanish_parent_born_in_spain/eligibility',
              '/routes/spain-citizenship-by-parent-or-option/variants/originally_spanish_parent_born_in_spain/allocation',
            ]),
          },
        ],
      },
      {
        id: 'spain-citizenship-by-birth',
        mode: 'birth',
        status: 'active',
        title: 'Citizenship through birth in Spain',
        summary: 'Birth in Spain can confer nationality by origin in specific parentage or statelessness cases.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'partial', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'foreign_parent_born_in_spain',
            label: 'Foreign parent also born in Spain',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'birth.jurisdiction', operator: 'eq', value: '724' },
              { field: 'parent.birth.jurisdiction', operator: 'eq', value: '724' },
              {
                field: 'parent.diplomatic_exception',
                operator: 'neq',
                value: true,
              },
            ],
            milestones: [{ status: 'citizenship_by_origin', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'high',
            },
            source_refs: refs([civilCode], [
              '/routes/spain-citizenship-by-birth/variants/foreign_parent_born_in_spain/eligibility',
            ]),
          },
          {
            id: 'no_nationality_transmitted',
            label: 'No nationality transmitted by either parent',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'birth.jurisdiction', operator: 'eq', value: '724' },
              {
                field: 'parent.nationality_transmitted',
                operator: 'eq',
                value: false,
                note: 'Applies where both parents are stateless or neither parent’s law grants nationality to the child.',
              },
            ],
            milestones: [{ status: 'citizenship_by_origin', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'high',
            },
            source_refs: refs([civilCode], [
              '/routes/spain-citizenship-by-birth/variants/no_nationality_transmitted/eligibility',
            ]),
          },
        ],
      },
      {
        id: 'spain-naturalization-by-residence',
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after legal residence',
        summary: 'The general residence period is ten years, with shorter statutory periods for refugees and specified groups.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'partial', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'ordinary',
            label: 'Ordinary residence',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [{
              field: 'residence.lawful_months',
              operator: 'gte',
              value: 120,
              unit: 'months',
            }],
            milestones: [
              { status: 'lawful_residence', minimum_months: 120 },
              { status: 'citizenship_application', minimum_months: 0 },
            ],
            timeline: {
              eligibility_minimum_months: 120,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Eligibility period only; the grant is not automatic.',
            },
            source_refs: refs([civilCode], [
              '/routes/spain-naturalization-by-residence/variants/ordinary/eligibility',
              '/routes/spain-naturalization-by-residence/variants/ordinary/timeline/eligibility_minimum_months',
              '/routes/spain-naturalization-by-residence/variants/ordinary/allocation',
            ]),
          },
          {
            id: 'recognized_refugee',
            label: 'Recognized refugee',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'protection.refugee_status', operator: 'eq', value: true },
              {
                field: 'residence.lawful_months',
                operator: 'gte',
                value: 60,
                unit: 'months',
              },
            ],
            milestones: [
              { status: 'lawful_residence', minimum_months: 60 },
              { status: 'citizenship_application', minimum_months: 0 },
            ],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Five-year residence period for a person recognized as a refugee.',
            },
            source_refs: refs([civilCode], [
              '/routes/spain-naturalization-by-residence/variants/recognized_refugee/eligibility',
              '/routes/spain-naturalization-by-residence/variants/recognized_refugee/timeline/eligibility_minimum_months',
            ]),
          },
          {
            id: 'born_in_spain',
            label: 'Born in Spain',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'birth.jurisdiction', operator: 'eq', value: '724' },
              {
                field: 'residence.lawful_months',
                operator: 'gte',
                value: 12,
                unit: 'months',
              },
            ],
            milestones: [
              { status: 'lawful_residence', minimum_months: 12 },
              { status: 'citizenship_application', minimum_months: 0 },
            ],
            timeline: {
              eligibility_minimum_months: 12,
              processing_typical_months: null,
              confidence: 'high',
              note: 'One-year residence period for a person born in Spanish territory.',
            },
            source_refs: refs([civilCode], [
              '/routes/spain-naturalization-by-residence/variants/born_in_spain/eligibility',
              '/routes/spain-naturalization-by-residence/variants/born_in_spain/timeline/eligibility_minimum_months',
            ]),
          },
        ],
      },
    ],
  });
}

function germanyRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === '276');
  if (!candidate) throw new Error('Germany jurisdiction is missing');
  const law = requireSource(officialSources, OFFICIAL_URLS.germany_nationality_act);
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:276',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'reviewed',
      confidence: 'high',
      last_checked: '2026-07-21',
      note: 'All acquisition modes reviewed against the Nationality Act; principal public paths are modeled.',
    },
    coverage: [
      {
        mode: 'ancestry',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([law], ['/coverage/ancestry']),
      },
      {
        mode: 'naturalization',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([law], ['/coverage/naturalization']),
      },
      {
        mode: 'birth',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([law], ['/coverage/birth']),
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        review: {
          state: 'reviewed',
          confidence: 'high',
          last_checked: '2026-07-21',
          note: 'Section 3 enumerates the acquisition modes and contains no direct citizenship-by-investment route.',
        },
        source_refs: refs([law], ['/coverage/investment']),
      },
    ],
    routes: [
      {
        id: 'germany-citizenship-by-parent',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship through a German parent',
        summary: 'A child generally acquires German citizenship at birth when at least one parent is German.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'german_parent',
          label: 'German parent at birth',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [{
            field: 'parent.citizenship.iso_n3',
            operator: 'eq',
            value: '276',
            note: 'For some births abroad, section 4(4) requires registration within one year.',
          }],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Citizenship is acquired at birth when the statutory conditions are met.',
          },
          source_refs: refs([law], [
            '/routes/germany-citizenship-by-parent/summary',
            '/routes/germany-citizenship-by-parent/variants/german_parent/eligibility',
          ]),
        }],
      },
      {
        id: 'germany-naturalization-by-residence',
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after residence',
        summary: 'The standard entitlement uses five years of lawful ordinary residence, with a shorter rule for spouses of Germans.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'ordinary',
            label: 'Standard five-year route',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [{
              field: 'residence.lawful_ordinary_months',
              operator: 'gte',
              value: 60,
              unit: 'months',
            }],
            milestones: [
              { status: 'lawful_ordinary_residence', minimum_months: 60 },
              { status: 'citizenship_application', minimum_months: 0 },
            ],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Other requirements in section 10 still apply.',
            },
            source_refs: refs([law], [
              '/routes/germany-naturalization-by-residence/variants/ordinary/eligibility',
              '/routes/germany-naturalization-by-residence/variants/ordinary/timeline',
            ]),
          },
          {
            id: 'spouse_of_german',
            label: 'Spouse or registered partner of a German',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'partner.citizenship.iso_n3', operator: 'eq', value: '276' },
              { field: 'residence.lawful_ordinary_months', operator: 'gte', value: 36, unit: 'months' },
              { field: 'relationship.duration_months', operator: 'gte', value: 24, unit: 'months' },
            ],
            milestones: [
              { status: 'lawful_ordinary_residence', minimum_months: 36 },
              { status: 'qualifying_relationship', minimum_months: 24 },
            ],
            timeline: {
              eligibility_minimum_months: 36,
              processing_typical_months: null,
              confidence: 'high',
              note: 'The residence and relationship requirements operate together.',
            },
            source_refs: refs([law], [
              '/routes/germany-naturalization-by-residence/variants/spouse_of_german/eligibility',
            ]),
          },
        ],
      },
      {
        id: 'germany-citizenship-by-birth',
        mode: 'birth',
        status: 'active',
        title: 'Citizenship by birth in Germany',
        summary: 'A child of foreign parents born in Germany acquires citizenship when one parent meets the residence and permanent-status conditions.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'qualifying_parent_residence',
          label: 'Parent resident for five years with permanent status',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '276' },
            { field: 'parent.residence.lawful_ordinary_months', operator: 'gte', value: 60, unit: 'months' },
            { field: 'parent.residence.permanent_right', operator: 'eq', value: true },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'The five-year period is a condition already met by the parent before birth.',
          },
          source_refs: refs([law], [
            '/routes/germany-citizenship-by-birth/summary',
            '/routes/germany-citizenship-by-birth/variants/qualifying_parent_residence/eligibility',
          ]),
        }],
      },
    ],
  });
}

function irelandRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === '372');
  if (!candidate) throw new Error('Ireland jurisdiction is missing');
  const descent = requireSource(officialSources, OFFICIAL_URLS.ireland_born_abroad);
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.ireland_naturalization);
  const birthLaw = requireSource(officialSources, OFFICIAL_URLS.ireland_birth_law);
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:372',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'reviewed',
      confidence: 'high',
      last_checked: '2026-07-21',
      note: 'All acquisition modes reviewed; principal descent, residence, and birth paths are modeled.',
    },
    coverage: [
      {
        mode: 'ancestry',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([descent], ['/coverage/ancestry']),
      },
      {
        mode: 'naturalization',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([naturalization], ['/coverage/naturalization']),
      },
      {
        mode: 'birth',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([birthLaw], ['/coverage/birth']),
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        review: {
          state: 'reviewed',
          confidence: 'medium',
          last_checked: '2026-07-21',
          note: 'The official citizenship guide identifies no direct citizenship-by-investment route.',
        },
        source_refs: refs([naturalization, descent], ['/coverage/investment']),
      },
    ],
    routes: [
      {
        id: 'ireland-citizenship-by-descent',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship through an Irish parent or grandparent',
        summary: 'Citizenship may be automatic through an Irish-born parent or available through Foreign Birth Registration in specified overseas cases.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'irish_born_parent',
            label: 'Parent born on the island of Ireland',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [{ field: 'parent.birth.island_of_ireland', operator: 'eq', value: true }],
            milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'high',
              note: 'The Department of Foreign Affairs describes this category as automatic.',
            },
            source_refs: refs([descent], [
              '/routes/ireland-citizenship-by-descent/variants/irish_born_parent/eligibility',
            ]),
          },
          {
            id: 'foreign_birth_registration',
            label: 'Foreign Birth Registration',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [{
              field: 'grandparent.birth.island_of_ireland',
              operator: 'eq',
              value: true,
              note: 'Also covers specified cases where a parent was an Irish citizen before the birth but was born abroad.',
            }],
            milestones: [{ status: 'foreign_birth_registration', minimum_months: null }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Citizenship begins when the person is entered on the Foreign Births Register.',
            },
            source_refs: refs([descent], [
              '/routes/ireland-citizenship-by-descent/variants/foreign_birth_registration/eligibility',
              '/routes/ireland-citizenship-by-descent/variants/foreign_birth_registration/timeline',
            ]),
          },
        ],
      },
      {
        id: 'ireland-naturalization-by-residence',
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after reckonable residence',
        summary: 'The standard adult route requires five years of reckonable residence in the previous nine, including one continuous year immediately before applying.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'ordinary',
          label: 'Standard adult naturalization',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [
            { field: 'residence.reckonable_months_previous_108', operator: 'gte', value: 60, unit: 'months' },
            { field: 'residence.continuous_months_immediately_before', operator: 'gte', value: 12, unit: 'months' },
          ],
          milestones: [
            { status: 'reckonable_residence', minimum_months: 60 },
            { status: 'citizenship_application', minimum_months: 0 },
          ],
          timeline: {
            eligibility_minimum_months: 60,
            processing_typical_months: null,
            confidence: 'high',
            note: 'The Minister retains discretion and other statutory conditions apply.',
          },
          source_refs: refs([naturalization], [
            '/routes/ireland-naturalization-by-residence/summary',
            '/routes/ireland-naturalization-by-residence/variants/ordinary/eligibility',
          ]),
        }],
      },
      {
        id: 'ireland-citizenship-by-birth',
        mode: 'birth',
        status: 'active',
        title: 'Citizenship by birth on the island of Ireland',
        summary: 'For births from 2005, citizenship depends on a parent’s citizenship, entitlement, or qualifying residence before the birth.',
        effective: { from: '2005-01-01', to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'citizen_or_entitled_parent',
            label: 'Irish citizen or entitled parent',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'birth.island_of_ireland', operator: 'eq', value: true },
              { field: 'parent.irish_citizenship_or_entitlement', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
            timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
            source_refs: refs([birthLaw], [
              '/routes/ireland-citizenship-by-birth/variants/citizen_or_entitled_parent/eligibility',
            ]),
          },
          {
            id: 'qualifying_parent_residence',
            label: 'Parent resident for three of the previous four years',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'birth.island_of_ireland', operator: 'eq', value: true },
              { field: 'parent.residence.reckonable_months_previous_48', operator: 'gte', value: 36, unit: 'months' },
            ],
            milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Specified study and protection-processing periods do not count toward the parent’s residence calculation.',
            },
            source_refs: refs([birthLaw], [
              '/routes/ireland-citizenship-by-birth/variants/qualifying_parent_residence/eligibility',
              '/routes/ireland-citizenship-by-birth/variants/qualifying_parent_residence/timeline',
            ]),
          },
        ],
      },
    ],
  });
}

function unitedKingdomRecord(
  shadow: DataShadow,
  officialSources: SourceRecord[],
): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === '826');
  if (!candidate) throw new Error('United Kingdom jurisdiction is missing');
  const parent = requireSource(officialSources, OFFICIAL_URLS.uk_british_parent);
  const birth = requireSource(officialSources, OFFICIAL_URLS.uk_born_in_country);
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.uk_naturalization);
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:826',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'reviewed',
      confidence: 'high',
      last_checked: '2026-07-21',
      note: 'All acquisition modes reviewed; principal parent, birth, and settlement paths are modeled.',
    },
    coverage: [
      {
        mode: 'ancestry',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([parent], ['/coverage/ancestry']),
      },
      {
        mode: 'naturalization',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([naturalization], ['/coverage/naturalization']),
      },
      {
        mode: 'birth',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        source_refs: refs([birth], ['/coverage/birth']),
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        review: {
          state: 'reviewed',
          confidence: 'medium',
          last_checked: '2026-07-21',
          note: 'The official citizenship routes reviewed contain no direct citizenship-by-investment route.',
        },
        source_refs: refs([naturalization, parent, birth], ['/coverage/investment']),
      },
    ],
    routes: [
      {
        id: 'uk-citizenship-by-parent',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship through a British parent',
        summary: 'British citizenship can usually pass one generation to a child born outside the UK, subject to the parent’s status and the date and place of birth.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'british_parent',
          label: 'British parent',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [{
            field: 'parent.british_citizenship',
            operator: 'eq',
            value: true,
            note: 'Automatic transmission depends on how the parent became British and the child’s birth circumstances.',
          }],
          milestones: [{ status: 'citizenship_at_birth_or_registration', minimum_months: 0 }],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Some categories are automatic and others require registration.',
          },
          source_refs: refs([parent], [
            '/routes/uk-citizenship-by-parent/summary',
            '/routes/uk-citizenship-by-parent/variants/british_parent/eligibility',
          ]),
        }],
      },
      {
        id: 'uk-naturalization-after-settlement',
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after settlement',
        summary: 'The standard route combines five years of residence with at least 12 months holding indefinite leave, settled status, or indefinite leave to enter.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'ordinary',
            label: 'Standard settled route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'residence.lawful_months', operator: 'gte', value: 60, unit: 'months' },
              { field: 'residence.settled_status_months', operator: 'gte', value: 12, unit: 'months' },
            ],
            milestones: [
              { status: 'qualifying_residence', minimum_months: 60 },
              { status: 'settled_status', minimum_months: 12 },
            ],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: 6,
              confidence: 'high',
              note: 'The residence and settled-status periods overlap when settlement was obtained earlier.',
            },
            source_refs: refs([naturalization], [
              '/routes/uk-naturalization-after-settlement/summary',
              '/routes/uk-naturalization-after-settlement/variants/ordinary/eligibility',
              '/routes/uk-naturalization-after-settlement/variants/ordinary/timeline',
            ]),
          },
          {
            id: 'spouse_of_british_citizen',
            label: 'Spouse or civil partner of a British citizen',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'partner.british_citizenship', operator: 'eq', value: true },
              { field: 'residence.lawful_months', operator: 'gte', value: 36, unit: 'months' },
              { field: 'residence.settled_status', operator: 'eq', value: true },
            ],
            milestones: [
              { status: 'qualifying_residence', minimum_months: 36 },
              { status: 'settled_status', minimum_months: 0 },
            ],
            timeline: {
              eligibility_minimum_months: 36,
              processing_typical_months: 6,
              confidence: 'high',
              note: 'No additional 12-month wait after settlement applies to this variant.',
            },
            source_refs: refs([naturalization], [
              '/routes/uk-naturalization-after-settlement/variants/spouse_of_british_citizen/eligibility',
            ]),
          },
        ],
      },
      {
        id: 'uk-citizenship-by-birth',
        mode: 'birth',
        status: 'active',
        title: 'Citizenship by birth in the UK',
        summary: 'For births from 1983, a child is normally automatically British when a parent is British or settled at the time of birth.',
        effective: { from: '1983-01-01', to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'british_or_settled_parent',
          label: 'British or settled parent',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '826' },
            { field: 'parent.british_or_settled_at_birth', operator: 'eq', value: true },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
          source_refs: refs([birth], [
            '/routes/uk-citizenship-by-birth/summary',
            '/routes/uk-citizenship-by-birth/variants/british_or_settled_parent/eligibility',
          ]),
        }],
      },
    ],
  });
}

function regionalArrangement(
  shadow: DataShadow,
  id: 'eu_eea' | 'mercosur',
  manualSources: ManualPilotSource[],
): ArrangementRecord {
  const candidate = shadow.arrangements.find(item => item.record.id === id);
  if (!candidate || candidate.arrangement_kind !== 'bloc') {
    throw new Error(`Regional pilot ${id} is missing`);
  }
  const bloc = candidate.record as Extract<typeof candidate.record, { rights: unknown }>;
  return ArrangementRecordSchema.parse({
    schema_version: 1,
    entity_type: 'arrangement',
    id: bloc.id,
    kind: 'regional',
    name: bloc.name,
    status: 'active',
    directionality: 'symmetric',
    participants: {
      members: bloc.members.map(member => member.iso_n3),
      former_members: bloc.former_members?.map(member => member.iso_n3) ?? [],
      destinations: [],
      beneficiaries: [],
    },
    display: {
      category: bloc.category,
      strength: bloc.strength,
      color: bloc.color,
    },
    rights_by_status: {
      temporary_residence: bloc.rights.TR,
      permanent_residence: bloc.rights.PR,
      citizenship: bloc.rights.CIT,
    },
    pathways: [],
    editorial: {
      fastest_entry: bloc.fastest_entry,
      notes: bloc.notes,
    },
    review: {
      state: 'partial',
      confidence: 'medium',
      last_checked: '2026-07-19',
      note: 'Core official instruments are linked; country-level implementation and scope exceptions remain to be reviewed.',
    },
    source_refs: manualSources
      .filter(source => source.arrangement_id === id)
      .map(source => ({
        source_id: source.record.id,
        supports_fields: source.supports_fields,
        ...(source.note ? { note: source.note } : {}),
      })),
  });
}

function spainIberoArrangement(
  shadow: DataShadow,
  manualSources: ManualPilotSource[],
): ArrangementRecord {
  const candidate = shadow.arrangements.find(
    item => item.record.id === 'spain_iberoamerican',
  );
  if (!candidate || candidate.arrangement_kind !== 'bilateral_lane') {
    throw new Error('Spain Ibero-American pilot is missing');
  }
  const lane = candidate.record as Extract<typeof candidate.record, { destination: unknown }>;
  const beneficiaryIsos = [...IBERO_AMERICAN_BENEFICIARIES];
  return ArrangementRecordSchema.parse({
    schema_version: 1,
    entity_type: 'arrangement',
    id: lane.id,
    kind: 'bilateral',
    name: lane.name,
    status: 'active',
    directionality: 'asymmetric',
    participants: {
      members: [],
      former_members: [],
      destinations: [lane.destination.iso_n3],
      beneficiaries: beneficiaryIsos,
      beneficiaries_note: lane.beneficiaries_note,
    },
    display: {
      category: 'one_way',
      strength: 0.8,
      color: lane.color,
    },
    rights_by_status: {
      temporary_residence: '',
      permanent_residence: '',
      citizenship: lane.grants,
    },
    pathways: [{
      id: 'two_year_naturalization',
      label: 'Two-year naturalization eligibility',
      outcome: 'citizenship',
      allocation: 'discretionary',
      eligibility: [
        {
          field: 'citizenship.iso_n3',
          operator: 'in',
          value: beneficiaryIsos,
        },
        {
          field: 'residence.lawful_months',
          operator: 'gte',
          value: 24,
          unit: 'months',
        },
      ],
      milestones: [
        { status: 'lawful_residence', minimum_months: 24 },
        { status: 'citizenship_application', minimum_months: 0 },
      ],
      timeline: {
        eligibility_minimum_months: 24,
        processing_typical_months: null,
        confidence: 'high',
        note: 'Two-year legal-residence eligibility period; processing time remains separate and unverified.',
      },
      source_refs: manualSources
        .filter(source => source.arrangement_id === lane.id)
        .filter(source => source.supports_fields.some(field => field.startsWith('/pathways/')))
        .map(source => ({
          source_id: source.record.id,
          supports_fields: source.supports_fields.filter(field => field.startsWith('/pathways/')),
          ...(source.note ? { note: source.note } : {}),
        })),
    }],
    editorial: { limits: lane.limits },
    review: {
      state: 'partial',
      confidence: 'high',
      last_checked: '2026-07-19',
      note: 'Official law and guidance reviewed; beneficiary enumeration corrected in the candidate and awaits compatibility cutover.',
    },
    source_refs: manualSources
      .filter(source => source.arrangement_id === lane.id)
      .map(source => ({
        ...source,
        supports_fields: source.supports_fields.filter(field => !field.startsWith('/pathways/')),
      }))
      .filter(source => source.supports_fields.length > 0)
      .map(source => ({
        source_id: source.record.id,
        supports_fields: source.supports_fields,
        ...(source.note ? { note: source.note } : {}),
      })),
  });
}

function pointerExists(root: unknown, pointer: string): boolean {
  let current = root;
  for (const rawPart of pointer.slice(1).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      const index = /^\d+$/.test(part) ? Number(part) : -1;
      if (index >= 0) {
        if (index >= current.length) return false;
        current = current[index];
        continue;
      }
      const identified = current.find(item => {
        if (typeof item !== 'object' || item === null) return false;
        if ('id' in item && item.id === part) return true;
        return 'mode' in item && item.mode === part;
      });
      if (identified === undefined) return false;
      current = identified;
      continue;
    }
    if (
      typeof current !== 'object'
      || current === null
      || !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

function validateReferences(pilot: CanonicalPilot, shadow: DataShadow): void {
  const sourceIds = new Set(pilot.sources.map(source => source.id));
  const entityIds = new Set<string>();
  for (const entity of [...pilot.jurisdictions, ...pilot.arrangements]) {
    if (entityIds.has(entity.id)) throw new Error(`Duplicate canonical entity ${entity.id}`);
    entityIds.add(entity.id);
  }
  for (const entity of [...pilot.jurisdictions, ...pilot.arrangements]) {
    const references = entity.entity_type === 'jurisdiction'
      ? [
          ...entity.coverage.flatMap(item => item.source_refs),
          ...entity.routes.flatMap(route =>
            route.variants.flatMap(variant => variant.source_refs)),
        ]
      : [
          ...entity.source_refs,
          ...entity.pathways.flatMap(pathway => pathway.source_refs),
        ];
    for (const reference of references) {
      if (!sourceIds.has(reference.source_id)) {
        throw new Error(`Missing canonical source ${reference.source_id}`);
      }
      if (new Set(reference.supports_fields).size !== reference.supports_fields.length) {
        throw new Error(`Duplicate supports_fields for ${reference.source_id}`);
      }
      for (const field of reference.supports_fields) {
        if (!pointerExists(entity, field)) {
          throw new Error(`${reference.source_id} supports missing field ${entity.id}${field}`);
        }
      }
    }
    if (entity.review.state === 'reviewed' && entity.review.last_checked === null) {
      throw new Error(`Reviewed entity ${entity.id} requires last_checked`);
    }
  }

  const arrangementIds = new Set([
    ...shadow.compatibility.mobility.blocs.map(bloc => bloc.id),
    ...shadow.compatibility.mobility.bilateral_lanes.map(lane => lane.id),
  ]);
  for (const jurisdiction of pilot.jurisdictions) {
    for (const condition of jurisdiction.routes.flatMap(route =>
      route.variants.flatMap(variant => variant.eligibility))) {
      if (condition.field === 'citizenship.bloc_any') {
        const ids = Array.isArray(condition.value) ? condition.value : [];
        for (const id of ids) {
          if (typeof id !== 'string' || !arrangementIds.has(id)) {
            throw new Error(`Unknown arrangement eligibility reference ${String(id)}`);
          }
        }
      }
      if (condition.field === 'citizenship.iso_n3') {
        const isos = Array.isArray(condition.value) ? condition.value : [];
        for (const iso of isos) {
          if (typeof iso !== 'string' || !/^\d{3}$/.test(iso)) {
            throw new Error(`Invalid citizenship eligibility reference ${String(iso)}`);
          }
        }
      }
    }
  }
}

export function buildCanonicalPilot(shadow = buildDataShadow()): CanonicalPilot {
  const countrySources = jurisdictionSources();
  const jurisdictions = [
    franceRecord(shadow, countrySources),
    germanyRecord(shadow, countrySources),
    irelandRecord(shadow, countrySources),
    portugalRecord(shadow, countrySources),
    spainRecord(shadow, countrySources),
    unitedKingdomRecord(shadow, countrySources),
  ];
  const manualSources = arrangementSources(shadow);
  const sourcesById = new Map<string, SourceRecord>();
  for (const jurisdiction of shadow.jurisdictions) {
    for (const route of jurisdiction.routes) {
      for (const source of route.sources) {
        const canonical = toSource(source, jurisdiction.jurisdiction.iso_n3, route.last_checked);
        const existing = sourcesById.get(canonical.id);
        if (existing && existing.url !== canonical.url) {
          throw new Error(`Source ID collision ${canonical.id}`);
        }
        if (existing) {
          if (
            existing.publisher !== canonical.publisher
            || existing.source_type !== canonical.source_type
          ) {
            throw new Error(`Conflicting metadata for canonical source ${canonical.id}`);
          }
          sourcesById.set(canonical.id, {
            ...existing,
            jurisdictions: [...new Set([
              ...existing.jurisdictions,
              ...canonical.jurisdictions,
            ])].sort(),
            last_checked: existing.last_checked > canonical.last_checked
              ? existing.last_checked
              : canonical.last_checked,
          });
        } else {
          sourcesById.set(canonical.id, canonical);
        }
      }
    }
  }
  for (const manual of manualSources) {
    const existing = sourcesById.get(manual.record.id);
    if (existing && existing.url !== manual.record.url) {
      throw new Error(`Source ID collision ${manual.record.id}`);
    }
    sourcesById.set(manual.record.id, manual.record);
  }
  for (const source of countrySources) {
    const existing = sourcesById.get(source.id);
    if (existing && existing.url !== source.url) {
      throw new Error(`Source ID collision ${source.id}`);
    }
    if (existing) {
      sourcesById.set(source.id, {
        ...source,
        jurisdictions: [...new Set([
          ...existing.jurisdictions,
          ...source.jurisdictions,
        ])].sort(),
        last_checked: existing.last_checked > source.last_checked
          ? existing.last_checked
          : source.last_checked,
      });
    } else {
      sourcesById.set(source.id, source);
    }
  }
  const sources = [...sourcesById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const arrangements = [
    regionalArrangement(shadow, 'eu_eea', manualSources),
    regionalArrangement(shadow, 'mercosur', manualSources),
    spainIberoArrangement(shadow, manualSources),
  ];
  const content = {
    sources,
    jurisdictions,
    arrangements,
    shadow_release_id: shadow.manifest.release_id,
  };
  const releaseId = hash(content, 16);
  const pilot: CanonicalPilot = {
    ...content,
    release_id: releaseId,
    manifest: {
      schema_version: 1,
      mode: 'canonical_candidate',
      release_id: releaseId,
      shadow_release_id: shadow.manifest.release_id,
      counts: {
        sources: sources.length,
        jurisdictions: jurisdictions.length,
        arrangements: arrangements.length,
        routes: jurisdictions.reduce((count, item) => count + item.routes.length, 0),
      },
    },
  };
  validateReferences(pilot, shadow);
  return pilot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeCanonicalPilot(
  pilot: CanonicalPilot,
  root = REPO_ROOT,
): string {
  const releaseRoot = path.join(
    root,
    '.generated/data-canonical/releases',
    pilot.release_id,
  );
  for (const source of pilot.sources) {
    writeJson(path.join(releaseRoot, 'sources', `${source.id.replace(/:/g, '--')}.json`), source);
  }
  for (const jurisdiction of pilot.jurisdictions) {
    writeJson(
      path.join(releaseRoot, 'jurisdictions', `${jurisdiction.jurisdiction.iso_n3}.json`),
      jurisdiction,
    );
  }
  for (const arrangement of pilot.arrangements) {
    writeJson(path.join(releaseRoot, 'arrangements', `${arrangement.id}.json`), arrangement);
  }
  writeJson(path.join(releaseRoot, 'manifest.json'), pilot.manifest);
  writeJson(path.join(root, '.generated/data-canonical/latest.json'), {
    release_id: pilot.release_id,
    manifest: `releases/${pilot.release_id}/manifest.json`,
  });
  return releaseRoot;
}

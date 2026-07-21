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
  france_birth_no_nationality: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419453/',
  france_birth_parent_born_france: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419425/',
  france_birth_diplomatic_exception: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419523/',
  france_birth_residence: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039366780/',
  france_birth_minor_declaration: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419871/',
  france_birth_guidance: 'https://www.service-public.fr/particuliers/vosdroits/F295',
  france_nationality_code: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006070721/2026-01-01',
  portugal_nationality: 'https://justica.gov.pt/registos/nacionalidade/nacionalidade-portuguesa',
  portugal_applications: 'https://justica.gov.pt/Servicos/Submeter-pedido-de-nacionalidade',
  spain_civil_code: 'https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763',
  germany_nationality_act: 'https://www.gesetze-im-internet.de/stag/',
  ireland_born_abroad: 'https://www.dfa.ie/citizenship/born-abroad/',
  ireland_naturalization: 'https://www.irishimmigration.ie/how-to-become-an-irish-citizen-guide/',
  ireland_birth_law: 'https://www.irishstatutebook.ie/eli/2004/act/38/section/4/enacted/en/html',
  uk_british_parent: 'https://www.gov.uk/apply-citizenship-british-parent',
  uk_born_in_country: 'https://www.gov.uk/apply-citizenship-born-uk/eligibility',
  uk_naturalization: 'https://www.gov.uk/apply-citizenship-indefinite-leave-to-remain',
  us_citizenship_abroad: 'https://travel.state.gov/content/travel/en/legal/travel-legal-considerations/us-citizenship/Acquisition-US-Citizenship-Child-Born-Abroad.html',
  us_citizenship_statute: 'https://uscode.house.gov/view.xhtml?edition=prelim&hl=false&req=granuleid%3AUSC-prelim-title8-section1401',
  us_naturalization: 'https://www.uscis.gov/sites/default/files/document/fact-sheets/DO_FactSheet_NaturalizationForLawfulPermanentResidents_wTorUNonimmigrantStatus_V3_508.pdf',
  us_eb5: 'https://www.uscis.gov/eb-5',
  canada_citizenship_status: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/canadian-citizenship/become-canadian-citizen/eligibility/already-citizen.html',
  canada_naturalization: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/canadian-citizenship/adult-minor/who.html',
  canada_pr_status: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/permanent-residents/status.html',
  australia_citizenship_act: 'https://www.legislation.gov.au/C2007A00020/latest/text',
  australia_descent: 'https://immi.homeaffairs.gov.au/citizenship/become-a-citizen/by-descent',
  australia_naturalization: 'https://immi.homeaffairs.gov.au/help-support/tools/residence-calculator',
  australia_investor_closure: 'https://immi.homeaffairs.gov.au/what-we-do/skilled-migration-program/recent-changes',
  nz_citizenship_types: 'https://www.govt.nz/browse/passports-citizenship-and-identity/nz-citizenship/types-of-citizenship-grant-birth-and-descent/',
  nz_citizenship_presence: 'https://www.govt.nz/browse/passports-citizenship-and-identity/nz-citizenship/requirements-for-nz-citizenship/presence-requirements/',
  nz_active_investor: 'https://www.immigration.govt.nz/visas/active-investor-plus-visa/',
  italy_citizenship: 'https://www.esteri.it/it/servizi-consolari-e-visti/normativa_consolare/serviziconsolari/cittadinanza/',
  italy_interior: 'https://www.interno.gov.it/it/temi/cittadinanza-e-altri-diritti-civili/cittadinanza',
  italy_investor_visa: 'https://investorvisa.mise.gov.it/index.php/en/investor-visa-how-it-works',
  netherlands_citizenship: 'https://www.government.nl/themes/migration-and-travel/dutch-citizenship/becoming-a-dutch-citizen',
  netherlands_birth: 'https://ind.nl/en/dutch-citizenship/dutch-citizen-by-birth-acknowledgment-or-adoption',
  netherlands_naturalization: 'https://ind.nl/en/dutch-citizenship/becoming-a-dutch-national-through-naturalisation',
  netherlands_nationality_act: 'https://wetten.overheid.nl/BWBR0003738/2023-10-01',
  switzerland_citizenship: 'https://www.sem.admin.ch/sem/en/home/integration-einbuergerung/schweizer-werden.html',
  switzerland_naturalization: 'https://www.sem.admin.ch/sem/en/home/integration-einbuergerung/schweizer-werden/ordentlich.html',
  switzerland_third_generation: 'https://www.sem.admin.ch/sem/en/home/integration-einbuergerung/schweizer-werden/3-generation.html',
  singapore_constitution: 'https://sso.agc.gov.sg/Act/CONS1963?ProvIds=P110-&ViewType=Advance',
  singapore_citizenship: 'https://www.ica.gov.sg/reside/citizenship',
  singapore_gip: 'https://www.edb.gov.sg/en/incentives-and-programmes/global-investor-programme.html',
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
      title: 'French Civil Code — Article 19-1',
      url: OFFICIAL_URLS.france_birth_no_nationality,
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
      title: 'French Civil Code — Article 19-3',
      url: OFFICIAL_URLS.france_birth_parent_born_france,
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
      title: 'French Civil Code — Article 20-5',
      url: OFFICIAL_URLS.france_birth_diplomatic_exception,
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
      title: 'French Civil Code — Article 21-11',
      url: OFFICIAL_URLS.france_birth_minor_declaration,
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
      title: 'German Nationality Act (Staatsangehörigkeitsgesetz)',
      url: OFFICIAL_URLS.germany_nationality_act,
      source_type: 'primary_law',
      jurisdictions: ['276'],
      language: 'de',
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
    ...[
      ['U.S. Department of State — Citizenship at birth abroad', OFFICIAL_URLS.us_citizenship_abroad, '840'],
      ['U.S. Code — 8 USC 1401', OFFICIAL_URLS.us_citizenship_statute, '840'],
      ['USCIS — Naturalization for lawful permanent residents', OFFICIAL_URLS.us_naturalization, '840'],
      ['USCIS — EB-5 Immigrant Investor Program', OFFICIAL_URLS.us_eb5, '840'],
      ['IRCC — Check if you may be a Canadian citizen', OFFICIAL_URLS.canada_citizenship_status, '124'],
      ['IRCC — Canadian citizenship eligibility', OFFICIAL_URLS.canada_naturalization, '124'],
      ['IRCC — Understand permanent resident status', OFFICIAL_URLS.canada_pr_status, '124'],
      ['Australian Citizenship Act 2007', OFFICIAL_URLS.australia_citizenship_act, '036'],
      ['Australian Home Affairs — Citizenship by descent', OFFICIAL_URLS.australia_descent, '036'],
      ['Australian Home Affairs — Citizenship residence calculator', OFFICIAL_URLS.australia_naturalization, '036'],
      ['Australian Home Affairs — Skilled migration recent changes', OFFICIAL_URLS.australia_investor_closure, '036'],
      ['New Zealand Government — Citizenship by birth, descent and grant', OFFICIAL_URLS.nz_citizenship_types, '554'],
      ['New Zealand Government — Citizenship presence requirements', OFFICIAL_URLS.nz_citizenship_presence, '554'],
      ['Immigration New Zealand — Active Investor Plus Visa', OFFICIAL_URLS.nz_active_investor, '554'],
      ['Italian Ministry of Foreign Affairs — Citizenship', OFFICIAL_URLS.italy_citizenship, '380'],
      ['Italian Ministry of the Interior — Citizenship', OFFICIAL_URLS.italy_interior, '380'],
      ['Italian Ministry of Enterprises — Investor Visa', OFFICIAL_URLS.italy_investor_visa, '380'],
      ['Government of the Netherlands — Becoming a Dutch citizen', OFFICIAL_URLS.netherlands_citizenship, '528'],
      ['IND — Dutch citizen by birth, acknowledgment or adoption', OFFICIAL_URLS.netherlands_birth, '528'],
      ['IND — Dutch citizenship through naturalisation', OFFICIAL_URLS.netherlands_naturalization, '528'],
      ['Netherlands Nationality Act', OFFICIAL_URLS.netherlands_nationality_act, '528'],
      ['Swiss SEM — Acquiring Swiss citizenship', OFFICIAL_URLS.switzerland_citizenship, '756'],
      ['Swiss SEM — Ordinary naturalisation', OFFICIAL_URLS.switzerland_naturalization, '756'],
      ['Swiss SEM — Third-generation naturalisation', OFFICIAL_URLS.switzerland_third_generation, '756'],
      ['Constitution of the Republic of Singapore — Citizenship', OFFICIAL_URLS.singapore_constitution, '702'],
      ['Singapore ICA — Becoming a Singapore citizen', OFFICIAL_URLS.singapore_citizenship, '702'],
      ['Singapore EDB — Global Investor Programme', OFFICIAL_URLS.singapore_gip, '702'],
    ].map(([title, url, jurisdiction]) => officialSource({
      title,
      url,
      source_type: url.includes('uscode.house.gov') || url.includes('legislation.gov.au')
        || url.includes('wetten.overheid.nl') || url.includes('sso.agc.gov.sg')
        ? 'primary_law'
        : 'official_guidance',
      jurisdictions: [jurisdiction],
      language: 'en',
      monitoring: {
        source_id: {
          '036': 'australia-citizenship-guidance',
          '124': 'canada-citizenship-guidance',
          '554': 'nz-citizenship-guidance',
          '380': 'italy-citizenship-guidance',
          '528': 'netherlands-citizenship-guidance',
          '702': 'singapore-citizenship-guidance',
          '756': 'switzerland-citizenship-guidance',
          '840': 'us-citizenship-guidance',
        }[jurisdiction]!,
        method: 'http',
        url,
        status: 'planned',
      },
    })),
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
  const birthNoNationalitySource = requireSource(
    officialSources,
    OFFICIAL_URLS.france_birth_no_nationality,
  );
  const birthParentBornFranceSource = requireSource(
    officialSources,
    OFFICIAL_URLS.france_birth_parent_born_france,
  );
  const birthDiplomaticExceptionSource = requireSource(
    officialSources,
    OFFICIAL_URLS.france_birth_diplomatic_exception,
  );
  const birthLawSource = requireSource(officialSources, OFFICIAL_URLS.france_birth_residence);
  const birthMinorDeclarationSource = requireSource(
    officialSources,
    OFFICIAL_URLS.france_birth_minor_declaration,
  );
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
          [
            birthNoNationalitySource,
            birthParentBornFranceSource,
            birthDiplomaticExceptionSource,
            birthLawSource,
            birthMinorDeclarationSource,
            birthGuidanceSource,
          ],
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
      title: 'Citizenship through birth and residence in France',
      summary: 'Birth in France alone is not generally enough. Limited parentage or statelessness cases confer citizenship at birth; otherwise a child of foreign parents can acquire it from age 13, 16, or automatically at 18 when the residence conditions are met.',
      effective: { from: null, to: null, supersedes: [] },
      review: { state: 'partial', confidence: 'high', last_checked: '2026-07-21' },
      variants: [
        {
          id: 'parent_born_in_france',
          label: 'Born in France to a parent also born in France',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '250' },
            { field: 'parent.birth.jurisdiction', operator: 'eq', value: '250' },
            { field: 'parent.diplomatic_exception', operator: 'neq', value: true },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Citizenship from birth under the double-jus-soli rule, subject to the diplomatic exception.',
          },
          source_refs: refs([birthParentBornFranceSource, birthDiplomaticExceptionSource], [
            '/routes/france-birth-and-residence/variants/parent_born_in_france/eligibility',
            '/routes/france-birth-and-residence/variants/parent_born_in_france/milestones',
          ]),
        },
        {
          id: 'no_nationality_transmitted',
          label: 'Stateless parents or no nationality transmitted',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '250' },
            {
              field: 'parent.nationality_transmitted',
              operator: 'eq',
              value: false,
              note: 'Both parents are stateless or neither parent’s nationality law transmits nationality to the child.',
            },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Citizenship from birth where the child would otherwise receive no nationality from either parent.',
          },
          source_refs: refs([birthNoNationalitySource], [
            '/routes/france-birth-and-residence/variants/no_nationality_transmitted/eligibility',
            '/routes/france-birth-and-residence/variants/no_nationality_transmitted/milestones',
          ]),
        },
        {
          id: 'declaration_from_age_13',
          label: 'Parent declaration from age 13',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '250' },
            { field: 'parent.citizenship.foreign', operator: 'eq', value: true },
            { field: 'person.age_years', operator: 'gte', value: 13, unit: 'years' },
            { field: 'residence.current_jurisdiction', operator: 'eq', value: '250' },
            {
              field: 'residence.habitual_months_since_age_8',
              operator: 'gte',
              value: 60,
              unit: 'months',
            },
            { field: 'child.consent', operator: 'eq', value: true },
          ],
          milestones: [
            { status: 'birth_in_country', minimum_months: 0 },
            { status: 'parental_nationality_declaration', minimum_months: null },
          ],
          timeline: {
            eligibility_minimum_months: null,
            processing_typical_months: null,
            confidence: 'high',
            note: 'From age 13, a parent may declare with the child’s consent after at least five years of habitual residence in France since age 8.',
          },
          source_refs: refs([birthMinorDeclarationSource, birthGuidanceSource], [
            '/routes/france-birth-and-residence/variants/declaration_from_age_13/eligibility',
            '/routes/france-birth-and-residence/variants/declaration_from_age_13/milestones',
          ]),
        },
        {
          id: 'declaration_from_age_16',
          label: 'Personal declaration from age 16',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '250' },
            { field: 'parent.citizenship.foreign', operator: 'eq', value: true },
            { field: 'person.age_years', operator: 'gte', value: 16, unit: 'years' },
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
            { status: 'nationality_declaration', minimum_months: null },
          ],
          timeline: {
            eligibility_minimum_months: null,
            processing_typical_months: null,
            confidence: 'high',
            note: 'At age 16 or 17, the child may declare while living in France after at least five years of habitual residence since age 11.',
          },
          source_refs: refs([birthMinorDeclarationSource, birthGuidanceSource], [
            '/routes/france-birth-and-residence/variants/declaration_from_age_16/eligibility',
            '/routes/france-birth-and-residence/variants/declaration_from_age_16/milestones',
          ]),
        },
        {
          id: 'automatic_at_majority',
          label: 'Automatic acquisition at age 18',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '250' },
            { field: 'parent.citizenship.foreign', operator: 'eq', value: true },
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
            note: 'Automatic at age 18 if the person lives in France then and has accumulated at least five years of habitual residence since age 11.',
          },
          source_refs: refs([birthLawSource, birthGuidanceSource], [
            '/routes/france-birth-and-residence/summary',
            '/routes/france-birth-and-residence/variants/automatic_at_majority/eligibility',
            '/routes/france-birth-and-residence/variants/automatic_at_majority/milestones',
          ]),
        },
      ],
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
        summary: 'Birth in Spain alone does not generally confer citizenship. Nationality by origin applies in limited parentage, statelessness, or undetermined-parentage cases.',
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
          {
            id: 'undetermined_parentage',
            label: 'Undetermined parentage',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'birth.jurisdiction', operator: 'eq', value: '724' },
              { field: 'parentage.determined', operator: 'eq', value: false },
            ],
            milestones: [{ status: 'citizenship_by_origin', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Spanish origin nationality applies when parentage is undetermined; the Civil Code also presumes certain found minors were born in Spain.',
            },
            source_refs: refs([civilCode], [
              '/routes/spain-citizenship-by-birth/variants/undetermined_parentage/eligibility',
              '/routes/spain-citizenship-by-birth/variants/undetermined_parentage/timeline',
            ]),
          },
        ],
      },
      {
        id: 'spain-naturalization-by-residence',
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after legal residence',
        summary: 'The general residence period is ten years and five years for recognized refugees. A person born in Spain who is not already Spanish by origin can apply after one year of legal, continuous residence immediately before applying; the grant is not automatic.',
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
              note: 'One year of legal, continuous residence immediately before the application. Article 22 also requires good civic conduct and sufficient integration; the grant is not automatic.',
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

function reviewedCountryRecord({
  shadow,
  iso,
  note,
  coverage,
  routes,
}: {
  shadow: DataShadow;
  iso: string;
  note: string;
  coverage: Array<{
    mode: 'ancestry' | 'naturalization' | 'birth' | 'investment';
    finding: 'present' | 'verified_none';
    sources: SourceRecord[];
    confidence?: 'high' | 'medium';
    note?: string;
  }>;
  routes: JurisdictionRecord['routes'];
}): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === iso);
  if (!candidate) throw new Error(`Jurisdiction ${iso} is missing`);
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: `jurisdiction:${iso}`,
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'reviewed',
      confidence: 'high',
      last_checked: '2026-07-21',
      note,
    },
    coverage: coverage.map(item => ({
      mode: item.mode,
      finding: item.finding,
      review: {
        state: 'reviewed',
        confidence: item.confidence ?? 'high',
        last_checked: '2026-07-21',
        ...(item.note ? { note: item.note } : {}),
      },
      source_refs: refs(item.sources, [`/coverage/${item.mode}`]),
    })),
    routes,
  });
}

function unitedStatesRecord(
  shadow: DataShadow,
  officialSources: SourceRecord[],
): JurisdictionRecord {
  const abroad = requireSource(officialSources, OFFICIAL_URLS.us_citizenship_abroad);
  const statute = requireSource(officialSources, OFFICIAL_URLS.us_citizenship_statute);
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.us_naturalization);
  const eb5 = requireSource(officialSources, OFFICIAL_URLS.us_eb5);
  return reviewedCountryRecord({
    shadow,
    iso: '840',
    note: 'All acquisition modes reviewed; principal citizenship-at-birth, parent-transmission, and LPR naturalization paths are modeled.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [abroad] },
      { mode: 'naturalization', finding: 'present', sources: [naturalization] },
      { mode: 'birth', finding: 'present', sources: [statute] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [eb5, naturalization],
        note: 'EB-5 is a lawful-permanent-residence program; citizenship still requires a separate naturalization path.',
      },
    ],
    routes: [
      {
        id: 'us-citizenship-at-birth-abroad',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship at birth through a U.S. citizen parent',
        summary: 'A child born abroad can acquire citizenship at birth when the citizen parent meets the applicable residence, physical-presence, parentage, and date-of-birth rules.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'one_us_citizen_parent',
          label: 'One U.S. citizen parent for births from 14 November 1986',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'parent.citizenship.iso_n3', operator: 'eq', value: '840' },
            { field: 'parent.us_physical_presence_months', operator: 'gte', value: 60, unit: 'months' },
            { field: 'parent.us_physical_presence_after_age_14_months', operator: 'gte', value: 24, unit: 'months' },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Different historical and family configurations use different statutory tests.',
          },
          source_refs: refs([abroad], [
            '/routes/us-citizenship-at-birth-abroad/summary',
            '/routes/us-citizenship-at-birth-abroad/variants/one_us_citizen_parent/eligibility',
          ]),
        }],
      },
      {
        id: 'us-naturalization-after-lpr',
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after permanent residence',
        summary: 'The standard route requires five years as a lawful permanent resident and at least 30 months of physical presence in that period.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'standard_five_year',
          label: 'Five-year LPR route',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'residence.lpr_months', operator: 'gte', value: 60, unit: 'months' },
            { field: 'residence.physical_presence_months_previous_60', operator: 'gte', value: 30, unit: 'months' },
          ],
          milestones: [{ status: 'lawful_permanent_residence', minimum_months: 60 }],
          timeline: {
            eligibility_minimum_months: 60,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Continuous residence, character, English, civics, and oath requirements also apply.',
          },
          source_refs: refs([naturalization], [
            '/routes/us-naturalization-after-lpr/summary',
            '/routes/us-naturalization-after-lpr/variants/standard_five_year/eligibility',
          ]),
        }],
      },
      {
        id: 'us-citizenship-by-birth',
        mode: 'birth',
        status: 'active',
        title: 'Citizenship by birth in the United States',
        summary: 'Federal statute grants citizenship at birth to a person born in the United States and subject to its jurisdiction.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'born_in_us_subject_to_jurisdiction',
          label: 'Born in the United States and subject to its jurisdiction',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '840' },
            { field: 'birth.subject_to_us_jurisdiction', operator: 'eq', value: true },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
          source_refs: refs([statute], [
            '/routes/us-citizenship-by-birth/summary',
            '/routes/us-citizenship-by-birth/variants/born_in_us_subject_to_jurisdiction/eligibility',
          ]),
        }],
      },
    ],
  });
}

function canadaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const status = requireSource(officialSources, OFFICIAL_URLS.canada_citizenship_status);
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.canada_naturalization);
  const permanentResidence = requireSource(officialSources, OFFICIAL_URLS.canada_pr_status);
  return reviewedCountryRecord({
    shadow,
    iso: '124',
    note: 'All acquisition modes reviewed against current post-15 December 2025 guidance; principal descent, birth, and grant paths are modeled.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [status] },
      { mode: 'naturalization', finding: 'present', sources: [naturalization] },
      { mode: 'birth', finding: 'present', sources: [status] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [permanentResidence, naturalization],
        note: 'Economic immigration can create permanent residence, but permanent residents are not citizens and must separately qualify for a citizenship grant.',
      },
    ],
    routes: [
      {
        id: 'canada-citizenship-by-descent',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship through a Canadian parent',
        summary: 'A child born abroad to a Canadian parent is generally a citizen; from 15 December 2025, a Canadian parent also born abroad must usually have spent 1,095 days in Canada before the child’s birth.',
        effective: { from: '2025-12-15', to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'canadian_parent_born_or_naturalized_in_canada',
            label: 'Canadian parent born or naturalized in Canada',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '124' }],
            milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
            timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
            source_refs: refs([status], [
              '/routes/canada-citizenship-by-descent/summary',
              '/routes/canada-citizenship-by-descent/variants/canadian_parent_born_or_naturalized_in_canada/eligibility',
            ]),
          },
          {
            id: 'canadian_parent_also_born_abroad',
            label: 'Canadian parent also born abroad',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'parent.citizenship.iso_n3', operator: 'eq', value: '124' },
              { field: 'parent.canada_physical_presence_days_before_birth', operator: 'gte', value: 1095, unit: 'days' },
            ],
            milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'high',
              note: 'This substantial-connection test applies to births on or after 15 December 2025.',
            },
            source_refs: refs([status], [
              '/routes/canada-citizenship-by-descent/variants/canadian_parent_also_born_abroad/eligibility',
              '/routes/canada-citizenship-by-descent/variants/canadian_parent_also_born_abroad/timeline',
            ]),
          },
        ],
      },
      {
        id: 'canada-citizenship-grant',
        mode: 'naturalization',
        status: 'active',
        title: 'Citizenship grant after physical presence',
        summary: 'An adult permanent resident generally needs 1,095 days of physical presence in the five-year eligibility period, including at least 730 days as a permanent resident.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'adult_standard',
          label: 'Standard adult grant',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'residence.permanent_status', operator: 'eq', value: true },
            { field: 'residence.physical_presence_days_previous_5_years', operator: 'gte', value: 1095, unit: 'days' },
            { field: 'residence.permanent_resident_days_previous_5_years', operator: 'gte', value: 730, unit: 'days' },
          ],
          milestones: [{ status: 'qualifying_physical_presence', minimum_months: 36 }],
          timeline: {
            eligibility_minimum_months: 36,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Tax, language, test, oath, and prohibition rules can also apply.',
          },
          source_refs: refs([naturalization], [
            '/routes/canada-citizenship-grant/summary',
            '/routes/canada-citizenship-grant/variants/adult_standard/eligibility',
          ]),
        }],
      },
      {
        id: 'canada-citizenship-by-birth',
        mode: 'birth',
        status: 'active',
        title: 'Citizenship by birth in Canada',
        summary: 'A person born in Canada is generally a citizen at birth, with a narrow exception for children of certain foreign diplomatic personnel.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'born_in_canada',
          label: 'Born in Canada',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '124' },
            { field: 'parent.foreign_diplomatic_exception', operator: 'neq', value: true },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
          source_refs: refs([status], [
            '/routes/canada-citizenship-by-birth/summary',
            '/routes/canada-citizenship-by-birth/variants/born_in_canada/eligibility',
          ]),
        }],
      },
    ],
  });
}

function australiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.australia_citizenship_act);
  const descent = requireSource(officialSources, OFFICIAL_URLS.australia_descent);
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.australia_naturalization);
  const investorClosure = requireSource(officialSources, OFFICIAL_URLS.australia_investor_closure);
  return reviewedCountryRecord({
    shadow,
    iso: '036',
    note: 'All acquisition modes reviewed; principal descent, conferral, and birth paths are modeled.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [descent, act] },
      { mode: 'naturalization', finding: 'present', sources: [naturalization, act] },
      { mode: 'birth', finding: 'present', sources: [act] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [act, investorClosure],
        note: 'The Citizenship Act contains no direct investment acquisition mode, and the former investor visa program closed to new applications in 2024.',
      },
    ],
    routes: [
      {
        id: 'australia-citizenship-by-descent',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship by descent',
        summary: 'A person born outside Australia may apply by descent when a parent was an Australian citizen at the time of birth.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'australian_parent',
          label: 'Australian citizen parent at birth',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '036' }],
          milestones: [{ status: 'citizenship_application', minimum_months: 0 }],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'If the parent was themselves a citizen by descent, a two-year lawful-presence condition can apply.',
          },
          source_refs: refs([descent, act], [
            '/routes/australia-citizenship-by-descent/summary',
            '/routes/australia-citizenship-by-descent/variants/australian_parent/eligibility',
          ]),
        }],
      },
      {
        id: 'australia-citizenship-by-conferral',
        mode: 'naturalization',
        status: 'active',
        title: 'Citizenship by conferral after residence',
        summary: 'The general residence requirement is four years on a valid visa, including the final 12 months as a permanent resident or eligible Special Category Visa holder.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'general_residence',
          label: 'General residence route',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [
            { field: 'residence.valid_visa_months', operator: 'gte', value: 48, unit: 'months' },
            { field: 'residence.permanent_or_scv_months', operator: 'gte', value: 12, unit: 'months' },
          ],
          milestones: [
            { status: 'lawful_residence', minimum_months: 48 },
            { status: 'permanent_residence_or_scv', minimum_months: 12 },
          ],
          timeline: {
            eligibility_minimum_months: 48,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Absence, character, test, and pledge requirements also apply.',
          },
          source_refs: refs([naturalization, act], [
            '/routes/australia-citizenship-by-conferral/summary',
            '/routes/australia-citizenship-by-conferral/variants/general_residence/eligibility',
          ]),
        }],
      },
      {
        id: 'australia-citizenship-by-birth',
        mode: 'birth',
        status: 'active',
        title: 'Citizenship by birth in Australia',
        summary: 'A child born in Australia is a citizen when a parent is a citizen or permanent resident, or when the child is ordinarily resident in Australia for the first ten years of life.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'citizen_or_permanent_parent',
            label: 'Citizen or permanent-resident parent at birth',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'birth.jurisdiction', operator: 'eq', value: '036' },
              { field: 'parent.australian_citizen_or_permanent_resident', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
            timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
            source_refs: refs([act], [
              '/routes/australia-citizenship-by-birth/summary',
              '/routes/australia-citizenship-by-birth/variants/citizen_or_permanent_parent/eligibility',
            ]),
          },
          {
            id: 'ten_year_ordinary_residence',
            label: 'First ten years ordinarily resident in Australia',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'birth.jurisdiction', operator: 'eq', value: '036' },
              { field: 'residence.ordinary_months_from_birth', operator: 'gte', value: 120, unit: 'months' },
            ],
            milestones: [{ status: 'citizenship_on_tenth_birthday', minimum_months: 120 }],
            timeline: { eligibility_minimum_months: 120, processing_typical_months: null, confidence: 'high' },
            source_refs: refs([act], [
              '/routes/australia-citizenship-by-birth/variants/ten_year_ordinary_residence/eligibility',
              '/routes/australia-citizenship-by-birth/variants/ten_year_ordinary_residence/timeline',
            ]),
          },
        ],
      },
    ],
  });
}

function newZealandRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const types = requireSource(officialSources, OFFICIAL_URLS.nz_citizenship_types);
  const presence = requireSource(officialSources, OFFICIAL_URLS.nz_citizenship_presence);
  const activeInvestor = requireSource(officialSources, OFFICIAL_URLS.nz_active_investor);
  return reviewedCountryRecord({
    shadow,
    iso: '554',
    note: 'All acquisition modes reviewed; principal birth, descent, and grant paths are modeled.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [types] },
      { mode: 'naturalization', finding: 'present', sources: [presence, types] },
      { mode: 'birth', finding: 'present', sources: [types] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [activeInvestor, types],
        note: 'Active Investor Plus is a resident visa; citizenship remains a separate grant under the ordinary citizenship rules.',
      },
    ],
    routes: [
      {
        id: 'nz-citizenship-by-descent',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship by descent',
        summary: 'A person born overseas can register as a citizen by descent when a parent was a New Zealand citizen by birth or grant at the time of birth.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'nz_parent_otherwise_than_descent',
          label: 'Parent citizen by birth or grant',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [{ field: 'parent.nz_citizenship_by_birth_or_grant', operator: 'eq', value: true }],
          milestones: [{ status: 'citizenship_by_descent_registration', minimum_months: 0 }],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'A citizen by descent generally cannot transmit citizenship to another overseas-born generation.',
          },
          source_refs: refs([types], [
            '/routes/nz-citizenship-by-descent/summary',
            '/routes/nz-citizenship-by-descent/variants/nz_parent_otherwise_than_descent/eligibility',
          ]),
        }],
      },
      {
        id: 'nz-citizenship-by-grant',
        mode: 'naturalization',
        status: 'active',
        title: 'Citizenship by grant after residence',
        summary: 'Most adults need five years as a resident, 1,350 days of physical presence in total, and at least 240 days in each of those five years.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'standard_presence',
          label: 'Standard five-year presence route',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [
            { field: 'residence.indefinite_right_months', operator: 'gte', value: 60, unit: 'months' },
            { field: 'residence.nz_presence_days_previous_5_years', operator: 'gte', value: 1350, unit: 'days' },
            { field: 'residence.nz_presence_days_each_year', operator: 'gte', value: 240, unit: 'days' },
          ],
          milestones: [{ status: 'qualifying_residence', minimum_months: 60 }],
          timeline: {
            eligibility_minimum_months: 60,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Language, character, and intention-to-reside requirements also apply.',
          },
          source_refs: refs([presence, types], [
            '/routes/nz-citizenship-by-grant/summary',
            '/routes/nz-citizenship-by-grant/variants/standard_presence/eligibility',
          ]),
        }],
      },
      {
        id: 'nz-citizenship-by-birth',
        mode: 'birth',
        status: 'active',
        title: 'Citizenship by birth in New Zealand',
        summary: 'For births from 1 January 2006, a child born in New Zealand is a citizen when at least one parent is a citizen or has the right to live in New Zealand indefinitely.',
        effective: { from: '2006-01-01', to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'citizen_or_resident_parent',
          label: 'Citizen or indefinitely resident parent',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '554' },
            { field: 'parent.nz_citizen_or_indefinite_residence', operator: 'eq', value: true },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
          source_refs: refs([types], [
            '/routes/nz-citizenship-by-birth/summary',
            '/routes/nz-citizenship-by-birth/variants/citizen_or_resident_parent/eligibility',
          ]),
        }],
      },
    ],
  });
}

function italyRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const citizenship = requireSource(officialSources, OFFICIAL_URLS.italy_citizenship);
  const interior = requireSource(officialSources, OFFICIAL_URLS.italy_interior);
  const investorVisa = requireSource(officialSources, OFFICIAL_URLS.italy_investor_visa);
  return reviewedCountryRecord({
    shadow,
    iso: '380',
    note: 'All acquisition modes reviewed against current post-2025 official guidance; principal routes are modeled.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [citizenship, interior] },
      { mode: 'naturalization', finding: 'present', sources: [citizenship, interior] },
      { mode: 'birth', finding: 'present', sources: [interior] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [citizenship, investorVisa],
        note: 'Investor Visa for Italy leads to a residence permit, not direct citizenship; citizenship remains governed by the ordinary statutory modes.',
      },
    ],
    routes: [
      {
        id: 'italy-citizenship-by-descent',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship through an Italian parent',
        summary: 'A child of an Italian citizen can acquire citizenship by descent, but the 2025 reform limits automatic transmission to foreign-born people who hold another citizenship unless a statutory connection exception applies.',
        effective: { from: '2025-05-24', to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'italian_parent_with_connection',
          label: 'Italian parent and statutory connection',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'parent.citizenship.iso_n3', operator: 'eq', value: '380' },
            {
              field: 'italy.post_2025_connection_exception',
              operator: 'eq',
              value: true,
              note: 'For a person born abroad who holds another citizenship, an exception in article 3-bis must apply; declarations for some minors are separately time-limited.',
            },
          ],
          milestones: [{ status: 'citizenship_entitlement_or_declaration', minimum_months: 0 }],
          timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
          source_refs: refs([citizenship], [
            '/routes/italy-citizenship-by-descent/summary',
            '/routes/italy-citizenship-by-descent/effective',
            '/routes/italy-citizenship-by-descent/variants/italian_parent_with_connection/eligibility',
          ]),
        }],
      },
      {
        id: 'italy-naturalization-by-residence',
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after legal residence',
        summary: 'The general route permits an application after ten years of legal residence, with shorter periods for specified groups.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'ordinary',
          label: 'General ten-year route',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [{ field: 'residence.legal_months', operator: 'gte', value: 120, unit: 'months' }],
          milestones: [{ status: 'legal_residence', minimum_months: 120 }],
          timeline: {
            eligibility_minimum_months: 120,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Other statutory requirements and differentiated residence periods can apply.',
          },
          source_refs: refs([interior, citizenship], [
            '/routes/italy-naturalization-by-residence/summary',
            '/routes/italy-naturalization-by-residence/variants/ordinary/eligibility',
            '/routes/italy-naturalization-by-residence/variants/ordinary/timeline',
          ]),
        }],
      },
      {
        id: 'italy-citizenship-connected-to-birth',
        mode: 'birth',
        status: 'active',
        title: 'Limited citizenship routes connected to birth in Italy',
        summary: 'Birth in Italy is not generally enough. Citizenship exists at birth in limited statelessness or non-transmission cases, while a foreign child born and continuously resident in Italy may declare citizenship after reaching adulthood.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'otherwise_stateless',
            label: 'Otherwise stateless at birth',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'birth.jurisdiction', operator: 'eq', value: '380' },
              { field: 'parent.nationality_transmitted', operator: 'eq', value: false },
            ],
            milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
            timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
            source_refs: refs([interior], ['/routes/italy-citizenship-connected-to-birth/variants/otherwise_stateless']),
          },
          {
            id: 'born_and_continuously_resident',
            label: 'Born and continuously resident until adulthood',
            outcome: 'citizenship',
            allocation: 'right',
            eligibility: [
              { field: 'birth.jurisdiction', operator: 'eq', value: '380' },
              { field: 'residence.legal_continuous_until_age_18', operator: 'eq', value: true },
              { field: 'declaration.within_one_year_of_age_18', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'citizenship_declaration_after_majority', minimum_months: 216 }],
            timeline: {
              eligibility_minimum_months: 216,
              processing_typical_months: null,
              confidence: 'high',
              note: 'This is later acquisition because of birth and residence, not unconditional citizenship at birth.',
            },
            source_refs: refs([citizenship, interior], [
              '/routes/italy-citizenship-connected-to-birth/summary',
              '/routes/italy-citizenship-connected-to-birth/variants/born_and_continuously_resident',
            ]),
          },
        ],
      },
    ],
  });
}

function netherlandsRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const overview = requireSource(officialSources, OFFICIAL_URLS.netherlands_citizenship);
  const birth = requireSource(officialSources, OFFICIAL_URLS.netherlands_birth);
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.netherlands_naturalization);
  const law = requireSource(officialSources, OFFICIAL_URLS.netherlands_nationality_act);
  return reviewedCountryRecord({
    shadow,
    iso: '528',
    note: 'All acquisition modes reviewed; automatic acquisition, option, and principal naturalization paths are distinguished.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [birth, law] },
      { mode: 'naturalization', finding: 'present', sources: [naturalization, law] },
      { mode: 'birth', finding: 'present', sources: [birth, law] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [overview, law],
        note: 'The official acquisition modes contain no direct citizenship-by-investment route.',
      },
    ],
    routes: [
      {
        id: 'netherlands-citizenship-by-parent',
        mode: 'ancestry',
        status: 'active',
        title: 'Dutch citizenship through a parent',
        summary: 'A child generally acquires Dutch citizenship automatically when the statutory Dutch-parent conditions are met at birth.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'dutch_parent_at_birth',
          label: 'Dutch parent at birth',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '528' }],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
          source_refs: refs([birth, law], [
            '/routes/netherlands-citizenship-by-parent/summary',
            '/routes/netherlands-citizenship-by-parent/variants/dutch_parent_at_birth/eligibility',
          ]),
        }],
      },
      {
        id: 'netherlands-naturalization-by-residence',
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after legal residence',
        summary: 'The standard naturalization route generally requires five consecutive years of lawful residence with a qualifying status.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'ordinary',
          label: 'Standard five-year route',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [{ field: 'residence.lawful_consecutive_months', operator: 'gte', value: 60, unit: 'months' }],
          milestones: [{ status: 'qualifying_lawful_residence', minimum_months: 60 }],
          timeline: {
            eligibility_minimum_months: 60,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Status, integration, public-order, and usually renunciation requirements also apply; statutory exceptions can shorten the term.',
          },
          source_refs: refs([naturalization, law], [
            '/routes/netherlands-naturalization-by-residence/summary',
            '/routes/netherlands-naturalization-by-residence/variants/ordinary/eligibility',
          ]),
        }],
      },
      {
        id: 'netherlands-third-generation-birth',
        mode: 'birth',
        status: 'active',
        title: 'Automatic citizenship for a qualifying third generation',
        summary: 'A child can acquire Dutch citizenship at birth under the statutory third-generation principal-residence rule even without a Dutch parent.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'third_generation_principal_residence',
          label: 'Third-generation principal-residence rule',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.kingdom_of_netherlands', operator: 'eq', value: true },
            { field: 'parent.principal_residence_in_kingdom_at_birth', operator: 'eq', value: true },
            { field: 'parent.qualifying_second_generation_connection', operator: 'eq', value: true },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
          source_refs: refs([birth, law], [
            '/routes/netherlands-third-generation-birth/summary',
            '/routes/netherlands-third-generation-birth/variants/third_generation_principal_residence/eligibility',
          ]),
        }],
      },
    ],
  });
}

function switzerlandRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const overview = requireSource(officialSources, OFFICIAL_URLS.switzerland_citizenship);
  const ordinary = requireSource(officialSources, OFFICIAL_URLS.switzerland_naturalization);
  const thirdGeneration = requireSource(officialSources, OFFICIAL_URLS.switzerland_third_generation);
  return reviewedCountryRecord({
    shadow,
    iso: '756',
    note: 'All acquisition modes reviewed; descent, ordinary naturalization, and the birthplace-linked third-generation route are modeled.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [overview] },
      { mode: 'naturalization', finding: 'present', sources: [ordinary, overview] },
      { mode: 'birth', finding: 'present', sources: [thirdGeneration, overview] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [overview, ordinary],
        note: 'Official citizenship guidance enumerates descent and naturalization routes, not direct citizenship by investment.',
      },
    ],
    routes: [
      {
        id: 'switzerland-citizenship-by-descent',
        mode: 'ancestry',
        status: 'active',
        title: 'Swiss citizenship through a parent',
        summary: 'Swiss citizenship is principally acquired through paternal or maternal descent rather than birthplace alone.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'swiss_parent',
          label: 'Swiss parent',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '756' }],
          milestones: [{ status: 'citizenship_by_descent', minimum_months: 0 }],
          timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
          source_refs: refs([overview], [
            '/routes/switzerland-citizenship-by-descent/summary',
            '/routes/switzerland-citizenship-by-descent/variants/swiss_parent/eligibility',
          ]),
        }],
      },
      {
        id: 'switzerland-ordinary-naturalization',
        mode: 'naturalization',
        status: 'active',
        title: 'Ordinary naturalization',
        summary: 'Ordinary naturalization generally requires ten years in Switzerland and a permanent C permit, alongside federal, cantonal, and communal requirements.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'ordinary',
          label: 'Ten-year route with C permit',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [
            { field: 'residence.counted_months', operator: 'gte', value: 120, unit: 'months' },
            { field: 'residence.permit', operator: 'eq', value: 'C' },
          ],
          milestones: [{ status: 'counted_residence', minimum_months: 120 }],
          timeline: {
            eligibility_minimum_months: 120,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Three years must fall within the five years before filing; cantonal and communal residence rules also apply.',
          },
          source_refs: refs([ordinary], [
            '/routes/switzerland-ordinary-naturalization/summary',
            '/routes/switzerland-ordinary-naturalization/variants/ordinary/eligibility',
          ]),
        }],
      },
      {
        id: 'switzerland-third-generation-naturalization',
        mode: 'birth',
        status: 'active',
        title: 'Facilitated naturalization for a third generation born in Switzerland',
        summary: 'Birth in Switzerland does not itself grant citizenship, but a qualifying third-generation applicant born there may use facilitated naturalization before age 25.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'third_generation',
          label: 'Third generation born in Switzerland',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '756' },
            { field: 'person.age_years', operator: 'lte', value: 24, unit: 'years' },
            { field: 'residence.permit', operator: 'eq', value: 'C' },
            { field: 'education.swiss_compulsory_years', operator: 'gte', value: 5, unit: 'years' },
            { field: 'family.third_generation_conditions_met', operator: 'eq', value: true },
          ],
          milestones: [{ status: 'facilitated_naturalization_application', minimum_months: null }],
          timeline: {
            eligibility_minimum_months: null,
            processing_typical_months: null,
            confidence: 'high',
            note: 'This is later facilitated naturalization connected to birthplace and family residence, not citizenship at birth.',
          },
          source_refs: refs([thirdGeneration, overview], [
            '/routes/switzerland-third-generation-naturalization/summary',
            '/routes/switzerland-third-generation-naturalization/variants/third_generation/eligibility',
          ]),
        }],
      },
    ],
  });
}

function singaporeRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.singapore_constitution);
  const citizenship = requireSource(officialSources, OFFICIAL_URLS.singapore_citizenship);
  const gip = requireSource(officialSources, OFFICIAL_URLS.singapore_gip);
  return reviewedCountryRecord({
    shadow,
    iso: '702',
    note: 'All acquisition modes reviewed against the current Constitution and official ICA/EDB guidance.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, citizenship] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, citizenship] },
      { mode: 'birth', finding: 'present', sources: [constitution] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, gip, citizenship],
        note: 'The Global Investor Programme grants permanent residence; citizenship requires a separate discretionary application under the ordinary citizenship framework.',
      },
    ],
    routes: [
      {
        id: 'singapore-citizenship-by-descent',
        mode: 'ancestry',
        status: 'active',
        title: 'Citizenship by descent',
        summary: 'A person born outside Singapore can acquire citizenship by descent through a Singapore citizen parent, subject to registration and additional connection rules where the parent is also a citizen by descent.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'singapore_citizen_parent',
          label: 'Singapore citizen parent',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'parent.citizenship.iso_n3', operator: 'eq', value: '702' },
            { field: 'birth.registered_within_one_year_or_extension', operator: 'eq', value: true },
          ],
          milestones: [{ status: 'citizenship_by_descent_registration', minimum_months: 0 }],
          timeline: {
            eligibility_minimum_months: 0,
            processing_typical_months: null,
            confidence: 'high',
            note: 'A citizen-by-descent parent must also satisfy the Constitution’s Singapore-residence connection test.',
          },
          source_refs: refs([constitution, citizenship], [
            '/routes/singapore-citizenship-by-descent/summary',
            '/routes/singapore-citizenship-by-descent/variants/singapore_citizen_parent/eligibility',
          ]),
        }],
      },
      {
        id: 'singapore-citizenship-after-pr',
        mode: 'naturalization',
        status: 'active',
        title: 'Citizenship application after permanent residence',
        summary: 'An adult permanent resident is eligible to apply after at least two years as a PR; approval remains discretionary.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'adult_pr',
          label: 'Adult permanent resident',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [
            { field: 'person.age_years', operator: 'gte', value: 21, unit: 'years' },
            { field: 'residence.permanent_months', operator: 'gte', value: 24, unit: 'months' },
          ],
          milestones: [{ status: 'permanent_residence', minimum_months: 24 }],
          timeline: {
            eligibility_minimum_months: 24,
            processing_typical_months: 12,
            confidence: 'high',
            note: 'Eligibility to apply is not an entitlement to approval; national-service and other rules can apply.',
          },
          source_refs: refs([citizenship, constitution], [
            '/routes/singapore-citizenship-after-pr/summary',
            '/routes/singapore-citizenship-after-pr/variants/adult_pr/eligibility',
            '/routes/singapore-citizenship-after-pr/variants/adult_pr/timeline',
          ]),
        }],
      },
      {
        id: 'singapore-citizenship-by-birth',
        mode: 'birth',
        status: 'active',
        title: 'Citizenship by birth in Singapore',
        summary: 'A person born in Singapore is a citizen by birth when at least one parent is a Singapore citizen, subject to the constitutional exceptions.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [{
          id: 'citizen_parent',
          label: 'Born in Singapore to a citizen parent',
          outcome: 'citizenship',
          allocation: 'right',
          eligibility: [
            { field: 'birth.jurisdiction', operator: 'eq', value: '702' },
            { field: 'parent.citizenship.iso_n3', operator: 'eq', value: '702' },
            { field: 'parent.constitutional_exception', operator: 'neq', value: true },
          ],
          milestones: [{ status: 'citizenship_at_birth', minimum_months: 0 }],
          timeline: { eligibility_minimum_months: 0, processing_typical_months: null, confidence: 'high' },
          source_refs: refs([constitution], [
            '/routes/singapore-citizenship-by-birth/summary',
            '/routes/singapore-citizenship-by-birth/variants/citizen_parent/eligibility',
          ]),
        }],
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
    australiaRecord(shadow, countrySources),
    canadaRecord(shadow, countrySources),
    franceRecord(shadow, countrySources),
    germanyRecord(shadow, countrySources),
    irelandRecord(shadow, countrySources),
    italyRecord(shadow, countrySources),
    netherlandsRecord(shadow, countrySources),
    newZealandRecord(shadow, countrySources),
    portugalRecord(shadow, countrySources),
    singaporeRecord(shadow, countrySources),
    spainRecord(shadow, countrySources),
    switzerlandRecord(shadow, countrySources),
    unitedKingdomRecord(shadow, countrySources),
    unitedStatesRecord(shadow, countrySources),
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

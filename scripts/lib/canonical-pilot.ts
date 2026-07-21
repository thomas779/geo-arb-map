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
  malta_citizenship: 'https://komunita.gov.mt/services/acquisition-of-citizenship/',
  malta_citizenship_act: 'https://legislation.mt/eli/cap/188/eng/pdf',
  malta_investment_repeal: 'https://www.gov.mt/en/Government/DOI/Press%20Releases/Pages/2025/07/16/PR251293en.aspx',
  malta_amendments: 'https://komunita.gov.mt/2025/09/02/amendments-to-the-maltese-citizenship-act-and-subsidiary-legislation/',
  malta_merit: 'https://komunita.gov.mt/wp-content/uploads/2026/02/Citizenship-by-Naturalisation-on-the-Basis-of-Merit.pdf',
  cyprus_origin: 'https://www.gov.cy/moi/en/ministry/departments/civil-registry-section/registry-office-2/cypriot-citizenship-nationality/acquisition-of-cypriot-citizenship-due-to-cypriot-origin/',
  cyprus_naturalization: 'https://www.gov.cy/moi/en/documents/acquisition-of-cypriot-citizenship-by-naturalization-due-to-years-of-residence-form-m127/',
  cyprus_investment_termination: 'https://cipregistry.mof.gov.cy/en/',
  turkiye_citizenship: 'https://nvi.gov.tr/turk-vatandasliginin-kazanilmasi',
  turkiye_citizenship_law: 'https://www.nvi.gov.tr/kurumlar/nvi.gov.tr/mevzuat/nufusmevzuat/ingilizce/TURKISH_CITIZENSHIP_LAW_5901.pdf',
  turkiye_investment: 'https://f.invest.gov.tr/en/investmentguide/pages/acquiring-property-and-citizenship.aspx',
  uruguay_constitution_birth: 'https://www.impo.com.uy/bases/constitucion/1967-1967/74',
  uruguay_nationality_law: 'https://www.impo.com.uy/bases/leyes/16021-1989',
  uruguay_legal_citizenship: 'https://www.gub.uy/tramites/carta-ciudadania',
  uruguay_tax_residence: 'https://www.gub.uy/direccion-general-impositiva/comunicacion/publicaciones/causales-residencia-fiscal',
  greece_citizenship_code: 'https://www.ypes.gr/kodikas-ellinikis-ithageneias/',
  greece_citizenship_supporting_documents: 'https://www.ypes.gr/en/acquisition-of-the-greek-citizenship-sup-doc/',
  greece_seven_year_naturalization: 'https://www.ypes.gr/t-theodorikakos-epimenoyme-elliniki-ithageneia-sta-7-chronia-ochi-se-3-chronia/',
  greece_golden_visa: 'https://migration.gov.gr/en/golden-visa/',
  bulgaria_citizenship_act: 'https://justice.government.bg/home/normdoc/2134446592',
  bulgaria_citizenship_directorate: 'https://justice.government.bg/home/index/dbg',
  bulgaria_investment_repeal: 'https://www.parliament.bg/en/news/ID/5424',
  serbia_citizenship_guidance: 'https://mup.gov.rs/wps/portal/sr/gradjani/dokumenta/Drzavljanstvo/',
  uae_nationality_law: 'https://elaws.moj.gov.ae/UAE-MOJ_LC-En/00_NATIONALITY/UAE-LC-En_1972-11-18_00017_Kait.html?val=EL1',
  uae_nationality_guidance: 'https://u.ae/en/information-and-services/passports-and-traveling/emirati-nationality',
  uae_golden_visa: 'https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/golden-visa',
  argentina_citizenship_law: 'https://www.argentina.gob.ar/normativa/nacional/ley-346-48854/actualizacion',
  argentina_investment_decree: 'https://www.argentina.gob.ar/normativa/nacional/decreto-524-2025-415710/texto',
  brazil_constitution: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm',
  brazil_migration_law: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2017/lei/l13445.htm',
  mexico_constitution: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/CPEUM.pdf',
  mexico_nationality_law: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LNac.pdf',
  colombia_nationality_law: 'https://www.cancilleria.gov.co/sites/default/files/Normograma/docs/ley_2332_2023.htm',
  colombia_visa_faq: 'https://www.cancilleria.gov.co/atencion-y-servicio-al-ciudadano/tramites-y-servicios/visa/abece-de-visas',
  colombia_visa_resolution: 'https://www.cancilleria.gov.co/sites/default/files/Normograma/docs/resolucion_minrelaciones_5477_2022.htm',
  colombia_student_visa: 'https://www.cancilleria.gov.co/node/26940',
  georgia_citizenship: 'https://sda.gov.ge/en/products/citizenship/',
  georgia_citizenship_law: 'https://matsne.gov.ge/en/document/view/2342552?publication=7',
  cayman_botc: 'https://otp.gov.ky/web/odg/botc-registration-and-naturalisation',
  cayman_status_reform: 'https://gov.ky/web/mcei/immigrationreform',
  uk_nationality_act: 'https://www.legislation.gov.uk/ukpga/1981/61/contents',
  dominica_citizenship: 'https://www.dominica.gov.dm/services/citizenship/how-do-i-apply-for-citizenship-of-the-commonwealth-of-dominica',
  dominica_forms: 'https://www.dominica.gov.dm/forms',
  dominica_constitution: 'https://www.dominica.gov.dm/laws/chapters/chap1-01.pdf',
  dominica_cbi_law: 'https://www.cbiu.gov.dm/dominica-citizenship/legislation/',
  dominica_cbi_options: 'https://www.cbiu.gov.dm/faqs/',
  dominica_cbi_home: 'https://www.cbiu.gov.dm/',
  st_kitts_constitution: 'https://lawcommission.gov.kn/wp-content/documents/Annual-Laws/The-Constitution-of-St-Christopher-and-Nevis.pdf',
  st_kitts_citizenship_act: 'https://lawcommission.gov.kn/wp-content/documents/Revised-Acts-of-St-Kitts-and-Nevis/Revised-Acts-of-St-Kitts-and-Nevis-2020/Ch-01_05-Saint-Christopher-and-Nevis-Citizenship-Act.pdf',
  st_kitts_cbi_options: 'https://ciu.gov.kn/cbi-options/',
  st_kitts_government_notices: 'https://ciu.gov.kn/government-notices/',
  st_kitts_application: 'https://ciu.gov.kn/application-process/',
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
    ...[
      ['Community Malta Agency — Acquisition of Citizenship', OFFICIAL_URLS.malta_citizenship, '470', 'en', 'official_guidance', 'komunita-malta'],
      ['Maltese Citizenship Act, Chapter 188', OFFICIAL_URLS.malta_citizenship_act, '470', 'en', 'primary_law', 'malta-legislation'],
      ['Government of Malta — citizenship programme discontinued', OFFICIAL_URLS.malta_investment_repeal, '470', 'en', 'official_guidance', 'komunita-malta'],
      ['Community Malta Agency — amendments to the Citizenship Act', OFFICIAL_URLS.malta_amendments, '470', 'en', 'official_guidance', 'komunita-malta'],
      ['Community Malta Agency — naturalisation on the basis of merit', OFFICIAL_URLS.malta_merit, '470', 'en', 'official_guidance', 'malta-legislation'],
      ['Cyprus Ministry of Interior — Citizenship due to Cypriot origin', OFFICIAL_URLS.cyprus_origin, '196', 'en', 'official_guidance', 'cyprus-citizenship-guidance'],
      ['Cyprus Ministry of Interior — Naturalization due to residence', OFFICIAL_URLS.cyprus_naturalization, '196', 'en', 'official_guidance', 'cyprus-citizenship-guidance'],
      ['Cyprus Ministry of Finance — Investment Programme termination', OFFICIAL_URLS.cyprus_investment_termination, '196', 'en', 'official_guidance', 'cyprus-investment-programme'],
      ['Türkiye NVI — Acquisition of Turkish citizenship', OFFICIAL_URLS.turkiye_citizenship, '792', 'tr', 'official_guidance', 'turkiye-citizenship-guidance'],
      ['Turkish Citizenship Law No. 5901', OFFICIAL_URLS.turkiye_citizenship_law, '792', 'en', 'primary_law', 'turkiye-citizenship-guidance'],
      ['Invest in Türkiye — Acquiring Property and Citizenship', OFFICIAL_URLS.turkiye_investment, '792', 'en', 'official_guidance', 'turkiye-investment-guidance'],
      ['Uruguay Constitution — Article 74', OFFICIAL_URLS.uruguay_constitution_birth, '858', 'es', 'primary_law', 'uruguay-nationality-law'],
      ['Uruguay Law No. 16.021 — Nationality', OFFICIAL_URLS.uruguay_nationality_law, '858', 'es', 'primary_law', 'uruguay-nationality-law'],
      ['Uruguay Electoral Court — Legal citizenship application', OFFICIAL_URLS.uruguay_legal_citizenship, '858', 'es', 'official_guidance', 'uruguay-citizenship-guidance'],
      ['Uruguay DGI — Tax residence through investment', OFFICIAL_URLS.uruguay_tax_residence, '858', 'es', 'official_guidance', 'uruguay-tax-residence'],
    ].map(([title, url, jurisdiction, language, sourceType, monitorId]) => officialSource({
      title,
      url,
      source_type: sourceType as SourceRecord['source_type'],
      jurisdictions: [jurisdiction],
      language,
      monitoring: {
        source_id: monitorId,
        method: 'http',
        url,
        status: 'planned',
      },
    })),
    ...[
      ['Greek Ministry of Interior — Citizenship Code', OFFICIAL_URLS.greece_citizenship_code, '300', 'el', 'primary_law', 'greece-citizenship'],
      ['Greek Ministry of Interior — Citizenship supporting documents', OFFICIAL_URLS.greece_citizenship_supporting_documents, '300', 'en', 'official_guidance', 'greece-citizenship'],
      ['Greek Ministry of Interior — seven-year naturalization period', OFFICIAL_URLS.greece_seven_year_naturalization, '300', 'el', 'official_guidance', 'greece-citizenship'],
      ['Greek Ministry of Migration — Golden Visa', OFFICIAL_URLS.greece_golden_visa, '300', 'en', 'official_guidance', 'greece-investor-residence'],
      ['Bulgarian Ministry of Justice — Citizenship Act', OFFICIAL_URLS.bulgaria_citizenship_act, '100', 'bg', 'primary_law', 'bulgaria-citizenship'],
      ['Bulgarian Ministry of Justice — Citizenship Directorate', OFFICIAL_URLS.bulgaria_citizenship_directorate, '100', 'bg', 'official_guidance', 'bulgaria-citizenship'],
      ['Bulgarian National Assembly — investment citizenship repealed', OFFICIAL_URLS.bulgaria_investment_repeal, '100', 'en', 'official_guidance', 'bulgaria-citizenship'],
      ['Serbian Ministry of Interior — Citizenship', OFFICIAL_URLS.serbia_citizenship_guidance, '688', 'sr', 'official_guidance', 'serbia-citizenship'],
      ['UAE Ministry of Justice — Nationality and Passports Law', OFFICIAL_URLS.uae_nationality_law, '784', 'en', 'primary_law', 'uae-nationality'],
      ['UAE Government — Emirati nationality', OFFICIAL_URLS.uae_nationality_guidance, '784', 'en', 'official_guidance', 'uae-nationality'],
      ['UAE Government — Golden Visa', OFFICIAL_URLS.uae_golden_visa, '784', 'en', 'official_guidance', 'uae-golden-visa'],
      ['Argentina — current text of Citizenship Law No. 346', OFFICIAL_URLS.argentina_citizenship_law, '032', 'es', 'primary_law', 'argentina-citizenship-law'],
      ['Argentina — Decree 524/2025 on citizenship by investment', OFFICIAL_URLS.argentina_investment_decree, '032', 'es', 'primary_law', 'argentina-citizenship-law'],
      ['Constitution of Brazil — Article 12', OFFICIAL_URLS.brazil_constitution, '076', 'pt', 'primary_law', 'brazil-citizenship-law'],
      ['Brazil Migration Law No. 13,445/2017', OFFICIAL_URLS.brazil_migration_law, '076', 'pt', 'primary_law', 'brazil-citizenship-law'],
      ['Political Constitution of Mexico — Article 30', OFFICIAL_URLS.mexico_constitution, '484', 'es', 'primary_law', 'mexico-nationality-law'],
      ['Mexico Nationality Law', OFFICIAL_URLS.mexico_nationality_law, '484', 'es', 'primary_law', 'mexico-nationality-law'],
      ['Colombia Law 2332 of 2023 — nationality', OFFICIAL_URLS.colombia_nationality_law, '170', 'es', 'primary_law', 'colombia-nationality-law'],
      ['Colombia Foreign Ministry — Visa FAQ', OFFICIAL_URLS.colombia_visa_faq, '170', 'es', 'official_guidance', 'colombia-nationality-law'],
      ['Colombia Resolution 5477 of 2022', OFFICIAL_URLS.colombia_visa_resolution, '170', 'es', 'primary_law', 'colombia-nationality-law'],
      ['Colombia Foreign Ministry — V Student Visa', OFFICIAL_URLS.colombia_student_visa, '170', 'es', 'official_guidance', 'colombia-nationality-law'],
      ['Georgia Public Service Development Agency — Citizenship', OFFICIAL_URLS.georgia_citizenship, '268', 'en', 'official_guidance', 'georgia-citizenship-law'],
      ['Organic Law of Georgia on Georgian Citizenship', OFFICIAL_URLS.georgia_citizenship_law, '268', 'en', 'primary_law', 'georgia-citizenship-law'],
      ['Cayman Islands Government — BOTC registration and naturalisation', OFFICIAL_URLS.cayman_botc, '136', 'en', 'official_guidance', 'cayman-botc-status'],
      ['Cayman Islands Government — Immigration reform', OFFICIAL_URLS.cayman_status_reform, '136', 'en', 'official_guidance', 'cayman-botc-status'],
      ['British Nationality Act 1981', OFFICIAL_URLS.uk_nationality_act, '136', 'en', 'primary_law', 'cayman-botc-status'],
      ['Dominica Government — Citizenship applications', OFFICIAL_URLS.dominica_citizenship, '212', 'en', 'official_guidance', 'dominica-citizenship-law'],
      ['Dominica Government — Citizenship forms', OFFICIAL_URLS.dominica_forms, '212', 'en', 'official_guidance', 'dominica-citizenship-law'],
      ['Constitution of the Commonwealth of Dominica', OFFICIAL_URLS.dominica_constitution, '212', 'en', 'primary_law', 'dominica-citizenship-law'],
      ['Dominica CBIU — Citizenship by Investment legislation', OFFICIAL_URLS.dominica_cbi_law, '212', 'en', 'official_guidance', 'dominica-citizenship-law'],
      ['Dominica CBIU — Programme options and requirements', OFFICIAL_URLS.dominica_cbi_options, '212', 'en', 'official_guidance', 'dominica-citizenship-law'],
      ['Dominica Citizenship by Investment Unit', OFFICIAL_URLS.dominica_cbi_home, '212', 'en', 'official_guidance', 'dominica-citizenship-law'],
      ['Constitution of St Christopher and Nevis', OFFICIAL_URLS.st_kitts_constitution, '659', 'en', 'primary_law', 'st-kitts-citizenship-law'],
      ['St Christopher and Nevis Citizenship Act', OFFICIAL_URLS.st_kitts_citizenship_act, '659', 'en', 'primary_law', 'st-kitts-citizenship-law'],
      ['St Kitts and Nevis Citizenship Unit — Investment options', OFFICIAL_URLS.st_kitts_cbi_options, '659', 'en', 'official_guidance', 'st-kitts-citizenship-law'],
      ['St Kitts and Nevis Citizenship Unit — Government notices', OFFICIAL_URLS.st_kitts_government_notices, '659', 'en', 'official_guidance', 'st-kitts-citizenship-law'],
      ['St. Kitts and Nevis Citizenship Unit', OFFICIAL_URLS.st_kitts_application, '659', 'en', 'official_guidance', 'st-kitts-citizenship-law'],
    ].map(([title, url, jurisdiction, language, sourceType, monitorId]) => officialSource({
      title,
      url,
      source_type: sourceType as SourceRecord['source_type'],
      jurisdictions: [jurisdiction],
      language,
      monitoring: {
        source_id: monitorId,
        method: 'http',
        url,
        status: 'active',
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
  name,
  type = 'sovereign',
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
  name?: string;
  type?: 'sovereign' | 'territory' | 'special';
}): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === iso);
  if (!candidate) throw new Error(`Jurisdiction ${iso} is missing`);
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: `jurisdiction:${iso}`,
    jurisdiction: { ...candidate.jurisdiction, ...(name ? { name } : {}), type },
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

function principalCitizenshipRoute({
  id,
  mode,
  title,
  summary,
  source,
  eligibility,
  months,
  allocation = 'right',
  note,
  status = 'active',
  lastChecked = '2026-07-21',
}: {
  id: string;
  mode: 'ancestry' | 'naturalization' | 'birth' | 'investment';
  title: string;
  summary: string;
  source: SourceRecord | SourceRecord[];
  eligibility: Array<{
    field: string;
    operator: 'eq' | 'neq' | 'in' | 'not_in' | 'gte' | 'lte' | 'exists';
    value: string | number | boolean | string[] | number[] | null;
    unit?: 'months' | 'years' | 'days' | 'count';
    note?: string;
  }>;
  months: number | null;
  allocation?: 'right' | 'discretionary';
  note?: string;
  status?: 'active' | 'inactive';
  lastChecked?: string;
}): JurisdictionRecord['routes'][number] {
  const variantId = `${id}-principal`;
  return {
    id,
    mode,
    status,
    title,
    summary,
    effective: { from: null, to: null, supersedes: [] },
    review: { state: 'reviewed', confidence: 'high', last_checked: lastChecked },
    variants: [{
      id: variantId,
      label: title,
      outcome: 'citizenship',
      allocation,
      eligibility,
      milestones: [{ status: 'citizenship_application', minimum_months: months }],
      timeline: {
        eligibility_minimum_months: months,
        processing_typical_months: null,
        confidence: 'high',
        ...(note ? { note } : {}),
      },
      source_refs: refs(Array.isArray(source) ? source : [source], [
        `/routes/${id}/summary`,
        `/routes/${id}/variants/${variantId}/eligibility`,
        `/routes/${id}/variants/${variantId}/timeline`,
      ]),
    }],
  };
}

function argentinaRecord(
  shadow: DataShadow,
  officialSources: SourceRecord[],
): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.argentina_citizenship_law);
  const investmentDecree = requireSource(
    officialSources,
    OFFICIAL_URLS.argentina_investment_decree,
  );
  const investmentId = 'argentina-relevant-investment-citizenship';
  const investmentVariant = `${investmentId}-principal`;
  return reviewedCountryRecord({
    shadow,
    iso: '032',
    note: 'All four acquisition modes reviewed against the current Citizenship Law. The 2025 investment route is recorded as pending because the official qualifying criteria remain to be verified.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law] },
      { mode: 'naturalization', finding: 'present', sources: [law] },
      { mode: 'birth', finding: 'present', sources: [law] },
      {
        mode: 'investment',
        finding: 'present',
        sources: [law, investmentDecree],
        note: 'Law 346 and Decree 524/2025 establish citizenship following a relevant investment, but no investment threshold is asserted until the Ministry of Economy criteria and operational rules are verified.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'argentina-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Argentine citizenship through a native Argentine parent',
        summary: 'A person born abroad to a native Argentine parent may opt for Argentine citizenship under Citizenship Law No. 346.',
        source: law,
        eligibility: [{ field: 'parent.native_argentine', operator: 'eq', value: true }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'argentina-naturalization-after-residence',
        mode: 'naturalization',
        title: 'Naturalization after two years of continuous legal residence',
        summary: 'Article 2(1) of Citizenship Law No. 346 permits an adult foreign national to request citizenship after two years of continuous legal residence immediately before applying.',
        source: law,
        eligibility: [
          {
            field: 'residence.continuous_legal_months',
            operator: 'gte',
            value: 24,
            unit: 'months',
            note: 'The current text defines continuity strictly and says the applicant must not have left Argentina during the qualifying period.',
          },
        ],
        months: 24,
        allocation: 'discretionary',
      }),
      principalCitizenshipRoute({
        id: 'argentina-citizenship-by-birth',
        mode: 'birth',
        title: 'Argentine citizenship by territorial birth',
        summary: 'A person born in Argentine territory is generally an Argentine citizen at birth, subject to the statutory exception for children of foreign ministers and diplomatic-legation members residing in Argentina.',
        source: law,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '032' },
          { field: 'parent.foreign_diplomatic_exception', operator: 'neq', value: true },
        ],
        months: 0,
      }),
      {
        id: investmentId,
        mode: 'investment',
        status: 'pending_verification',
        title: 'Citizenship following a relevant investment',
        summary: 'The current law permits a foreign national to request citizenship, regardless of residence duration, after making an investment that qualifies as relevant under criteria established by the Ministry of Economy.',
        effective: { from: '2025-05-29', to: null, supersedes: [] },
        review: {
          state: 'pending',
          confidence: 'high',
          last_checked: '2026-07-21',
          note: 'The statutory route and procedure exist, but the qualifying investment criteria and practical availability still require official verification.',
        },
        variants: [{
          id: investmentVariant,
          label: 'Relevant investment route',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [{
            field: 'investment.relevant_under_ministry_criteria',
            operator: 'eq',
            value: true,
            note: 'No monetary threshold is asserted in this record.',
          }],
          milestones: [
            { status: 'relevant_investment', minimum_months: null },
            { status: 'citizenship_application', minimum_months: 0 },
          ],
          timeline: {
            eligibility_minimum_months: null,
            processing_typical_months: null,
            confidence: 'low',
            note: 'Decree 524/2025 provides a review process but no verified investment threshold or reliable public operating timeline.',
          },
          source_refs: refs([law, investmentDecree], [
            `/routes/${investmentId}/summary`,
            `/routes/${investmentId}/variants/${investmentVariant}/eligibility`,
            `/routes/${investmentId}/variants/${investmentVariant}/timeline`,
          ]),
        }],
      },
    ],
  });
}

function brazilRecord(
  shadow: DataShadow,
  officialSources: SourceRecord[],
): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.brazil_constitution);
  const migrationLaw = requireSource(officialSources, OFFICIAL_URLS.brazil_migration_law);
  const naturalizationId = 'brazil-naturalization-by-residence';
  return reviewedCountryRecord({
    shadow,
    iso: '076',
    note: 'All acquisition modes reviewed against Article 12 of the Constitution and the current Migration Law; investor residence is not classified as direct citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, migrationLaw] },
      { mode: 'birth', finding: 'present', sources: [constitution] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, migrationLaw],
        note: 'The official nationality grounds contain no direct citizenship-by-investment route. Investment residence remains subject to a separate naturalization process.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'brazil-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Brazilian citizenship through a Brazilian parent',
        summary: 'A child born abroad to a Brazilian parent can acquire Brazilian nationality through the constitutional service, consular-registration, or later residence-and-option rules.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '076' }],
        months: 0,
      }),
      {
        id: naturalizationId,
        mode: 'naturalization',
        status: 'active',
        title: 'Brazilian naturalization after residence',
        summary: 'Ordinary naturalization generally requires four years of residence; the Constitution provides a one-year route for people originating from Portuguese-speaking countries who also satisfy the applicable conditions.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'ordinary_four_years',
            label: 'Ordinary four-year residence route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [{ field: 'residence.lawful_months', operator: 'gte', value: 48, unit: 'months' }],
            milestones: [{ status: 'lawful_residence', minimum_months: 48 }],
            timeline: { eligibility_minimum_months: 48, processing_typical_months: null, confidence: 'high', note: 'Capacity, Portuguese-language ability and absence of a disqualifying criminal conviction also apply.' },
            source_refs: refs([migrationLaw], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/ordinary_four_years/eligibility`,
              `/routes/${naturalizationId}/variants/ordinary_four_years/timeline`,
            ]),
          },
          {
            id: 'portuguese_speaking_country',
            label: 'One-year route for an origin country with Portuguese as an official language',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'origin.portuguese_official_language', operator: 'eq', value: true },
              { field: 'residence.continuous_months', operator: 'gte', value: 12, unit: 'months' },
            ],
            milestones: [{ status: 'continuous_residence', minimum_months: 12 }],
            timeline: { eligibility_minimum_months: 12, processing_typical_months: null, confidence: 'high', note: 'Article 12 also requires good moral character.' },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/portuguese_speaking_country/eligibility`,
              `/routes/${naturalizationId}/variants/portuguese_speaking_country/timeline`,
            ]),
          },
        ],
      },
      principalCitizenshipRoute({
        id: 'brazil-citizenship-by-birth',
        mode: 'birth',
        title: 'Brazilian citizenship by territorial birth',
        summary: 'A person born in Brazil is generally Brazilian at birth, including a child of foreign parents, unless the parents are serving their country.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '076' },
          { field: 'parent.serving_foreign_country', operator: 'neq', value: true },
        ],
        months: 0,
      }),
    ],
  });
}

function mexicoRecord(
  shadow: DataShadow,
  officialSources: SourceRecord[],
): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.mexico_constitution);
  const nationalityLaw = requireSource(officialSources, OFFICIAL_URLS.mexico_nationality_law);
  const naturalizationId = 'mexico-naturalization-by-residence';
  return reviewedCountryRecord({
    shadow,
    iso: '484',
    note: 'All acquisition modes reviewed against Article 30 of the Constitution and the current Nationality Law.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [nationalityLaw] },
      { mode: 'birth', finding: 'present', sources: [constitution] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, nationalityLaw],
        note: 'The official acquisition grounds contain no direct citizenship-by-investment route; residence obtained through economic activity does not bypass naturalization.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'mexico-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Mexican nationality through a Mexican parent',
        summary: 'Article 30 treats a person born abroad to a Mexican mother or father as Mexican by birth under the constitutional parentage rules.',
        source: constitution,
        eligibility: [{ field: 'parent.nationality.iso_n3', operator: 'eq', value: '484' }],
        months: 0,
      }),
      {
        id: naturalizationId,
        mode: 'naturalization',
        status: 'active',
        title: 'Mexican naturalization after residence',
        summary: 'The ordinary route requires five years of residence; Article 20 reduces the period to two years for a person originating from a Latin American country or the Iberian Peninsula.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'ordinary_five_years',
            label: 'Ordinary five-year residence route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [{ field: 'residence.in_mexico_months', operator: 'gte', value: 60, unit: 'months' }],
            milestones: [{ status: 'residence_in_mexico', minimum_months: 60 }],
            timeline: { eligibility_minimum_months: 60, processing_typical_months: null, confidence: 'high' },
            source_refs: refs([nationalityLaw], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/ordinary_five_years/eligibility`,
              `/routes/${naturalizationId}/variants/ordinary_five_years/timeline`,
            ]),
          },
          {
            id: 'latin_american_or_iberian_origin',
            label: 'Two-year route for Latin American or Iberian Peninsula origin',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'origin.region', operator: 'in', value: ['latin_america', 'iberian_peninsula'] },
              { field: 'residence.in_mexico_months', operator: 'gte', value: 24, unit: 'months' },
            ],
            milestones: [{ status: 'residence_in_mexico', minimum_months: 24 }],
            timeline: { eligibility_minimum_months: 24, processing_typical_months: null, confidence: 'high' },
            source_refs: refs([nationalityLaw], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/latin_american_or_iberian_origin/eligibility`,
              `/routes/${naturalizationId}/variants/latin_american_or_iberian_origin/timeline`,
            ]),
          },
        ],
      },
      principalCitizenshipRoute({
        id: 'mexico-citizenship-by-birth',
        mode: 'birth',
        title: 'Mexican nationality by territorial birth',
        summary: 'A person born in Mexican territory is Mexican by birth regardless of the parents’ nationality; the Constitution also covers births aboard qualifying Mexican vessels and aircraft.',
        source: constitution,
        eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '484' }],
        months: 0,
      }),
    ],
  });
}

function colombiaRecord(
  shadow: DataShadow,
  officialSources: SourceRecord[],
): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.colombia_nationality_law);
  const visaFaq = requireSource(officialSources, OFFICIAL_URLS.colombia_visa_faq);
  const visaResolution = requireSource(officialSources, OFFICIAL_URLS.colombia_visa_resolution);
  const studentVisa = requireSource(officialSources, OFFICIAL_URLS.colombia_student_visa);
  const naturalizationId = 'colombia-naturalization-by-residence';
  const legacyId = 'colombia-study-permanent-residence-credit';
  const legacyVariant = `${legacyId}-principal`;
  const legacySummary = "Colombia's current student route is a Visitor (V) visa. The Foreign Ministry states that study time does not count toward a Resident (R) visa by accumulated time; article 90 lists qualifying Migrant (M) categories and does not include the V student visa.";
  return reviewedCountryRecord({
    shadow,
    iso: '170',
    note: 'All acquisition modes reviewed against Law 2332 of 2023. Conditional territorial birth and the distinction between student status, permanent residence and naturalization are preserved.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law] },
      { mode: 'naturalization', finding: 'present', sources: [law, visaFaq, visaResolution, studentVisa] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [law],
        note: 'Birth in Colombia is conditional: a Colombian parent or a foreign parent domiciled in Colombia at the time of birth qualifies, with a separate statelessness safeguard.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [law],
        note: 'Law 2332 contains no direct citizenship-by-investment route. Any investor residence remains subject to the ordinary naturalization requirements.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'colombia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Colombian nationality through a Colombian parent',
        summary: 'A person born abroad to a Colombian mother or father is Colombian by birth after registering at a Colombian consulate or becoming domiciled in Colombia.',
        source: law,
        eligibility: [
          { field: 'parent.nationality.iso_n3', operator: 'eq', value: '170' },
          { field: 'connection.consular_registration_or_colombian_domicile', operator: 'eq', value: true },
        ],
        months: 0,
      }),
      {
        id: naturalizationId,
        mode: 'naturalization',
        status: 'active',
        title: 'Colombian naturalization after residence',
        summary: 'Law 2332 generally requires five years of continuous domicile as a Resident Visa holder, reduced to two years for a qualifying Colombian spouse or permanent partner, Colombian child, or verified reciprocal treatment.',
        effective: { from: '2023-09-25', to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-21' },
        variants: [
          {
            id: 'ordinary_five_years',
            label: 'Ordinary five-year Resident Visa route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'visa.resident_holder', operator: 'eq', value: true },
              { field: 'domicile.continuous_months', operator: 'gte', value: 60, unit: 'months' },
            ],
            milestones: [{ status: 'resident_visa_domicile', minimum_months: 60 }],
            timeline: { eligibility_minimum_months: 60, processing_typical_months: null, confidence: 'high', note: 'Naturalization remains a sovereign and discretionary decision.' },
            source_refs: refs([law], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/ordinary_five_years/eligibility`,
              `/routes/${naturalizationId}/variants/ordinary_five_years/timeline`,
            ]),
          },
          {
            id: 'reduced_two_years',
            label: 'Two-year family or reciprocity route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'visa.resident_holder', operator: 'eq', value: true },
              { field: 'domicile.continuous_months', operator: 'gte', value: 24, unit: 'months' },
              { field: 'reduction.family_or_reciprocity', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'resident_visa_domicile', minimum_months: 24 }],
            timeline: { eligibility_minimum_months: 24, processing_typical_months: null, confidence: 'high', note: 'The reduction applies to a Colombian spouse or permanent partner, Colombian children, or verified reciprocal treatment by the origin state.' },
            source_refs: refs([law], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/reduced_two_years/eligibility`,
              `/routes/${naturalizationId}/variants/reduced_two_years/timeline`,
            ]),
          },
        ],
      },
      principalCitizenshipRoute({
        id: 'colombia-citizenship-by-conditional-birth',
        mode: 'birth',
        title: 'Colombian nationality by conditional territorial birth',
        summary: 'A child born in Colombia to foreign parents is Colombian by birth when at least one parent was domiciled in Colombia at the time of birth; a separate exception protects a child whom no state recognizes as a national.',
        source: law,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '170' },
          { field: 'parent.domiciled_in_colombia_at_birth', operator: 'eq', value: true },
        ],
        months: 0,
      }),
      {
        id: legacyId,
        mode: 'naturalization',
        status: 'verified_negative',
        title: 'Visitor student visa time does not accumulate toward permanent residence',
        summary: legacySummary,
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-17' },
        variants: [{
          id: legacyVariant,
          label: 'V student residence-credit finding',
          outcome: 'permanent_residence',
          allocation: 'discretionary',
          eligibility: [{ field: 'visa.category', operator: 'eq', value: 'V_student' }],
          milestones: [{ status: 'permanent_residence_credit', minimum_months: null }],
          timeline: {
            eligibility_minimum_months: null,
            processing_typical_months: null,
            confidence: 'high',
            note: 'The V student visa does not accumulate qualifying time toward a Resident Visa under the cited rules.',
          },
          source_refs: refs([visaFaq, visaResolution, studentVisa], [
            `/routes/${legacyId}/summary`,
            `/routes/${legacyId}/variants/${legacyVariant}/eligibility`,
            `/routes/${legacyId}/variants/${legacyVariant}/timeline`,
          ]),
        }],
      },
    ],
  });
}

function georgiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const guidance = requireSource(officialSources, OFFICIAL_URLS.georgia_citizenship);
  const law = requireSource(officialSources, OFFICIAL_URLS.georgia_citizenship_law);
  return reviewedCountryRecord({
    shadow,
    iso: '268',
    note: 'All acquisition modes reviewed against Georgia’s Organic Law and Public Service Development Agency guidance.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law, guidance] },
      { mode: 'naturalization', finding: 'present', sources: [law, guidance] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [law, guidance],
        note: 'Territorial birth alone is insufficient; the principal rules cover a Georgian parent and narrow safeguards against statelessness.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [law, guidance],
        note: 'Georgia has no direct, entitlement-based citizenship-by-investment programme. Economic contribution may be considered only within exceptional, discretionary citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'georgia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Georgian citizenship through a Georgian parent',
        summary: 'A person acquires Georgian citizenship by birth when at least one parent is a Georgian citizen.',
        source: [law, guidance],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '268' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'georgia-ordinary-naturalization',
        mode: 'naturalization',
        title: 'Ordinary naturalization after ten years',
        summary: 'An adult may apply after ten consecutive years of lawful residence, subject to the Georgian language, history and law test and a qualifying economic connection.',
        source: [law, guidance],
        eligibility: [
          { field: 'residence.lawful_months', operator: 'gte', value: 120, unit: 'months' },
          { field: 'integration.citizenship_test_passed', operator: 'eq', value: true },
          { field: 'connection.employment_property_business_or_enterprise_interest', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        note: 'A Georgian citizen’s spouse has a separate five-year simplified route. Eligibility does not guarantee the presidential grant.',
      }),
      principalCitizenshipRoute({
        id: 'georgia-citizenship-by-protected-birth',
        mode: 'birth',
        title: 'Citizenship at birth under anti-statelessness safeguards',
        summary: 'A child born in Georgia can acquire citizenship under narrow statutory safeguards, including where qualifying parents are stateless or the other parent is unknown.',
        source: [law, guidance],
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '268' },
          { field: 'birth.anti_statelessness_condition_met', operator: 'eq', value: true },
        ],
        months: 0,
      }),
    ],
  });
}

function caymanIslandsRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const botc = requireSource(officialSources, OFFICIAL_URLS.cayman_botc);
  const reform = requireSource(officialSources, OFFICIAL_URLS.cayman_status_reform);
  const nationalityAct = requireSource(officialSources, OFFICIAL_URLS.uk_nationality_act);
  return reviewedCountryRecord({
    shadow,
    iso: '136',
    name: 'Cayman Islands',
    type: 'territory',
    note: 'Cayman is a British Overseas Territory. BOTC citizenship and Caymanian immigration status are related but legally distinct and are displayed without conflating either with British citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [nationalityAct] },
      { mode: 'naturalization', finding: 'present', sources: [nationalityAct, botc, reform] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [nationalityAct, reform],
        note: 'Birth in Cayman is not unconditional jus soli; BOTC and Caymanian-status rules depend on parental status and date-specific provisions.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [nationalityAct, botc, reform],
        note: 'Cayman offers investment-linked residence options, not direct citizenship by investment. BOTC naturalization and Caymanian status remain separate later processes.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'cayman-botc-by-descent',
        mode: 'ancestry',
        title: 'BOTC citizenship by descent through a qualifying parent',
        summary: 'British Overseas Territories citizenship connected to Cayman can pass to a child born abroad under the British Nationality Act’s descent and registration rules.',
        source: nationalityAct,
        eligibility: [
          { field: 'parent.status', operator: 'eq', value: 'botc_connected_to_cayman' },
          { field: 'birth.outside_qualifying_territory', operator: 'eq', value: true },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'cayman-botc-naturalization',
        mode: 'naturalization',
        title: 'BOTC naturalization after qualifying residence',
        summary: 'An adult can apply to naturalize as a BOTC connected to Cayman under the British Nationality Act after the statutory residence period; Caymanian status is a separate immigration status.',
        source: [nationalityAct, botc, reform],
        eligibility: [
          { field: 'residence.in_cayman_months', operator: 'gte', value: 60, unit: 'months' },
          { field: 'residence.final_twelve_months_compliant', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        note: 'The general BOTC naturalization schedule uses five years. From 1 May 2026, Caymanian status based on naturalization generally requires 20 years lawful ordinary residence or 10 years after BOTC naturalization or registration.',
      }),
      principalCitizenshipRoute({
        id: 'cayman-botc-by-birth',
        mode: 'birth',
        title: 'BOTC citizenship at birth through a qualifying parent',
        summary: 'A child born in Cayman acquires BOTC at birth when a parent is a BOTC or is settled in the territory, subject to the British Nationality Act and date-specific rules.',
        source: nationalityAct,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '136' },
          { field: 'parent.botc_or_settled_at_birth', operator: 'eq', value: true },
        ],
        months: 0,
      }),
    ],
  });
}

function dominicaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const guidance = requireSource(officialSources, OFFICIAL_URLS.dominica_citizenship);
  const forms = requireSource(officialSources, OFFICIAL_URLS.dominica_forms);
  const constitution = requireSource(officialSources, OFFICIAL_URLS.dominica_constitution);
  const cbiLaw = requireSource(officialSources, OFFICIAL_URLS.dominica_cbi_law);
  const cbiOptions = requireSource(officialSources, OFFICIAL_URLS.dominica_cbi_options);
  const cbiLegacy = requireSource(officialSources, OFFICIAL_URLS.dominica_cbi_home);
  return reviewedCountryRecord({
    shadow,
    iso: '212',
    note: 'All acquisition modes reviewed against the Constitution, government citizenship procedures and current Citizenship by Investment regulations.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, guidance] },
      { mode: 'naturalization', finding: 'present', sources: [guidance, forms] },
      { mode: 'birth', finding: 'present', sources: [constitution] },
      { mode: 'investment', finding: 'present', sources: [cbiLaw, cbiOptions] },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'dominica-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Dominican citizenship through a citizen parent',
        summary: 'The Constitution provides citizenship by descent for a person born outside Dominica to a qualifying Dominican parent.',
        source: [constitution, guidance],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '212' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'dominica-naturalization-after-residence',
        mode: 'naturalization',
        title: 'Naturalization after seven years of residence',
        summary: 'Government forms provide a citizenship application route after seven years of residence, subject to ministerial approval and the supporting-document requirements.',
        source: [guidance, forms],
        eligibility: [{ field: 'residence.in_dominica_months', operator: 'gte', value: 84, unit: 'months' }],
        months: 84,
        allocation: 'discretionary',
      }),
      principalCitizenshipRoute({
        id: 'dominica-citizenship-by-birth',
        mode: 'birth',
        title: 'Citizenship by birth in Dominica',
        summary: 'A person born in Dominica acquires citizenship at birth, subject to the constitutional exceptions for certain diplomatic and hostile-occupation circumstances.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '212' },
          { field: 'birth.constitutional_exception', operator: 'eq', value: false },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'dominica-cbi',
        mode: 'investment',
        title: 'Dominica Citizenship by Investment Programme',
        summary: 'Government-administered direct citizenship programme offering a public-fund contribution and approved real-estate route.',
        source: cbiLegacy,
        eligibility: [
          { field: 'investment.minimum_usd', operator: 'gte', value: 200000 },
          { field: 'compliance.due_diligence_passed', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'discretionary',
        note: 'The official minimum starts at US$200,000 for a single applicant under either the fund contribution or approved-real-estate route; fees and family thresholds vary.',
        lastChecked: '2026-07-17',
      }),
    ],
  });
}

function stKittsNevisRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.st_kitts_constitution);
  const act = requireSource(officialSources, OFFICIAL_URLS.st_kitts_citizenship_act);
  const cbi = requireSource(officialSources, OFFICIAL_URLS.st_kitts_cbi_options);
  const notices = requireSource(officialSources, OFFICIAL_URLS.st_kitts_government_notices);
  const application = requireSource(officialSources, OFFICIAL_URLS.st_kitts_application);
  return reviewedCountryRecord({
    shadow,
    iso: '659',
    note: 'All acquisition modes reviewed against the Constitution, Citizenship Act and current official Citizenship Unit options.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, act] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      { mode: 'birth', finding: 'present', sources: [constitution] },
      { mode: 'investment', finding: 'present', sources: [act, cbi, notices] },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'st-kitts-nevis-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Citizenship through a citizen parent',
        summary: 'The Constitution provides citizenship by descent for a person born abroad to a qualifying citizen parent.',
        source: [constitution, act],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '659' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'st-kitts-nevis-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after a fifteen-year qualifying window',
        summary: 'The Citizenship Act requires residence throughout the twelve months immediately before application and residence during the preceding fourteen years, with good-character and intention-to-reside requirements.',
        source: act,
        eligibility: [
          { field: 'residence.qualifying_window_months', operator: 'gte', value: 180, unit: 'months' },
          { field: 'residence.final_twelve_months_continuous', operator: 'eq', value: true },
        ],
        months: 180,
        allocation: 'discretionary',
        note: 'The Second Schedule states a final continuous 12 months plus residence during the 14 years before that period. This is not modeled as a simple 14-year continuous-residence rule.',
      }),
      principalCitizenshipRoute({
        id: 'st-kitts-nevis-citizenship-by-birth',
        mode: 'birth',
        title: 'Citizenship by birth in St Kitts and Nevis',
        summary: 'A person born in the federation acquires citizenship at birth, except for the Constitution’s diplomatic-immunity and hostile-occupation exceptions.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '659' },
          { field: 'birth.constitutional_exception', operator: 'eq', value: false },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'st-kitts-nevis-citizenship-programme',
        mode: 'investment',
        title: 'Citizenship Programme',
        summary: 'Government-administered direct citizenship programme requiring a prescribed investment or contribution and due diligence.',
        source: application,
        eligibility: [
          { field: 'investment.minimum_usd', operator: 'gte', value: 250000 },
          { field: 'compliance.due_diligence_passed', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'discretionary',
        note: 'Official minimums currently start at US$250,000 for SISC or Public Benefit, US$325,000 for approved development or condominium property, and US$600,000 for a private home.',
        lastChecked: '2026-07-17',
      }),
    ],
  });
}

function maltaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const guidance = requireSource(officialSources, OFFICIAL_URLS.malta_citizenship);
  const act = requireSource(officialSources, OFFICIAL_URLS.malta_citizenship_act);
  const repeal = requireSource(officialSources, OFFICIAL_URLS.malta_investment_repeal);
  const amendments = requireSource(officialSources, OFFICIAL_URLS.malta_amendments);
  const merit = requireSource(officialSources, OFFICIAL_URLS.malta_merit);
  return reviewedCountryRecord({
    shadow,
    iso: '470',
    note: 'All acquisition modes reviewed against the consolidated Citizenship Act and Community Malta guidance after the 2025 repeal of investor citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [guidance, act] },
      { mode: 'naturalization', finding: 'present', sources: [guidance, act] },
      { mode: 'birth', finding: 'present', sources: [guidance, act], note: 'Birth in Malta is not generally sufficient; the current rule depends on a qualifying parent.' },
      { mode: 'investment', finding: 'present', sources: [repeal, amendments, merit], note: 'The modeled route is historical and inactive: the Granting of Citizenship for Exceptional Services programme was discontinued in 2025. Merit naturalization is discretionary and not direct CBI.' },
    ],
    routes: [
      principalCitizenshipRoute({ id: 'malta-registration-family-descent', mode: 'ancestry', title: 'Maltese citizenship by descent', summary: 'Malta provides registration routes for specified family situations, including descendants in the direct line where the relevant line includes two consecutive ascendants born in Malta, and for certain second or subsequent generations born abroad. A foreign spouse of a Maltese citizen may also qualify for registration after five years of marriage, subject to the applicable conditions.', source: guidance, eligibility: [{ field: 'ancestor.citizenship.iso_n3', operator: 'eq', value: '470' }], months: 0, lastChecked: '2026-07-17' }),
      principalCitizenshipRoute({ id: 'malta-residence-naturalization', mode: 'naturalization', title: 'Maltese naturalization by residence', summary: 'An adult may apply after residing in Malta throughout the twelve months immediately before the application and for an aggregate of at least four years during the preceding six years. The applicant must also meet character and language requirements. Naturalization remains a ministerial, discretionary decision rather than an entitlement after five calendar years.', source: guidance, eligibility: [{ field: 'residence.immediately_preceding_months', operator: 'gte', value: 12, unit: 'months' }, { field: 'residence.prior_six_years_months', operator: 'gte', value: 48, unit: 'months' }], months: 60, allocation: 'discretionary', note: 'The statutory residence threshold establishes eligibility to apply, not an entitlement to citizenship.', lastChecked: '2026-07-17' }),
      principalCitizenshipRoute({ id: 'malta-citizenship-by-birth', mode: 'birth', title: 'Citizenship at birth through a qualifying parent', summary: 'For births on or after 1 August 1989, birth in Malta confers citizenship only where a parent has the qualifying citizenship or status required by the Act.', source: guidance, eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '470' }, { field: 'parent.qualifying_status', operator: 'eq', value: true }], months: 0 }),
      principalCitizenshipRoute({ id: 'malta-transactional-investor-citizenship-ended', mode: 'investment', title: 'Former investor-citizenship programme', summary: 'Malta discontinued the Granting of Citizenship for Exceptional Services programme following the Court of Justice of the European Union judgment. Current exceptional-merit naturalization is a discretionary route based on genuine exceptional service or contribution and residence; it should not be represented as a direct citizenship-by-investment product.', source: [repeal, amendments, merit], eligibility: [{ field: 'programme.accepting_new_applications', operator: 'eq', value: false }], months: null, allocation: 'discretionary', status: 'inactive', lastChecked: '2026-07-17', note: 'Historical route retained to state explicitly that transactional investor citizenship ended in 2025.' }),
    ],
  });
}

function cyprusRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const origin = requireSource(officialSources, OFFICIAL_URLS.cyprus_origin);
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.cyprus_naturalization);
  const termination = requireSource(officialSources, OFFICIAL_URLS.cyprus_investment_termination);
  return reviewedCountryRecord({
    shadow,
    iso: '196',
    note: 'All acquisition modes reviewed against current Ministry of Interior guidance and the official record of the terminated investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [origin] },
      { mode: 'naturalization', finding: 'present', sources: [naturalization] },
      { mode: 'birth', finding: 'present', sources: [origin], note: 'The principal birth-related route is citizenship through a Cypriot parent, including consular registration for a person born abroad; Cyprus does not operate general territorial jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [termination], note: 'The Cyprus Investment Programme stopped accepting new applications from 1 November 2020.' },
    ],
    routes: [
      principalCitizenshipRoute({ id: 'cyprus-citizenship-by-origin', mode: 'ancestry', title: 'Cypriot citizenship due to origin', summary: 'Cypriot-origin registration routes cover people born abroad and specified descendants, using the applicable M121, M123, M124 or M126 procedure.', source: origin, eligibility: [{ field: 'ancestor.citizenship_or_origin.iso_n3', operator: 'eq', value: '196' }], months: 0 }),
      principalCitizenshipRoute({ id: 'cyprus-naturalization-by-residence', mode: 'naturalization', title: 'Cypriot naturalization by residence', summary: 'The ordinary route requires twelve continuous months immediately before application and at least seven cumulative lawful years in the preceding ten years, plus language, civic, character and resources tests.', source: naturalization, eligibility: [{ field: 'residence.immediately_preceding_months', operator: 'gte', value: 12, unit: 'months' }, { field: 'residence.prior_ten_years_months', operator: 'gte', value: 84, unit: 'months' }, { field: 'language.greek_level', operator: 'eq', value: 'B1' }], months: 96, allocation: 'discretionary' }),
      principalCitizenshipRoute({ id: 'cyprus-citizenship-at-birth-by-parent', mode: 'birth', title: 'Citizenship at birth through a Cypriot parent', summary: 'A person born abroad after 16 August 1960 can use the consular-birth route where a mother or father was a Cypriot citizen at the time of birth, subject to statutory exceptions and registration.', source: origin, eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '196' }, { field: 'parent.citizenship_at_child_birth', operator: 'eq', value: true }], months: 0 }),
    ],
  });
}

function turkiyeRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const guidance = requireSource(officialSources, OFFICIAL_URLS.turkiye_citizenship);
  const law = requireSource(officialSources, OFFICIAL_URLS.turkiye_citizenship_law);
  const investment = requireSource(officialSources, OFFICIAL_URLS.turkiye_investment);
  return reviewedCountryRecord({
    shadow,
    iso: '792',
    name: 'Türkiye',
    note: 'All acquisition modes reviewed against Citizenship Law No. 5901, NVI guidance, and the current official investment thresholds.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [guidance, law] },
      { mode: 'naturalization', finding: 'present', sources: [guidance, law] },
      { mode: 'birth', finding: 'present', sources: [guidance, law], note: 'Territorial birth citizenship is limited to a child who would otherwise acquire no nationality, including a foundling presumed born in Türkiye.' },
      { mode: 'investment', finding: 'present', sources: [investment, law] },
    ],
    routes: [
      principalCitizenshipRoute({ id: 'turkiye-citizenship-by-descent', mode: 'ancestry', title: 'Turkish citizenship by descent', summary: 'A child acquires Turkish citizenship through a Turkish mother or father, subject to the parentage rules in Citizenship Law No. 5901.', source: law, eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '792' }], months: 0 }),
      principalCitizenshipRoute({ id: 'turkiye-naturalization-by-residence', mode: 'naturalization', title: 'Turkish naturalization after residence', summary: 'An adult can apply under the general provisions after five continuous years of residence and satisfaction of settlement, language, character, health and security conditions.', source: guidance, eligibility: [{ field: 'residence.continuous_months', operator: 'gte', value: 60, unit: 'months' }, { field: 'language.turkish_sufficient', operator: 'eq', value: true }], months: 60, allocation: 'discretionary' }),
      principalCitizenshipRoute({ id: 'turkiye-citizenship-by-birth-statelessness', mode: 'birth', title: 'Citizenship at birth to prevent statelessness', summary: 'A child born in Türkiye who cannot acquire any nationality from the parents becomes Turkish from birth; a foundling is presumed born in Türkiye.', source: guidance, eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '792' }, { field: 'child.other_nationality_acquired', operator: 'eq', value: false }], months: 0 }),
      principalCitizenshipRoute({ id: 'turkiye-exceptional-investor-citizenship', mode: 'investment', title: 'Exceptional citizenship through qualifying investment', summary: 'Foreign investors meeting a prescribed property, capital, deposit, securities, pension-fund or job-creation condition may acquire citizenship by presidential decision.', source: investment, eligibility: [{ field: 'investment.property_usd', operator: 'gte', value: 400000 }, { field: 'investment.holding_months', operator: 'gte', value: 36, unit: 'months' }], months: 36, allocation: 'discretionary', lastChecked: '2026-07-17', note: 'The property variant is modeled here; official guidance also lists USD 500,000 alternatives and a 50-job option.' }),
    ],
  });
}

function uruguayRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.uruguay_constitution_birth);
  const nationality = requireSource(officialSources, OFFICIAL_URLS.uruguay_nationality_law);
  const legalCitizenship = requireSource(officialSources, OFFICIAL_URLS.uruguay_legal_citizenship);
  const taxResidence = requireSource(officialSources, OFFICIAL_URLS.uruguay_tax_residence);
  return reviewedCountryRecord({
    shadow,
    iso: '858',
    note: 'All acquisition modes reviewed with Uruguay’s distinction between natural nationality and later legal citizenship preserved.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, nationality] },
      { mode: 'naturalization', finding: 'present', sources: [legalCitizenship] },
      { mode: 'birth', finding: 'present', sources: [constitution, nationality] },
      { mode: 'investment', finding: 'verified_none', sources: [legalCitizenship, taxResidence], note: 'Investment can establish a tax-residence basis and property can evidence means of life, but it does not directly confer citizenship; legal citizenship still requires habitual residence.' },
    ],
    routes: [
      principalCitizenshipRoute({ id: 'uruguay-nationality-by-parent', mode: 'ancestry', title: 'Uruguayan nationality through a parent', summary: 'A child of a Uruguayan mother or father is a Uruguayan national regardless of birthplace; constitutional natural-citizenship exercise involves the applicable connection and registration steps.', source: nationality, eligibility: [{ field: 'parent.nationality.iso_n3', operator: 'eq', value: '858' }], months: 0 }),
      principalCitizenshipRoute({ id: 'uruguay-legal-citizenship-by-residence', mode: 'naturalization', title: 'Uruguayan legal citizenship by habitual residence', summary: 'A foreign adult of good conduct may seek legal citizenship after three years of habitual residence with family constituted in Uruguay, or five years without, while proving qualifying means or activity.', source: legalCitizenship, eligibility: [{ field: 'residence.habitual_months', operator: 'gte', value: 36, unit: 'months' }, { field: 'family.constituted_in_uruguay', operator: 'eq', value: true }], months: 36, allocation: 'right', note: 'Without family constituted in Uruguay the period is five years. An absence exceeding six continuous months resets the residence period.' }),
      principalCitizenshipRoute({ id: 'uruguay-nationality-by-birth', mode: 'birth', title: 'Uruguayan nationality by territorial birth', summary: 'Every person born anywhere in the territory of Uruguay is a natural citizen and Uruguayan national.', source: constitution, eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '858' }], months: 0 }),
    ],
  });
}

function greeceRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const code = requireSource(officialSources, OFFICIAL_URLS.greece_citizenship_code);
  const supporting = requireSource(officialSources, OFFICIAL_URLS.greece_citizenship_supporting_documents);
  const sevenYears = requireSource(officialSources, OFFICIAL_URLS.greece_seven_year_naturalization);
  const goldenVisa = requireSource(officialSources, OFFICIAL_URLS.greece_golden_visa);
  return reviewedCountryRecord({
    shadow,
    iso: '300',
    note: 'All acquisition modes reviewed against the Ministry of Interior citizenship code; investor residence is kept separate from citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [code] },
      { mode: 'naturalization', finding: 'present', sources: [code] },
      { mode: 'birth', finding: 'present', sources: [code], note: 'Birth in Greece is not generally sufficient; the code provides limited automatic and declaration routes tied to parent status, statelessness, residence and schooling.' },
      { mode: 'investment', finding: 'verified_none', sources: [code, goldenVisa], note: 'The Golden Visa is an investor residence permit, not direct citizenship.' },
    ],
    routes: [
      principalCitizenshipRoute({ id: 'greece-citizenship-by-greek-parent', mode: 'ancestry', title: 'Citizenship routes through a Greek parent', summary: 'Greek nationality law provides acquisition and declaration procedures for people born to a Greek parent, with separate documentary routes depending on birth date, registration and the parents\' marital or acknowledgment status. This record confirms the route family but does not collapse those distinct procedures into one universal checklist.', source: supporting, eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '300' }], months: 0, lastChecked: '2026-07-17' }),
      principalCitizenshipRoute({ id: 'greece-ordinary-naturalization', mode: 'naturalization', title: 'Ordinary naturalization after residence', summary: 'Greece\'s ordinary naturalization route for non-co-ethnic foreign nationals generally uses seven years of legal residence, with distinct eligible residence categories and supporting documents. Applicants must also satisfy the applicable integration, language, civic-knowledge and character requirements; residence eligibility is not an automatic grant.', source: [supporting, sevenYears], eligibility: [{ field: 'residence.lawful_continuous_months', operator: 'gte', value: 84, unit: 'months' }], months: 84, allocation: 'discretionary', lastChecked: '2026-07-17' }),
      principalCitizenshipRoute({ id: 'greece-citizenship-birth-and-school', mode: 'birth', title: 'Citizenship following birth and schooling in Greece', summary: 'A child born in Greece to foreign parents can acquire citizenship by declaration where the statutory parent-residence, lawful-status and Greek-school conditions are met.', source: code, eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '300' }, { field: 'parent.residence_before_birth_months', operator: 'gte', value: 60, unit: 'months' }, { field: 'education.enrolled_in_greek_school', operator: 'eq', value: true }], months: 0, note: 'This is a declaration route connected to birth and schooling, not unconditional jus soli.' }),
    ],
  });
}

function bulgariaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.bulgaria_citizenship_act);
  const directorate = requireSource(officialSources, OFFICIAL_URLS.bulgaria_citizenship_directorate);
  const repeal = requireSource(officialSources, OFFICIAL_URLS.bulgaria_investment_repeal);
  return reviewedCountryRecord({
    shadow,
    iso: '100',
    note: 'All acquisition modes reviewed against the current Bulgarian Citizenship Act and Ministry of Justice citizenship procedures.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act, directorate] },
      { mode: 'naturalization', finding: 'present', sources: [act, directorate] },
      { mode: 'birth', finding: 'present', sources: [act], note: 'Territorial birth applies where the person does not acquire another citizenship by origin; it is not general jus soli.' },
      { mode: 'investment', finding: 'present', sources: [act, repeal], note: 'The only modeled route is historical and inactive: investment-naturalization Articles 12a and 14a were repealed in 2022 and unfinished proceedings were terminated.' },
    ],
    routes: [
      principalCitizenshipRoute({ id: 'bulgaria-bulgarian-origin-naturalization', mode: 'ancestry', title: 'Naturalization for a person of Bulgarian origin', summary: 'A person of Bulgarian origin may apply under article 15 without the ordinary residence, income, language and release-of-prior-citizenship conditions. The applicant must establish the family relationship with at least one ancestor of Bulgarian origin, up to the third degree inclusive, using the required official documents.', source: act, eligibility: [{ field: 'ancestor.bulgarian_origin_degree', operator: 'lte', value: 3, unit: 'count' }], months: 0, allocation: 'discretionary', lastChecked: '2026-07-17' }),
      principalCitizenshipRoute({ id: 'bulgaria-ordinary-naturalization', mode: 'naturalization', title: 'Ordinary naturalization after permanent residence', summary: 'Bulgaria\'s ordinary route generally requires an adult to have held permanent or long-term residence for at least five years, alongside criminal-record, income or occupation, Bulgarian-language and—unless an exception applies—prior-citizenship release requirements. This is five years after the qualifying residence status, not a promise of citizenship after five years of any lawful stay.', source: [act, directorate], eligibility: [{ field: 'residence.permanent_or_long_term_months', operator: 'gte', value: 60, unit: 'months' }, { field: 'language.bulgarian_required', operator: 'eq', value: true }], months: 60, allocation: 'discretionary', note: 'The five years run from obtaining permanent or long-term residence, not merely from first arrival.', lastChecked: '2026-07-17' }),
      principalCitizenshipRoute({ id: 'bulgaria-citizenship-by-birth-statelessness', mode: 'birth', title: 'Citizenship by birth where no other citizenship is acquired', summary: 'A person born in Bulgaria is a citizen by place of birth if they do not acquire another citizenship by origin; a foundling with unknown parents is presumed born in Bulgaria.', source: act, eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '100' }, { field: 'child.other_nationality_acquired', operator: 'eq', value: false }], months: 0 }),
      principalCitizenshipRoute({ id: 'bulgaria-investor-citizenship-repealed', mode: 'investment', title: 'Former investor-citizenship provisions', summary: 'Bulgaria repealed the special investment-based citizenship provisions in 2022. Investment or property ownership should not be presented as a current direct route to Bulgarian citizenship; any residence obtained on another legal basis follows the applicable ordinary nationality rules.', source: [repeal, act], eligibility: [{ field: 'programme.accepting_new_applications', operator: 'eq', value: false }], months: null, allocation: 'discretionary', status: 'inactive', lastChecked: '2026-07-17', note: 'Historical negative retained to prevent stale investor-citizenship recommendations.' }),
    ],
  });
}

function serbiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const guidance = requireSource(officialSources, OFFICIAL_URLS.serbia_citizenship_guidance);
  return reviewedCountryRecord({
    shadow,
    iso: '688',
    note: 'All acquisition modes reviewed against the Serbian Ministry of Interior citizenship guidance and linked Citizenship Act.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [guidance] },
      { mode: 'naturalization', finding: 'present', sources: [guidance] },
      { mode: 'birth', finding: 'present', sources: [guidance], note: 'Birth in Serbia is limited to children whose parents are unknown, of unknown citizenship or stateless, or where the child would otherwise be stateless.' },
      { mode: 'investment', finding: 'verified_none', sources: [guidance], note: 'The official acquisition grounds do not provide a direct citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({ id: 'serbia-citizenship-by-descent', mode: 'ancestry', title: 'Serbian citizenship by descent', summary: 'Serbian citizenship is acquired by descent under the parentage and, for some foreign-born children, registration conditions in the Citizenship Act.', source: guidance, eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '688' }], months: 0 }),
      principalCitizenshipRoute({ id: 'serbia-admission-after-permanent-residence', mode: 'naturalization', title: 'Admission after permanent residence', summary: 'An adult foreigner with permanent residence may request admission to Serbian citizenship subject to release or qualifying assurance regarding former citizenship and a declaration that Serbia is their state.', source: guidance, eligibility: [{ field: 'residence.permanent_status', operator: 'eq', value: true }, { field: 'declaration.serbia_as_state', operator: 'eq', value: true }], months: 36, allocation: 'discretionary', note: 'Current foreigner rules generally make permanent residence available after three years of continuous temporary residence; citizenship admission then remains a separate decision.' }),
      principalCitizenshipRoute({ id: 'serbia-citizenship-by-birth-statelessness', mode: 'birth', title: 'Citizenship at birth to prevent statelessness', summary: 'A child born or found in Serbia acquires citizenship where both parents are unknown, of unknown citizenship or stateless, or where the child would otherwise be stateless.', source: guidance, eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '688' }, { field: 'child.other_nationality_acquired', operator: 'eq', value: false }], months: 0 }),
    ],
  });
}

function unitedArabEmiratesRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.uae_nationality_law);
  const guidance = requireSource(officialSources, OFFICIAL_URLS.uae_nationality_guidance);
  const goldenVisa = requireSource(officialSources, OFFICIAL_URLS.uae_golden_visa);
  return reviewedCountryRecord({
    shadow,
    iso: '784',
    note: 'All acquisition modes reviewed against the federal nationality law and UAE Government guidance; nomination-based nationality is distinguished from Golden Visa residence.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law] },
      { mode: 'naturalization', finding: 'present', sources: [law, guidance], note: 'Naturalization and the 2021 exceptional categories are discretionary and nomination-based.' },
      { mode: 'birth', finding: 'present', sources: [law], note: 'Birth in the UAE alone does not confer citizenship; acquisition at birth depends principally on a qualifying parent or the foundling/statelessness rules.' },
      { mode: 'investment', finding: 'present', sources: [guidance, goldenVisa], note: 'Property-owning investors may be nominated for nationality, but there is no open, threshold-based direct CBI application. The Golden Visa is residence only.' },
    ],
    routes: [
      principalCitizenshipRoute({ id: 'uae-citizenship-by-father', mode: 'ancestry', title: 'Emirati nationality through a citizen father', summary: 'Federal law treats a person born in the UAE or abroad to a qualifying Emirati father as a citizen by operation of law, with additional limited maternal and foundling cases.', source: law, eligibility: [{ field: 'parent.father_citizenship.iso_n3', operator: 'eq', value: '784' }], months: 0 }),
      principalCitizenshipRoute({ id: 'uae-exceptional-naturalization', mode: 'naturalization', title: 'Exceptional nomination for Emirati nationality', summary: 'Specified professionals, scientists, inventors, intellectuals and talented people may be nominated for nationality when their category-specific conditions are met.', source: guidance, eligibility: [{ field: 'nomination.by_competent_uae_authority', operator: 'eq', value: true }], months: null, allocation: 'discretionary', note: 'There is no public self-application route or guaranteed timeline.' }),
      principalCitizenshipRoute({ id: 'uae-citizenship-at-birth-qualifying-parent', mode: 'birth', title: 'Citizenship at birth through a qualifying parent', summary: 'Citizenship at birth follows the federal parentage rules rather than territorial birth; the law also protects certain children of unknown or stateless parentage.', source: law, eligibility: [{ field: 'birth.parent_qualifying_under_federal_law', operator: 'eq', value: true }], months: 0 }),
      principalCitizenshipRoute({ id: 'uae-investor-nationality-nomination', mode: 'investment', title: 'Investor nomination for Emirati nationality', summary: 'The 2021 exceptional categories allow a property-owning investor to be nominated for nationality by designated UAE authorities.', source: guidance, eligibility: [{ field: 'investment.uae_property_owned', operator: 'eq', value: true }, { field: 'nomination.by_competent_uae_authority', operator: 'eq', value: true }], months: null, allocation: 'discretionary', note: 'This is not a purchasable or threshold-based CBI programme. Golden Visa investment residence is separate.' }),
    ],
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
    argentinaRecord(shadow, countrySources),
    australiaRecord(shadow, countrySources),
    brazilRecord(shadow, countrySources),
    bulgariaRecord(shadow, countrySources),
    canadaRecord(shadow, countrySources),
    caymanIslandsRecord(shadow, countrySources),
    colombiaRecord(shadow, countrySources),
    cyprusRecord(shadow, countrySources),
    dominicaRecord(shadow, countrySources),
    franceRecord(shadow, countrySources),
    georgiaRecord(shadow, countrySources),
    germanyRecord(shadow, countrySources),
    greeceRecord(shadow, countrySources),
    irelandRecord(shadow, countrySources),
    italyRecord(shadow, countrySources),
    maltaRecord(shadow, countrySources),
    mexicoRecord(shadow, countrySources),
    netherlandsRecord(shadow, countrySources),
    newZealandRecord(shadow, countrySources),
    portugalRecord(shadow, countrySources),
    stKittsNevisRecord(shadow, countrySources),
    serbiaRecord(shadow, countrySources),
    singaporeRecord(shadow, countrySources),
    spainRecord(shadow, countrySources),
    switzerlandRecord(shadow, countrySources),
    turkiyeRecord(shadow, countrySources),
    unitedArabEmiratesRecord(shadow, countrySources),
    unitedKingdomRecord(shadow, countrySources),
    unitedStatesRecord(shadow, countrySources),
    uruguayRecord(shadow, countrySources),
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

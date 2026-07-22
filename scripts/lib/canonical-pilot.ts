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
  brazil_naturalization_residence: 'https://www.gov.br/mj/pt-br/assuntos/seus-direitos/migracoes/naturalizacao/o-que-e-naturalizacao/naturalizacao-ordinaria/ter-residencia-em-territorio-nacional-pelo-prazo-estabelecido-pela-lei-brasileira',
  brazil_family_reunification: 'https://www.gov.br/pf/pt-br/assuntos/imigracao/duvidas-frequentes',
  mexico_constitution: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/CPEUM.pdf',
  mexico_nationality_law: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LNac.pdf',
  mexico_migration_law: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LMigra.pdf',
  mexico_child_naturalization: 'https://portales.sre.gob.mx/tramites-dgaj/naturalizacion/carta-de-naturalizacion-por-tener-hijos-mexicanos-por-nacimiento',
  mexico_family_residence: 'https://www.inm.gob.mx/static/Tramites/cambio_de_condicion_estancia/Residente_permanente_por_vinculo_familiar.pdf',
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
  antigua_constitution: 'https://www.legislation.gov.uk/uksi/1981/1106/contents/made',
  antigua_citizenship_act: 'https://laws.gov.ag/wp-content/uploads/2018/08/cap-22.pdf',
  antigua_citizenship_faq: 'https://immigration.gov.ag/frequently-asked-questions/citizenship-permit-faqs/',
  antigua_cbi_act: 'https://cip.gov.ag/wp-content/uploads/2013/10/Antigua-and-Barbuda-Citizenship-by-Investment-Act-2013.pdf',
  antigua_cbi_options: 'https://cip.gov.ag/citizenship/',
  antigua_cbi_home: 'https://cip.gov.ag/home',
  grenada_constitution: 'https://www.gov.gd/government/the-constitution',
  grenada_citizenship_act: 'https://www.laws.gov.gd/index.php/chapters/c-39a-75d/92-chapter-54-citizenship-act',
  grenada_naturalization_form: 'https://gndembassyprc.mofa.gov.gd/wp-content/uploads/2023/09/Schedule-5-Regulation-7.pdf',
  grenada_cbi: 'https://www.cbi.gov.gd/index_php/',
  saint_lucia_constitution: 'https://www.govt.lc/constitution7',
  saint_lucia_citizenship_amendment: 'https://npc.govt.lc/files/laws/acts/2024/Act%20No%207%20of%202024%20Citizenship%20of%20Saint%20Lucia.pdf',
  saint_lucia_descent_guidance: 'https://homeaffairs.govt.lc/news/the-citizenship-of-saint-lucia-act-is-amended',
  saint_lucia_cbi_act: 'https://pmd.govt.lc/wp-content/uploads/2025/10/Citizenship-by-Investment-Act-Cap.1.20.pdf',
  saint_lucia_cbi_options: 'https://www.cipsaintlucia.com/citizenship-by-investment',
  bahamas_constitution: 'https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/1973/1973-1080/1973-1080_1.pdf',
  bahamas_nationality_act: 'https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/1973/1973-0018/1973-0018.pdf',
  bahamas_economic_pr: 'https://www.immigration.gov.bs/wp-content/uploads/2019/10/PERMANENT-RESIDENCE-FORM-ECONOMIC.pdf',
  barbados_constitution: 'https://www.electoral.barbados.gov.bb/wp-content/uploads/2021/10/The_Constitution_of_Barbados.pdf',
  barbados_citizenship_act: 'https://www.barbadoslawcourts.gov.bb/assets/content/pdfs/statutes/BarbadosCitizenshipCAP186.pdf',
  barbados_citizenship_guidance: 'https://immigration.gov.bb/pages/Citizenship.aspx',
  mauritius_citizenship_act: 'https://lawsofmauritius.govmu.org/portal/viewlegislationdocument/web/?docnumber=&doctitle=TWF1cml0aXVzIENpdGl6ZW5zaGlwIEFjdA%3D%3D&doctype=act',
  mauritius_citizenship_guidance: 'https://dha.govmu.org/Pages/Services/Citizenship.aspx',
  panama_constitution: 'https://constitucion.te.gob.pa/constitucion-vigente/',
  panama_naturalization_requirements: 'https://www.migracion.gob.pa/wp-content/uploads/REQUISITOS-DE-NATURALIZACION-ACTUALIZADO.pdf',
  vanuatu_constitution: 'https://parliament.gov.vu/images/constitution.pdf',
  vanuatu_registration_guidance: 'https://crvsd.gov.vu/services/registration-of-new-citizens',
  vanuatu_cbi_review: 'https://pmo.gov.vu/en/public-information/press-release/1150-coi-report-and-recommendations.html',
  vanuatu_citizenship_types: 'https://vancitizenship.gov.vu/index.php/citizenship/types-of-citizenship',
  vanuatu_legislative_framework: 'https://vancitizenship.gov.vu/index.php/about-us/legislative-framework',
  vanuatu_dsp_regulations: 'https://vancitizenship.gov.vu/images/Order_No_33_of_2019_-_New_DSP_Regulations.pdf',
  egypt_nationality_law: 'https://manshurat.org/node/7358',
  egypt_nationality_amendment_2004: 'https://learningpartnership.org/sites/default/files/resources/pdfs/Egypt%20-%20Nationality%20Law%20-%202004%20-%20English.pdf',
  egypt_cbi_programme: 'https://egyptcitizenship.gov.eg/',
  egypt_gafi_citizenship: 'https://www.gafi.gov.eg/English/Howcanwehelp/Pages/Egyptian-Citizenship.aspx',
  jordan_nationality_law: 'https://learningpartnership.org/sites/default/files/resources/pdfs/Jordan%20Law%20No.%206%20of%201954%20on%20Nationality%20%28last%20amended%201987%29%20English.pdf',
  jordan_investor_criteria: 'https://invest.jo/en/node/123',
  jordan_petra_investor_citizenship: 'https://petra.gov.jo/en/news/government-revamps-investor-citizenship-rules-to-funnel-capital-into-provinces',
  nauru_citizenship_act: 'https://justice.gov.nr/wp-content/uploads/2023/12/Naoero-Citizenship-Act-2017.pdf',
  nauru_ecrcp_act: 'https://ronlaw.gov.nr/assets/docs%2Facts%2F2024%2FNauru%20Economic%20and%20Climate%20Resilience%20Citizenship%20Act%202024.pdf',
  nauru_ecrcp_programme: 'https://www.ecrcp.gov.nr/',
  nauru_ecrcp_launch: 'https://www.nauru.gov.nr/government-information-office/media-release/climate-resilience-citizenship-program-introducted-in-singapore_1dec24.aspx',
  sao_tome_nationality_law: 'https://citizenshiprightsafrica.org/wp-content/uploads/STP-Lei.07.2022.pdf',
  sao_tome_cbi_regulation: 'https://www.imidaily.com/wp-content/uploads/2025/08/STP-CBI-Act-01082025-1.pdf',
  sao_tome_cbi_consulate: 'https://saotomeprincipe.de/pt/cidadania-por-investimento/',
  paraguay_constitution: 'https://www.bacn.gov.py/archivos/9580/CONSTITUCION_ORIGINAL_FIRMADA.pdf',
  paraguay_constitution_index: 'https://www.bacn.gov.py/leyes-paraguayas/9580/constitucion-nacional-',
  paraguay_descent_guidance: 'https://repatriados.gov.py/inclusion-a-la-identidad-nacional/',
  paraguay_migration: 'https://migraciones.gov.py/',
  chile_sermig_citizenship: 'https://serviciomigraciones.cl/en/citizenship/',
  chile_constitution_art10: 'https://bcn.cl/2lzfp',
  israel_nationality_law: 'https://data.globalcit.eu/NationalDB/docs/Isreal%20Nationality%20Law%20(amended).pdf',
  israel_law_of_return: 'https://www.jewishvirtuallibrary.org/law-of-return',
  poland_recognition: 'https://www.gov.pl/web/mswia-en/apply-to-be-recognised-as-a-polish-citizen',
  poland_citizenship_hub: 'https://www.gov.pl/web/mswia/obywatelstwo',
  poland_citizenship_en: 'https://www.gov.pl/web/mswia-en/citizenship',
  hungary_acquisition: 'https://emberijogok.kormany.hu/the-acquisition-of-hungarian-nationality',
  hungary_simplified: 'https://www.kormanyhivatal.hu/hu/budapest/jarasok/egyszerusitett-honositasi-eljaras',
  hungary_simplified_en: 'https://telaviv.mfa.gov.hu/eng/page/egyszerusitett-honositas',
  japan_nationality_act: 'https://www.japaneselawtranslation.go.jp/en/laws/view/3784/en',
  japan_nationality_qa: 'https://www.moj.go.jp/EN/MINJI/minji78.html',
  korea_general_naturalization: 'https://www.hikorea.go.kr/info/InfoDatail.pt?CAT_SEQ=200&PARENT_ID=148&locale=EN',
  korea_simple_naturalization: 'https://www.hikorea.go.kr/info/InfoDatail.pt?CAT_SEQ=201&PARENT_ID=148&locale=EN',
  philippines_ca_473: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/29/34227',
  philippines_osg_scn: 'https://www.osg.gov.ph/page?call=scn',
  south_africa_citizenship_act: 'https://www.gov.za/sites/default/files/gcis_document/201409/act88of1995.pdf',
  south_africa_citizenship_act_page: 'https://www.gov.za/documents/south-african-citizenship-act',
  south_africa_amendment_2010: 'https://www.gov.za/sites/default/files/gcis_document/201409/a1720100.pdf',
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
      ['Brazil Ministry of Justice — naturalization residence periods', OFFICIAL_URLS.brazil_naturalization_residence, '076', 'pt', 'official_guidance', 'brazil-citizenship-law'],
      ['Brazil Federal Police — family-reunification guidance', OFFICIAL_URLS.brazil_family_reunification, '076', 'pt', 'official_guidance', 'brazil-citizenship-law'],
      ['Political Constitution of Mexico — Article 30', OFFICIAL_URLS.mexico_constitution, '484', 'es', 'primary_law', 'mexico-nationality-law'],
      ['Mexico Nationality Law', OFFICIAL_URLS.mexico_nationality_law, '484', 'es', 'primary_law', 'mexico-nationality-law'],
      ['Mexico Migration Law', OFFICIAL_URLS.mexico_migration_law, '484', 'es', 'primary_law', 'mexico-nationality-law'],
      ['Mexico Foreign Ministry — naturalization for parents of Mexican-born children', OFFICIAL_URLS.mexico_child_naturalization, '484', 'es', 'official_guidance', 'mexico-nationality-law'],
      ['Mexico INM — permanent residence through family relationship', OFFICIAL_URLS.mexico_family_residence, '484', 'es', 'official_guidance', 'mexico-nationality-law'],
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
      ['Constitution of Antigua and Barbuda', OFFICIAL_URLS.antigua_constitution, '028', 'en', 'primary_law', 'antigua-citizenship-law'],
      ['Antigua and Barbuda Citizenship Act', OFFICIAL_URLS.antigua_citizenship_act, '028', 'en', 'primary_law', 'antigua-citizenship-law'],
      ['Antigua and Barbuda Immigration — Citizenship FAQs', OFFICIAL_URLS.antigua_citizenship_faq, '028', 'en', 'official_guidance', 'antigua-citizenship-law'],
      ['Antigua and Barbuda Citizenship by Investment Act', OFFICIAL_URLS.antigua_cbi_act, '028', 'en', 'primary_law', 'antigua-citizenship-law'],
      ['Antigua and Barbuda CIU — Investment options', OFFICIAL_URLS.antigua_cbi_options, '028', 'en', 'official_guidance', 'antigua-citizenship-law'],
      ['Antigua and Barbuda Citizenship by Investment Unit', OFFICIAL_URLS.antigua_cbi_home, '028', 'en', 'official_guidance', 'antigua-citizenship-law'],
      ['Constitution of Grenada', OFFICIAL_URLS.grenada_constitution, '308', 'en', 'primary_law', 'grenada-citizenship-law'],
      ['Grenada Citizenship Act', OFFICIAL_URLS.grenada_citizenship_act, '308', 'en', 'primary_law', 'grenada-citizenship-law'],
      ['Grenada — application for naturalisation', OFFICIAL_URLS.grenada_naturalization_form, '308', 'en', 'official_guidance', 'grenada-citizenship-law'],
      ['Grenada Citizenship by Investment', OFFICIAL_URLS.grenada_cbi, '308', 'en', 'official_guidance', 'grenada-citizenship-law'],
      ['Constitution of Saint Lucia — citizenship', OFFICIAL_URLS.saint_lucia_constitution, '662', 'en', 'primary_law', 'saint-lucia-citizenship-law'],
      ['Citizenship of Saint Lucia (Amendment) Act 2024', OFFICIAL_URLS.saint_lucia_citizenship_amendment, '662', 'en', 'primary_law', 'saint-lucia-citizenship-law'],
      ['Saint Lucia Home Affairs — descent amendment', OFFICIAL_URLS.saint_lucia_descent_guidance, '662', 'en', 'official_guidance', 'saint-lucia-citizenship-law'],
      ['Saint Lucia Citizenship by Investment Act', OFFICIAL_URLS.saint_lucia_cbi_act, '662', 'en', 'primary_law', 'saint-lucia-citizenship-law'],
      ['Saint Lucia CIP — Investment options', OFFICIAL_URLS.saint_lucia_cbi_options, '662', 'en', 'official_guidance', 'saint-lucia-citizenship-law'],
      ['Constitution of The Bahamas — citizenship', OFFICIAL_URLS.bahamas_constitution, '044', 'en', 'primary_law', 'bahamas-nationality-law'],
      ['Bahamas Nationality Act', OFFICIAL_URLS.bahamas_nationality_act, '044', 'en', 'primary_law', 'bahamas-nationality-law'],
      ['Bahamas Immigration — Economic permanent residence', OFFICIAL_URLS.bahamas_economic_pr, '044', 'en', 'official_guidance', 'bahamas-nationality-law'],
      ['Constitution of Barbados — citizenship', OFFICIAL_URLS.barbados_constitution, '052', 'en', 'primary_law', 'barbados-citizenship-law'],
      ['Barbados Citizenship Act', OFFICIAL_URLS.barbados_citizenship_act, '052', 'en', 'primary_law', 'barbados-citizenship-law'],
      ['Barbados Immigration — Citizenship', OFFICIAL_URLS.barbados_citizenship_guidance, '052', 'en', 'official_guidance', 'barbados-citizenship-law'],
      ['Mauritius Citizenship Act', OFFICIAL_URLS.mauritius_citizenship_act, '480', 'en', 'primary_law', 'mauritius-citizenship-law'],
      ['Mauritius Prime Minister’s Office — Citizenship', OFFICIAL_URLS.mauritius_citizenship_guidance, '480', 'en', 'official_guidance', 'mauritius-citizenship-law'],
      ['Constitution of Panama — nationality and naturalization', OFFICIAL_URLS.panama_constitution, '591', 'es', 'primary_law', 'panama-nationality-law'],
      ['Panama Migration — Naturalization requirements', OFFICIAL_URLS.panama_naturalization_requirements, '591', 'es', 'official_guidance', 'panama-nationality-law'],
      ['Constitution of Vanuatu — citizenship', OFFICIAL_URLS.vanuatu_constitution, '548', 'en', 'primary_law', 'vanuatu-citizenship-law'],
      ['Vanuatu Civil Registry — Registration of new citizens', OFFICIAL_URLS.vanuatu_registration_guidance, '548', 'en', 'official_guidance', 'vanuatu-citizenship-law'],
      ['Vanuatu Prime Minister’s Office — CBI review', OFFICIAL_URLS.vanuatu_cbi_review, '548', 'en', 'official_guidance', 'vanuatu-citizenship-law'],
      ['Vanuatu Citizenship Commission — Types of Citizenship', OFFICIAL_URLS.vanuatu_citizenship_types, '548', 'en', 'official_guidance', 'vanuatu-citizenship-law'],
      ['Vanuatu Citizenship Commission — Legislative Framework', OFFICIAL_URLS.vanuatu_legislative_framework, '548', 'en', 'official_guidance', 'vanuatu-citizenship-law'],
      ['Vanuatu Development Support Program Regulations', OFFICIAL_URLS.vanuatu_dsp_regulations, '548', 'en', 'primary_law', 'vanuatu-citizenship-law'],
      ['Egyptian Nationality Law No. 26 of 1975', OFFICIAL_URLS.egypt_nationality_law, '818', 'ar', 'primary_law', 'egypt-citizenship-investment'],
      ['Egypt Law No. 154 of 2004 amending the Nationality Law', OFFICIAL_URLS.egypt_nationality_amendment_2004, '818', 'en', 'primary_law', 'egypt-citizenship-investment'],
      ['Egyptian Cabinet — Citizenship through Investment Programmes', OFFICIAL_URLS.egypt_cbi_programme, '818', 'ar', 'official_guidance', 'egypt-citizenship-investment'],
      ['GAFI — Unit for Granting Egyptian Citizenship in Exchange for Investment', OFFICIAL_URLS.egypt_gafi_citizenship, '818', 'en', 'official_guidance', 'egypt-citizenship-investment'],
      ['Jordanian Nationality Law No. 6 of 1954 (as amended)', OFFICIAL_URLS.jordan_nationality_law, '400', 'en', 'primary_law', 'jordan-investor-citizenship'],
      ['Invest Jordan — Cabinet investor residency and citizenship criteria', OFFICIAL_URLS.jordan_investor_criteria, '400', 'en', 'official_guidance', 'jordan-investor-citizenship'],
      ['Jordan News Agency (Petra) — Cabinet investor citizenship amendments', OFFICIAL_URLS.jordan_petra_investor_citizenship, '400', 'en', 'official_guidance', 'jordan-investor-citizenship'],
      ['Naoero Citizenship Act 2017', OFFICIAL_URLS.nauru_citizenship_act, '520', 'en', 'primary_law', 'nauru-citizenship-law'],
      ['Nauru Economic and Climate Resilience Citizenship Act 2024', OFFICIAL_URLS.nauru_ecrcp_act, '520', 'en', 'primary_law', 'nauru-citizenship-law'],
      ['Nauru Program Office — Economic and Climate Resilience Citizenship Program', OFFICIAL_URLS.nauru_ecrcp_programme, '520', 'en', 'official_guidance', 'nauru-citizenship-law'],
      ['Government of Nauru — climate resilience citizenship programme launch', OFFICIAL_URLS.nauru_ecrcp_launch, '520', 'en', 'official_guidance', 'nauru-citizenship-law'],
      ['São Tomé and Príncipe — Lei n.º 07/2022 Lei da Nacionalidade', OFFICIAL_URLS.sao_tome_nationality_law, '678', 'pt', 'primary_law', 'sao-tome-citizenship-law'],
      ['São Tomé and Príncipe — Decreto-Lei n.º 07/2025 RNID', OFFICIAL_URLS.sao_tome_cbi_regulation, '678', 'pt', 'primary_law', 'sao-tome-citizenship-law'],
      ['Honorary Consulate of São Tomé and Príncipe — Citizenship by Investment', OFFICIAL_URLS.sao_tome_cbi_consulate, '678', 'pt', 'official_guidance', 'sao-tome-citizenship-law'],
      ['Paraguay Constitution — nationality provisions (signed text)', OFFICIAL_URLS.paraguay_constitution, '600', 'es', 'primary_law', 'paraguay-nationality-law'],
      ['Paraguay BACN — Constitución Nacional index', OFFICIAL_URLS.paraguay_constitution_index, '600', 'es', 'primary_law', 'paraguay-nationality-law'],
      ['Paraguay Repatriados — inclusión a la identidad nacional', OFFICIAL_URLS.paraguay_descent_guidance, '600', 'es', 'official_guidance', 'paraguay-nationality-law'],
      ['Paraguay Dirección General de Migraciones', OFFICIAL_URLS.paraguay_migration, '600', 'es', 'official_guidance', 'paraguay-nationality-law'],
      ['Chile SERMIG — Chilean citizenship / Carta de Nacionalización', OFFICIAL_URLS.chile_sermig_citizenship, '152', 'en', 'official_guidance', 'chile-nationality-law'],
      ['Chile Constitution Article 10 — nationality (BCN)', OFFICIAL_URLS.chile_constitution_art10, '152', 'es', 'primary_law', 'chile-nationality-law'],
      ['Israel Nationality Law 5712-1952 (amended text)', OFFICIAL_URLS.israel_nationality_law, '376', 'en', 'primary_law', 'israel-nationality-law'],
      ['Israel Law of Return 5710-1950 (published text)', OFFICIAL_URLS.israel_law_of_return, '376', 'en', 'primary_law', 'israel-nationality-law'],
      ['Poland MSWiA — recognition as a Polish citizen', OFFICIAL_URLS.poland_recognition, '616', 'en', 'official_guidance', 'poland-citizenship-law'],
      ['Poland MSWiA — obywatelstwo', OFFICIAL_URLS.poland_citizenship_hub, '616', 'pl', 'official_guidance', 'poland-citizenship-law'],
      ['Poland MSWiA — citizenship (English hub)', OFFICIAL_URLS.poland_citizenship_en, '616', 'en', 'official_guidance', 'poland-citizenship-law'],
      ['Hungary Government — acquisition of Hungarian nationality', OFFICIAL_URLS.hungary_acquisition, '348', 'en', 'official_guidance', 'hungary-citizenship-law'],
      ['Hungary Government Office — simplified naturalization', OFFICIAL_URLS.hungary_simplified, '348', 'hu', 'official_guidance', 'hungary-citizenship-law'],
      ['Hungary MFA — simplified naturalization (English)', OFFICIAL_URLS.hungary_simplified_en, '348', 'en', 'official_guidance', 'hungary-citizenship-law'],
      ['Japan Nationality Act (Japanese Law Translation)', OFFICIAL_URLS.japan_nationality_act, '392', 'en', 'primary_law', 'japan-nationality-law'],
      ['Japan Ministry of Justice — Nationality Q&A', OFFICIAL_URLS.japan_nationality_qa, '392', 'en', 'official_guidance', 'japan-nationality-law'],
      ['HiKorea — General naturalization (5 years)', OFFICIAL_URLS.korea_general_naturalization, '410', 'en', 'official_guidance', 'korea-nationality-law'],
      ['HiKorea — Simple naturalization', OFFICIAL_URLS.korea_simple_naturalization, '410', 'en', 'official_guidance', 'korea-nationality-law'],
      ['Philippines Commonwealth Act No. 473 — Revised Naturalization Law', OFFICIAL_URLS.philippines_ca_473, '608', 'en', 'primary_law', 'philippines-citizenship-law'],
      ['Office of the Solicitor General — Special Committee on Naturalization', OFFICIAL_URLS.philippines_osg_scn, '608', 'en', 'official_guidance', 'philippines-citizenship-law'],
      ['South African Citizenship Act 88 of 1995 (gov.za PDF)', OFFICIAL_URLS.south_africa_citizenship_act, '710', 'en', 'primary_law', 'south-africa-citizenship-law'],
      ['South African Government — Citizenship Act document page', OFFICIAL_URLS.south_africa_citizenship_act_page, '710', 'en', 'official_guidance', 'south-africa-citizenship-law'],
      ['South African Citizenship Amendment Act 17 of 2010', OFFICIAL_URLS.south_africa_amendment_2010, '710', 'en', 'primary_law', 'south-africa-citizenship-law'],
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
  const naturalizationGuidance = requireSource(
    officialSources,
    OFFICIAL_URLS.brazil_naturalization_residence,
  );
  const familyGuidance = requireSource(
    officialSources,
    OFFICIAL_URLS.brazil_family_reunification,
  );
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
        summary: 'Ordinary naturalization generally requires four years of residence. The minimum falls to one year for a parent of a Brazilian child and for a person originating from a Portuguese-speaking country, subject to the remaining conditions.',
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
          {
            id: 'parent_of_brazilian_child',
            label: 'One-year route for a parent of a Brazilian child',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'child.nationality.iso_n3', operator: 'eq', value: '076' },
              { field: 'residence.indefinite_continuous_months', operator: 'gte', value: 12, unit: 'months' },
            ],
            milestones: [
              { status: 'family_reunification_residence', minimum_months: 0 },
              { status: 'indefinite_continuous_residence', minimum_months: 12 },
            ],
            timeline: {
              eligibility_minimum_months: 12,
              processing_typical_months: null,
              confidence: 'high',
              note: 'The child is Brazilian at birth. A parent can seek family-reunification residence, and having a Brazilian child reduces the naturalization residence minimum to one year; citizenship is not automatic. Grandparents may qualify for family-reunification residence as second-degree ascendants, but receive no automatic citizenship or child-based one-year naturalization shortcut.',
            },
            source_refs: refs([migrationLaw, naturalizationGuidance, familyGuidance], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/parent_of_brazilian_child/eligibility`,
              `/routes/${naturalizationId}/variants/parent_of_brazilian_child/milestones`,
              `/routes/${naturalizationId}/variants/parent_of_brazilian_child/timeline`,
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
  const migrationLaw = requireSource(officialSources, OFFICIAL_URLS.mexico_migration_law);
  const childNaturalization = requireSource(
    officialSources,
    OFFICIAL_URLS.mexico_child_naturalization,
  );
  const familyResidence = requireSource(
    officialSources,
    OFFICIAL_URLS.mexico_family_residence,
  );
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
        summary: 'The ordinary route requires five years of residence. Article 20 reduces the period to two years for a person originating from Latin America or the Iberian Peninsula and for a parent of a Mexican child by birth.',
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
          {
            id: 'parent_of_mexican_child_by_birth',
            label: 'Two-year route for a parent of a Mexican child by birth',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'child.mexican_by_birth', operator: 'eq', value: true },
              { field: 'residence.in_mexico_months', operator: 'gte', value: 24, unit: 'months' },
            ],
            milestones: [
              { status: 'permanent_residence_by_family_relationship', minimum_months: 0 },
              { status: 'residence_in_mexico', minimum_months: 24 },
            ],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'high',
              note: 'The child is Mexican at birth. Parents and grandparents can qualify for permanent residence through the direct family relationship, but only a parent with a Mexican child by birth receives this two-year naturalization route; citizenship is not automatic for either generation.',
            },
            source_refs: refs([nationalityLaw, migrationLaw, childNaturalization, familyResidence], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/parent_of_mexican_child_by_birth/eligibility`,
              `/routes/${naturalizationId}/variants/parent_of_mexican_child_by_birth/milestones`,
              `/routes/${naturalizationId}/variants/parent_of_mexican_child_by_birth/timeline`,
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
        summary: 'Government-administered direct citizenship programme requiring a prescribed investment or contribution, including the Sustainable Island State Contribution (SISC), and due diligence.',
        source: application,
        eligibility: [
          { field: 'investment.minimum_usd', operator: 'gte', value: 250000 },
          { field: 'compliance.due_diligence_passed', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'discretionary',
        note: 'Official contribution/investment minimums currently start at US$250,000 for the SISC or Public Benefit option for a single principal applicant. Approved real-estate routes are higher. Due diligence, biometrics and passport fees are additional and change by circular; re-check the Citizenship Unit schedule before quoting all-in cost.',
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function antiguaBarbudaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.antigua_constitution);
  const act = requireSource(officialSources, OFFICIAL_URLS.antigua_citizenship_act);
  const citizenshipFaq = requireSource(officialSources, OFFICIAL_URLS.antigua_citizenship_faq);
  const cbiAct = requireSource(officialSources, OFFICIAL_URLS.antigua_cbi_act);
  const cbiOptions = requireSource(officialSources, OFFICIAL_URLS.antigua_cbi_options);
  const cbiLegacy = requireSource(officialSources, OFFICIAL_URLS.antigua_cbi_home);
  return reviewedCountryRecord({
    shadow,
    iso: '028',
    name: 'Antigua and Barbuda',
    note: 'All acquisition modes reviewed against the Constitution, Citizenship Act and current Citizenship by Investment Unit options.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, act] },
      { mode: 'naturalization', finding: 'present', sources: [act, citizenshipFaq] },
      { mode: 'birth', finding: 'present', sources: [constitution] },
      { mode: 'investment', finding: 'present', sources: [cbiAct, cbiOptions] },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'antigua-barbuda-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Citizenship through a citizen parent',
        summary: 'A person born abroad acquires citizenship at birth through a qualifying Antigua and Barbuda citizen parent under section 113 of the Constitution.',
        source: [constitution, act],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '028' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'antigua-barbuda-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after a qualifying residence period',
        summary: 'The Citizenship Act requires residence throughout the twelve months immediately before application and at least five aggregate years during the preceding seven-year period.',
        source: [act, citizenshipFaq],
        eligibility: [
          { field: 'residence.final_twelve_months_continuous', operator: 'eq', value: true },
          { field: 'residence.prior_seven_years_months', operator: 'gte', value: 60, unit: 'months' },
        ],
        months: 96,
        allocation: 'discretionary',
        note: 'The eight-year window contains a continuous final year plus five aggregate years in the preceding seven; it is not an eight-year continuous-residence rule.',
      }),
      principalCitizenshipRoute({
        id: 'antigua-barbuda-citizenship-by-birth',
        mode: 'birth',
        title: 'Citizenship by birth in Antigua and Barbuda',
        summary: 'A person born in Antigua and Barbuda acquires citizenship at birth, subject to the Constitution’s diplomatic-immunity and hostile-occupation exceptions.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '028' },
          { field: 'birth.constitutional_exception', operator: 'eq', value: false },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'antigua-barbuda-cip',
        mode: 'investment',
        title: 'Citizenship by Investment Programme',
        summary: 'Government-administered direct citizenship programme with contribution, real-estate and other approved investment options.',
        source: cbiLegacy,
        eligibility: [
          { field: 'investment.minimum_usd', operator: 'gte', value: 230000 },
          { field: 'compliance.due_diligence_passed', operator: 'eq', value: true },
          { field: 'residence.first_five_years_days', operator: 'gte', value: 5, unit: 'days' },
        ],
        months: 0,
        allocation: 'discretionary',
        note: 'The National Development Fund option currently starts at US$230,000. Other approved routes and fees differ, and the principal applicant must spend at least five days in Antigua and Barbuda during the first five calendar years.',
        lastChecked: '2026-07-17',
      }),
    ],
  });
}

function grenadaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.grenada_constitution);
  const act = requireSource(officialSources, OFFICIAL_URLS.grenada_citizenship_act);
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.grenada_naturalization_form);
  const cbi = requireSource(officialSources, OFFICIAL_URLS.grenada_cbi);
  return reviewedCountryRecord({
    shadow,
    iso: '308',
    note: 'All acquisition modes reviewed against the Constitution, Citizenship Act, official naturalisation form and Citizenship by Investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, act] },
      { mode: 'naturalization', finding: 'present', sources: [act, naturalization] },
      { mode: 'birth', finding: 'present', sources: [constitution] },
      { mode: 'investment', finding: 'present', sources: [cbi] },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'grenada-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Citizenship through a citizen parent',
        summary: 'A person born outside Grenada acquires citizenship at birth when a qualifying parent is a Grenadian citizen.',
        source: [constitution, act],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '308' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'grenada-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after a seven-year residence history',
        summary: 'An alien may apply for discretionary naturalization using the official form’s seven-year residence or government-service history, with character, solvency and intention-to-reside review.',
        source: [act, naturalization],
        eligibility: [{ field: 'residence_or_government_service.history_months', operator: 'gte', value: 84, unit: 'months' }],
        months: 84,
        allocation: 'discretionary',
        note: 'The official application records the seven years immediately before filing. It does not establish an automatic grant after seven continuous years.',
      }),
      principalCitizenshipRoute({
        id: 'grenada-citizenship-by-birth',
        mode: 'birth',
        title: 'Citizenship by birth in Grenada',
        summary: 'A person born in Grenada acquires citizenship at birth, subject to the constitutional diplomatic-immunity and hostile-occupation exceptions.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '308' },
          { field: 'birth.constitutional_exception', operator: 'eq', value: false },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'grenada-cbi',
        mode: 'investment',
        title: 'Citizenship by Investment Programme',
        summary: 'Government-administered direct citizenship programme with National Transformation Fund and approved-project routes.',
        source: cbi,
        eligibility: [
          { field: 'investment.qualifying_option', operator: 'in', value: ['national_transformation_fund', 'approved_project'] },
          { field: 'compliance.due_diligence_passed', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'discretionary',
        note: 'The official programme page confirms the contribution and approved-project routes. Monetary thresholds are intentionally omitted here because the same page currently displays an older minimum and should not be treated as a reliable current fee schedule.',
        lastChecked: '2026-07-17',
      }),
    ],
  });
}

function saintLuciaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.saint_lucia_constitution);
  const amendment = requireSource(officialSources, OFFICIAL_URLS.saint_lucia_citizenship_amendment);
  const descent = requireSource(officialSources, OFFICIAL_URLS.saint_lucia_descent_guidance);
  const cbiAct = requireSource(officialSources, OFFICIAL_URLS.saint_lucia_cbi_act);
  const cbiOptions = requireSource(officialSources, OFFICIAL_URLS.saint_lucia_cbi_options);
  return reviewedCountryRecord({
    shadow,
    iso: '662',
    note: 'All acquisition modes reviewed against the Constitution, the 2024 citizenship amendment and the current Citizenship by Investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, amendment, descent] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution, amendment] },
      { mode: 'investment', finding: 'present', sources: [cbiAct, cbiOptions] },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'saint-lucia-citizenship-by-parent-or-grandparent',
        mode: 'ancestry',
        title: 'Citizenship through a citizen parent or grandparent',
        summary: 'The 2024 amendment extends citizenship by descent to a person born abroad whose parent or grandparent is a Saint Lucian citizen by birth, subject to the statutory conditions.',
        source: [amendment, descent],
        eligibility: [{ field: 'parent_or_grandparent.citizen_by_birth.iso_n3', operator: 'eq', value: '662' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'saint-lucia-naturalization',
        mode: 'naturalization',
        title: 'Registration after seven years for a Commonwealth citizen',
        summary: 'A Commonwealth citizen is entitled to apply for registration after seven years of ordinary residence in Saint Lucia, subject to the Constitution’s application and public-interest conditions.',
        source: constitution,
        eligibility: [
          { field: 'citizenship.commonwealth', operator: 'eq', value: true },
          { field: 'residence.ordinary_months', operator: 'gte', value: 84, unit: 'months' },
        ],
        months: 84,
        allocation: 'right',
      }),
      principalCitizenshipRoute({
        id: 'saint-lucia-citizenship-by-birth',
        mode: 'birth',
        title: 'Citizenship by birth in Saint Lucia',
        summary: 'A person born in Saint Lucia acquires citizenship at birth, subject to the statutory diplomatic-immunity and hostile-occupation exceptions.',
        source: [constitution, amendment],
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '662' },
          { field: 'birth.constitutional_exception', operator: 'eq', value: false },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'saint-lucia-cip',
        mode: 'investment',
        title: 'Citizenship by Investment Programme',
        summary: 'Direct citizenship by registration following a qualifying investment under the Citizenship by Investment Act.',
        source: cbiAct,
        eligibility: [
          { field: 'investment.minimum_usd', operator: 'gte', value: 240000 },
          { field: 'compliance.due_diligence_passed', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'discretionary',
        note: 'The National Economic Fund option currently starts at US$240,000 for a principal applicant with up to three qualifying dependants; other options and fees differ.',
        lastChecked: '2026-07-17',
      }),
    ],
  });
}

function bahamasRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.bahamas_constitution);
  const act = requireSource(officialSources, OFFICIAL_URLS.bahamas_nationality_act);
  const economicPr = requireSource(officialSources, OFFICIAL_URLS.bahamas_economic_pr);
  return reviewedCountryRecord({
    shadow,
    iso: '044',
    name: 'Bahamas',
    note: 'All acquisition modes reviewed against the Constitution and Nationality Act; economic permanent residence is kept distinct from citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, act] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Birth in The Bahamas grants citizenship at birth when a parent is a citizen; a person born there to non-citizen parents has a separate constitutional registration window at age 18.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, act, economicPr],
        note: 'Investment can support economic permanent residence, not direct citizenship. Citizenship still follows the Constitution and Nationality Act.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'bahamas-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Citizenship through a qualifying Bahamian parent',
        summary: 'The Constitution provides citizenship at birth or a registration route for a person born abroad through a qualifying Bahamian parent; the applicable rule depends on parentage and the circumstances of birth.',
        source: [constitution, act],
        eligibility: [{ field: 'parent.qualifies_under_constitution', operator: 'eq', value: true }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'bahamas-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after a qualifying residence period',
        summary: 'The Nationality Act requires twelve months of residence immediately before application and at least six aggregate years during the preceding nine years, alongside character, English, civic-knowledge and permanent-home requirements.',
        source: act,
        eligibility: [
          { field: 'residence.final_twelve_months_continuous', operator: 'eq', value: true },
          { field: 'residence.prior_nine_years_months', operator: 'gte', value: 72, unit: 'months' },
        ],
        months: 120,
        allocation: 'discretionary',
        note: 'The ten-year statutory window contains a final continuous year plus six aggregate years in the preceding nine; it is not a ten-year continuous-residence rule.',
      }),
      principalCitizenshipRoute({
        id: 'bahamas-citizenship-connected-to-birth',
        mode: 'birth',
        title: 'Citizenship connected to birth in The Bahamas',
        summary: 'Birth in The Bahamas confers citizenship at birth when a parent is Bahamian. A person born there to non-citizen parents may instead apply for registration at age 18 and before turning 19, subject to the constitutional conditions.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '044' },
          { field: 'birth.citizen_parent_or_age_18_registration_conditions', operator: 'eq', value: true },
        ],
        months: 0,
        note: 'The age-18 route is later registration connected to birthplace, not citizenship at birth.',
      }),
    ],
  });
}

function barbadosRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.barbados_constitution);
  const act = requireSource(officialSources, OFFICIAL_URLS.barbados_citizenship_act);
  const guidance = requireSource(officialSources, OFFICIAL_URLS.barbados_citizenship_guidance);
  return reviewedCountryRecord({
    shadow,
    iso: '052',
    note: 'All acquisition modes reviewed against the Constitution, Citizenship Act and official Immigration guidance. Barbados retains broad territorial birth citizenship, subject to narrow constitutional exceptions.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, guidance] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'A person born in Barbados after independence is generally a citizen at birth; the Constitution has narrow diplomatic-immunity and hostile-occupation exceptions.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, act, guidance],
        note: 'No direct citizenship-by-investment route appears in the reviewed citizenship framework. Investment or residence products must not be represented as direct citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'barbados-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Citizenship through a qualifying Barbadian parent',
        summary: 'A person born abroad acquires citizenship at birth through the constitutional parentage rules, including where at least one parent is a Barbadian citizen born in Barbados.',
        source: [constitution, guidance],
        eligibility: [{ field: 'parent.qualifies_under_constitution', operator: 'eq', value: true }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'barbados-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after qualifying residence',
        summary: 'An alien may apply after twelve continuous months immediately before the application and at least five aggregate years of residence during the preceding seven years, subject to character and residence-intention requirements.',
        source: act,
        eligibility: [
          { field: 'residence.final_continuous_months', operator: 'gte', value: 12, unit: 'months' },
          { field: 'residence.prior_seven_years_aggregate_months', operator: 'gte', value: 60, unit: 'months' },
        ],
        months: null,
        allocation: 'discretionary',
        note: 'The Act uses a final continuous year plus five aggregate years in the preceding seven. It is neither six continuous years nor eight continuous years.',
      }),
      principalCitizenshipRoute({
        id: 'barbados-citizenship-by-birth',
        mode: 'birth',
        title: 'Citizenship by birth in Barbados',
        summary: 'A person born in Barbados after 29 November 1966 is generally a citizen from birth, subject to narrow diplomatic-immunity and hostile-occupation exceptions.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '052' },
          { field: 'birth.constitutional_exception_applies', operator: 'eq', value: false },
        ],
        months: 0,
      }),
    ],
  });
}

function mauritiusRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.mauritius_citizenship_act);
  const guidance = requireSource(officialSources, OFFICIAL_URLS.mauritius_citizenship_guidance);
  return reviewedCountryRecord({
    shadow,
    iso: '480',
    note: 'All acquisition modes reviewed against the current Citizenship Act and Prime Minister’s Office guidance. The investor route is naturalization after investment and residence, not passport purchase without residence.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [guidance] },
      { mode: 'naturalization', finding: 'present', sources: [act, guidance] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [guidance],
        note: 'Birth before 1 October 1995 generally conferred citizenship regardless of parentage. For later births in Mauritius, a citizen parent is required.',
      },
      {
        mode: 'investment',
        finding: 'present',
        sources: [act, guidance],
        note: 'Section 9(3) permits the Minister to accept two continuous years of residence for an applicant investing at least US$500,000. The grant remains discretionary naturalization.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'mauritius-citizenship-by-descent',
        mode: 'ancestry',
        title: 'Citizenship through a Mauritian parent',
        summary: 'A person born abroad is a Mauritian citizen by descent when a qualifying parent is a Mauritian citizen by birth.',
        source: guidance,
        eligibility: [{ field: 'parent.citizen_by_birth.iso_n3', operator: 'eq', value: '480' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'mauritius-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after qualifying residence',
        summary: 'A non-Commonwealth applicant may seek naturalization after twelve continuous months immediately before applying and five aggregate years during the preceding seven years, subject to character, language and residence-intention requirements.',
        source: [act, guidance],
        eligibility: [
          { field: 'residence.final_continuous_months', operator: 'gte', value: 12, unit: 'months' },
          { field: 'residence.prior_seven_years_aggregate_months', operator: 'gte', value: 60, unit: 'months' },
        ],
        months: null,
        allocation: 'discretionary',
      }),
      principalCitizenshipRoute({
        id: 'mauritius-citizenship-connected-to-birth',
        mode: 'birth',
        title: 'Citizenship connected to birth in Mauritius',
        summary: 'Birth in Mauritius before 1 October 1995 generally conferred citizenship regardless of parentage; after that date, at least one parent must be a Mauritian citizen.',
        source: guidance,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '480' },
          { field: 'birth.before_1995_10_01_or_citizen_parent', operator: 'eq', value: true },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'mauritius-investor-naturalization',
        mode: 'investment',
        title: 'Investor naturalization after residence',
        summary: 'The Minister may accept two continuous years of residence from an applicant who has invested at least US$500,000 in Mauritius, instead of the ordinary residence pattern.',
        source: [act, guidance],
        eligibility: [
          { field: 'investment.minimum_usd', operator: 'gte', value: 500000 },
          { field: 'residence.continuous_months', operator: 'gte', value: 24, unit: 'months' },
        ],
        months: 24,
        allocation: 'discretionary',
        note: 'This is discretionary naturalization with a statutory investment and residence condition, not residence-free direct citizenship.',
      }),
    ],
  });
}

function panamaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.panama_constitution);
  const requirements = requireSource(
    officialSources,
    OFFICIAL_URLS.panama_naturalization_requirements,
  );
  return reviewedCountryRecord({
    shadow,
    iso: '591',
    note: 'All acquisition modes reviewed against the current Constitution and National Migration Service requirements. Investor and Friendly Nations residence routes remain separate from citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, requirements] },
      { mode: 'birth', finding: 'present', sources: [constitution] },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, requirements],
        note: 'Panama offers investment-linked residence, but the reviewed nationality framework contains no direct citizenship-by-investment entitlement.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'panama-nationality-through-parent',
        mode: 'ancestry',
        title: 'Nationality through a Panamanian parent',
        summary: 'A person born abroad to a Panamanian parent can acquire nationality under Article 9, subject to domicile in Panama and, for a naturalized parent, a timely declaration after majority.',
        source: constitution,
        eligibility: [
          { field: 'parent.citizenship.iso_n3', operator: 'eq', value: '591' },
          { field: 'residence.domicile_in_panama', operator: 'eq', value: true },
        ],
        months: null,
      }),
      principalCitizenshipRoute({
        id: 'panama-ordinary-naturalization',
        mode: 'naturalization',
        title: 'Ordinary naturalization',
        summary: 'A permanent resident may apply after five consecutive years in Panama, subject to the constitutional declaration, nationality-renunciation, Spanish and civic-knowledge requirements.',
        source: [constitution, requirements],
        eligibility: [
          { field: 'residence.consecutive_months', operator: 'gte', value: 60, unit: 'months' },
          { field: 'residence.status', operator: 'eq', value: 'permanent_resident' },
          { field: 'integration.spanish_and_civics', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
      }),
      principalCitizenshipRoute({
        id: 'panama-family-naturalization',
        mode: 'naturalization',
        title: 'Naturalization through a qualifying family connection',
        summary: 'The Constitution reduces the residence period to three consecutive years for an applicant with a child born in Panama, a Panamanian parent, or a Panamanian spouse, while retaining the other Article 10 requirements.',
        source: [constitution, requirements],
        eligibility: [
          { field: 'residence.consecutive_months', operator: 'gte', value: 36, unit: 'months' },
          { field: 'family.qualifying_panamanian_connection', operator: 'eq', value: true },
        ],
        months: 36,
        allocation: 'discretionary',
      }),
      principalCitizenshipRoute({
        id: 'panama-nationality-by-birth',
        mode: 'birth',
        title: 'Nationality by birth in Panama',
        summary: 'A person born in Panama is Panamanian by birth under Article 9 of the Constitution.',
        source: constitution,
        eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '591' }],
        months: 0,
      }),
    ],
  });
}

function vanuatuRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.vanuatu_constitution);
  const registration = requireSource(
    officialSources,
    OFFICIAL_URLS.vanuatu_registration_guidance,
  );
  const cbiReview = requireSource(officialSources, OFFICIAL_URLS.vanuatu_cbi_review);
  const types = requireSource(officialSources, OFFICIAL_URLS.vanuatu_citizenship_types);
  const framework = requireSource(officialSources, OFFICIAL_URLS.vanuatu_legislative_framework);
  const dsp = requireSource(officialSources, OFFICIAL_URLS.vanuatu_dsp_regulations);
  return reviewedCountryRecord({
    shadow,
    iso: '548',
    note: 'All acquisition modes reviewed against the constitutional citizenship chapter and Citizenship Commission materials. The Commission’s investment programmes remain subject to current regulations and official programme administration.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, registration] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, framework] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution, registration],
        note: 'Birth in Vanuatu alone is insufficient. A person born after independence, in Vanuatu or abroad, is a citizen when at least one parent is a citizen.',
      },
      { mode: 'investment', finding: 'present', sources: [types, framework, dsp, cbiReview] },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'vanuatu-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Citizenship through a Vanuatu parent',
        summary: 'A person born after independence, in Vanuatu or abroad, becomes a citizen when at least one parent is a Vanuatu citizen.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '548' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'vanuatu-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after continuous residence',
        summary: 'A foreign national or stateless person may apply after living continuously in Vanuatu for at least ten years, subject to further statutory conditions and review.',
        source: [constitution, framework],
        eligibility: [{ field: 'residence.continuous_months', operator: 'gte', value: 120, unit: 'months' }],
        months: 120,
        allocation: 'discretionary',
      }),
      principalCitizenshipRoute({
        id: 'vanuatu-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Vanuatu parent',
        summary: 'A child born after independence acquires citizenship at birth, whether born in Vanuatu or abroad, if at least one parent is a citizen.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '548' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'vanuatu-investor-citizenship',
        mode: 'investment',
        title: 'Investor and contribution citizenship programmes',
        summary: 'The Citizenship Commission lists investor citizenship, the Development Support Program, the Vanuatu Contribution Program and a real-estate option under the Citizenship Act framework.',
        source: [types, framework],
        eligibility: [{ field: 'programme.official_investor_or_contribution_route', operator: 'eq', value: true }],
        months: null,
        allocation: 'discretionary',
        note: 'Programme options, contribution levels, due-diligence rules and designated agents are volatile. Verify them against current Commission regulations before relying on a quote.',
        lastChecked: '2026-07-17',
      }),
    ],
  });
}

function egyptRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.egypt_nationality_law);
  const amendment = requireSource(officialSources, OFFICIAL_URLS.egypt_nationality_amendment_2004);
  const cbi = requireSource(officialSources, OFFICIAL_URLS.egypt_cbi_programme);
  const gafi = requireSource(officialSources, OFFICIAL_URLS.egypt_gafi_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '818',
    note: 'All acquisition modes reviewed against Nationality Law No. 26 of 1975 as amended in 2004 and the Cabinet/GAFI citizenship-by-investment programme pages.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law, amendment] },
      {
        mode: 'naturalization',
        finding: 'present',
        sources: [law],
        note: 'Ordinary naturalization under Law No. 26 of 1975 remains a discretionary Interior Ministry decision after ten consecutive years of normal legal residence, with Arabic language and character conditions.',
      },
      {
        mode: 'birth',
        finding: 'present',
        sources: [law, amendment],
        note: 'Citizenship at birth follows Egyptian parentage or the foundling/unknown-parents rule. Birth in Egypt to two foreign parents is not general jus soli.',
      },
      { mode: 'investment', finding: 'present', sources: [cbi, gafi] },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'egypt-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Egyptian nationality through an Egyptian parent',
        summary: 'A person born of an Egyptian father or an Egyptian mother is Egyptian under Law No. 26 of 1975 as equalized by Law No. 154 of 2004.',
        source: [law, amendment],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '818' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'egypt-naturalization',
        mode: 'naturalization',
        title: 'Ordinary naturalization after ten consecutive years',
        summary: 'Under Article 4 of Law No. 26 of 1975, a foreign adult may seek discretionary Egyptian nationality after ten consecutive years of normal legal residence in Egypt, with Arabic-language, means and character review by the Minister of Interior.',
        source: law,
        eligibility: [
          { field: 'residence.consecutive_lawful_years', operator: 'gte', value: 10, unit: 'years' },
          { field: 'language.arabic_sufficient', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        note: 'Residence eligibility is not an automatic grant. Shorter statutory routes exist for some Egyptian-origin and other special categories, and investment/property pathways are modeled separately; those are not collapsed into this ordinary record.',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'egypt-citizenship-by-birth',
        mode: 'birth',
        title: 'Citizenship at birth through parentage or foundling status',
        summary: 'A person is Egyptian at birth when born to an Egyptian father or mother. A person born in Egypt of unknown parents, including a foundling presumed born in Egypt, is also Egyptian. Birth in Egypt alone to identified foreign parents is not general jus soli.',
        source: [law, amendment],
        eligibility: [
          {
            field: 'parent.egyptian_or_unknown_parents_in_egypt',
            operator: 'eq',
            value: true,
          },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'egypt-investor-citizenship',
        mode: 'investment',
        title: 'Egyptian citizenship through investment programmes',
        summary: 'The Prime Minister\'s citizenship unit administers direct routes through a non-refundable contribution, property, an investment project or a central-bank deposit. No multi-year residence period is required before the investment programme grant.',
        source: [cbi, gafi],
        eligibility: [
          {
            field: 'investment.qualifying_option',
            operator: 'in',
            value: [
              'treasury_contribution_usd_250000',
              'property_usd_300000',
              'deposit_usd_500000_three_years',
              'investment_project_usd_450000',
            ],
          },
          { field: 'compliance.security_and_due_diligence_passed', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'discretionary',
        note: 'Official programme pages list four investment options starting at USD 250,000. Approval remains discretionary after security review; temporary residence may be issued only to complete the chosen investment programme.',
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function jordanRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.jordan_nationality_law);
  const investor = requireSource(officialSources, OFFICIAL_URLS.jordan_investor_criteria);
  const petra = requireSource(officialSources, OFFICIAL_URLS.jordan_petra_investor_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '400',
    note: 'All acquisition modes reviewed against Nationality Law No. 6 of 1954 as amended and the July 2026 Cabinet investor-citizenship criteria published by Invest Jordan and Petra.',
    coverage: [
      {
        mode: 'ancestry',
        finding: 'present',
        sources: [law],
        note: 'Descent is primarily through a Jordanian father. A Jordanian mother transmits nationality at birth only with an unknown, stateless or unestablished father, or through later discretionary routes.',
      },
      { mode: 'naturalization', finding: 'present', sources: [law] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [law],
        note: 'Territorial birth is limited to foundlings and a child born in Jordan to a Jordanian mother and unknown/stateless father. It is not general jus soli.',
      },
      {
        mode: 'investment',
        finding: 'present',
        sources: [investor, petra],
        note: 'Investor citizenship is a Cabinet discretionary economic pathway administered through the Ministry of Investment / Invest Jordan, not an amendment of the Nationality Law itself. Passive bank-deposit and treasury-bond options were phased out in favour of productive capital and employment routes. Dual nationality is routinely permitted on this pathway, unlike ordinary naturalization. Several project routes use a temporary passport and multi-year compliance period before full citizenship is recommended.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'jordan-citizenship-by-father',
        mode: 'ancestry',
        title: 'Jordanian nationality through a Jordanian father',
        summary: 'A person whose father holds Jordanian nationality is Jordanian, and the children of a Jordanian man are Jordanian wherever they are born.',
        source: law,
        eligibility: [{ field: 'father.citizenship.iso_n3', operator: 'eq', value: '400' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'jordan-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after four years of regular residence',
        summary: 'A non-Jordanian adult may apply to the Council of Ministers after four years of regular residence and an intention to reside in Jordan. The Cabinet may grant or refuse the certificate and may waive the residence period for an Arab applicant or in the public interest with royal approval. Ordinary naturalization under the Nationality Law requires loss of the prior nationality; this renunciation rule is distinct from the investor Cabinet pathway.',
        source: law,
        eligibility: [
          { field: 'residence.regular_months', operator: 'gte', value: 48, unit: 'months' },
          { field: 'residence.intention_to_reside', operator: 'eq', value: true },
          { field: 'prior_nationality.lost_or_renounced', operator: 'eq', value: true },
        ],
        months: 48,
        allocation: 'discretionary',
        note: 'Eligibility to apply is not a right to citizenship. Article 13 of the Nationality Law conditions an ordinary certificate on loss of prior nationality. Political and public-office restrictions apply for years after naturalization. Do not assume the same renunciation rule for investor citizenship.',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'jordan-citizenship-by-birth-limited',
        mode: 'birth',
        title: 'Limited citizenship connected to birth in Jordan',
        summary: 'A person born in Jordan to a Jordanian mother and a father who is unknown, stateless or whose filiation is not established is Jordanian. A foundling in Jordan is presumed born there and is Jordanian unless the contrary is proved. Birth in Jordan to two foreign parents is not general jus soli.',
        source: law,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '400' },
          {
            field: 'birth.foundling_or_jordanian_mother_unknown_father',
            operator: 'eq',
            value: true,
          },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'jordan-investor-citizenship',
        mode: 'investment',
        title: 'Investor citizenship criteria',
        summary: 'Jordan\'s Cabinet-approved criteria, administered by the Ministry of Investment / Invest Jordan, provide citizenship routes through qualifying securities, productive projects, business expansion or sustained job creation. Several project routes require a multi-year compliance period, often with a temporary three-year passport before a recommendation for full citizenship. Dual nationality is routinely permitted on this economic pathway.',
        source: [investor, petra],
        eligibility: [
          {
            field: 'investment.qualifying_cabinet_route',
            operator: 'in',
            value: [
              'listed_shares_jod_1500000',
              'new_productive_project',
              'existing_project_expansion',
              'large_scale_employment',
              'amrah_city_project',
            ],
          },
          { field: 'compliance.employment_or_holding_conditions_met', operator: 'eq', value: true },
        ],
        months: 36,
        allocation: 'discretionary',
        note: 'Property purchase alone is a residence route, not direct citizenship. Passive deposit and treasury-bond routes have been phased out. Thresholds and employment numbers change by Cabinet decision; always verify the current Invest Jordan publication before relying on a quote. Origin-country dual-nationality policy should still be checked case by case.',
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function nauruRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.nauru_citizenship_act);
  const ecrcpAct = requireSource(officialSources, OFFICIAL_URLS.nauru_ecrcp_act);
  const programme = requireSource(officialSources, OFFICIAL_URLS.nauru_ecrcp_programme);
  const launch = requireSource(officialSources, OFFICIAL_URLS.nauru_ecrcp_launch);
  return reviewedCountryRecord({
    shadow,
    iso: '520',
    note: 'All acquisition modes reviewed against the Naoero Citizenship Act 2017 and the 2024 Economic and Climate Resilience Citizenship Act administered by the Nauru Program Office.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      {
        mode: 'naturalization',
        finding: 'present',
        sources: [act],
        note: 'There is no general residence-only naturalization. Marriage and other relationship-based grants are the ordinary non-investment naturalization routes.',
      },
      {
        mode: 'birth',
        finding: 'present',
        sources: [act],
        note: 'Citizenship at birth generally requires a citizen parent. A later application exists for a person born in Nauru to non-citizen parents after twenty years of residence.',
      },
      { mode: 'investment', finding: 'present', sources: [ecrcpAct, programme, launch] },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'nauru-citizenship-by-descent',
        mode: 'ancestry',
        title: 'Citizenship by descent through a Nauruan parent',
        summary: 'A person born outside Nauru is a citizen if, at the time of birth, either parent was a citizen.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '520' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'nauru-naturalization-by-marriage',
        mode: 'naturalization',
        title: 'Naturalization through marriage to a Nauruan citizen',
        summary: 'A foreign spouse may apply after seven continuous years of lawful marriage and residence with the Nauruan spouse, subject to character, health, commitment to reside and no-criminal-conviction conditions. Cabinet may waive the residence period.',
        source: act,
        eligibility: [
          { field: 'spouse.citizenship.iso_n3', operator: 'eq', value: '520' },
          { field: 'marriage_and_residence.continuous_months', operator: 'gte', value: 84, unit: 'months' },
        ],
        months: 84,
        allocation: 'discretionary',
        note: 'The grant is made by the Minister in consultation with Cabinet and is final without court appeal under the Act.',
      }),
      principalCitizenshipRoute({
        id: 'nauru-citizenship-connected-to-birth',
        mode: 'birth',
        title: 'Citizenship connected to birth in Nauru',
        summary: 'A person born in Nauru is a citizen at birth if either parent is a citizen. A person born in Nauru to non-citizen parents may later apply after twenty continuous years of residence. Foundling and otherwise-stateless birth situations are also protected under the constitutional and statutory framework.',
        source: act,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '520' },
          {
            field: 'parent.citizen_or_twenty_year_residence_application',
            operator: 'eq',
            value: true,
          },
        ],
        months: 0,
        note: 'The twenty-year route is later discretionary acquisition connected to birthplace, not citizenship at birth.',
      }),
      principalCitizenshipRoute({
        id: 'nauru-climate-resilience-citizenship',
        mode: 'investment',
        title: 'Economic and Climate Resilience Citizenship Program',
        summary: 'A statutory contribution programme administered by the Nauru Program Office under the Nauru Economic and Climate Resilience Citizenship Act 2024, under which a foreign adult may acquire economic and climate resilience citizenship after a prescribed contribution and due diligence, without a residence requirement.',
        source: [ecrcpAct, programme, launch],
        eligibility: [
          { field: 'applicant.age_years', operator: 'gte', value: 18 },
          { field: 'contribution.programme_prescribed', operator: 'eq', value: true },
          { field: 'compliance.due_diligence_passed', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'discretionary',
        note: 'The 2024 Act creates the no-residence contribution framework; contribution amounts are programme-prescribed rather than a permanent single figure in the Act. Published baselines have been in the region of USD 115,000, with limited-time promotional discounts (for example lower temporary tiers). Verify current Program Office figures and due-diligence fees before relying on a quote.',
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function saoTomePrincipeRecord(
  shadow: DataShadow,
  officialSources: SourceRecord[],
): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.sao_tome_nationality_law);
  const regulation = requireSource(officialSources, OFFICIAL_URLS.sao_tome_cbi_regulation);
  const consulate = requireSource(officialSources, OFFICIAL_URLS.sao_tome_cbi_consulate);
  return reviewedCountryRecord({
    shadow,
    iso: '678',
    name: 'São Tomé and Príncipe',
    note: 'All acquisition modes reviewed against Lei n.º 07/2022 and the Decreto-Lei n.º 07/2025 investment/donation regulation, with the honorary-consulate programme page used only as operational guidance.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law] },
      { mode: 'naturalization', finding: 'present', sources: [law] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [law],
        note: 'Origin nationality covers birth in the country to a São-tomense parent, birth abroad with declaration, grandchildren, foundlings/stateless parents, and children of foreign parents who reside in the territory and are not in the service of another state.',
      },
      { mode: 'investment', finding: 'present', sources: [law, regulation, consulate] },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'sao-tome-citizenship-by-parent-or-grandparent',
        mode: 'ancestry',
        title: 'Citizenship through a São-tomense parent or grandparent',
        summary: 'Origin nationality covers a person born abroad to a São-tomense parent who declares the wish to be São-tomense, and descendants who are grandchildren of a São-tomense national born abroad.',
        source: law,
        eligibility: [
          { field: 'parent_or_grandparent.citizenship.iso_n3', operator: 'eq', value: '678' },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'sao-tome-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years of legal residence',
        summary: 'The Government may naturalize a foreign adult or stateless person after at least five years of legal residence, Portuguese or national-language knowledge, clean criminal record, national-security clearance and means of subsistence. The grant is by government decree after a Public Prosecutor prior review.',
        source: law,
        eligibility: [
          { field: 'residence.legal_months', operator: 'gte', value: 60, unit: 'months' },
          { field: 'language.portuguese_or_national', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        note: 'Naturalization is discretionary and may be refused even when the formal residence period is met. Dual-nationality caps apply to some naturalized persons.',
      }),
      principalCitizenshipRoute({
        id: 'sao-tome-citizenship-by-birth',
        mode: 'birth',
        title: 'Citizenship connected to birth in São Tomé and Príncipe',
        summary: 'A person born in São Tomé and Príncipe is of origin nationality when a parent is São-tomense, when the parents are stateless or of unknown nationality, or when foreign parents reside in the territory and are not in the service of another state. Foundling and parental-status conditions remain statutory.',
        source: law,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '678' },
          { field: 'birth.statutory_origin_condition', operator: 'eq', value: true },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'sao-tome-principe-cbi',
        mode: 'investment',
        title: 'Citizenship by Investment Programme',
        summary: 'A direct contribution route created under Decreto-Lei n.º 07/2025 as a special naturalization mechanism under Lei n.º 07/2022 for investment or donation to the National Transformation Fund, administered through the Citizenship by Investment and Donation Unit.',
        source: [regulation, law, consulate],
        eligibility: [
          { field: 'contribution.national_transformation_fund', operator: 'eq', value: true },
          { field: 'compliance.due_diligence_and_mp_prior_review', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'discretionary',
        note: 'The regulation frames the programme as naturalization for investment or donation, not residence-free passport purchase without process. Minimum contribution figures are set in the regulation annex and programme materials and should be re-checked before reliance.',
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function paraguayRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.paraguay_constitution);
  const index = requireSource(officialSources, OFFICIAL_URLS.paraguay_constitution_index);
  const descent = requireSource(officialSources, OFFICIAL_URLS.paraguay_descent_guidance);
  const migration = requireSource(officialSources, OFFICIAL_URLS.paraguay_migration);
  return reviewedCountryRecord({
    shadow,
    iso: '600',
    note: 'All acquisition modes reviewed against Constitución Nacional Arts. 146–148 and official descent/migration guidance. Investor residence is kept distinct from citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, descent, index] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, migration, index] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution, index],
        note: 'Birth in Paraguay generally confers natural nationality (jus soli), subject to the constitutional foreign-government-service exception.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, migration, index],
        note: 'No direct citizenship-by-investment route appears in the constitutional nationality framework. Investor or SUACE-style residence may lead only to later naturalization after the statutory residence period.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'paraguay-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Natural nationality through a Paraguayan parent',
        summary: 'Children of a Paraguayan mother or father born abroad are natural Paraguayans when they settle permanently in the Republic, or when a parent was in the service of the Republic at the time of birth abroad.',
        source: [constitution, descent],
        eligibility: [
          { field: 'parent.citizenship.iso_n3', operator: 'eq', value: '600' },
          { field: 'child.settles_permanently_or_parent_in_state_service', operator: 'eq', value: true },
        ],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'paraguay-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after minimum residence',
        summary: 'Foreign adults may seek Paraguayan nationality by naturalization after a constitutional minimum of three years of residence in the national territory, majority, good conduct, and exercise of a profession, trade, science, art or industry, or ownership of property in the country, subject to the statutory process.',
        source: [constitution, migration],
        eligibility: [
          { field: 'residence.minimum_months', operator: 'gte', value: 36, unit: 'months' },
          { field: 'applicant.majority', operator: 'eq', value: true },
        ],
        months: 36,
        allocation: 'discretionary',
        note: 'The three-year constitutional minimum is eligibility to apply, not an automatic grant. Administrative practice may involve temporary then permanent residence sequencing before the citizenship petition.',
      }),
      principalCitizenshipRoute({
        id: 'paraguay-citizenship-by-birth',
        mode: 'birth',
        title: 'Natural nationality by birth in Paraguay',
        summary: 'Persons born in the territory of the Republic are natural Paraguayans, subject to the constitutional exception for children of persons in the service of a foreign government.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '600' },
          { field: 'birth.foreign_government_service_exception', operator: 'eq', value: false },
        ],
        months: 0,
      }),
    ],
  });
}

function chileRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const sermig = requireSource(officialSources, OFFICIAL_URLS.chile_sermig_citizenship);
  const constitution = requireSource(officialSources, OFFICIAL_URLS.chile_constitution_art10);
  return reviewedCountryRecord({
    shadow,
    iso: '152',
    note: 'All acquisition modes reviewed against Constitución Article 10 and SERMIG Carta de Nacionalización guidance. Investor residence is not direct citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, sermig] },
      { mode: 'naturalization', finding: 'present', sources: [sermig, constitution] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Birth in Chile generally confers nationality, except children of transient foreigners or foreigners in the service of their government; limited later option routes exist for some excluded cases.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [sermig, constitution],
        note: 'Chile has no direct citizenship-by-investment programme. Investor visas support residence only; citizenship still follows naturalization after permanent residence.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'chile-citizenship-by-parent-or-grandparent',
        mode: 'ancestry',
        title: 'Nationality through a Chilean parent or grandparent',
        summary: 'Children of a Chilean father or mother born abroad, and further generations covered by Article 10, may hold or claim Chilean nationality under the constitutional descent rules, including where a parent or grandparent acquired nationality by birth or naturalization as applicable.',
        source: [constitution, sermig],
        eligibility: [{ field: 'parent_or_grandparent.citizenship.iso_n3', operator: 'eq', value: '152' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'chile-naturalization',
        mode: 'naturalization',
        title: 'Carta de Nacionalización after permanent residence',
        summary: 'Adult permanent residents may seek a letter of naturalization after five or more years of residence counted from the electronic stamp that led to permanent residence. A reduced two-year continuous residence path applies for specified family ties to Chileans, including a two-year marriage registered in Chile with shared household.',
        source: sermig,
        eligibility: [
          { field: 'residence.permanent_and_qualifying_years', operator: 'gte', value: 5, unit: 'years' },
          { field: 'status.residencia_definitiva', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        note: 'Family-tie applicants may qualify after two continuous years from the electronic stamp. The grant remains discretionary presidential/administrative naturalization, not an automatic right after five years.',
      }),
      principalCitizenshipRoute({
        id: 'chile-citizenship-by-birth',
        mode: 'birth',
        title: 'Nationality by birth in Chile',
        summary: 'Persons born in Chilean territory are Chilean by birth, except children of transient foreigners or of foreigners who are in Chile in the service of their government. Statelessness safeguards and later option routes may apply to some excluded children.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '152' },
          { field: 'birth.transient_or_foreign_service_exception', operator: 'eq', value: false },
        ],
        months: 0,
      }),
    ],
  });
}

function israelRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const nationality = requireSource(officialSources, OFFICIAL_URLS.israel_nationality_law);
  const lawOfReturn = requireSource(officialSources, OFFICIAL_URLS.israel_law_of_return);
  return reviewedCountryRecord({
    shadow,
    iso: '376',
    note: 'All acquisition modes reviewed against the Nationality Law 5712-1952 and the Law of Return 5710-1950. Official gov.il pages currently return 403 to the automated collector and remain monitoring targets; published law texts supply the canonical evidence.',
    coverage: [
      {
        mode: 'ancestry',
        finding: 'present',
        sources: [lawOfReturn, nationality],
        note: 'Law of Return covers Jews, children and grandchildren of Jews, and certain spouses; Nationality Law also transmits citizenship through an Israeli parent.',
      },
      { mode: 'naturalization', finding: 'present', sources: [nationality] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [nationality],
        note: 'Birth in Israel confers citizenship when a parent is an Israeli national; it is not unconditional territorial jus soli for two foreign parents.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [nationality, lawOfReturn],
        note: 'Israel has no direct citizenship-by-investment programme. Economic residence products must not be represented as Law of Return or naturalization substitutes.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'israel-citizenship-by-return-or-parent',
        mode: 'ancestry',
        title: 'Citizenship by return or through an Israeli parent',
        summary: 'Every Jew has the right to come to Israel as an oleh under the Law of Return; the same rights extend to a child and grandchild of a Jew and to specified spouses, subject to the statutory exceptions. Separately, the Nationality Law transmits Israeli nationality through an Israeli mother or father.',
        source: [lawOfReturn, nationality],
        eligibility: [
          {
            field: 'qualifying_return_status_or_parent.citizenship.iso_n3',
            operator: 'eq',
            value: '376',
          },
        ],
        months: 0,
        note: 'Law of Return eligibility is not ordinary multi-generation ethnic descent without the statutory Jewish/family definitions. Security, health and anti-Jewish-people activity exclusions apply.',
      }),
      principalCitizenshipRoute({
        id: 'israel-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after permanent residence',
        summary: 'A non-national adult may naturalize while in Israel after three years of presence out of the five years before application, permanent-residence entitlement, settlement or intention to settle, some knowledge of Hebrew, and renunciation or loss of prior nationality upon naturalization.',
        source: nationality,
        eligibility: [
          { field: 'residence.years_in_israel_of_prior_five', operator: 'gte', value: 3, unit: 'years' },
          { field: 'status.permanent_residence_entitled', operator: 'eq', value: true },
          { field: 'language.hebrew_some_knowledge', operator: 'eq', value: true },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 36,
        allocation: 'discretionary',
        note: 'Jewish olim under the Law of Return are not subject to the ordinary non-Jew renunciation pattern. Naturalization remains discretionary and security-screened.',
      }),
      principalCitizenshipRoute({
        id: 'israel-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Israeli parent',
        summary: 'A person born in Israel after the establishment of the State acquires Israeli nationality by birth when a parent was an Israeli national; birth in Israel alone to two foreign parents is not general jus soli under the Nationality Law.',
        source: nationality,
        eligibility: [
          { field: 'parent.citizenship.iso_n3', operator: 'eq', value: '376' },
          { field: 'parent.citizenship_at_child_birth', operator: 'eq', value: true },
        ],
        months: 0,
      }),
    ],
  });
}

function polandRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const recognition = requireSource(officialSources, OFFICIAL_URLS.poland_recognition);
  const hub = requireSource(officialSources, OFFICIAL_URLS.poland_citizenship_hub);
  const hubEn = requireSource(officialSources, OFFICIAL_URLS.poland_citizenship_en);
  return reviewedCountryRecord({
    shadow,
    iso: '616',
    note: 'All acquisition modes reviewed against official MSWiA citizenship guidance implementing the Act on Polish Citizenship. No direct CBI route is offered.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [hub, hubEn] },
      { mode: 'naturalization', finding: 'present', sources: [recognition, hub] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [hubEn],
        note: 'Polish citizenship is primarily jus sanguinis: a child of a Polish parent is Polish regardless of birthplace. Territorial birth alone is not general jus soli.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [recognition, hub],
        note: 'Poland has no direct citizenship-by-investment programme. Residence permits based on business or investment remain residence, not citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'poland-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Polish citizenship through a Polish parent',
        summary: 'A child acquires Polish citizenship when at least one parent is a Polish citizen, regardless of the place of birth, subject to the historical continuity rules of the Citizenship Act for older generations.',
        source: [hub, hubEn],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '616' }],
        months: 0,
      }),
      principalCitizenshipRoute({
        id: 'poland-recognition-by-residence',
        mode: 'naturalization',
        title: 'Recognition as a Polish citizen after permanent residence',
        summary: 'A foreign national may be recognised as a Polish citizen after continuous legal residence of at least three years on permanent residence, EU long-term residence or permanent-residence right, with a stable income, a legal title to dwelling, and Polish language at B1. Shorter periods apply for spouses of Polish citizens, refugees, Polish origin / Karta Polaka holders and other statutory categories.',
        source: recognition,
        eligibility: [
          { field: 'residence.continuous_permanent_years', operator: 'gte', value: 3, unit: 'years' },
          { field: 'language.polish_level', operator: 'eq', value: 'B1' },
          { field: 'means.stable_income_and_dwelling', operator: 'eq', value: true },
        ],
        months: 36,
        allocation: 'discretionary',
        note: 'Recognition may be refused for defence or public-security reasons. Presidential grant of citizenship is a separate discretionary channel with different documentary rules.',
      }),
      principalCitizenshipRoute({
        id: 'poland-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Polish parent',
        summary: 'A person born to a Polish citizen parent is a Polish citizen at birth. Birth in Poland to two foreign parents does not generally create citizenship by soil alone.',
        source: hubEn,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '616' }],
        months: 0,
      }),
    ],
  });
}

function hungaryRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const acquisition = requireSource(officialSources, OFFICIAL_URLS.hungary_acquisition);
  const simplified = requireSource(officialSources, OFFICIAL_URLS.hungary_simplified);
  const simplifiedEn = requireSource(officialSources, OFFICIAL_URLS.hungary_simplified_en);
  return reviewedCountryRecord({
    shadow,
    iso: '348',
    note: 'All acquisition modes reviewed against official government acquisition guidance and simplified-naturalization materials. Investor residence is not direct citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [simplifiedEn, acquisition] },
      { mode: 'naturalization', finding: 'present', sources: [acquisition, simplifiedEn] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [acquisition],
        note: 'Hungary follows jus sanguinis: a child of a Hungarian citizen parent is a citizen. Birth in Hungary to foreign parents is not general jus soli.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [acquisition],
        note: 'Hungary has no direct citizenship-by-investment grant. Guest-investor or other residence products may support later ordinary naturalization but are not citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'hungary-citizenship-by-parent-or-simplified-origin',
        mode: 'ancestry',
        title: 'Citizenship through a Hungarian parent or simplified origin naturalization',
        summary: 'A person is a Hungarian citizen at birth if a parent is a Hungarian citizen. Separately, simplified naturalization is available without a multi-year residence period for applicants who prove a Hungarian ancestor or Hungarian origin and demonstrate Hungarian language knowledge, or who meet the long marriage-to-Hungarian criteria.',
        source: [simplifiedEn, acquisition],
        eligibility: [
          {
            field: 'parent_or_ancestor.hungarian_citizenship_or_origin',
            operator: 'eq',
            value: true,
          },
        ],
        months: 0,
        note: 'Parent-at-birth citizenship is recognition of existing status. Simplified naturalization for distant ancestry is discretionary and language-tested; it is not unconditional multi-generation jus sanguinis without process.',
      }),
      principalCitizenshipRoute({
        id: 'hungary-ordinary-naturalization',
        mode: 'naturalization',
        title: 'Ordinary naturalization after continuous residence',
        summary: 'Ordinary naturalization generally requires eight years of continuous residence in Hungary, clean criminal record, livelihood and housing, no public-security obstacle, and a constitutional exam in Hungarian, unless an exemption applies. Preferential shorter periods exist for spouses, parents of Hungarian minors and other statutory categories.',
        source: acquisition,
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 8, unit: 'years' },
          { field: 'exam.constitutional_knowledge_hungarian', operator: 'eq', value: true },
        ],
        months: 96,
        allocation: 'discretionary',
        note: 'Residence eligibility is not an automatic grant. Simplified origin naturalization is modeled under the ancestry route family.',
      }),
      principalCitizenshipRoute({
        id: 'hungary-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Hungarian parent',
        summary: 'A child acquires Hungarian citizenship at birth when at least one parent is a Hungarian citizen, regardless of the place of birth. Birth in Hungary alone to foreign parents is not general jus soli.',
        source: acquisition,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '348' }],
        months: 0,
      }),
    ],
  });
}

function japanRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.japan_nationality_act);
  const qa = requireSource(officialSources, OFFICIAL_URLS.japan_nationality_qa);
  return reviewedCountryRecord({
    shadow,
    iso: '392',
    note: 'All acquisition modes reviewed against the Japanese Law Translation Nationality Act and MOJ Nationality Q&A. Naturalization remains ministerial permission; dual nationality is generally not retained on naturalization.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act, qa] },
      { mode: 'naturalization', finding: 'present', sources: [act, qa] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [act, qa],
        note: 'Japan follows jus sanguinis: a child of a Japanese father or mother is Japanese at birth. Birth in Japan alone to identified foreign parents is not general jus soli; foundling/unknown-parents rules apply.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [act, qa],
        note: 'Japan has no citizenship-by-investment programme. Business or highly skilled residence may support later naturalization but is not citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'japan-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Japanese nationality through a Japanese parent',
        summary: 'A child is a Japanese citizen if the father or mother is a Japanese citizen at the time of birth, or if the father died before birth while a Japanese citizen. Acknowledgment after birth by a Japanese father can support nationality acquisition by notification under Article 3 when statutory age and status conditions are met.',
        source: [act, qa],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '392' }],
        months: 0,
        lastChecked: '2026-07-22',
        note: 'Children born abroad who also acquire a foreign nationality at birth must retain Japanese nationality within the Family Register Act period or may lose it retroactively, subject to reacquisition routes.',
      }),
      principalCitizenshipRoute({
        id: 'japan-naturalization',
        mode: 'naturalization',
        title: 'Naturalization with permission of the Minister of Justice',
        summary: 'A foreign national may acquire Japanese nationality by naturalization with permission of the Minister of Justice. Ordinary minimum conditions include five or more years continuous domicile in Japan, majority and capacity, good conduct, livelihood, and renunciation or loss of prior nationality, plus constitutional-compliance conditions. Meeting the statutory minima does not create an entitlement to permission.',
        source: [act, qa],
        eligibility: [
          { field: 'residence.continuous_domicile_years', operator: 'gte', value: 5, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
          { field: 'means.livelihood', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        note: 'Article 5 of the Nationality Act still states five years continuous domicile. Screening is discretionary and relaxed statutory periods exist for spouses, Japanese-born applicants and other special relationships under Articles 6–8. Administrative practice may apply stricter documentary or continuity expectations than the statutory floor.',
      }),
      principalCitizenshipRoute({
        id: 'japan-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Japanese parent or foundling rule',
        summary: 'A person born to a Japanese father or mother is Japanese at birth. A person born in Japan whose parents are both unknown or without nationality is also Japanese. Birth in Japan alone to identified foreign parents is not general jus soli.',
        source: [act, qa],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '392' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function koreaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const general = requireSource(officialSources, OFFICIAL_URLS.korea_general_naturalization);
  const simple = requireSource(officialSources, OFFICIAL_URLS.korea_simple_naturalization);
  return reviewedCountryRecord({
    shadow,
    iso: '410',
    note: 'All acquisition modes reviewed against official HiKorea nationality/naturalization guidance. Overseas Korean F-4 residence is not citizenship. Dual nationality is generally restricted on naturalization with statutory exceptions.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [simple, general] },
      { mode: 'naturalization', finding: 'present', sources: [general, simple] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [general],
        note: 'Korean nationality at birth follows a Korean national parent (jus sanguinis). Birth in Korea alone to two foreign parents is not general jus soli.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [general],
        note: 'South Korea has no direct citizenship-by-investment programme. Investor or talent residence may support later naturalization but is not a citizenship grant.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'korea-citizenship-by-parent-or-simple-origin',
        mode: 'ancestry',
        title: 'Citizenship through a Korean parent or simplified origin naturalization',
        summary: 'A child acquires Korean nationality when a parent is a Korean national at birth. Separately, simplified naturalization routes exist for persons with a Korean parent, former Korean nationals, or other statutory family/origin links after shorter residence than ordinary naturalization, subject to Nationality Act conditions and Ministry of Justice screening.',
        source: [simple, general],
        eligibility: [
          {
            field: 'parent_or_origin.korean_nationality_or_lineage',
            operator: 'eq',
            value: true,
          },
        ],
        months: 0,
        lastChecked: '2026-07-22',
        note: 'Parent-at-birth status is recognition of existing nationality. Simplified naturalization for adult applicants remains discretionary and is not automatic multi-generation jus sanguinis without process.',
      }),
      principalCitizenshipRoute({
        id: 'korea-general-naturalization',
        mode: 'naturalization',
        title: 'General naturalization after five years domicile and permanent residence',
        summary: 'General naturalization requires more than five consecutive years of domicile in the Republic of Korea, permanent residency status, legal majority under Korean civil law, good conduct, livelihood ability, basic Korean language and cultural knowledge, and no national-security or public-order obstacle. Permission is granted by the Minister of Justice; eligibility is not an entitlement.',
        source: general,
        eligibility: [
          { field: 'residence.continuous_domicile_years', operator: 'gte', value: 5, unit: 'years' },
          { field: 'status.permanent_residence', operator: 'eq', value: true },
          { field: 'language.korean_basic_knowledge', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        note: 'Applicants generally must renounce prior nationality after permission, subject to dual-nationality exceptions for marriage migrants, outstanding talent and other Nationality Act categories. Spousal and origin simplified tracks use shorter residence floors.',
      }),
      principalCitizenshipRoute({
        id: 'korea-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Korean parent',
        summary: 'A person born to a Korean national parent acquires Korean nationality at birth. Birth in Korea alone to two foreign parents is not general jus soli under the Nationality Act.',
        source: general,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '410' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function philippinesRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const ca473 = requireSource(officialSources, OFFICIAL_URLS.philippines_ca_473);
  const scn = requireSource(officialSources, OFFICIAL_URLS.philippines_osg_scn);
  return reviewedCountryRecord({
    shadow,
    iso: '608',
    note: 'All acquisition modes reviewed against Commonwealth Act 473 (judicial naturalization), OSG administrative naturalization under RA 9139, and constitutional jus sanguinis principles. No direct citizenship-by-investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [ca473, scn] },
      { mode: 'naturalization', finding: 'present', sources: [ca473, scn] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [ca473],
        note: 'Philippine citizenship is primarily jus sanguinis through a Filipino parent. Birth in the Philippines alone to two foreign parents is not general jus soli.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [ca473, scn],
        note: 'The Philippines has no direct citizenship-by-investment programme. Special investor residence visas support residence only.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'philippines-citizenship-by-parent-or-reacquisition',
        mode: 'ancestry',
        title: 'Citizenship through a Filipino parent or natural-born reacquisition',
        summary: 'A person is a Filipino citizen when at least one parent is a Filipino citizen, subject to constitutional and statutory lineage rules. Natural-born Filipinos who lost Philippine citizenship by naturalization abroad may reacquire and retain dual citizenship under Republic Act No. 9225 by taking the oath of allegiance and meeting documentary requirements.',
        source: [ca473, scn],
        eligibility: [
          {
            field: 'parent_or_natural_born.filipino_citizenship',
            operator: 'eq',
            value: true,
          },
        ],
        months: 0,
        lastChecked: '2026-07-22',
        note: 'RA 9225 reacquisition is for natural-born Filipinos who previously lost citizenship; it is not a general multi-generation registration without lineage proof.',
      }),
      principalCitizenshipRoute({
        id: 'philippines-naturalization',
        mode: 'naturalization',
        title: 'Naturalization by judicial petition or administrative RA 9139 process',
        summary: 'Ordinary naturalization for foreign adults is available by judicial petition under Commonwealth Act No. 473 after continuous residence of not less than ten years (with shorter statutory periods for specified categories), good moral character, means of support, language and civics knowledge, and other qualifications and disqualifications. Separately, Republic Act No. 9139 provides an administrative naturalization path through the Special Committee on Naturalization for persons born in the Philippines who meet native-born residence and other statutory conditions.',
        source: [ca473, scn],
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 10, unit: 'years' },
          { field: 'character.good_moral', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        note: 'CA 473 is the general judicial track; RA 9139 is a narrower administrative track for persons born and residing in the Philippines. Neither route is an entitlement after residence alone.',
      }),
      principalCitizenshipRoute({
        id: 'philippines-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Filipino parent',
        summary: 'A person born to a Filipino father or mother is a Filipino citizen under the 1987 Constitution. Birth in the Philippines alone to two foreign parents does not generally create citizenship by soil.',
        source: ca473,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '608' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function southAfricaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.south_africa_citizenship_act);
  const page = requireSource(officialSources, OFFICIAL_URLS.south_africa_citizenship_act_page);
  const amendment = requireSource(officialSources, OFFICIAL_URLS.south_africa_amendment_2010);
  return reviewedCountryRecord({
    shadow,
    iso: '710',
    note: 'All acquisition modes reviewed against the South African Citizenship Act 88 of 1995 as amended (including Act 17 of 2010). Investor visas are residence products only.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act, amendment] },
      { mode: 'naturalization', finding: 'present', sources: [act, amendment, page] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [act, amendment],
        note: 'Citizenship by birth follows a South African citizen parent or adoption by a citizen in the statutory cases. Additional birth-in-the-Republic pathways exist under the amended Act for specified parent-status and major-age registration situations; it is not unconditional jus soli for two foreign temporary residents.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [act, page],
        note: 'South Africa has no direct citizenship-by-investment programme. Business or critical-skills residence and permanent residence remain residence, not citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'south-africa-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Citizenship through a South African parent or descent',
        summary: 'A person is a South African citizen by birth or descent when a parent is a South African citizen under the Citizenship Act, including citizenship transmitted through a citizen parent regardless of birthplace in the ordinary jus sanguinis cases, subject to registration and historical continuity rules.',
        source: [act, amendment],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '710' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'south-africa-naturalization',
        mode: 'naturalization',
        title: 'Naturalisation after permanent residence and ordinary residence',
        summary: 'The Minister may grant a certificate of naturalisation to an adult foreigner who has been admitted for permanent residence and has been ordinarily resident in the Republic for a continuous period of not less than five years immediately preceding the application (as amended by Act 17 of 2010), is of good character, intends continued residence or qualifying service, can communicate in an official language, and has adequate knowledge of the responsibilities and privileges of citizenship. Naturalisation remains discretionary.',
        source: [act, amendment, page],
        eligibility: [
          { field: 'status.permanent_residence', operator: 'eq', value: true },
          { field: 'residence.continuous_ordinary_years', operator: 'gte', value: 5, unit: 'years' },
          { field: 'language.official_language_communication', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        note: 'Regulations may impose additional presence limits within the five-year ordinary-residence period. Spousal and exceptional ministerial routes exist with different residence floors.',
      }),
      principalCitizenshipRoute({
        id: 'south-africa-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a South African parent',
        summary: 'A person born to a South African citizen parent is a South African citizen by birth under the Citizenship Act. Birth in the Republic to two foreign parents is not unconditional jus soli; specified later naturalisation or registration routes may apply in limited statutory cases.',
        source: [act, amendment],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '710' }],
        months: 0,
        lastChecked: '2026-07-22',
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
    antiguaBarbudaRecord(shadow, countrySources),
    argentinaRecord(shadow, countrySources),
    australiaRecord(shadow, countrySources),
    bahamasRecord(shadow, countrySources),
    barbadosRecord(shadow, countrySources),
    brazilRecord(shadow, countrySources),
    bulgariaRecord(shadow, countrySources),
    canadaRecord(shadow, countrySources),
    caymanIslandsRecord(shadow, countrySources),
    chileRecord(shadow, countrySources),
    colombiaRecord(shadow, countrySources),
    cyprusRecord(shadow, countrySources),
    dominicaRecord(shadow, countrySources),
    egyptRecord(shadow, countrySources),
    franceRecord(shadow, countrySources),
    georgiaRecord(shadow, countrySources),
    germanyRecord(shadow, countrySources),
    grenadaRecord(shadow, countrySources),
    greeceRecord(shadow, countrySources),
    hungaryRecord(shadow, countrySources),
    irelandRecord(shadow, countrySources),
    israelRecord(shadow, countrySources),
    italyRecord(shadow, countrySources),
    japanRecord(shadow, countrySources),
    jordanRecord(shadow, countrySources),
    koreaRecord(shadow, countrySources),
    maltaRecord(shadow, countrySources),
    mauritiusRecord(shadow, countrySources),
    mexicoRecord(shadow, countrySources),
    nauruRecord(shadow, countrySources),
    netherlandsRecord(shadow, countrySources),
    vanuatuRecord(shadow, countrySources),
    newZealandRecord(shadow, countrySources),
    panamaRecord(shadow, countrySources),
    paraguayRecord(shadow, countrySources),
    philippinesRecord(shadow, countrySources),
    polandRecord(shadow, countrySources),
    portugalRecord(shadow, countrySources),
    saintLuciaRecord(shadow, countrySources),
    saoTomePrincipeRecord(shadow, countrySources),
    stKittsNevisRecord(shadow, countrySources),
    serbiaRecord(shadow, countrySources),
    singaporeRecord(shadow, countrySources),
    southAfricaRecord(shadow, countrySources),
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

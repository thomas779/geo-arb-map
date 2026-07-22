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
  spain_residence_nationality: 'https://administracion.gob.es/pag_Home/Tu-espacio-europeo/derechos-obligaciones/ciudadanos/residencia/obtencion-nacionalidad.html',
  colombia_naturalization_guidance: 'https://www.cancilleria.gov.co/atencion-y-servicio-al-ciudadano/tramites-y-servicios/nacionalidad/naturalizacion',
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
  belize_economic_citizenship_abolition: 'https://www.nationalassembly.gov.bz/wp-content/uploads/2023/12/Act-No.-54-of-2023-economic-citizenship.pdf',
  belize_immigration_citizenship: 'https://immigration.gov.bz/citizenship/citizenship-do-i-qualify/',
  montenegro_eu_report_2023: 'https://enlargement.ec.europa.eu/montenegro-report-2023_en',
  comoros_economic_citizenship_state: 'https://www.state.gov/reports/2023-country-reports-on-human-rights-practices/comoros/',
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
  taiwan_nationality_act: 'https://law.moj.gov.tw/ENG/LawClass/LawAll.aspx?pcode=D0030001',
  taiwan_employment_gold_card: 'https://goldcard.nat.gov.tw/en/',
  taiwan_nia_permanent_residency: 'https://www.immigration.gov.tw/5475/5478/141465/141808/411648/cp_news',
  indonesia_citizenship_law: 'https://www.ecoi.net/en/file/local/1170232/1504_1217488313_law-of-the-republic-of-indonesia-no-12-on-citizenship-of-the-republic-of-indonesia.pdf',
  indonesia_imigrasi: 'https://www.imigrasi.go.id/',
  thailand_nationality_act: 'https://www.refworld.org/legal/legislation/natlegbod/2012/101733',
  thailand_boi: 'https://www.boi.go.th/index.php?page=eligibility',
  nigeria_constitution_citizenship: 'https://citizenshiprightsafrica.org/en/nigeria-constitution-1999-chapter-iii-on-citizenship/',
  nigeria_interior_requirements: 'https://candb.interior.gov.ng/wp-content/uploads/2025/05/CB-Citizenship-Requirements.pdf',
  nigeria_constitute: 'https://www.constituteproject.org/constitution/Nigeria_2011',
  peru_naturalization: 'https://www.gob.pe/12580',
  peru_marriage_nationality: 'https://www.gob.pe/12574-obtener-la-nacionalidad-peruana-por-matrimonio',
  peru_migraciones: 'https://www.migraciones.gob.pe/',
  bolivia_constitution: 'https://www.constituteproject.org/constitution/Bolivia_2009',
  ecuador_constitution: 'https://www.constituteproject.org/constitution/Ecuador_2021',
  costa_rica_constitution: 'https://www.constituteproject.org/constitution/Costa_Rica_2020',
  el_salvador_constitution: 'https://www.constituteproject.org/constitution/El_Salvador_2014',
  guatemala_constitution: 'https://www.constituteproject.org/constitution/Guatemala_1993',
  guatemala_nationality_law: 'https://www.acnur.org/fileadmin/Documentos/BDL/2001/0135.pdf',
  honduras_constitution: 'https://www.constituteproject.org/constitution/Honduras_2013',
  nicaragua_constitution: 'https://www.constituteproject.org/constitution/Nicaragua_2014',
  dominican_republic_constitution: 'https://www.constituteproject.org/constitution/Dominican_Republic_2015',
  venezuela_constitution: 'https://www.constituteproject.org/constitution/Venezuela_2009',
  malaysia_constitution: 'https://www.constituteproject.org/constitution/Malaysia_2007',
  malaysia_residence_pass: 'https://www.imi.gov.my/index.php/en/main-services/pass/residence-pass/',
  vietnam_nationality_law: 'https://vietnamlawmagazine.vn/law-on-vietnamese-nationality-2008-4847.html',
  cambodia_constitution: 'https://www.constituteproject.org/constitution/Cambodia_2008',
  cambodia_nationality_law: 'https://cib-cdc.gov.kh/media/2025/04/1.-Law-on-Nationality-1996-EN.pdf',
  samoa_citizenship_investment_act: 'https://www.ag.gov.ws/wp-content/uploads/2024/02/Citizenship-Investment-Act-2015.pdf',
  samoa_mcil_workshop: 'https://mcil.gov.ws/node/89',
  kenya_immigration_citizenship: 'https://immigration.go.ke/citizenship-section/',
  kenya_constitution: 'https://www.constituteproject.org/constitution/Kenya_2010',
  ghana_naturalization: 'https://www.mint.gov.gh/e-services-portal/naturalization-as-ghanaian-citizen/',
  ghana_citizenship_act: 'https://citizenshiprightsafrica.org/wp-content/uploads/2016/02/Ghana_Citizenship_Act_with_forms_591_2000.pdf',
  morocco_constitution: 'https://www.constituteproject.org/constitution/Morocco_2011',
  india_constitution: 'https://www.constituteproject.org/constitution/India_2016',
  india_oci: 'https://www.mea.gov.in/overseas-citizenship-of-india-scheme',
  samoa_constitution: 'https://www.constituteproject.org/constitution/Samoa_2017',
  austria_citizenship: 'https://www.migration.gv.at/en/living-and-working-in-austria/integration-and-citizenship/citizenship/',
  austria_oesterreich: 'https://www.oesterreich.gv.at/en/themen/menschen_aus_anderen_staaten/staatsbuergerschaft',
  belgium_constitution: 'https://www.constituteproject.org/constitution/Belgium_2014',
  sweden_citizenship: 'https://www.migrationsverket.se/en/you-want-to-apply/swedish-citizenship/citizenship-for-adults/citizenship-for-adults.html',
  norway_citizenship: 'https://www.udi.no/en/want-to-apply/citizenship/',
  denmark_citizenship: 'https://uim.dk/arbejdsomraader/statsborgerskab/',
  czechia_citizenship: 'https://www.mvcr.cz/clanek/statni-obcanstvi.aspx',
  romania_immigration: 'https://igi.mai.gov.ro/en/',
  romania_constitution: 'https://www.constituteproject.org/constitution/Romania_2003',
  andorra_government: 'https://www.govern.ad/en',
  andorra_constitution: 'https://www.constituteproject.org/constitution/Andorra_1993',
  finland_citizenship: 'https://migri.fi/en/finnish-citizenship',
  finland_period_of_residence: 'https://migri.fi/en/period-of-residence',
  estonia_citizenship_act: 'https://www.riigiteataja.ee/en/eli/523012024006/consolide',
  latvia_naturalisation: 'https://www.pmlp.gov.lv/en/naturalisation',
  lithuania_migracija: 'https://www.migracija.lt/home?lang=en',
  lithuania_constitution: 'https://www.constituteproject.org/constitution/Lithuania_2019',
  croatia_citizenship: 'https://gov.hr/en/acquiring-croatian-citizenship/460',
  slovakia_naturalization: 'https://mic.iom.sk/en/citizenship/conditions-for-granting-slovak-citizenship-naturalization.html',
  slovakia_constitution: 'https://www.constituteproject.org/constitution/Slovakia_2017',
  luxembourg_naturalisation: 'https://guichet.public.lu/en/citoyens/citoyennete/nationalite-luxembourgeoise/acquisition-recouvrement/naturalisation.html',
  monaco_nationality: 'https://monservicepublic.gouv.mc/en/themes/nationality-and-residency/monegasque-nationality/acquisition-and-loss-of-nationality/acquiring-monegasque-nationality',
  liechtenstein_naturalization: 'https://www.llv.li/en/individuals/migration-and-integration/naturalization',
  iceland_citizenship_when: 'https://island.is/en/electronic-application-for-icelandic-citizenship/when-can-I-apply',
  iceland_government_citizenship: 'https://www.government.is/topics/foreign-nationals/citizenship/',
  fiji_citizenship_registration: 'https://www.immigration.gov.fj/by-registration/',
  fiji_foreign_affairs_citizenship: 'https://www.foreignaffairs.gov.fj/fiji-high-commission-new-zealand/fiji-citizenship/',
  png_citizenship_eligibility: 'https://ica.gov.pg/citizenship/eligibility-for-png-citizenship',
  png_dual_citizenship: 'https://ica.gov.pg/citizenship/citizenship-and-dual-citizenship',
  solomon_citizenship: 'https://solomons.gov.sb/ministry-of-home-affairs/essential-services/obtain-solomon-islands-citizenship/',
  tonga_constitution: 'https://www.constituteproject.org/constitution/Tonga_2013',
  timor_leste_citizenship_law: 'https://www.migracao.gov.tl/pdf/[0503-07]citizenship%20Law.pdf',
  timor_leste_constitution: 'https://www.constituteproject.org/constitution/East_Timor_2002',
  brunei_nationality_act: 'https://www.agc.gov.bn/AGC%20Images/LAWS/ACT_PDF/cap015.pdf',
  china_nationality_law: 'https://www.immd.gov.hk/eng/residents/immigration/chinese/law.html',
  kiribati_constitution: 'https://www.constituteproject.org/constitution/Kiribati_2013',
  tuvalu_citizenship_act: 'https://tuvalu-legislation.tv/cms/images/LEGISLATION/PRINCIPAL/1979/1979-0005/1979-0005_1.pdf',
  marshall_islands_citizenship_act: 'https://www.refworld.org/legal/legislation/natlegbod/1984/123580',
  palau_constitution: 'https://www.constituteproject.org/constitution/Palau_2008',
  fsm_citizenship_code: 'https://fsmlaw.org/fsm/code/title07/T07_Ch02.htm',
  rwanda_citizenship: 'https://www.migration.gov.rw/our-services/citizenshipss',
  senegal_constitution: 'https://www.constituteproject.org/constitution/Senegal_2016',
  albania_constitution: 'https://www.constituteproject.org/constitution/Albania_2016',
  bosnia_herzegovina_constitution: 'https://www.constituteproject.org/constitution/Bosnia_Herzegovina_2009',
  north_macedonia_constitution: 'https://www.constituteproject.org/constitution/Macedonia_2011',
  moldova_constitution: 'https://www.constituteproject.org/constitution/Moldova_2016',
  montenegro_constitution: 'https://www.constituteproject.org/constitution/Montenegro_2013',
  ukraine_constitution: 'https://www.constituteproject.org/constitution/Ukraine_2019',
  belize_constitution: 'https://www.constituteproject.org/constitution/Belize_2011',
  guyana_constitution: 'https://www.constituteproject.org/constitution/Guyana_2016',
  haiti_constitution: 'https://www.constituteproject.org/constitution/Haiti_2012',
  jamaica_constitution: 'https://www.constituteproject.org/constitution/Jamaica_2015',
  saint_vincent_constitution: 'https://www.constituteproject.org/constitution/Saint_Vincent_and_the_Grenadines_2009',
  suriname_constitution: 'https://www.constituteproject.org/constitution/Suriname_1992',
  trinidad_and_tobago_constitution: 'https://www.constituteproject.org/constitution/Trinidad_and_Tobago_2007',
  cuba_constitution: 'https://www.constituteproject.org/constitution/Cuba_2019',
  equatorial_guinea_constitution: 'https://www.constituteproject.org/constitution/Equatorial_Guinea_2012',
  slovenia_constitution: 'https://www.constituteproject.org/constitution/Slovenia_2016',
  burundi_constitution: 'https://www.constituteproject.org/constitution/Burundi_2018',
  central_african_republic_constitution: 'https://www.constituteproject.org/constitution/Central_African_Republic_2016',
  chad_constitution: 'https://www.constituteproject.org/constitution/Chad_2018',
  comoros_constitution: 'https://www.constituteproject.org/constitution/Comoros_2018',
  djibouti_constitution: 'https://www.constituteproject.org/constitution/Djibouti_2010',
  eritrea_constitution: 'https://www.constituteproject.org/constitution/Eritrea_1997',
  guinea_constitution: 'https://www.constituteproject.org/constitution/Guinea_2020',
  guinea_bissau_constitution: 'https://www.constituteproject.org/constitution/Guinea_Bissau_1996',
  mauritania_constitution: 'https://www.constituteproject.org/constitution/Mauritania_2012',
  south_sudan_constitution: 'https://www.constituteproject.org/constitution/South_Sudan_2011',
  somalia_constitution: 'https://www.constituteproject.org/constitution/Somalia_2012',
  benin_constitution: 'https://www.constituteproject.org/constitution/Benin_1990',
  burkina_faso_constitution: 'https://www.constituteproject.org/constitution/Burkina_Faso_2012',
  congo_constitution: 'https://www.constituteproject.org/constitution/Congo_2015',
  drc_constitution: 'https://www.constituteproject.org/constitution/Democratic_Republic_of_the_Congo_2011',
  eswatini_constitution: 'https://www.constituteproject.org/constitution/Swaziland_2005',
  gabon_constitution: 'https://www.constituteproject.org/constitution/Gabon_2011',
  gambia_constitution: 'https://www.constituteproject.org/constitution/Gambia_2019',
  lesotho_constitution: 'https://www.constituteproject.org/constitution/Lesotho_2018',
  liberia_constitution: 'https://www.constituteproject.org/constitution/Liberia_1986',
  libya_constitution: 'https://www.constituteproject.org/constitution/Libya_2011',
  madagascar_constitution: 'https://www.constituteproject.org/constitution/Madagascar_2010',
  malawi_constitution: 'https://www.constituteproject.org/constitution/Malawi_2017',
  mali_constitution: 'https://www.constituteproject.org/constitution/Mali_1992',
  niger_constitution: 'https://www.constituteproject.org/constitution/Niger_2010',
  sierra_leone_constitution: 'https://www.constituteproject.org/constitution/Sierra_Leone_2013',
  sudan_constitution: 'https://www.constituteproject.org/constitution/Sudan_2019',
  togo_constitution: 'https://www.constituteproject.org/constitution/Togo_2007',
  botswana_citizenship_act: 'https://citizenshiprightsafrica.org/wp-content/uploads/2016/01/Botswana_Citizenship_Act_Cap0101_2004.pdf',
  namibia_constitution: 'https://www.constituteproject.org/constitution/Namibia_2014',
  ethiopia_nationality_proclamation: 'https://www.refworld.org/docid/409100414.html',
  tanzania_naturalization: 'https://www.immigration.go.tz/index.php/3-0-citizenship-by-naturalization',
  uganda_naturalization: 'https://www.immigration.go.ug/node/235',
  algeria_nationality_code: 'https://data.globalcit.eu/NationalDB/docs/Algeria_Loi_No.70-86_ENGLISH.pdf',
  tunisia_constitution: 'https://www.constituteproject.org/constitution/Tunisia_2022',
  cote_divoire_constitution: 'https://www.constituteproject.org/constitution/Cote_dIvoire_2016',
  zambia_citizenship_act: 'https://zambialii.org/akn/zm/act/2016/33/eng@2016-06-07',
  zimbabwe_constitution: 'https://www.constituteproject.org/constitution/Zimbabwe_2013',
  angola_constitution: 'https://www.constituteproject.org/constitution/Angola_2010',
  cabo_verde_citizenship: 'https://www.embcv-usa.gov.cv/images/doc/CAPEVERDEAN_CITIZENSHIP.pdf',
  seychelles_citizenship_faq: 'https://www.ics.gov.sc/faq/immigration-services/permanent-resident-citizenship',
  cameroon_who_is_cameroonian: 'https://minjustice.cm/ova_sev/who-is-a-cameroonian/',
  mozambique_constitution: 'https://www.constituteproject.org/constitution/Mozambique_2007',
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
      title: 'Spain General Administration — acquisition of nationality by residence',
      url: OFFICIAL_URLS.spain_residence_nationality,
      source_type: 'official_guidance',
      jurisdictions: ['724'],
      language: 'es',
      monitoring: {
        source_id: 'spain-residence-nationality',
        method: 'http',
        url: OFFICIAL_URLS.spain_residence_nationality,
        status: 'active',
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
      ['Belize Economic Citizenship (Abolition of Rights) Act 2023', OFFICIAL_URLS.belize_economic_citizenship_abolition, '084', 'en', 'primary_law', 'belize-citizenship-law'],
      ['Belize Immigration — Citizenship eligibility', OFFICIAL_URLS.belize_immigration_citizenship, '084', 'en', 'official_guidance', 'belize-citizenship-law'],
      ['European Commission — Montenegro Report 2023 (ECP discontinued)', OFFICIAL_URLS.montenegro_eu_report_2023, '499', 'en', 'official_guidance', 'montenegro-citizenship-law'],
      ['US State Department — Comoros 2023 Human Rights Report', OFFICIAL_URLS.comoros_economic_citizenship_state, '174', 'en', 'official_guidance', 'comoros-citizenship-law'],
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
      ['Colombia Cancilleria — naturalization requirements', OFFICIAL_URLS.colombia_naturalization_guidance, '170', 'es', 'official_guidance', 'colombia-nationality-law'],
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
      ['Taiwan (R.O.C.) Nationality Act — Laws & Regulations Database', OFFICIAL_URLS.taiwan_nationality_act, '158', 'en', 'primary_law', 'taiwan-nationality-law'],
      ['Taiwan Employment Gold Card — official portal', OFFICIAL_URLS.taiwan_employment_gold_card, '158', 'en', 'official_guidance', 'taiwan-employment-gold-card'],
      ['Taiwan NIA — Guidelines for permanent residency (APRC)', OFFICIAL_URLS.taiwan_nia_permanent_residency, '158', 'en', 'official_guidance', 'taiwan-employment-gold-card'],
      ['Indonesia Law No. 12 of 2006 on Citizenship (English text)', OFFICIAL_URLS.indonesia_citizenship_law, '360', 'en', 'primary_law', 'indonesia-citizenship-law'],
      ['Direktorat Jenderal Imigrasi — official portal', OFFICIAL_URLS.indonesia_imigrasi, '360', 'id', 'official_guidance', 'indonesia-citizenship-law'],
      ['Thailand Nationality Act B.E. 2508 (amended; UNHCR English text)', OFFICIAL_URLS.thailand_nationality_act, '764', 'en', 'primary_law', 'thailand-nationality-law'],
      ['Thailand Board of Investment — eligibility (residence, not citizenship)', OFFICIAL_URLS.thailand_boi, '764', 'en', 'official_guidance', 'thailand-nationality-law'],
      ['Nigeria Constitution 1999 — Chapter III Citizenship (published text)', OFFICIAL_URLS.nigeria_constitution_citizenship, '566', 'en', 'primary_law', 'nigeria-citizenship-law'],
      ['Nigeria Ministry of Interior — Citizenship requirements PDF', OFFICIAL_URLS.nigeria_interior_requirements, '566', 'en', 'official_guidance', 'nigeria-citizenship-law'],
      ['Constitute Project — Constitution of Nigeria 1999 (as amended)', OFFICIAL_URLS.nigeria_constitute, '566', 'en', 'primary_law', 'nigeria-citizenship-law'],
      ['Peru Migraciones — naturalization procedure', OFFICIAL_URLS.peru_naturalization, '604', 'es', 'official_guidance', 'peru-citizenship-law'],
      ['Peru Migraciones — nationality by marriage', OFFICIAL_URLS.peru_marriage_nationality, '604', 'es', 'official_guidance', 'peru-citizenship-law'],
      ['Peru Superintendencia Nacional de Migraciones', OFFICIAL_URLS.peru_migraciones, '604', 'es', 'official_guidance', 'peru-citizenship-law'],
      ['Bolivia 2009 Constitution (Constitute Project)', OFFICIAL_URLS.bolivia_constitution, '068', 'en', 'primary_law', 'bolivia-citizenship-law'],
      ['Ecuador 2021 Constitution (Constitute Project)', OFFICIAL_URLS.ecuador_constitution, '218', 'en', 'primary_law', 'ecuador-citizenship-law'],
      ['Costa Rica Constitution — nationality (Constitute Project)', OFFICIAL_URLS.costa_rica_constitution, '188', 'en', 'primary_law', 'costa-rica-citizenship-law'],
      ['El Salvador Constitution — nationality (Constitute Project)', OFFICIAL_URLS.el_salvador_constitution, '222', 'en', 'primary_law', 'el-salvador-citizenship-law'],
      ['Guatemala Constitution — nationality (Constitute Project)', OFFICIAL_URLS.guatemala_constitution, '320', 'en', 'primary_law', 'guatemala-citizenship-law'],
      ['Guatemala Nationality Law Decree 1613 (ACNUR text)', OFFICIAL_URLS.guatemala_nationality_law, '320', 'es', 'primary_law', 'guatemala-citizenship-law'],
      ['Honduras Constitution — nationality (Constitute Project)', OFFICIAL_URLS.honduras_constitution, '340', 'en', 'primary_law', 'honduras-citizenship-law'],
      ['Nicaragua Constitution — nationality (Constitute Project)', OFFICIAL_URLS.nicaragua_constitution, '558', 'en', 'primary_law', 'nicaragua-citizenship-law'],
      ['Dominican Republic Constitution — nationality (Constitute Project)', OFFICIAL_URLS.dominican_republic_constitution, '214', 'en', 'primary_law', 'dominican-republic-citizenship-law'],
      ['Venezuela Constitution — nationality (Constitute Project)', OFFICIAL_URLS.venezuela_constitution, '862', 'en', 'primary_law', 'venezuela-citizenship-law'],
      ['Malaysia Federal Constitution (Constitute Project)', OFFICIAL_URLS.malaysia_constitution, '458', 'en', 'primary_law', 'malaysia-citizenship-law'],
      ['Malaysia Immigration — Residence Pass', OFFICIAL_URLS.malaysia_residence_pass, '458', 'en', 'official_guidance', 'malaysia-citizenship-law'],
      ['Vietnam Law on Vietnamese Nationality 2008 (English)', OFFICIAL_URLS.vietnam_nationality_law, '704', 'en', 'primary_law', 'vietnam-citizenship-law'],
      ['Cambodia Constitution (Constitute Project)', OFFICIAL_URLS.cambodia_constitution, '116', 'en', 'primary_law', 'cambodia-citizenship-law'],
      ['Cambodia Law on Nationality 1996 (CIB English text)', OFFICIAL_URLS.cambodia_nationality_law, '116', 'en', 'primary_law', 'cambodia-citizenship-law'],
      ['Kenya Immigration — Citizenship section', OFFICIAL_URLS.kenya_immigration_citizenship, '404', 'en', 'official_guidance', 'kenya-citizenship-law'],
      ['Kenya 2010 Constitution (Constitute Project)', OFFICIAL_URLS.kenya_constitution, '404', 'en', 'primary_law', 'kenya-citizenship-law'],
      ['Ghana Ministry of Interior — naturalization', OFFICIAL_URLS.ghana_naturalization, '288', 'en', 'official_guidance', 'ghana-citizenship-law'],
      ['Ghana Citizenship Act 2000 (Act 591)', OFFICIAL_URLS.ghana_citizenship_act, '288', 'en', 'primary_law', 'ghana-citizenship-law'],
      ['Morocco 2011 Constitution (Constitute Project)', OFFICIAL_URLS.morocco_constitution, '504', 'en', 'primary_law', 'morocco-citizenship-law'],
      ['India Constitution (Constitute Project)', OFFICIAL_URLS.india_constitution, '356', 'en', 'primary_law', 'india-citizenship-law'],
      ['India MEA — Overseas Citizenship of India Scheme', OFFICIAL_URLS.india_oci, '356', 'en', 'official_guidance', 'india-citizenship-law'],
      ['Samoa Constitution (Constitute Project)', OFFICIAL_URLS.samoa_constitution, '882', 'en', 'primary_law', 'samoa-citizenship-law'],
      ['Samoa Citizenship Investment Act 2015', OFFICIAL_URLS.samoa_citizenship_investment_act, '882', 'en', 'primary_law', 'samoa-citizenship-law'],
      ['Samoa MCIL - 2025 policy framework workshop', OFFICIAL_URLS.samoa_mcil_workshop, '882', 'en', 'official_guidance', 'samoa-citizenship-law'],
      ['Austria migration.gv.at - citizenship', OFFICIAL_URLS.austria_citizenship, '040', 'en', 'official_guidance', 'austria-citizenship-law'],
      ['Austria oesterreich.gv.at - citizenship', OFFICIAL_URLS.austria_oesterreich, '040', 'en', 'official_guidance', 'austria-citizenship-law'],
      ['Belgium Constitution (Constitute Project)', OFFICIAL_URLS.belgium_constitution, '056', 'en', 'primary_law', 'belgium-citizenship-law'],
      ['Swedish Migration Agency - citizenship for adults', OFFICIAL_URLS.sweden_citizenship, '752', 'en', 'official_guidance', 'sweden-citizenship-law'],
      ['Norway UDI - citizenship', OFFICIAL_URLS.norway_citizenship, '578', 'en', 'official_guidance', 'norway-citizenship-law'],
      ['Denmark UIM - citizenship', OFFICIAL_URLS.denmark_citizenship, '208', 'en', 'official_guidance', 'denmark-citizenship-law'],
      ['Czech Ministry of Interior - citizenship', OFFICIAL_URLS.czechia_citizenship, '203', 'cs', 'official_guidance', 'czechia-citizenship-law'],
      ['Romania General Inspectorate for Immigration', OFFICIAL_URLS.romania_immigration, '642', 'en', 'official_guidance', 'romania-citizenship-law'],
      ['Romania Constitution (Constitute Project)', OFFICIAL_URLS.romania_constitution, '642', 'en', 'primary_law', 'romania-citizenship-law'],
      ['Government of Andorra', OFFICIAL_URLS.andorra_government, '020', 'en', 'official_guidance', 'andorra-citizenship-law'],
      ['Andorra Constitution (Constitute Project)', OFFICIAL_URLS.andorra_constitution, '020', 'en', 'primary_law', 'andorra-citizenship-law'],
      ['Finnish Immigration Service - Finnish citizenship', OFFICIAL_URLS.finland_citizenship, '246', 'en', 'official_guidance', 'finland-citizenship-law'],
      ['Finnish Immigration Service - period of residence', OFFICIAL_URLS.finland_period_of_residence, '246', 'en', 'official_guidance', 'finland-citizenship-law'],
      ['Estonia Citizenship Act (Riigi Teataja)', OFFICIAL_URLS.estonia_citizenship_act, '233', 'en', 'primary_law', 'estonia-citizenship-law'],
      ['Latvia OCMA/PMLP - naturalisation', OFFICIAL_URLS.latvia_naturalisation, '428', 'en', 'official_guidance', 'latvia-citizenship-law'],
      ['Lithuania Migration Department', OFFICIAL_URLS.lithuania_migracija, '440', 'en', 'official_guidance', 'lithuania-citizenship-law'],
      ['Lithuania Constitution (Constitute Project)', OFFICIAL_URLS.lithuania_constitution, '440', 'en', 'primary_law', 'lithuania-citizenship-law'],
      ['Croatia gov.hr - acquiring Croatian citizenship', OFFICIAL_URLS.croatia_citizenship, '191', 'en', 'official_guidance', 'croatia-citizenship-law'],
      ['Slovakia IOM MIC - naturalization conditions', OFFICIAL_URLS.slovakia_naturalization, '703', 'en', 'official_guidance', 'slovakia-citizenship-law'],
      ['Slovakia Constitution (Constitute Project)', OFFICIAL_URLS.slovakia_constitution, '703', 'en', 'primary_law', 'slovakia-citizenship-law'],
      ['Luxembourg Guichet - naturalisation', OFFICIAL_URLS.luxembourg_naturalisation, '442', 'en', 'official_guidance', 'luxembourg-citizenship-law'],
      ['Monaco mon service public - acquiring nationality', OFFICIAL_URLS.monaco_nationality, '492', 'en', 'official_guidance', 'monaco-citizenship-law'],
      ['Liechtenstein National Administration - naturalization', OFFICIAL_URLS.liechtenstein_naturalization, '438', 'en', 'official_guidance', 'liechtenstein-citizenship-law'],
      ['Island.is - Icelandic citizenship residence length', OFFICIAL_URLS.iceland_citizenship_when, '352', 'en', 'official_guidance', 'iceland-citizenship-law'],
      ['Government of Iceland - citizenship', OFFICIAL_URLS.iceland_government_citizenship, '352', 'en', 'official_guidance', 'iceland-citizenship-law'],
      ['Fiji Ministry of Immigration - citizenship by registration and naturalization', OFFICIAL_URLS.fiji_citizenship_registration, '242', 'en', 'official_guidance', 'fiji-citizenship-law'],
      ['Fiji Ministry of Foreign Affairs - Fiji citizenship', OFFICIAL_URLS.fiji_foreign_affairs_citizenship, '242', 'en', 'official_guidance', 'fiji-citizenship-law'],
      ['PNG ICA - eligibility for citizenship', OFFICIAL_URLS.png_citizenship_eligibility, '598', 'en', 'official_guidance', 'png-citizenship-law'],
      ['PNG ICA - citizenship and dual citizenship', OFFICIAL_URLS.png_dual_citizenship, '598', 'en', 'official_guidance', 'png-citizenship-law'],
      ['Solomon Islands government - obtain citizenship', OFFICIAL_URLS.solomon_citizenship, '090', 'en', 'official_guidance', 'solomon-islands-citizenship-law'],
      ['Tonga Constitution (Constitute Project)', OFFICIAL_URLS.tonga_constitution, '776', 'en', 'primary_law', 'tonga-citizenship-law'],
      ['Timor-Leste Citizenship Law (Migration Service PDF)', OFFICIAL_URLS.timor_leste_citizenship_law, '626', 'en', 'primary_law', 'timor-leste-citizenship-law'],
      ['Timor-Leste Constitution (Constitute Project)', OFFICIAL_URLS.timor_leste_constitution, '626', 'en', 'primary_law', 'timor-leste-citizenship-law'],
      ['Brunei Nationality Act (AGC)', OFFICIAL_URLS.brunei_nationality_act, '096', 'en', 'primary_law', 'brunei-citizenship-law'],
      ['PRC Nationality Law (IMMD published text)', OFFICIAL_URLS.china_nationality_law, '156', 'en', 'primary_law', 'china-citizenship-law'],
      ['Kiribati Constitution (Constitute Project)', OFFICIAL_URLS.kiribati_constitution, '296', 'en', 'primary_law', 'kiribati-citizenship-law'],
      ['Tuvalu Citizenship Act 1979 (official legislation PDF)', OFFICIAL_URLS.tuvalu_citizenship_act, '798', 'en', 'primary_law', 'tuvalu-citizenship-law'],
      ['Marshall Islands Citizenship Act 1984 (Refworld)', OFFICIAL_URLS.marshall_islands_citizenship_act, '584', 'en', 'primary_law', 'marshall-islands-citizenship-law'],
      ['Palau Constitution (Constitute Project)', OFFICIAL_URLS.palau_constitution, '585', 'en', 'primary_law', 'palau-citizenship-law'],
      ['FSM Code Title 7 Chapter 2 Citizenship', OFFICIAL_URLS.fsm_citizenship_code, '583', 'en', 'primary_law', 'fsm-citizenship-law'],
      ['Rwanda DGIE - citizenship services', OFFICIAL_URLS.rwanda_citizenship, '646', 'en', 'official_guidance', 'rwanda-citizenship-law'],
      ['Senegal Constitution (Constitute Project)', OFFICIAL_URLS.senegal_constitution, '686', 'en', 'primary_law', 'senegal-citizenship-law'],
      ['Albania Constitution (Constitute Project)', OFFICIAL_URLS.albania_constitution, '008', 'en', 'primary_law', 'albania-citizenship-law'],
      ['Bosnia and Herzegovina Constitution (Constitute Project)', OFFICIAL_URLS.bosnia_herzegovina_constitution, '070', 'en', 'primary_law', 'bosnia-herzegovina-citizenship-law'],
      ['North Macedonia Constitution (Constitute Project)', OFFICIAL_URLS.north_macedonia_constitution, '807', 'en', 'primary_law', 'north-macedonia-citizenship-law'],
      ['Moldova Constitution (Constitute Project)', OFFICIAL_URLS.moldova_constitution, '498', 'en', 'primary_law', 'moldova-citizenship-law'],
      ['Montenegro Constitution (Constitute Project)', OFFICIAL_URLS.montenegro_constitution, '499', 'en', 'primary_law', 'montenegro-citizenship-law'],
      ['Ukraine Constitution (Constitute Project)', OFFICIAL_URLS.ukraine_constitution, '804', 'en', 'primary_law', 'ukraine-citizenship-law'],
      ['Belize Constitution (Constitute Project)', OFFICIAL_URLS.belize_constitution, '084', 'en', 'primary_law', 'belize-citizenship-law'],
      ['Guyana Constitution (Constitute Project)', OFFICIAL_URLS.guyana_constitution, '328', 'en', 'primary_law', 'guyana-citizenship-law'],
      ['Haiti Constitution (Constitute Project)', OFFICIAL_URLS.haiti_constitution, '332', 'en', 'primary_law', 'haiti-citizenship-law'],
      ['Jamaica Constitution (Constitute Project)', OFFICIAL_URLS.jamaica_constitution, '388', 'en', 'primary_law', 'jamaica-citizenship-law'],
      ['Saint Vincent and the Grenadines Constitution (Constitute Project)', OFFICIAL_URLS.saint_vincent_constitution, '670', 'en', 'primary_law', 'saint-vincent-citizenship-law'],
      ['Suriname Constitution (Constitute Project)', OFFICIAL_URLS.suriname_constitution, '740', 'en', 'primary_law', 'suriname-citizenship-law'],
      ['Trinidad and Tobago Constitution (Constitute Project)', OFFICIAL_URLS.trinidad_and_tobago_constitution, '780', 'en', 'primary_law', 'trinidad-and-tobago-citizenship-law'],
      ['Cuba Constitution (Constitute Project)', OFFICIAL_URLS.cuba_constitution, '192', 'en', 'primary_law', 'cuba-citizenship-law'],
      ['Equatorial Guinea Constitution (Constitute Project)', OFFICIAL_URLS.equatorial_guinea_constitution, '226', 'en', 'primary_law', 'equatorial-guinea-citizenship-law'],
      ['Slovenia Constitution (Constitute Project)', OFFICIAL_URLS.slovenia_constitution, '705', 'en', 'primary_law', 'slovenia-citizenship-law'],
      ['Burundi Constitution (Constitute Project)', OFFICIAL_URLS.burundi_constitution, '108', 'en', 'primary_law', 'burundi-citizenship-law'],
      ['Central African Republic Constitution (Constitute Project)', OFFICIAL_URLS.central_african_republic_constitution, '140', 'en', 'primary_law', 'central-african-republic-citizenship-law'],
      ['Chad Constitution (Constitute Project)', OFFICIAL_URLS.chad_constitution, '148', 'en', 'primary_law', 'chad-citizenship-law'],
      ['Comoros Constitution (Constitute Project)', OFFICIAL_URLS.comoros_constitution, '174', 'en', 'primary_law', 'comoros-citizenship-law'],
      ['Djibouti Constitution (Constitute Project)', OFFICIAL_URLS.djibouti_constitution, '262', 'en', 'primary_law', 'djibouti-citizenship-law'],
      ['Eritrea Constitution (Constitute Project)', OFFICIAL_URLS.eritrea_constitution, '232', 'en', 'primary_law', 'eritrea-citizenship-law'],
      ['Guinea Constitution (Constitute Project)', OFFICIAL_URLS.guinea_constitution, '324', 'en', 'primary_law', 'guinea-citizenship-law'],
      ['Guinea-Bissau Constitution (Constitute Project)', OFFICIAL_URLS.guinea_bissau_constitution, '624', 'en', 'primary_law', 'guinea-bissau-citizenship-law'],
      ['Mauritania Constitution (Constitute Project)', OFFICIAL_URLS.mauritania_constitution, '478', 'en', 'primary_law', 'mauritania-citizenship-law'],
      ['South Sudan Constitution (Constitute Project)', OFFICIAL_URLS.south_sudan_constitution, '728', 'en', 'primary_law', 'south-sudan-citizenship-law'],
      ['Somalia Constitution (Constitute Project)', OFFICIAL_URLS.somalia_constitution, '706', 'en', 'primary_law', 'somalia-citizenship-law'],
      ['Benin Constitution (Constitute Project)', OFFICIAL_URLS.benin_constitution, '204', 'en', 'primary_law', 'benin-citizenship-law'],
      ['Burkina Faso Constitution (Constitute Project)', OFFICIAL_URLS.burkina_faso_constitution, '854', 'en', 'primary_law', 'burkina-faso-citizenship-law'],
      ['Republic of the Congo Constitution (Constitute Project)', OFFICIAL_URLS.congo_constitution, '178', 'en', 'primary_law', 'congo-citizenship-law'],
      ['Democratic Republic of the Congo Constitution (Constitute Project)', OFFICIAL_URLS.drc_constitution, '180', 'en', 'primary_law', 'drc-citizenship-law'],
      ['Eswatini Constitution (Constitute Project)', OFFICIAL_URLS.eswatini_constitution, '748', 'en', 'primary_law', 'eswatini-citizenship-law'],
      ['Gabon Constitution (Constitute Project)', OFFICIAL_URLS.gabon_constitution, '266', 'en', 'primary_law', 'gabon-citizenship-law'],
      ['The Gambia Constitution (Constitute Project)', OFFICIAL_URLS.gambia_constitution, '270', 'en', 'primary_law', 'gambia-citizenship-law'],
      ['Lesotho Constitution (Constitute Project)', OFFICIAL_URLS.lesotho_constitution, '426', 'en', 'primary_law', 'lesotho-citizenship-law'],
      ['Liberia Constitution (Constitute Project)', OFFICIAL_URLS.liberia_constitution, '430', 'en', 'primary_law', 'liberia-citizenship-law'],
      ['Libya Constitution (Constitute Project)', OFFICIAL_URLS.libya_constitution, '434', 'en', 'primary_law', 'libya-citizenship-law'],
      ['Madagascar Constitution (Constitute Project)', OFFICIAL_URLS.madagascar_constitution, '450', 'en', 'primary_law', 'madagascar-citizenship-law'],
      ['Malawi Constitution (Constitute Project)', OFFICIAL_URLS.malawi_constitution, '454', 'en', 'primary_law', 'malawi-citizenship-law'],
      ['Mali Constitution (Constitute Project)', OFFICIAL_URLS.mali_constitution, '466', 'en', 'primary_law', 'mali-citizenship-law'],
      ['Niger Constitution (Constitute Project)', OFFICIAL_URLS.niger_constitution, '562', 'en', 'primary_law', 'niger-citizenship-law'],
      ['Sierra Leone Constitution (Constitute Project)', OFFICIAL_URLS.sierra_leone_constitution, '694', 'en', 'primary_law', 'sierra-leone-citizenship-law'],
      ['Sudan Constitution (Constitute Project)', OFFICIAL_URLS.sudan_constitution, '729', 'en', 'primary_law', 'sudan-citizenship-law'],
      ['Togo Constitution (Constitute Project)', OFFICIAL_URLS.togo_constitution, '768', 'en', 'primary_law', 'togo-citizenship-law'],
      ['Botswana Citizenship Act Cap 01:01', OFFICIAL_URLS.botswana_citizenship_act, '072', 'en', 'primary_law', 'botswana-citizenship-law'],
      ['Namibia Constitution (Constitute Project)', OFFICIAL_URLS.namibia_constitution, '516', 'en', 'primary_law', 'namibia-citizenship-law'],
      ['Ethiopia Proclamation on Ethiopian Nationality 378/2003', OFFICIAL_URLS.ethiopia_nationality_proclamation, '231', 'en', 'primary_law', 'ethiopia-citizenship-law'],
      ['Tanzania Immigration - citizenship by naturalization', OFFICIAL_URLS.tanzania_naturalization, '834', 'en', 'official_guidance', 'tanzania-citizenship-law'],
      ['Uganda Immigration - naturalization', OFFICIAL_URLS.uganda_naturalization, '800', 'en', 'official_guidance', 'uganda-citizenship-law'],
      ['Algeria Nationality Code (English text)', OFFICIAL_URLS.algeria_nationality_code, '012', 'en', 'primary_law', 'algeria-citizenship-law'],
      ['Tunisia Constitution (Constitute Project)', OFFICIAL_URLS.tunisia_constitution, '788', 'en', 'primary_law', 'tunisia-citizenship-law'],
      ['Cote d\'Ivoire Constitution (Constitute Project)', OFFICIAL_URLS.cote_divoire_constitution, '384', 'en', 'primary_law', 'cote-divoire-citizenship-law'],
      ['Zambia Citizenship of Zambia Act 2016', OFFICIAL_URLS.zambia_citizenship_act, '894', 'en', 'primary_law', 'zambia-citizenship-law'],
      ['Zimbabwe Constitution (Constitute Project)', OFFICIAL_URLS.zimbabwe_constitution, '716', 'en', 'primary_law', 'zimbabwe-citizenship-law'],
      ['Angola Constitution (Constitute Project)', OFFICIAL_URLS.angola_constitution, '024', 'en', 'primary_law', 'angola-citizenship-law'],
      ['Cape Verde Embassy USA - citizenship overview', OFFICIAL_URLS.cabo_verde_citizenship, '132', 'en', 'official_guidance', 'cabo-verde-citizenship-law'],
      ['Seychelles ICS - permanent resident and citizenship FAQ', OFFICIAL_URLS.seychelles_citizenship_faq, '690', 'en', 'official_guidance', 'seychelles-citizenship-law'],
      ['Cameroon Ministry of Justice - who is a Cameroonian', OFFICIAL_URLS.cameroon_who_is_cameroonian, '120', 'en', 'official_guidance', 'cameroon-citizenship-law'],
      ['Mozambique Constitution (Constitute Project)', OFFICIAL_URLS.mozambique_constitution, '508', 'en', 'primary_law', 'mozambique-citizenship-law'],

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
  const residenceGuide = requireSource(officialSources, OFFICIAL_URLS.spain_residence_nationality);
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:724',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'reviewed',
      confidence: 'high',
      last_checked: '2026-07-22',
      note: 'All acquisition modes reviewed. Civil Code Article 22 reduced residence periods (Ibero-American, Sephardic, family, birth-in-Spain) are modeled as explicit naturalization variants.',
    },
    coverage: [
      {
        mode: 'ancestry',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        source_refs: refs([civilCode], ['/coverage/ancestry']),
      },
      {
        mode: 'naturalization',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        source_refs: refs([civilCode, residenceGuide], ['/coverage/naturalization']),
      },
      {
        mode: 'birth',
        finding: 'present',
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        source_refs: refs([civilCode], ['/coverage/birth']),
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        review: {
          state: 'reviewed',
          confidence: 'high',
          last_checked: '2026-07-22',
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
        summary: 'Civil Code Article 22 sets stacked residence floors: ten years ordinary; five for recognized refugees; two for nationals of Ibero-American countries, Andorra, the Philippines, Equatorial Guinea, or Portugal, and for persons of Sephardic origin; and one year for several family and birth-in-Spain categories (including marriage to a Spaniard). Residence must be legal, continuous, and immediately before applying. Integration (DELE/CCSE where required) and good civic conduct apply. Dual nationality is generally retained for the two-year preferential nationalities. The grant remains discretionary. Processing time is separate and often long.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        variants: [
          {
            id: 'ordinary',
            label: 'Ordinary ten-year residence',
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
              note: 'Default Article 22 floor for nationalities without a preferential reduction. Eligibility period only; the grant is not automatic.',
            },
            source_refs: refs([civilCode, residenceGuide], [
              '/routes/spain-naturalization-by-residence/variants/ordinary/eligibility',
              '/routes/spain-naturalization-by-residence/variants/ordinary/timeline/eligibility_minimum_months',
              '/routes/spain-naturalization-by-residence/variants/ordinary/allocation',
            ]),
          },
          {
            id: 'recognized_refugee',
            label: 'Recognized refugee (five years)',
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
              note: 'Preferential Article 22 floor for a person recognized as a refugee.',
            },
            source_refs: refs([civilCode, residenceGuide], [
              '/routes/spain-naturalization-by-residence/variants/recognized_refugee/eligibility',
              '/routes/spain-naturalization-by-residence/variants/recognized_refugee/timeline/eligibility_minimum_months',
            ]),
          },
          {
            id: 'iberoamerican_two_years',
            label: 'Ibero-American, Andorra, Philippines, Equatorial Guinea, or Portugal (two years)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              {
                field: 'citizenship.iso_n3',
                operator: 'in',
                value: [...IBERO_AMERICAN_BENEFICIARIES],
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
              note: 'Article 22 two-year preferential floor. Same beneficiary set as the spain_iberoamerican bilateral lane. Dual nationality is generally retained for these nationalities. Processing backlogs remain separate.',
            },
            source_refs: refs([civilCode, residenceGuide], [
              '/routes/spain-naturalization-by-residence/variants/iberoamerican_two_years/eligibility',
              '/routes/spain-naturalization-by-residence/variants/iberoamerican_two_years/timeline/eligibility_minimum_months',
            ]),
          },
          {
            id: 'sephardic_two_years',
            label: 'Sephardic origin (two years)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'origin.sephardic', operator: 'eq', value: true },
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
              note: 'Article 22 also applies the two-year residence floor to persons of Sephardic origin. Distinct from the closed 2015 Sephardic carta-de-naturaleza programme.',
            },
            source_refs: refs([civilCode, residenceGuide], [
              '/routes/spain-naturalization-by-residence/variants/sephardic_two_years/eligibility',
              '/routes/spain-naturalization-by-residence/variants/sephardic_two_years/timeline/eligibility_minimum_months',
            ]),
          },
          {
            id: 'married_to_spanish_one_year',
            label: 'Married to a Spaniard (one year)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'spouse.citizenship.iso_n3', operator: 'eq', value: '724' },
              { field: 'marriage.not_separated', operator: 'eq', value: true },
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
              note: 'Article 22 one-year floor when married to a Spaniard for one year at application and not legally or de facto separated. Other one-year family categories (widowhood, guardianship, Spanish grandparents of origin) exist and are not fully enumerated here.',
            },
            source_refs: refs([civilCode, residenceGuide], [
              '/routes/spain-naturalization-by-residence/variants/married_to_spanish_one_year/eligibility',
              '/routes/spain-naturalization-by-residence/variants/married_to_spanish_one_year/timeline/eligibility_minimum_months',
            ]),
          },
          {
            id: 'born_in_spain',
            label: 'Born in Spain (one year)',
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
              note: 'One year of legal, continuous residence immediately before the application for a person born in Spain who is not already Spanish by origin. Good civic conduct and integration remain required; the grant is not automatic.',
            },
            source_refs: refs([civilCode, residenceGuide], [
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
  confidence = 'high',
  reviewState = 'reviewed',
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
  status?: 'active' | 'inactive' | 'pending_verification';
  lastChecked?: string;
  confidence?: 'high' | 'medium';
  reviewState?: 'reviewed' | 'pending';
}): JurisdictionRecord['routes'][number] {
  const variantId = `${id}-principal`;
  return {
    id,
    mode,
    status,
    title,
    summary,
    effective: { from: null, to: null, supersedes: [] },
    review: { state: reviewState, confidence, last_checked: lastChecked },
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
        confidence,
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
  const naturalizationGuide = requireSource(
    officialSources,
    OFFICIAL_URLS.colombia_naturalization_guidance,
  );
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
    note: 'All acquisition modes reviewed against Law 2332 of 2023 and Cancilleria naturalization guidance. Preferential two-year domicile reductions for family ties and Spanish nationals are modeled as explicit variants.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law] },
      { mode: 'naturalization', finding: 'present', sources: [law, naturalizationGuide, visaFaq, visaResolution, studentVisa] },
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
        summary: 'Law 2332 generally requires five years of continuous domicile as a Resident Visa holder counted from Resident Visa issuance. The domicile floor falls to two years for a Colombian spouse or permanent partner, a Colombian child, a Spanish national, or where reciprocal treatment by the origin state is verified. Naturalization remains discretionary.',
        effective: { from: '2023-09-25', to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
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
            timeline: { eligibility_minimum_months: 60, processing_typical_months: null, confidence: 'high', note: 'Default domicile floor. Naturalization remains a sovereign and discretionary decision.' },
            source_refs: refs([law, naturalizationGuide], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/ordinary_five_years/eligibility`,
              `/routes/${naturalizationId}/variants/ordinary_five_years/timeline`,
            ]),
          },
          {
            id: 'family_two_years',
            label: 'Two-year family route (Colombian spouse, partner, or child)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'visa.resident_holder', operator: 'eq', value: true },
              { field: 'domicile.continuous_months', operator: 'gte', value: 24, unit: 'months' },
              { field: 'family.colombian_spouse_partner_or_child', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'resident_visa_domicile', minimum_months: 24 }],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Preferential domicile reduction for marriage/permanent partnership with a Colombian or Colombian children.',
            },
            source_refs: refs([law, naturalizationGuide], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/family_two_years/eligibility`,
              `/routes/${naturalizationId}/variants/family_two_years/timeline`,
            ]),
          },
          {
            id: 'spanish_national_two_years',
            label: 'Two-year route for Spanish nationals',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'visa.resident_holder', operator: 'eq', value: true },
              { field: 'citizenship.iso_n3', operator: 'eq', value: '724' },
              { field: 'domicile.continuous_months', operator: 'gte', value: 24, unit: 'months' },
            ],
            milestones: [{ status: 'resident_visa_domicile', minimum_months: 24 }],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Cancilleria naturalization guidance expressly lists Spanish nationality as a two-year domicile reduction ground under Law 2332. This is the clearest Spain-into-Colombia naturalization fast lane in the dataset.',
            },
            source_refs: refs([law, naturalizationGuide], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/spanish_national_two_years/eligibility`,
              `/routes/${naturalizationId}/variants/spanish_national_two_years/timeline`,
            ]),
          },
          {
            id: 'reciprocal_origin_two_years',
            label: 'Two-year route for verified reciprocal treatment',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'visa.resident_holder', operator: 'eq', value: true },
              { field: 'domicile.continuous_months', operator: 'gte', value: 24, unit: 'months' },
              { field: 'origin.reciprocal_treatment_verified', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'resident_visa_domicile', minimum_months: 24 }],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'medium',
              note: 'Law 2332 also reduces domicile to two years when reciprocal treatment by the origin state is verified. Spanish nationals are listed separately by Cancilleria; other origin states require case-by-case verification and are not enumerated here.',
            },
            source_refs: refs([law, naturalizationGuide], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/reciprocal_origin_two_years/eligibility`,
              `/routes/${naturalizationId}/variants/reciprocal_origin_two_years/timeline`,
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
  const ordinaryId = 'panama-ordinary-naturalization';
  const reciprocityId = 'panama-spain-latin-american-reciprocity-naturalization';
  return reviewedCountryRecord({
    shadow,
    iso: '591',
    note: 'All acquisition modes reviewed against the current Constitution and National Migration Service requirements. Article 10 preferential tracks (family; Spain/Latin American birth nationals on reciprocity) are modeled as explicit routes. Investor and Friendly Nations residence remain separate from citizenship.',
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
      {
        id: ordinaryId,
        mode: 'naturalization',
        status: 'active',
        title: 'Ordinary naturalization',
        summary: 'Article 10(1): a permanent resident may apply after five consecutive years in Panama, with the constitutional declaration, renunciation of other nationality, Spanish language, and elementary civic knowledge.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        variants: [{
          id: `${ordinaryId}-principal`,
          label: 'Ordinary five-year naturalization',
          outcome: 'citizenship',
          allocation: 'discretionary',
          eligibility: [
            { field: 'residence.consecutive_months', operator: 'gte', value: 60, unit: 'months' },
            { field: 'residence.status', operator: 'eq', value: 'permanent_resident' },
            { field: 'integration.spanish_and_civics', operator: 'eq', value: true },
          ],
          milestones: [{ status: 'permanent_residence', minimum_months: 60 }],
          timeline: {
            eligibility_minimum_months: 60,
            processing_typical_months: null,
            confidence: 'high',
            note: 'Default Article 10(1) floor when no family or Spain/Latin American reciprocity track applies.',
          },
          source_refs: refs([constitution, requirements], [
            `/routes/${ordinaryId}/summary`,
            `/routes/${ordinaryId}/variants/${ordinaryId}-principal/eligibility`,
          ]),
        }],
      },
      principalCitizenshipRoute({
        id: 'panama-family-naturalization',
        mode: 'naturalization',
        title: 'Naturalization through a qualifying family connection',
        summary: 'Article 10(2) reduces the residence period to three consecutive years for an applicant with a child born in Panama to a Panamanian parent, or a Panamanian spouse, while retaining renunciation, Spanish, and civic-knowledge requirements.',
        source: [constitution, requirements],
        eligibility: [
          { field: 'residence.consecutive_months', operator: 'gte', value: 36, unit: 'months' },
          { field: 'family.qualifying_panamanian_connection', operator: 'eq', value: true },
        ],
        months: 36,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      {
        id: reciprocityId,
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization for Spanish or Latin American birth nationals (reciprocity)',
        summary: 'Article 10(3) lets nationals by birth of Spain or any Latin American state request naturalization if they meet the same requirements their origin state imposes on Panamanians. Spanish birth nationals are modeled at two years (Spain Article 22 Ibero floor). Several origin constitutions fix shorter floors for Spanish/Hispano-American or Latin American birth nationals and are modeled as named variants. Other origins still use case-by-case reciprocity. Renunciation, Spanish, and civic knowledge still apply.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        variants: [
          {
            id: 'spanish_birth_national_two_years',
            label: 'Spanish birth nationals (two years by reciprocity with Spain)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'citizenship.by_birth.iso_n3', operator: 'eq', value: '724' },
              { field: 'residence.consecutive_months', operator: 'gte', value: 24, unit: 'months' },
              { field: 'integration.spanish_and_civics', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'permanent_residence', minimum_months: 24 }],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Article 10(3) reciprocity: Spain grants Panamanians the two-year Ibero-American naturalization floor, so Spanish birth nationals are modeled at two years continuous residence in Panama.',
            },
            source_refs: refs([constitution, requirements], [
              `/routes/${reciprocityId}/summary`,
              `/routes/${reciprocityId}/variants/spanish_birth_national_two_years/eligibility`,
              `/routes/${reciprocityId}/variants/spanish_birth_national_two_years/timeline`,
            ]),
          },
          {
            id: 'el_salvador_birth_national_one_year',
            label: 'Salvadoran birth nationals (one year by reciprocity)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'citizenship.by_birth.iso_n3', operator: 'eq', value: '222' },
              { field: 'residence.consecutive_months', operator: 'gte', value: 12, unit: 'months' },
              { field: 'integration.spanish_and_civics', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'permanent_residence', minimum_months: 12 }],
            timeline: {
              eligibility_minimum_months: 12,
              processing_typical_months: null,
              confidence: 'high',
              note: 'El Salvador Constitution Article 92 gives native Spaniards and Hispano-Americans a one-year residence naturalization floor, so Panamanians get one year there and Salvadoran birth nationals get one year in Panama under Article 10(3).',
            },
            source_refs: refs([constitution, requirements], [
              `/routes/${reciprocityId}/summary`,
              `/routes/${reciprocityId}/variants/el_salvador_birth_national_one_year/eligibility`,
            ]),
          },
          {
            id: 'honduras_birth_national_two_years',
            label: 'Honduran birth nationals (two years by reciprocity)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'citizenship.by_birth.iso_n3', operator: 'eq', value: '340' },
              { field: 'residence.consecutive_months', operator: 'gte', value: 24, unit: 'months' },
              { field: 'integration.spanish_and_civics', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'permanent_residence', minimum_months: 24 }],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Honduras Constitution Article 24 gives Spaniards and Ibero-Americans by birth a two-year consecutive residence floor (Central Americans by birth are one year). Panamanians fall under the two-year Ibero track, so Honduran birth nationals are modeled at two years in Panama.',
            },
            source_refs: refs([constitution, requirements], [
              `/routes/${reciprocityId}/summary`,
              `/routes/${reciprocityId}/variants/honduras_birth_national_two_years/eligibility`,
            ]),
          },
          {
            id: 'costa_rica_birth_national_five_years',
            label: 'Costa Rican birth nationals (five years by reciprocity)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'citizenship.by_birth.iso_n3', operator: 'eq', value: '188' },
              { field: 'residence.consecutive_months', operator: 'gte', value: 60, unit: 'months' },
              { field: 'integration.spanish_and_civics', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'permanent_residence', minimum_months: 60 }],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Costa Rica Constitution Article 14 gives Central Americans, Spaniards, and Spanish-Americans by birth a five-year official residence floor (seven years for other foreigners). Panamanians as Spanish-Americans by birth are on the five-year track, so Costa Rican birth nationals are modeled at five years in Panama.',
            },
            source_refs: refs([constitution, requirements], [
              `/routes/${reciprocityId}/summary`,
              `/routes/${reciprocityId}/variants/costa_rica_birth_national_five_years/eligibility`,
            ]),
          },
          {
            id: 'venezuela_birth_national_five_years',
            label: 'Venezuelan birth nationals (five years by reciprocity)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'citizenship.by_birth.iso_n3', operator: 'eq', value: '862' },
              { field: 'residence.consecutive_months', operator: 'gte', value: 60, unit: 'months' },
              { field: 'integration.spanish_and_civics', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'permanent_residence', minimum_months: 60 }],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Venezuela Constitution Article 33 reduces the ten-year naturalization residence floor to five years for original nationals of Spain, Portugal, Italy, or a Latin American or Caribbean country. Panamanians qualify for five years there, so Venezuelan birth nationals are modeled at five years in Panama.',
            },
            source_refs: refs([constitution, requirements], [
              `/routes/${reciprocityId}/summary`,
              `/routes/${reciprocityId}/variants/venezuela_birth_national_five_years/eligibility`,
            ]),
          },
          {
            id: 'latin_american_birth_national_reciprocity',
            label: 'Other Latin American birth nationals (reciprocal period)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'citizenship.by_birth.region', operator: 'eq', value: 'latin_america' },
              { field: 'origin.reciprocal_treatment_of_panamanians', operator: 'eq', value: true },
              { field: 'integration.spanish_and_civics', operator: 'eq', value: true },
            ],
            milestones: [{ status: 'permanent_residence', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: null,
              processing_typical_months: null,
              confidence: 'medium',
              note: 'Article 10(3) still sets the residence floor to whatever the origin Latin American state requires of Panamanians. Named variants above cover Spain, El Salvador, Honduras, Costa Rica, and Venezuela where the origin constitution states a clear preferential floor. Other origins (for example Mexico two years for Iberian/Latin American origin, Colombia two years for Spaniards) should be checked against the origin nationality rules before relying on a shorter period.',
            },
            source_refs: refs([constitution, requirements], [
              `/routes/${reciprocityId}/summary`,
              `/routes/${reciprocityId}/variants/latin_american_birth_national_reciprocity/eligibility`,
              `/routes/${reciprocityId}/variants/latin_american_birth_national_reciprocity/timeline`,
            ]),
          },
        ],
      },
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

function taiwanRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.taiwan_nationality_act);
  const goldCard = requireSource(officialSources, OFFICIAL_URLS.taiwan_employment_gold_card);
  const aprc = requireSource(officialSources, OFFICIAL_URLS.taiwan_nia_permanent_residency);
  return reviewedCountryRecord({
    shadow,
    iso: '158',
    note: 'All acquisition modes reviewed against the R.O.C. Nationality Act. The Employment Gold Card and investment-linked APRC tracks are residence products modeled in mobility data, not citizenship grants. Naturalization generally requires loss of prior nationality within one year of permission, with statutory exceptions for high-level professionals and special contribution.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      { mode: 'naturalization', finding: 'present', sources: [act, goldCard, aprc] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [act],
        note: 'R.O.C. nationality at birth follows a R.O.C. national parent, or birth in the territory when both parents are unknown or stateless. Birth in Taiwan alone to identified foreign parents is not general jus soli.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [act, goldCard, aprc],
        note: 'Taiwan has no citizenship-by-investment programme. The Employment Gold Card is a talent open-work/residence product with a path to APRC; NIA also lists investor/company-responsible-person evidence for ordinary permanent-residence applications after the statutory residence period. Neither is a purchase of nationality. High-level professional and special-contribution naturalization under Articles 5–6 remain discretionary merit routes.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'taiwan-citizenship-by-parent',
        mode: 'ancestry',
        title: 'R.O.C. nationality through a R.O.C. parent',
        summary: 'A person has R.O.C. nationality if the father or mother was a R.O.C. national at the time of birth, or if a parent died before the birth while a R.O.C. national. Restoration routes exist for persons who previously lost nationality under the Act.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '158' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'taiwan-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after consecutive legal residence',
        summary: 'A foreign national or stateless person domiciled in the R.O.C. may apply for naturalization after legally residing more than 183 days each year for at least five consecutive years, with capacity, good conduct, livelihood, and basic national-language and civic knowledge. Shorter three-year floors apply for spouses, certain family ties, persons born in the territory, and other Article 4 categories. Permission is granted by the Ministry of the Interior; eligibility is not an entitlement.',
        source: act,
        eligibility: [
          { field: 'residence.consecutive_years_183_days', operator: 'gte', value: 5, unit: 'years' },
          { field: 'language.national_basic_proficiency', operator: 'eq', value: true },
          { field: 'prior_nationality.loss_certificate_within_one_year', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        note: 'Article 9 generally requires a certificate of loss of original nationality within one year of naturalization permission, with exemptions for high-level professionals, special contribution, and cases where loss is impossible for reasons not attributable to the applicant.',
      }),
      principalCitizenshipRoute({
        id: 'taiwan-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a R.O.C. parent or foundling rule',
        summary: 'A person born to a R.O.C. national parent is a R.O.C. national at birth. A person born in the territory whose parents cannot be ascertained or were both stateless is also a national. Birth in Taiwan alone to identified foreign parents is not general jus soli.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '158' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function indonesiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.indonesia_citizenship_law);
  const imigrasi = requireSource(officialSources, OFFICIAL_URLS.indonesia_imigrasi);
  return reviewedCountryRecord({
    shadow,
    iso: '360',
    note: 'All acquisition modes reviewed against Law No. 12 of 2006 on Citizenship of the Republic of Indonesia. Adult dual nationality is generally not retained on naturalization; limited dual status for children ends at majority.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law] },
      { mode: 'naturalization', finding: 'present', sources: [law, imigrasi] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [law],
        note: 'Indonesian citizenship at birth is primarily through an Indonesian parent under Law 12/2006. Birth in Indonesia alone to two foreign parents is not general jus soli.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [law, imigrasi],
        note: 'Indonesia has no direct citizenship-by-investment programme. Investor or second-home residence products support stay only and do not grant citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'indonesia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Citizenship through an Indonesian parent',
        summary: 'A child acquires Indonesian citizenship when a parent is an Indonesian citizen under the lineage rules of Law No. 12 of 2006, including specified mixed-nationality and acknowledgment situations. Limited dual citizenship for children ends when the child must choose nationality at majority or marriage.',
        source: law,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '360' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'indonesia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five consecutive or ten intermittent years',
        summary: 'A foreign adult (or married applicant) may request naturalization after residing in Indonesian territory for at least five consecutive years or at least ten years intermittently, with capacity, Indonesian language ability, acceptance of Pancasila and the Constitution, good health, no serious criminal conviction, livelihood, payment of the statutory fee, and no dual citizenship upon becoming Indonesian. Approval is discretionary at the presidential level after ministerial process.',
        source: [law, imigrasi],
        eligibility: [
          { field: 'residence.consecutive_years_or_ten_intermittent', operator: 'gte', value: 5, unit: 'years' },
          { field: 'language.bahasa_indonesia', operator: 'eq', value: true },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        note: 'The five-year consecutive floor is the ordinary continuous path; the ten-year intermittent alternative is statutory. Special contribution naturalization under Article 20 is exceptional and not modeled as CBI.',
      }),
      principalCitizenshipRoute({
        id: 'indonesia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Indonesian parent',
        summary: 'A person born to an Indonesian citizen parent acquires Indonesian citizenship under Law No. 12 of 2006. Birth in Indonesia alone to two foreign parents is not general jus soli.',
        source: law,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '360' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function thailandRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.thailand_nationality_act);
  const boi = requireSource(officialSources, OFFICIAL_URLS.thailand_boi);
  return reviewedCountryRecord({
    shadow,
    iso: '764',
    note: 'All acquisition modes reviewed against the Nationality Act B.E. 2508 (as amended; UNHCR English text). Board of Investment privileges are residence/tax incentives only and are not citizenship.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [act],
        note: 'Thai nationality at birth follows a Thai parent under the Act. Birth in Thailand alone to two foreign parents is not unconditional jus soli.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [act, boi],
        note: 'Thailand has no direct citizenship-by-investment programme. BOI promotion and long-term resident visas support residence and work privileges only; citizenship still requires naturalization under the Nationality Act.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'thailand-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Thai nationality through a Thai parent',
        summary: 'A person acquires Thai nationality by birth when a parent is a Thai national under the Nationality Act lineage rules, including specified transmission through a Thai father or mother and related acknowledgment situations.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '764' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'thailand-naturalization',
        mode: 'naturalization',
        title: 'Naturalization with ministerial and Cabinet approval',
        summary: 'A foreigner may be naturalized as a Thai national with permission of the Minister of Interior and Cabinet approval after meeting the statutory conditions of the Nationality Act, which ordinarily include majority and capacity, good conduct, lawful occupation, knowledge of Thai sufficient for communication, and domicile in Thailand for not less than five consecutive years under a permanent-residence qualification, unless a shorter statutory path applies (for example certain spouses of Thai nationals). Naturalization remains highly discretionary.',
        source: act,
        eligibility: [
          { field: 'status.permanent_residence', operator: 'eq', value: true },
          { field: 'residence.consecutive_years', operator: 'gte', value: 5, unit: 'years' },
          { field: 'language.thai_communication', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        note: 'Permanent residence is itself discretionary and quota-limited. Marriage to a Thai national may shorten residence floors but does not create automatic citizenship.',
      }),
      principalCitizenshipRoute({
        id: 'thailand-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Thai parent',
        summary: 'A person born to a Thai national parent is a Thai national at birth under the Nationality Act. Birth in Thailand alone to two foreign parents is not unconditional jus soli.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '764' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function nigeriaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const chapter = requireSource(officialSources, OFFICIAL_URLS.nigeria_constitution_citizenship);
  const interior = requireSource(officialSources, OFFICIAL_URLS.nigeria_interior_requirements);
  const constitute = requireSource(officialSources, OFFICIAL_URLS.nigeria_constitute);
  return reviewedCountryRecord({
    shadow,
    iso: '566',
    note: 'All acquisition modes reviewed against Chapter III of the 1999 Constitution and Ministry of Interior citizenship guidance. Naturalization and registration remain presidential/ministerial grants, not entitlements after residence alone.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [chapter, constitute] },
      { mode: 'naturalization', finding: 'present', sources: [chapter, interior, constitute] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [chapter, constitute],
        note: 'Citizenship by birth under section 25 is primarily descent-based (parent or grandparent citizen / indigenous community rules), not unconditional jus soli for two foreign parents.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [chapter, interior],
        note: 'Nigeria has no direct citizenship-by-investment programme. Business residence and related permits remain immigration status only.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'nigeria-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Citizenship by birth through a Nigerian parent',
        summary: 'Under section 25 of the 1999 Constitution, a person is a citizen of Nigeria by birth if born outside Nigeria to a Nigerian citizen parent, or if born in Nigeria after independence to a parent or grandparent who is a citizen, subject to the indigenous-community and historical rules for pre-independence births.',
        source: [chapter, constitute],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '566' }],
        months: 0,
        lastChecked: '2026-07-22',
        note: 'Registration under section 26 is a separate discretionary channel for certain spouses and persons of Nigerian origin and is not collapsed into ordinary naturalization.',
      }),
      principalCitizenshipRoute({
        id: 'nigeria-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after fifteen years continuous residence',
        summary: 'Section 27 of the 1999 Constitution allows the President to grant a certificate of naturalization to a person who satisfies the constitutional qualifications, including continuous residence in Nigeria for a period of fifteen years, majority, good character, intention to reside, community acceptability, and capacity to make a useful contribution. Section 28 requires renunciation of other nationalities except citizenship of a country acquired by birth. The Ministry of Interior administers applications; grant is discretionary.',
        source: [chapter, interior, constitute],
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 15, unit: 'years' },
          { field: 'prior_nationality.renounced_except_citizenship_by_birth', operator: 'eq', value: true },
          { field: 'character.good', operator: 'eq', value: true },
        ],
        months: 180,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        note: 'Interior guidance lists documentary requirements for naturalization under section 27. Registration under section 26 (including certain spouses) uses different constitutional criteria and is not modeled as a separate principal route here.',
      }),
      principalCitizenshipRoute({
        id: 'nigeria-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Nigerian parent or grandparent rules',
        summary: 'A person born outside Nigeria either of whose parents is a citizen of Nigeria is a citizen by birth. Birth in Nigeria after independence with a citizen parent or grandparent also creates citizenship by birth under section 25. Birth in Nigeria alone to two foreign parents without qualifying lineage is not general jus soli.',
        source: [chapter, constitute],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '566' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function peruRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.peru_naturalization);
  const marriage = requireSource(officialSources, OFFICIAL_URLS.peru_marriage_nationality);
  const migraciones = requireSource(officialSources, OFFICIAL_URLS.peru_migraciones);
  return reviewedCountryRecord({
    shadow,
    iso: '604',
    note: 'Reviewed against Migraciones naturalization guidance. Investor migration quality supports ordinary naturalization paperwork only — not CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [naturalization, migraciones] },
      { mode: 'naturalization', finding: 'present', sources: [naturalization, marriage] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [naturalization],
        note: 'Peruvian parent or birth in Peru under nationality law; not only pure jus soli for all foreign-parent cases without lineage rules.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [naturalization, migraciones],
        note: 'No citizenship-by-investment. Investor is a residence quality used when applying for ordinary naturalization.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'peru-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Peruvian nationality through a Peruvian parent',
        summary: 'A child of a Peruvian parent is Peruvian under the Nationality Law lineage rules, including birth abroad subject to registration.',
        source: [naturalization, migraciones],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '604' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'peru-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after two years legal residence',
        summary: 'Adult foreigners may apply after at least two consecutive years of legal residence, subject to Migraciones conditions (means, good conduct, exam) for their migration quality. Marriage to a Peruvian has a parallel two-year continuous residence track.',
        source: [naturalization, marriage],
        eligibility: [
          { field: 'residence.consecutive_years', operator: 'gte', value: 2, unit: 'years' },
        ],
        months: 24,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'peru-citizenship-at-birth',
        mode: 'birth',
        title: 'Citizenship at birth through a Peruvian parent or birth in Peru',
        summary: 'Birth to a Peruvian parent, or birth in Peru under the Nationality Law, creates Peruvian nationality. Ordinary foreign-parent temporary presence is not a general unrestricted jus soli path.',
        source: naturalization,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '604' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function boliviaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.bolivia_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '068',
    note: 'Reviewed against the 2009 Constitution nationality articles. No citizenship-by-investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Birth in Bolivia generally confers nationality; parent Bolivian rules also apply.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No direct citizenship-by-investment grant.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'bolivia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Bolivian nationality through a Bolivian parent',
        summary: 'Children of a Bolivian parent are Bolivian by birth under the Constitution, including birth abroad subject to the statutory rules.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '068' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'bolivia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after continuous residence',
        summary: 'Foreigners may naturalize after more than three years uninterrupted legal residence, or two years with a Bolivian spouse, child, or foster parent, subject to legal status and statutory process.',
        source: constitution,
        eligibility: [
          { field: 'residence.uninterrupted_years', operator: 'gte', value: 3, unit: 'years' },
        ],
        months: 36,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'bolivia-citizenship-by-birth',
        mode: 'birth',
        title: 'Citizenship by birth in Bolivia or through a Bolivian parent',
        summary: 'Persons born in Bolivian territory are Bolivian by birth (with the constitutional foreign-service exceptions). Parentage rules also transmit Bolivian nationality.',
        source: constitution,
        eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '068' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function ecuadorRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.ecuador_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '218',
    note: 'Reviewed against the Constitution nationality framework. No citizenship-by-investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Ecuadorian parent or birth in Ecuador under constitutional rules.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No direct citizenship-by-investment grant. Investor visas are residence only.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'ecuador-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Ecuadorian nationality through an Ecuadorian parent',
        summary: 'A person born to an Ecuadorian father or mother is Ecuadorian, including birth abroad subject to registration rules.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '218' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'ecuador-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after legal residence',
        summary: 'Foreign adults may seek naturalization after three years of continuous legal residence under the nationality and immigration framework, with shorter tracks for spouses and other statutory categories. Grant is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 3, unit: 'years' },
        ],
        months: 36,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'ecuador-citizenship-at-birth',
        mode: 'birth',
        title: 'Citizenship at birth through an Ecuadorian parent or birth in Ecuador',
        summary: 'Birth to an Ecuadorian parent, or birth in Ecuador under the Constitution, creates Ecuadorian nationality.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '218' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function costaRicaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.costa_rica_constitution);
  const naturalizationId = 'costa-rica-naturalization-by-residence';
  return reviewedCountryRecord({
    shadow,
    iso: '188',
    note: 'Reviewed against Constitution Articles 13 to 15. Preferential five-year floors for Central Americans, Spaniards, and Spanish-Americans by birth are modeled as explicit variants. No citizenship-by-investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Article 13 covers birth in Costa Rica to a Costa Rican parent, birth abroad to a Costa Rican by birth with registration, birth in Costa Rica to foreign parents with timely registration, and foundlings.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No direct citizenship-by-investment grant in the constitutional nationality chapter.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'costa-rica-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Costa Rican nationality through a Costa Rican parent',
        summary: 'A child of a Costa Rican father or mother is Costa Rican by birth under Article 13, including birth abroad for a Costa Rican parent by birth when registered as provided.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '188' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      {
        id: naturalizationId,
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after official residence',
        summary: 'Article 14: Central Americans, Spaniards, and Spanish-Americans by birth may naturalize after five years of official residence; other foreigners need seven years. Marriage to a Costa Rican has a two-year residence track. Spanish language, civics, good conduct, and means still apply under Article 15.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        variants: [
          {
            id: 'central_american_spanish_spanish_american_birth_five_years',
            label: 'Central American, Spanish, or Spanish-American by birth (five years)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              {
                field: 'citizenship.by_birth.category',
                operator: 'in',
                value: ['central_america', 'spain', 'spanish_america'],
              },
              { field: 'residence.official_months', operator: 'gte', value: 60, unit: 'months' },
            ],
            milestones: [{ status: 'official_residence', minimum_months: 60 }],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Constitution Article 14(2). Spanish-Americans by birth includes most Ibero-American birth nationals outside Central America.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/central_american_spanish_spanish_american_birth_five_years/eligibility`,
            ]),
          },
          {
            id: 'ordinary_seven_years',
            label: 'Ordinary seven-year residence route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'residence.official_months', operator: 'gte', value: 84, unit: 'months' },
            ],
            milestones: [{ status: 'official_residence', minimum_months: 84 }],
            timeline: {
              eligibility_minimum_months: 84,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Constitution Article 14(3) for other foreigners and for Central Americans, Spaniards, or Spanish-Americans who are not so by birth.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/ordinary_seven_years/eligibility`,
            ]),
          },
          {
            id: 'married_to_costa_rican_two_years',
            label: 'Married to a Costa Rican (two years)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'spouse.citizenship.iso_n3', operator: 'eq', value: '188' },
              { field: 'residence.official_months', operator: 'gte', value: 24, unit: 'months' },
            ],
            milestones: [{ status: 'official_residence', minimum_months: 24 }],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Constitution Article 14(5): two years of marriage and residence after declaring the desire to acquire Costa Rican nationality.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/married_to_costa_rican_two_years/eligibility`,
            ]),
          },
        ],
      },
      principalCitizenshipRoute({
        id: 'costa-rica-citizenship-by-birth',
        mode: 'birth',
        title: 'Costa Rican nationality by birth in Costa Rica or through a Costa Rican parent',
        summary: 'Article 13 nationality by birth rules: Costa Rican parentage, birth in Costa Rica with registration for foreign parents, birth abroad to a Costa Rican by birth with registration, and foundlings.',
        source: constitution,
        eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '188' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function elSalvadorRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.el_salvador_constitution);
  const naturalizationId = 'el-salvador-naturalization-by-residence';
  return reviewedCountryRecord({
    shadow,
    iso: '222',
    note: 'Reviewed against Constitution Articles 90 to 92. Native Spaniards and Hispano-Americans have a one-year naturalization floor; Central American natives of the former Federal Republic can opt by domicile declaration. No citizenship-by-investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Article 90: birth in El Salvador; children of a Salvadoran parent born abroad; and Central American natives of the former Federal Republic who domicile in El Salvador and declare the desire to be Salvadoran without renouncing origin nationality.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No direct citizenship-by-investment grant in the constitutional nationality title.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'el-salvador-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Salvadoran nationality through a Salvadoran parent',
        summary: 'Children of a Salvadoran father or mother born abroad are Salvadoran by birth under Article 90.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '222' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'el-salvador-central-american-option',
        mode: 'naturalization',
        title: 'Central American option by domicile declaration',
        summary: 'Natives of the other states that constituted the Federal Republic of Central America who domicile in El Salvador may declare the desire to be Salvadoran without renouncing their nationality of origin (Article 90(3)).',
        source: constitution,
        eligibility: [
          { field: 'citizenship.by_birth.region', operator: 'eq', value: 'former_federal_republic_central_america' },
          { field: 'residence.domicile_in_el_salvador', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'right',
        lastChecked: '2026-07-22',
        note: 'Constitution treats this as Salvadoran by birth after declaration, not ordinary naturalization years.',
      }),
      {
        id: naturalizationId,
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after residence',
        summary: 'Article 92: native Spaniards and Hispano-Americans may naturalize after one year of residence; other foreigners after five years; marriage to a Salvadoran has a two-year residence track. Grant is by competent authority under the law.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        variants: [
          {
            id: 'spanish_or_hispano_american_one_year',
            label: 'Native Spaniards and Hispano-Americans (one year)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              {
                field: 'citizenship.by_birth.category',
                operator: 'in',
                value: ['spain', 'hispano_america'],
              },
              { field: 'residence.in_el_salvador_months', operator: 'gte', value: 12, unit: 'months' },
            ],
            milestones: [{ status: 'residence_in_el_salvador', minimum_months: 12 }],
            timeline: {
              eligibility_minimum_months: 12,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Constitution Article 92(1). This is the reciprocal floor used for Panama Article 10(3) modeling of Salvadoran birth nationals.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/spanish_or_hispano_american_one_year/eligibility`,
            ]),
          },
          {
            id: 'ordinary_five_years',
            label: 'Ordinary five-year residence route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'residence.in_el_salvador_months', operator: 'gte', value: 60, unit: 'months' },
            ],
            milestones: [{ status: 'residence_in_el_salvador', minimum_months: 60 }],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: null,
              confidence: 'high',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/ordinary_five_years/eligibility`,
            ]),
          },
          {
            id: 'married_to_salvadoran_two_years',
            label: 'Married to a Salvadoran (two years)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'spouse.citizenship.iso_n3', operator: 'eq', value: '222' },
              { field: 'residence.in_el_salvador_months', operator: 'gte', value: 24, unit: 'months' },
            ],
            milestones: [{ status: 'residence_in_el_salvador', minimum_months: 24 }],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Constitution Article 92(4): two years residence prior to or after the marriage.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/married_to_salvadoran_two_years/eligibility`,
            ]),
          },
        ],
      },
      principalCitizenshipRoute({
        id: 'el-salvador-citizenship-by-birth',
        mode: 'birth',
        title: 'Salvadoran nationality by birth in El Salvador',
        summary: 'Persons born in the territory of El Salvador are Salvadoran by birth under Article 90.',
        source: constitution,
        eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '222' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function guatemalaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.guatemala_constitution);
  const nationalityLaw = requireSource(officialSources, OFFICIAL_URLS.guatemala_nationality_law);
  const naturalizationId = 'guatemala-naturalization-by-residence';
  return reviewedCountryRecord({
    shadow,
    iso: '320',
    note: 'Reviewed against the Constitution nationality framework and the Nationality Law (Decree 1613) text for ordinary five-year naturalization. No citizenship-by-investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, nationalityLaw] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Constitutional birth and parentage rules; foreign-parent edge cases follow secondary nationality law.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, nationalityLaw],
        note: 'No direct citizenship-by-investment grant; ordinary naturalization remains discretionary.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'guatemala-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Guatemalan nationality through a Guatemalan parent',
        summary: 'Children of a Guatemalan parent are Guatemalan under the constitutional nationality framework, including birth abroad subject to registration rules.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '320' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      {
        id: naturalizationId,
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after domicile and residence',
        summary: 'Ordinary naturalization (naturalización concesiva) generally requires domicile and five years of immediately preceding residence under the Nationality Law. Shorter two-year tracks exist for statutory special categories (important services, prior Central American residence, recognized merit, or statelessness). Grant is discretionary.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        variants: [
          {
            id: 'ordinary_five_years',
            label: 'Ordinary five-year residence route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'residence.in_guatemala_months', operator: 'gte', value: 60, unit: 'months' },
            ],
            milestones: [{ status: 'domicile_in_guatemala', minimum_months: 60 }],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Nationality Law Article 33(1): five years immediately preceding residence while domiciled, with limited absence rules.',
            },
            source_refs: refs([nationalityLaw, constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/ordinary_five_years/eligibility`,
            ]),
          },
          {
            id: 'special_two_years',
            label: 'Two-year special-category route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'naturalization.special_category', operator: 'eq', value: true },
              { field: 'residence.in_guatemala_months', operator: 'gte', value: 24, unit: 'months' },
            ],
            milestones: [{ status: 'domicile_in_guatemala', minimum_months: 24 }],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'medium',
              note: 'Nationality Law Article 33(3): two years for important services, three prior years of residence in a Central American country, recognized merit, or statelessness. Case-check the category before relying on the shorter floor.',
            },
            source_refs: refs([nationalityLaw], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/special_two_years/eligibility`,
            ]),
          },
        ],
      },
      principalCitizenshipRoute({
        id: 'guatemala-citizenship-by-birth',
        mode: 'birth',
        title: 'Guatemalan nationality by birth in Guatemala or through a Guatemalan parent',
        summary: 'Birth in Guatemala or through a Guatemalan parent creates Guatemalan nationality under the constitutional framework.',
        source: constitution,
        eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '320' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function hondurasRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.honduras_constitution);
  const naturalizationId = 'honduras-naturalization-by-residence';
  return reviewedCountryRecord({
    shadow,
    iso: '340',
    note: 'Reviewed against Constitution Articles 22 to 24. Central Americans by birth have a one-year floor; Spaniards and Ibero-Americans by birth have two years; other foreigners three years. No citizenship-by-investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Article 23: birth in Honduras (except children of diplomatic agents), children born abroad to a Honduran by birth, births on Honduran vessels or aircraft in defined cases, and foundlings.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No direct citizenship-by-investment grant in the constitutional nationality chapter.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'honduras-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Honduran nationality through a Honduran parent',
        summary: 'Children born abroad to a Honduran father or mother by birth are Honduran by birth under Article 23.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '340' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      {
        id: naturalizationId,
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after residence',
        summary: 'Article 24: Central Americans by birth after one year; Spaniards and Ibero-Americans by birth after two consecutive years; other foreigners after more than three consecutive years. Spouses of Hondurans by birth and selected immigrant groups have separate tracks. Prior renunciation of other nationality is generally required unless a dual-nationality treaty applies.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        variants: [
          {
            id: 'central_american_birth_one_year',
            label: 'Central Americans by birth (one year)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'citizenship.by_birth.region', operator: 'eq', value: 'central_america' },
              { field: 'residence.in_honduras_months', operator: 'gte', value: 12, unit: 'months' },
            ],
            milestones: [{ status: 'residence_in_honduras', minimum_months: 12 }],
            timeline: {
              eligibility_minimum_months: 12,
              processing_typical_months: null,
              confidence: 'high',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/central_american_birth_one_year/eligibility`,
            ]),
          },
          {
            id: 'spanish_or_ibero_american_birth_two_years',
            label: 'Spaniards and Ibero-Americans by birth (two years)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              {
                field: 'citizenship.by_birth.category',
                operator: 'in',
                value: ['spain', 'ibero_america'],
              },
              { field: 'residence.in_honduras_months', operator: 'gte', value: 24, unit: 'months' },
            ],
            milestones: [{ status: 'residence_in_honduras', minimum_months: 24 }],
            timeline: {
              eligibility_minimum_months: 24,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Constitution Article 24(2). This is the reciprocal floor used for Panama Article 10(3) modeling of Honduran birth nationals.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/spanish_or_ibero_american_birth_two_years/eligibility`,
            ]),
          },
          {
            id: 'ordinary_three_years',
            label: 'Ordinary three-year residence route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'residence.in_honduras_months', operator: 'gte', value: 36, unit: 'months' },
            ],
            milestones: [{ status: 'residence_in_honduras', minimum_months: 36 }],
            timeline: {
              eligibility_minimum_months: 36,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Constitution Article 24(3): more than three consecutive years for other foreigners.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/ordinary_three_years/eligibility`,
            ]),
          },
          {
            id: 'married_to_honduran_by_birth',
            label: 'Married to a Honduran by birth',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'spouse.citizenship.by_birth.iso_n3', operator: 'eq', value: '340' },
            ],
            milestones: [{ status: 'citizenship_application', minimum_months: 0 }],
            timeline: {
              eligibility_minimum_months: 0,
              processing_typical_months: null,
              confidence: 'medium',
              note: 'Constitution Article 24(6) lists foreigners married to Hondurans by birth among naturalization categories; statutory procedure and any waiting period still apply.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/married_to_honduran_by_birth/eligibility`,
            ]),
          },
        ],
      },
      principalCitizenshipRoute({
        id: 'honduras-citizenship-by-birth',
        mode: 'birth',
        title: 'Honduran nationality by birth in Honduras',
        summary: 'Persons born within the national territory are Honduran by birth under Article 23, with the diplomatic-agent children exception.',
        source: constitution,
        eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '340' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function nicaraguaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.nicaragua_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '558',
    note: 'Reviewed against Constitution Articles 15 to 21. Central Americans by birth may opt for Nicaraguan nationality while retaining origin nationality. Ordinary naturalization is delegated to statute (renunciation and legal conditions). No citizenship-by-investment programme in the constitutional text.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Article 16: birth in Nicaragua with diplomatic/international-organization exceptions, children of a Nicaraguan parent, foundlings, and limited vessel/aircraft cases.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No direct citizenship-by-investment grant in the constitutional nationality chapter.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'nicaragua-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Nicaraguan nationality through a Nicaraguan parent',
        summary: 'Children of a Nicaraguan father or mother are nationals under Article 16, including birth abroad with application rules after majority for some cases.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '558' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'nicaragua-central-american-option',
        mode: 'naturalization',
        title: 'Central American option while retaining origin nationality',
        summary: 'Native-born Central Americans who reside in Nicaragua may apply for Nicaraguan nationality without renouncing their prior nationality (Article 17).',
        source: constitution,
        eligibility: [
          { field: 'citizenship.by_birth.region', operator: 'eq', value: 'central_america' },
          { field: 'residence.in_nicaragua', operator: 'eq', value: true },
        ],
        months: 0,
        allocation: 'right',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'nicaragua-naturalization',
        mode: 'naturalization',
        title: 'Naturalization under nationality statute',
        summary: 'Foreigners may be nationalized after applying to the competent authority, renouncing prior nationality, and meeting the requirements fixed by the applicable nationality law (Article 19). Residence periods are statutory rather than fixed in the Constitution.',
        source: constitution,
        eligibility: [
          { field: 'naturalization.statutory_requirements_met', operator: 'eq', value: true },
        ],
        months: null,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Constitution does not state a single multi-year residence floor; case-check the current nationality law and implementing rules.',
      }),
      principalCitizenshipRoute({
        id: 'nicaragua-citizenship-by-birth',
        mode: 'birth',
        title: 'Nicaraguan nationality by birth in Nicaragua',
        summary: 'Persons born in the national territory are nationals under Article 16, with exceptions for children of certain foreign diplomatic or international-organization personnel unless they opt for Nicaraguan nationality.',
        source: constitution,
        eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '558' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function dominicanRepublicRecord(
  shadow: DataShadow,
  officialSources: SourceRecord[],
): JurisdictionRecord {
  const constitution = requireSource(
    officialSources,
    OFFICIAL_URLS.dominican_republic_constitution,
  );
  return reviewedCountryRecord({
    shadow,
    iso: '214',
    note: 'Reviewed against Constitution Articles 18 to 20. Birthright is restricted for children of foreigners in transit or illegally present. Naturalization is delegated to statute. Dual nationality is recognized for Dominicans. No constitutional citizenship-by-investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Article 18: children of a Dominican parent; persons born in the territory except children of diplomats and of foreigners in transit or illegally present; dual-nationality option rules for some births abroad.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No direct citizenship-by-investment grant in the constitutional nationality section.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'dominican-republic-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Dominican nationality through a Dominican parent',
        summary: 'Sons and daughters of a Dominican mother or father are Dominican under Article 18, including many births abroad subject to the dual-nationality choice rules after age eighteen.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '214' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'dominican-republic-naturalization',
        mode: 'naturalization',
        title: 'Naturalization under nationality statute',
        summary: 'Article 19: foreigners may become naturalized in accordance with the law. Naturalized persons face political-office limits. Residence and other conditions are fixed by the nationality statute rather than a single constitutional multi-year floor.',
        source: constitution,
        eligibility: [
          { field: 'naturalization.statutory_requirements_met', operator: 'eq', value: true },
        ],
        months: null,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Constitution defers periods and process to law (historically Ley 1683 and later amendments). Case-check the current naturalization statute before relying on a specific year count.',
      }),
      principalCitizenshipRoute({
        id: 'dominican-republic-citizenship-by-birth',
        mode: 'birth',
        title: 'Dominican nationality by birth in the Dominican Republic',
        summary: 'Persons born in the national territory are Dominican under Article 18, except children of foreign diplomats and of foreigners in transit or illegally present as defined by Dominican law.',
        source: constitution,
        eligibility: [
          { field: 'birth.jurisdiction', operator: 'eq', value: '214' },
          { field: 'birth.parents.not_in_transit_or_illegal', operator: 'eq', value: true },
        ],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function venezuelaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.venezuela_constitution);
  const naturalizationId = 'venezuela-naturalization-by-residence';
  return reviewedCountryRecord({
    shadow,
    iso: '862',
    note: 'Reviewed against Constitution Articles 32 to 33. Ordinary naturalization is ten years uninterrupted residence, reduced to five for original nationals of Spain, Portugal, Italy, or a Latin American or Caribbean country. Marriage track is five years. No citizenship-by-investment programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Article 32: birth in the territory; birth abroad to two Venezuelan parents by birth; birth abroad to one Venezuelan by birth with residence or declaration; birth abroad to a naturalized Venezuelan parent with later residence and declaration rules.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No direct citizenship-by-investment grant in the constitutional nationality chapter.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'venezuela-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Venezuelan nationality through a Venezuelan parent',
        summary: 'Article 32 transmits Venezuelan nationality by birth to children born abroad to Venezuelan parents under the parentage, residence, and declaration rules in that article.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '862' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      {
        id: naturalizationId,
        mode: 'naturalization',
        status: 'active',
        title: 'Naturalization after uninterrupted residence',
        summary: 'Article 33: naturalization letter after at least ten years uninterrupted residence immediately before the application. The period falls to five years for original nationals of Spain, Portugal, Italy, or a Latin American or Caribbean country. Spouses of Venezuelans may declare after five years of marriage.',
        effective: { from: null, to: null, supersedes: [] },
        review: { state: 'reviewed', confidence: 'high', last_checked: '2026-07-22' },
        variants: [
          {
            id: 'ordinary_ten_years',
            label: 'Ordinary ten-year residence route',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              {
                field: 'residence.uninterrupted_months',
                operator: 'gte',
                value: 120,
                unit: 'months',
              },
            ],
            milestones: [{ status: 'uninterrupted_residence', minimum_months: 120 }],
            timeline: {
              eligibility_minimum_months: 120,
              processing_typical_months: null,
              confidence: 'high',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/ordinary_ten_years/eligibility`,
            ]),
          },
          {
            id: 'spain_portugal_italy_latin_america_caribbean_five_years',
            label: 'Spain, Portugal, Italy, Latin America, or Caribbean origin (five years)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              {
                field: 'citizenship.original.category',
                operator: 'in',
                value: ['spain', 'portugal', 'italy', 'latin_america', 'caribbean'],
              },
              {
                field: 'residence.uninterrupted_months',
                operator: 'gte',
                value: 60,
                unit: 'months',
              },
            ],
            milestones: [{ status: 'uninterrupted_residence', minimum_months: 60 }],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Constitution Article 33. This is the reciprocal floor used for Panama Article 10(3) modeling of Venezuelan birth nationals.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/spain_portugal_italy_latin_america_caribbean_five_years/eligibility`,
            ]),
          },
          {
            id: 'married_to_venezuelan_five_years',
            label: 'Married to a Venezuelan (five years)',
            outcome: 'citizenship',
            allocation: 'discretionary',
            eligibility: [
              { field: 'spouse.citizenship.iso_n3', operator: 'eq', value: '862' },
              { field: 'marriage.months', operator: 'gte', value: 60, unit: 'months' },
            ],
            milestones: [{ status: 'marriage_to_venezuelan', minimum_months: 60 }],
            timeline: {
              eligibility_minimum_months: 60,
              processing_typical_months: null,
              confidence: 'high',
              note: 'Constitution Article 33(2): declaration of wish to adopt Venezuelan nationality at least five years after the marriage date.',
            },
            source_refs: refs([constitution], [
              `/routes/${naturalizationId}/summary`,
              `/routes/${naturalizationId}/variants/married_to_venezuelan_five_years/eligibility`,
            ]),
          },
        ],
      },
      principalCitizenshipRoute({
        id: 'venezuela-citizenship-by-birth',
        mode: 'birth',
        title: 'Venezuelan nationality by birth in Venezuela',
        summary: 'Any person born within the territory of the Republic is Venezuelan by birth under Article 32.',
        source: constitution,
        eligibility: [{ field: 'birth.jurisdiction', operator: 'eq', value: '862' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function malaysiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.malaysia_constitution);
  const residence = requireSource(officialSources, OFFICIAL_URLS.malaysia_residence_pass);
  return reviewedCountryRecord({
    shadow,
    iso: '458',
    note: 'Reviewed against Federal Constitution citizenship parts and Immigration residence guidance. Naturalization requires renunciation of prior nationality.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, residence] },
      {
        mode: 'birth',
        finding: 'present',
        sources: [constitution],
        note: 'Primarily parent Malaysian citizen; birth in Malaysia alone is not general jus soli for two foreign parents.',
      },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, residence],
        note: 'No citizenship-by-investment. MM2H and related residence products are not citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'malaysia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Malaysian citizenship through a Malaysian parent',
        summary: 'A child of a Malaysian citizen parent may hold or register Malaysian citizenship under the Federal Constitution, subject to the birthplace and registration rules in force.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '458' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'malaysia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after long residence',
        summary: 'Federal Constitution naturalization generally requires ten years residence within the twelve years before application, including twelve months immediately before applying, Malay language ability, good character, and renunciation of prior nationality. Approval is highly discretionary.',
        source: [constitution, residence],
        eligibility: [
          { field: 'residence.years_in_prior_twelve', operator: 'gte', value: 10, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
          { field: 'language.malay', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'malaysia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Malaysian parent',
        summary: 'A person born to a Malaysian citizen parent is Malaysian under the Constitution’s operation-of-law and registration rules. Birth in Malaysia to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '458' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function vietnamRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.vietnam_nationality_law);
  return reviewedCountryRecord({
    shadow,
    iso: '704',
    note: 'Reviewed against Law on Vietnamese Nationality 2008. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law] },
      { mode: 'naturalization', finding: 'present', sources: [law] },
      { mode: 'birth', finding: 'present', sources: [law], note: 'Parent Vietnamese; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [law], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'vietnam-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Vietnamese nationality through a Vietnamese parent',
        summary: 'A child of a Vietnamese citizen parent is Vietnamese under the Nationality Law.',
        source: law,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '704' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'vietnam-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Adult foreigners may apply after five consecutive years of permanent residence, with language, livelihood, and character conditions. Applicants generally renounce prior nationality. Grant is discretionary.',
        source: law,
        eligibility: [
          { field: 'residence.permanent_consecutive_years', operator: 'gte', value: 5, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'vietnam-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Vietnamese parent',
        summary: 'Birth to a Vietnamese parent creates Vietnamese nationality. Birth in Vietnam alone to two foreign parents is not general jus soli.',
        source: law,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '704' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function cambodiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.cambodia_constitution);
  const nationalityLaw = requireSource(officialSources, OFFICIAL_URLS.cambodia_nationality_law);
  return reviewedCountryRecord({
    shadow,
    iso: '116',
    note: 'Reviewed against Constitution and Nationality Law practice. Investor naturalization remains pending verification.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, nationalityLaw] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, nationalityLaw] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Khmer/Cambodian; not general jus soli.' },
      {
        mode: 'investment',
        finding: 'present',
        sources: [nationalityLaw],
        note: 'Nationality law has investment/donation naturalization text; live programme operation remains pending verification.',
        confidence: 'medium',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'cambodia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Cambodian nationality through a Cambodian parent',
        summary: 'A child of a Cambodian parent is Cambodian under nationality law.',
        source: [constitution, nationalityLaw],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '116' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cambodia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after seven years residence',
        summary: 'Foreign adults may apply after about seven years continuous legal residence, with language and character conditions. Grant is discretionary.',
        source: [constitution, nationalityLaw],
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cambodia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Cambodian parent',
        summary: 'Birth to a Cambodian parent creates Cambodian nationality. Birth in Cambodia alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '116' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cambodia-investor-naturalization-status',
        mode: 'investment',
        title: 'Investor and donor naturalization exists in law; current operation needs verification',
        summary: "Cambodia's nationality law contains investment and donation provisions, but a current government-administered programme and operational requirements have not been verified for live recommendations.",
        source: nationalityLaw,
        eligibility: [{ field: 'programme_type', operator: 'eq', value: 'statutory_investor_naturalization' }],
        months: null,
        allocation: 'discretionary',
        status: 'pending_verification',
        lastChecked: '2026-07-17',
        confidence: 'medium',
        reviewState: 'pending',
      }),
    ],
  });
}

function kenyaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const immigration = requireSource(officialSources, OFFICIAL_URLS.kenya_immigration_citizenship);
  const constitution = requireSource(officialSources, OFFICIAL_URLS.kenya_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '404',
    note: 'Reviewed against Constitution Chapter 3 and Immigration Department citizenship guidance. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, immigration] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, immigration] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Kenyan citizen; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [immigration], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'kenya-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Kenyan citizenship through a Kenyan parent',
        summary: 'A person is a citizen by birth if a parent is a Kenyan citizen at the time of birth.',
        source: [constitution, immigration],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '404' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'kenya-registration-by-residence',
        mode: 'naturalization',
        title: 'Registration after seven years lawful residence',
        summary: 'Adults lawfully resident for a continuous period of at least seven years may apply for registration as a citizen. Spouses of Kenyans may apply after seven years of marriage. Grant follows statutory conditions.',
        source: [constitution, immigration],
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'kenya-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Kenyan parent',
        summary: 'Birth to a Kenyan citizen parent creates Kenyan citizenship by birth. Birth in Kenya alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '404' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function ghanaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const naturalization = requireSource(officialSources, OFFICIAL_URLS.ghana_naturalization);
  const act = requireSource(officialSources, OFFICIAL_URLS.ghana_citizenship_act);
  return reviewedCountryRecord({
    shadow,
    iso: '288',
    note: 'Reviewed against Citizenship Act 2000 and Interior naturalization guidance. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      { mode: 'naturalization', finding: 'present', sources: [act, naturalization] },
      { mode: 'birth', finding: 'present', sources: [act], note: 'Parent Ghanaian under historical Constitution date rules.' },
      { mode: 'investment', finding: 'verified_none', sources: [act], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'ghana-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Ghanaian citizenship through a Ghanaian parent',
        summary: 'A child of a Ghanaian citizen parent is Ghanaian under the Citizenship Act and Constitution date rules.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '288' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'ghana-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Applicants need twelve months residence immediately before applying and at least five years aggregate residence in the prior seven years, plus language, character, and integration conditions. Ministerial approval with presidential assent; discretionary.',
        source: [act, naturalization],
        eligibility: [
          { field: 'residence.aggregate_years_in_prior_seven', operator: 'gte', value: 5, unit: 'years' },
          { field: 'residence.immediately_preceding_months', operator: 'gte', value: 12, unit: 'months' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'ghana-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Ghanaian parent',
        summary: 'Birth to a Ghanaian parent creates Ghanaian citizenship under the applicable constitutional date rules. Birth in Ghana alone to two foreign parents is not general jus soli.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '288' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function moroccoRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.morocco_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '504',
    note: 'Reviewed against Constitution nationality framework and Code de la nationalité practice (five-year naturalization). No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Moroccan; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'morocco-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Moroccan nationality through a Moroccan parent',
        summary: 'A child of a Moroccan father or mother is Moroccan under the nationality code.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '504' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'morocco-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Foreign adults may apply after five years continuous legal residence, with language and character conditions. Shorter tracks exist for spouses. Grant is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'morocco-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Moroccan parent',
        summary: 'Birth to a Moroccan parent creates Moroccan nationality. Birth in Morocco alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '504' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function indiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.india_constitution);
  const oci = requireSource(officialSources, OFFICIAL_URLS.india_oci);
  return reviewedCountryRecord({
    shadow,
    iso: '356',
    note: 'Reviewed against Constitution citizenship provisions and MEA OCI scheme. OCI is not dual citizenship. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, oci] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent-based rules after 1987; not unrestricted jus soli.' },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution, oci],
        note: 'No citizenship-by-investment. OCI is a diaspora status, not nationality.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'india-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Indian citizenship through an Indian parent',
        summary: 'A child of an Indian citizen parent may be Indian under the Citizenship Act date rules. Overseas Citizen of India (OCI) is a separate status for persons of Indian origin abroad — not dual nationality.',
        source: [constitution, oci],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '356' }],
        months: 0,
        lastChecked: '2026-07-22',
        note: 'OCI is modeled in mobility as a diaspora status, not citizenship.',
      }),
      principalCitizenshipRoute({
        id: 'india-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after long residence',
        summary: 'Ordinary naturalization generally requires about twelve years residence (eleven of the prior fourteen plus twelve months immediately before applying), renunciation of prior nationality, and character conditions. Grant is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.years_in_prior_fourteen', operator: 'gte', value: 11, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 144,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'india-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Indian parent',
        summary: 'After 1987, birth in India creates citizenship only with a qualifying Indian parent (or later rules for both parents). Birth in India alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '356' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function samoaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.samoa_constitution);
  const investmentAct = requireSource(officialSources, OFFICIAL_URLS.samoa_citizenship_investment_act);
  const mcil = requireSource(officialSources, OFFICIAL_URLS.samoa_mcil_workshop);
  return reviewedCountryRecord({
    shadow,
    iso: '882',
    note: 'Reviewed against Constitution citizenship framework. NZ Samoan Quota is a separate mobility ballot. Investment programme remains pending verification.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Samoan or birth connected to Samoa under Citizenship Act rules.' },
      {
        mode: 'investment',
        finding: 'present',
        sources: [investmentAct, mcil],
        note: 'Citizenship Investment Act exists; current programme operation remains pending verification.',
        confidence: 'medium',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'samoa-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Samoan citizenship through a Samoan parent',
        summary: 'A child of a Samoan citizen parent is Samoan under the Citizenship Act lineage rules.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '882' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'samoa-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after residence',
        summary: 'Foreign adults may apply after five years continuous permanent residence, with character and intention-to-reside conditions. Grant is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.continuous_permanent_years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'samoa-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Samoan parent',
        summary: 'Birth to a Samoan parent creates Samoan citizenship. Birth in Samoa alone to two foreign parents is not general unrestricted jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '882' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'samoa-citizenship-investment-status',
        mode: 'investment',
        title: 'Citizenship Investment Act exists; current programme operation needs verification',
        summary: 'Samoa has a Citizenship Investment Act and was reviewing the programme framework in 2025, but current application operations and qualifying guidelines are not yet verified for live recommendations.',
        source: [investmentAct, mcil],
        eligibility: [{ field: 'programme_type', operator: 'eq', value: 'statutory_basis_only' }],
        months: null,
        allocation: 'discretionary',
        status: 'pending_verification',
        lastChecked: '2026-07-17',
        confidence: 'medium',
        reviewState: 'pending',
      }),
    ],
  });
}

function austriaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const guide = requireSource(officialSources, OFFICIAL_URLS.austria_citizenship);
  const portal = requireSource(officialSources, OFFICIAL_URLS.austria_oesterreich);
  return reviewedCountryRecord({
    shadow,
    iso: '040',
    note: 'Reviewed against official Austrian citizenship guidance. Ordinary naturalization generally requires renunciation of prior nationality. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [guide, portal] },
      { mode: 'naturalization', finding: 'present', sources: [guide, portal] },
      { mode: 'birth', finding: 'present', sources: [guide], note: 'Parent Austrian; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [guide], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'austria-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Austrian citizenship through an Austrian parent',
        summary: 'A child of an Austrian citizen parent is Austrian under the Citizenship Act. Separate declaration routes exist for certain descendants of Nazi-era victims.',
        source: [guide, portal],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '040' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'austria-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after ten years residence',
        summary: 'Ordinary naturalization generally needs ten years continuous legal residence (including at least five with a settlement permit), German language, civic knowledge, livelihood, and usually renunciation of prior nationality. Shorter paths exist for EEA citizens and other statutory categories. Grant is discretionary.',
        source: [guide, portal],
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 10, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'austria-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Austrian parent',
        summary: 'Birth to an Austrian parent creates Austrian citizenship. Birth in Austria alone to two foreign parents is not general jus soli.',
        source: guide,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '040' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function belgiumRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.belgium_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '056',
    note: 'Reviewed against Belgian nationality framework. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Belgian or conditional birth rules; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'belgium-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Belgian nationality through a Belgian parent',
        summary: 'A child of a Belgian parent is Belgian under the nationality code, subject to registration rules for birth abroad.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '056' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'belgium-naturalization',
        mode: 'naturalization',
        title: 'Nationality declaration after five years residence',
        summary: 'Adults with five years legal residence may apply for Belgian nationality by declaration if they meet integration, language, and economic participation conditions. Naturalization by parliament remains a separate exceptional track. Not automatic after five years.',
        source: constitution,
        eligibility: [
          { field: 'residence.legal_years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'belgium-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Belgian parent',
        summary: 'Birth to a Belgian parent creates Belgian nationality. Birth in Belgium alone to two foreign parents is not unrestricted jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '056' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function swedenRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const migrationsverket = requireSource(officialSources, OFFICIAL_URLS.sweden_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '752',
    note: 'Reviewed against Swedish Migration Agency citizenship guidance after the 2026 residence-period reform. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [migrationsverket] },
      { mode: 'naturalization', finding: 'present', sources: [migrationsverket] },
      { mode: 'birth', finding: 'present', sources: [migrationsverket], note: 'Parent Swedish; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [migrationsverket], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'sweden-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Swedish citizenship through a Swedish parent',
        summary: 'A child of a Swedish citizen parent is Swedish under the Citizenship Act.',
        source: migrationsverket,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '752' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'sweden-naturalization',
        mode: 'naturalization',
        title: 'Citizenship after eight years residence',
        summary: 'Adults generally need continuous residence of at least eight years, permanent residence status, identity proof, and good conduct. Shorter periods apply for Nordic citizens, spouses, and other statutory categories. Language and knowledge requirements apply under the current rules.',
        source: migrationsverket,
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 8, unit: 'years' },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'sweden-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Swedish parent',
        summary: 'Birth to a Swedish parent creates Swedish citizenship. Birth in Sweden alone to two foreign parents is not general jus soli.',
        source: migrationsverket,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '752' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function norwayRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const udi = requireSource(officialSources, OFFICIAL_URLS.norway_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '578',
    note: 'Reviewed against UDI citizenship guidance. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [udi] },
      { mode: 'naturalization', finding: 'present', sources: [udi] },
      { mode: 'birth', finding: 'present', sources: [udi], note: 'Parent Norwegian; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [udi], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'norway-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Norwegian citizenship through a Norwegian parent',
        summary: 'A child of a Norwegian citizen parent is Norwegian under the Nationality Act.',
        source: udi,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '578' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'norway-naturalization',
        mode: 'naturalization',
        title: 'Citizenship after residence and language requirements',
        summary: 'Adults generally need a long period of continuous residence (commonly eight years within the last eleven), permanent residence, Norwegian language, social studies, and good conduct. Dual nationality is now generally permitted. Grant follows statutory conditions.',
        source: udi,
        eligibility: [
          { field: 'residence.years_in_prior_eleven', operator: 'gte', value: 8, unit: 'years' },
          { field: 'language.norwegian', operator: 'eq', value: true },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'norway-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Norwegian parent',
        summary: 'Birth to a Norwegian parent creates Norwegian citizenship. Birth in Norway alone to two foreign parents is not general jus soli.',
        source: udi,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '578' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function denmarkRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const uim = requireSource(officialSources, OFFICIAL_URLS.denmark_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '208',
    note: 'Reviewed against Danish government citizenship guidance. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [uim] },
      { mode: 'naturalization', finding: 'present', sources: [uim] },
      { mode: 'birth', finding: 'present', sources: [uim], note: 'Parent Danish; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [uim], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'denmark-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Danish citizenship through a Danish parent',
        summary: 'A child of a Danish citizen parent is Danish under the Nationality Act.',
        source: uim,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '208' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'denmark-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after long residence',
        summary: 'Adults generally need about nine years continuous residence, permanent residence, Danish language and civics tests, self-support, and good conduct. Parliament grants nationality by statute. Dual nationality is generally allowed.',
        source: uim,
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 9, unit: 'years' },
          { field: 'language.danish', operator: 'eq', value: true },
        ],
        months: 108,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'denmark-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Danish parent',
        summary: 'Birth to a Danish parent creates Danish citizenship. Birth in Denmark alone to two foreign parents is not general jus soli.',
        source: uim,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '208' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function czechiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const interior = requireSource(officialSources, OFFICIAL_URLS.czechia_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '203',
    note: 'Reviewed against Czech Ministry of Interior citizenship materials. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [interior] },
      { mode: 'naturalization', finding: 'present', sources: [interior] },
      { mode: 'birth', finding: 'present', sources: [interior], note: 'Parent Czech; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [interior], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'czechia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Czech citizenship through a Czech parent',
        summary: 'A child of a Czech citizen parent is Czech under the Citizenship Act.',
        source: interior,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '203' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'czechia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after permanent residence',
        summary: 'Adults generally need five years of permanent residence (or three for EU citizens and some family categories), Czech language and civics, livelihood, and good conduct. Dual nationality is generally allowed. Grant is discretionary.',
        source: interior,
        eligibility: [
          { field: 'residence.permanent_years', operator: 'gte', value: 5, unit: 'years' },
          { field: 'language.czech', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'czechia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Czech parent',
        summary: 'Birth to a Czech parent creates Czech citizenship. Birth in Czechia alone to two foreign parents is not general jus soli.',
        source: interior,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '203' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function romaniaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const igi = requireSource(officialSources, OFFICIAL_URLS.romania_immigration);
  const constitution = requireSource(officialSources, OFFICIAL_URLS.romania_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '642',
    note: 'Reviewed against Constitution and immigration guidance. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, igi] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, igi] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Romanian; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [igi], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'romania-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Romanian citizenship through a Romanian parent',
        summary: 'A child of a Romanian citizen parent is Romanian. Separate restoration and origin routes exist for descendants of former citizens.',
        source: [constitution, igi],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '642' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'romania-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after eight years residence',
        summary: 'Adults generally need eight years legal residence (five if married to a Romanian), Romanian language and culture knowledge, livelihood, and good conduct. Dual nationality is generally allowed. Grant is discretionary.',
        source: [constitution, igi],
        eligibility: [
          { field: 'residence.legal_years', operator: 'gte', value: 8, unit: 'years' },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'romania-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Romanian parent',
        summary: 'Birth to a Romanian parent creates Romanian citizenship. Birth in Romania alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '642' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function andorraRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const government = requireSource(officialSources, OFFICIAL_URLS.andorra_government);
  const constitution = requireSource(officialSources, OFFICIAL_URLS.andorra_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '020',
    note: 'Reviewed against Andorran nationality framework. Long residence path; renunciation of prior nationality required. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, government] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, government] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Andorran; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [government], note: 'Residence by investment products are not citizenship.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'andorra-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Andorran nationality through an Andorran parent',
        summary: 'A child of an Andorran parent is Andorran under nationality law, subject to registration rules for birth abroad.',
        source: [constitution, government],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '020' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'andorra-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after long residence',
        summary: 'Ordinary naturalization generally requires about twenty years permanent residence (ten if educated in Andorra), integration, and renunciation of prior nationality. Grant is discretionary.',
        source: [constitution, government],
        eligibility: [
          { field: 'residence.permanent_years', operator: 'gte', value: 20, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 240,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'andorra-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Andorran parent',
        summary: 'Birth to an Andorran parent creates Andorran nationality. Birth in Andorra alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '020' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function finlandRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const migri = requireSource(officialSources, OFFICIAL_URLS.finland_citizenship);
  const residence = requireSource(officialSources, OFFICIAL_URLS.finland_period_of_residence);
  return reviewedCountryRecord({
    shadow,
    iso: '246',
    note: 'Reviewed against Migri citizenship guidance after the October 2024 residence reform. Dual nationality generally allowed. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [migri] },
      { mode: 'naturalization', finding: 'present', sources: [migri, residence] },
      { mode: 'birth', finding: 'present', sources: [migri], note: 'Parent Finnish; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [migri], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'finland-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Finnish citizenship through a Finnish parent',
        summary: 'A child of a Finnish citizen parent is Finnish under the Citizenship Act. Declaration routes also exist for former citizens and certain Nordic cases.',
        source: migri,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '246' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'finland-naturalization',
        mode: 'naturalization',
        title: 'Citizenship after eight years residence',
        summary: 'Adults generally need eight years legal residence in Finland. Five years can suffice with the required language skills, a Finnish spouse, or statelessness. Dual nationality is generally allowed. Grant is discretionary.',
        source: [migri, residence],
        eligibility: [
          { field: 'residence.legal_years', operator: 'gte', value: 8, unit: 'years' },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'finland-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Finnish parent',
        summary: 'Birth to a Finnish parent creates Finnish citizenship. Birth in Finland alone to two foreign parents is not general jus soli.',
        source: migri,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '246' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function estoniaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.estonia_citizenship_act);
  return reviewedCountryRecord({
    shadow,
    iso: '233',
    note: 'Reviewed against the Estonian Citizenship Act. Naturalizers must renounce prior nationality. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      { mode: 'birth', finding: 'present', sources: [act], note: 'Parent Estonian; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [act], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'estonia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Estonian citizenship through an Estonian parent',
        summary: 'A child of an Estonian citizen parent is Estonian under the Citizenship Act. Birth citizenship has different dual-nationality treatment than naturalization.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '233' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'estonia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after eight years residence',
        summary: 'Adults generally need eight years residence on a permit or right of residence, Estonian language and civics knowledge, permanent residence, livelihood, and renunciation of prior nationality. Grant follows statutory conditions.',
        source: act,
        eligibility: [
          { field: 'residence.legal_years', operator: 'gte', value: 8, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'estonia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Estonian parent',
        summary: 'Birth to an Estonian parent creates Estonian citizenship. Birth in Estonia alone to two foreign parents is not general jus soli.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '233' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function latviaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const pmlp = requireSource(officialSources, OFFICIAL_URLS.latvia_naturalisation);
  return reviewedCountryRecord({
    shadow,
    iso: '428',
    note: 'Reviewed against OCMA/PMLP naturalisation guidance. Dual nationality rules are limited and category-specific. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [pmlp] },
      { mode: 'naturalization', finding: 'present', sources: [pmlp] },
      { mode: 'birth', finding: 'present', sources: [pmlp], note: 'Parent Latvian; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [pmlp], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'latvia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Latvian citizenship through a Latvian parent',
        summary: 'A child of a Latvian citizen parent is Latvian under the Citizenship Law. Separate registration routes exist for certain descendants of former citizens.',
        source: pmlp,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '428' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'latvia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years permanent residence',
        summary: 'From age 15, applicants generally need five years permanent residence in Latvia, Latvian language and civics knowledge, livelihood, and loyalty. Dual nationality is limited to statutory categories. Grant follows examination and decision.',
        source: pmlp,
        eligibility: [
          { field: 'residence.permanent_years', operator: 'gte', value: 5, unit: 'years' },
          { field: 'language.latvian', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'latvia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Latvian parent',
        summary: 'Birth to a Latvian parent creates Latvian citizenship. Birth in Latvia alone to two foreign parents is not general jus soli.',
        source: pmlp,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '428' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function lithuaniaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const migracija = requireSource(officialSources, OFFICIAL_URLS.lithuania_migracija);
  const constitution = requireSource(officialSources, OFFICIAL_URLS.lithuania_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '440',
    note: 'Reviewed against Migration Department materials and Constitution. Naturalizers generally renounce prior nationality. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, migracija] },
      { mode: 'naturalization', finding: 'present', sources: [migracija, constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Lithuanian; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [migracija], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'lithuania-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Lithuanian citizenship through a Lithuanian parent',
        summary: 'A child of a Lithuanian citizen parent is Lithuanian. Separate restoration routes exist for pre-1940 citizens and their descendants.',
        source: [constitution, migracija],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '440' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'lithuania-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after ten years permanent residence',
        summary: 'Adults generally need ten years permanent legal residence (seven if married to a Lithuanian), permanent residence status, Lithuanian language and Constitution exams, livelihood, and renunciation of prior nationality after grant. Decision is discretionary.',
        source: [migracija, constitution],
        eligibility: [
          { field: 'residence.permanent_years', operator: 'gte', value: 10, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'lithuania-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Lithuanian parent',
        summary: 'Birth to a Lithuanian parent creates Lithuanian citizenship. Birth in Lithuania alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '440' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function croatiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const gov = requireSource(officialSources, OFFICIAL_URLS.croatia_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '191',
    note: 'Reviewed against gov.hr citizenship guidance. Ordinary residence naturalization generally requires renunciation. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [gov] },
      { mode: 'naturalization', finding: 'present', sources: [gov] },
      { mode: 'birth', finding: 'present', sources: [gov], note: 'Parent Croatian; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [gov], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'croatia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Croatian citizenship through a Croatian parent',
        summary: 'A child of a Croatian citizen parent is Croatian. Separate naturalization tracks exist for emigrant descendants and affiliation with the Croatian nation.',
        source: gov,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '191' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'croatia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after eight years residence',
        summary: 'Ordinary residence naturalization generally needs eight years continuous registered residence with permanent residence status, Croatian language and culture knowledge, and usually renunciation of prior nationality. Separate tracks exist for marriage, emigrants, and national interest.',
        source: gov,
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 8, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'croatia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Croatian parent',
        summary: 'Birth to a Croatian parent creates Croatian citizenship. Birth in Croatia alone to two foreign parents is not general jus soli.',
        source: gov,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '191' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function slovakiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const mic = requireSource(officialSources, OFFICIAL_URLS.slovakia_naturalization);
  const constitution = requireSource(officialSources, OFFICIAL_URLS.slovakia_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '703',
    note: 'Reviewed against IOM MIC naturalization guidance and Constitution. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, mic] },
      { mode: 'naturalization', finding: 'present', sources: [mic] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Slovak; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [mic], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'slovakia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Slovak citizenship through a Slovak parent',
        summary: 'A child of a Slovak citizen parent is Slovak. Descent and restoration routes also cover certain Czechoslovak-line ancestors and former citizens.',
        source: [constitution, mic],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '703' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'slovakia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after eight years permanent residence',
        summary: 'Adults generally need eight years continuous permanent residence immediately before applying, Slovak language knowledge, livelihood, and good conduct. Shorter paths exist for spouses and some descent categories. Grant is discretionary.',
        source: mic,
        eligibility: [
          { field: 'residence.permanent_years', operator: 'gte', value: 8, unit: 'years' },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'slovakia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Slovak parent',
        summary: 'Birth to a Slovak parent creates Slovak citizenship. Birth in Slovakia alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '703' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function luxembourgRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const guichet = requireSource(officialSources, OFFICIAL_URLS.luxembourg_naturalisation);
  return reviewedCountryRecord({
    shadow,
    iso: '442',
    note: 'Reviewed against Guichet.lu nationality naturalisation guidance. Dual nationality generally allowed. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [guichet] },
      { mode: 'naturalization', finding: 'present', sources: [guichet] },
      { mode: 'birth', finding: 'present', sources: [guichet], note: 'Parent Luxembourgish or conditional birth rules; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [guichet], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'luxembourg-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Luxembourgish nationality through a Luxembourgish parent',
        summary: 'A child of a Luxembourgish parent is Luxembourgish under the nationality law. Option and reclamation routes cover additional family and historical cases.',
        source: guichet,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '442' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'luxembourg-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Adults with five years legal residence (final year uninterrupted), Luxembourgish language certificate, and the Living Together course or exam may apply. Good repute rules apply. Dual nationality is generally allowed.',
        source: guichet,
        eligibility: [
          { field: 'residence.legal_years', operator: 'gte', value: 5, unit: 'years' },
          { field: 'language.luxembourgish', operator: 'eq', value: true },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'luxembourg-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Luxembourgish parent',
        summary: 'Birth to a Luxembourgish parent creates Luxembourgish nationality. Birth in Luxembourg alone to two foreign parents is not unrestricted jus soli.',
        source: guichet,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '442' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function monacoRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const portal = requireSource(officialSources, OFFICIAL_URLS.monaco_nationality);
  return reviewedCountryRecord({
    shadow,
    iso: '492',
    note: 'Reviewed against Monaco mon service public nationality guidance. Naturalization requires renunciation and is discretionary. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [portal] },
      { mode: 'naturalization', finding: 'present', sources: [portal] },
      { mode: 'birth', finding: 'present', sources: [portal], note: 'Parent Monegasque; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [portal], note: 'Residence products are not citizenship.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'monaco-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Monegasque nationality through a Monegasque parent',
        summary: 'A child of a Monegasque parent is Monegasque under nationality law, with detailed maternal and paternal transmission rules.',
        source: portal,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '492' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'monaco-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after ten years residence',
        summary: 'Adults with ordinary residence in Monaco for at least ten years after age eighteen may petition the Sovereign Prince. Naturalization is discretionary and requires renunciation of prior nationality and freedom from foreign military service obligations.',
        source: portal,
        eligibility: [
          { field: 'residence.ordinary_years_after_majority', operator: 'gte', value: 10, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'monaco-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Monegasque parent',
        summary: 'Birth to a Monegasque parent creates Monegasque nationality. Birth in Monaco alone to two foreign parents is not general jus soli.',
        source: portal,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '492' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function liechtensteinRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const llv = requireSource(officialSources, OFFICIAL_URLS.liechtenstein_naturalization);
  return reviewedCountryRecord({
    shadow,
    iso: '438',
    note: 'Reviewed against LLV naturalization guidance. Naturalization requires renunciation of prior nationality. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [llv] },
      { mode: 'naturalization', finding: 'present', sources: [llv] },
      { mode: 'birth', finding: 'present', sources: [llv], note: 'Parent Liechtenstein; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [llv], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'liechtenstein-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Liechtenstein citizenship through a Liechtenstein parent',
        summary: 'A child of a Liechtenstein citizen parent is Liechtenstein under nationality law, subject to registration rules for birth abroad.',
        source: llv,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '438' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'liechtenstein-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after long residence',
        summary: 'Ordinary naturalization is highly discretionary and typically involves about ten years residence plus municipal approval. Facilitated naturalization after about thirty years residence (years under twenty count double) or marriage routes also exist. Renunciation of prior nationality is required.',
        source: llv,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'liechtenstein-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Liechtenstein parent',
        summary: 'Birth to a Liechtenstein parent creates Liechtenstein citizenship. Birth in Liechtenstein alone to two foreign parents is not general jus soli.',
        source: llv,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '438' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function icelandRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const island = requireSource(officialSources, OFFICIAL_URLS.iceland_citizenship_when);
  const government = requireSource(officialSources, OFFICIAL_URLS.iceland_government_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '352',
    note: 'Reviewed against Island.is and Government of Iceland citizenship guidance. Dual nationality generally allowed. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [government, island] },
      { mode: 'naturalization', finding: 'present', sources: [island, government] },
      { mode: 'birth', finding: 'present', sources: [government], note: 'Parent Icelandic; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [government], note: 'No citizenship-by-investment.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'iceland-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Icelandic citizenship through an Icelandic parent',
        summary: 'A child of an Icelandic citizen parent is Icelandic under the Nationality Act. Separate routes exist for children of citizens living in Iceland and for restoration.',
        source: [government, island],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '352' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'iceland-naturalization',
        mode: 'naturalization',
        title: 'Citizenship after seven years residence',
        summary: 'Adults generally need seven years continuous legal domicile in Iceland, Icelandic language, self-support, and good conduct. Shorter periods apply for Nordic citizens, spouses, refugees, and other statutory categories. Dual nationality is generally allowed.',
        source: [island, government],
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'iceland-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Icelandic parent',
        summary: 'Birth to an Icelandic parent creates Icelandic citizenship. Birth in Iceland alone to two foreign parents is not general jus soli.',
        source: government,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '352' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function fijiRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const immigration = requireSource(officialSources, OFFICIAL_URLS.fiji_citizenship_registration);
  const foreignAffairs = requireSource(officialSources, OFFICIAL_URLS.fiji_foreign_affairs_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '242',
    note: 'Reviewed against Fiji Immigration and Foreign Affairs citizenship guidance. Dual nationality generally allowed. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [immigration] },
      { mode: 'naturalization', finding: 'present', sources: [immigration, foreignAffairs] },
      { mode: 'birth', finding: 'present', sources: [immigration], note: 'Parent Fijian; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [immigration], note: 'Investor permits are residence, not direct citizenship.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'fiji-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Fijian citizenship through a Fijian parent',
        summary: 'A child of a Fijian citizen parent may register as a citizen. Adult children of citizens use a registration track with residence conditions.',
        source: immigration,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '242' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'fiji-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five of ten years lawful presence',
        summary: 'Adults may naturalize after lawful presence in Fiji for a total of five of the ten years immediately before application (visitor and student time excluded). Dual nationality is generally allowed. Grant is discretionary.',
        source: [immigration, foreignAffairs],
        eligibility: [
          { field: 'residence.lawful_years_in_prior_ten', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'fiji-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Fijian parent',
        summary: 'Birth to a Fijian parent creates Fijian citizenship under nationality law. Birth in Fiji alone to two foreign parents is not unrestricted jus soli.',
        source: immigration,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '242' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function papuaNewGuineaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const eligibility = requireSource(officialSources, OFFICIAL_URLS.png_citizenship_eligibility);
  const dual = requireSource(officialSources, OFFICIAL_URLS.png_dual_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '598',
    note: 'Reviewed against PNG ICA citizenship guidance. Dual nationality limited to prescribed countries. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [eligibility] },
      { mode: 'naturalization', finding: 'present', sources: [eligibility, dual] },
      { mode: 'birth', finding: 'present', sources: [eligibility], note: 'Parent PNG citizen; not general jus soli.' },
      { mode: 'investment', finding: 'present', sources: [dual], note: 'Investor naturalization is a discretionary category, not a published buy-a-passport product.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'papua-new-guinea-citizenship-by-parent',
        mode: 'ancestry',
        title: 'PNG citizenship through a PNG parent',
        summary: 'A child of a Papua New Guinean citizen parent is a citizen under the Constitution and Citizenship Act, subject to registration rules for birth abroad.',
        source: eligibility,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '598' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'papua-new-guinea-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after eight years residence',
        summary: 'Adults with eight years continuous residence may apply. Applicants must show character, language or vernacular knowledge, respect for customs, self-support, civic knowledge, and generally renounce other citizenship unless dual nationality with a prescribed country is approved. Ministerial grant is discretionary.',
        source: [eligibility, dual],
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 8, unit: 'years' },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'papua-new-guinea-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a PNG parent',
        summary: 'Birth to a PNG citizen parent creates PNG citizenship. Birth in PNG alone to two foreign parents is not general jus soli.',
        source: eligibility,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '598' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'papua-new-guinea-investor-naturalization',
        mode: 'investment',
        title: 'Investor naturalization category',
        summary: 'PNG ICA lists an investor naturalization request form as a discretionary ministerial track. It is not a published fixed-price citizenship-by-investment programme and still depends on statutory naturalization conditions and Cabinet or ministerial approval.',
        source: dual,
        eligibility: [
          { field: 'programme.published_transactional_cbi', operator: 'eq', value: false },
        ],
        months: null,
        allocation: 'discretionary',
        status: 'pending_verification',
        confidence: 'medium',
        reviewState: 'pending',
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function solomonIslandsRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const gov = requireSource(officialSources, OFFICIAL_URLS.solomon_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '090',
    note: 'Reviewed against Solomon Islands government citizenship service guidance. Dual nationality reforms apply. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [gov] },
      { mode: 'naturalization', finding: 'present', sources: [gov] },
      { mode: 'birth', finding: 'present', sources: [gov], note: 'Parent Solomon Islands citizen; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [gov], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'solomon-islands-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Solomon Islands citizenship through a citizen parent',
        summary: 'A child of a Solomon Islands citizen parent is a citizen under nationality law, subject to registration rules.',
        source: gov,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '090' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'solomon-islands-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Adults generally need about five years residence (commonly framed as five of the preceding ten years), good character, and language or cultural integration. Dual nationality is now generally permitted. Grant is discretionary.',
        source: gov,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'solomon-islands-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a citizen parent',
        summary: 'Birth to a Solomon Islands citizen parent creates citizenship. Birth in the Solomon Islands alone to two foreign parents is not general jus soli.',
        source: gov,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '090' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function tongaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.tonga_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '776',
    note: 'Reviewed against the Tongan Constitution naturalization clause. Royal grant is discretionary. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Tongan; not unrestricted jus soli for foreigners.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'tonga-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Tongan nationality through a Tongan parent',
        summary: 'A child of a Tongan national parent is Tongan under nationality law, subject to registration rules for birth abroad.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '776' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'tonga-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Foreigners who have resided in Tonga for five years or more may, with the consent of the King, take the oath of allegiance and receive a certificate of naturalization. Language, character, and permanent settlement intent apply under the Nationality Act framework. Grant is highly discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'tonga-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Tongan parent',
        summary: 'Birth to a Tongan parent creates Tongan nationality. Birth in Tonga alone to two foreign parents is not a general open jus soli path for ordinary foreign residents.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '776' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function timorLesteRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.timor_leste_citizenship_law);
  const constitution = requireSource(officialSources, OFFICIAL_URLS.timor_leste_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '626',
    note: 'Reviewed against Timor-Leste Citizenship Law and Constitution. Dual nationality generally allowed. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, law] },
      { mode: 'naturalization', finding: 'present', sources: [law] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Original citizenship rules in Constitution; not unrestricted jus soli for all births.' },
      { mode: 'investment', finding: 'verified_none', sources: [law], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'timor-leste-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Timorese citizenship through a Timorese parent',
        summary: 'A child of a Timorese father or mother is an original citizen under the Constitution, including many births abroad in the direct line.',
        source: [constitution, law],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '626' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'timor-leste-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after ten years residence',
        summary: 'Adults generally need usual and regular residence for at least ten years after 20 May 2002 (or qualifying pre-1975 residence), official language ability, livelihood, good character, and knowledge of Timorese history and culture. Occupation-era transmigration residence does not count. Grant is discretionary.',
        source: law,
        eligibility: [
          { field: 'residence.regular_years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'timor-leste-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Original citizenship at birth through a Timorese parent',
        summary: 'Birth to a Timorese parent creates original citizenship under the Constitution. Additional birth-in-territory rules apply for certain parentage and declaration cases.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '626' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function bruneiRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.brunei_nationality_act);
  return reviewedCountryRecord({
    shadow,
    iso: '096',
    note: 'Reviewed against the Brunei Nationality Act. Naturalization requires long residence and renunciation of prior nationality. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      { mode: 'birth', finding: 'present', sources: [act], note: 'Parent Bruneian subject; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [act], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'brunei-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Bruneian nationality through a Bruneian parent',
        summary: 'A child of a subject of His Majesty is Bruneian under the Nationality Act, subject to registration rules for birth abroad.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '096' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'brunei-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after twenty years residence',
        summary: 'Adults generally need twenty years aggregate residence in the preceding twenty-five years, including the two years immediately before application, Malay language proficiency, good character, and intention to settle. Dual nationality is not recognized; prior nationality must cease. Grant is discretionary.',
        source: act,
        eligibility: [
          { field: 'residence.years_in_prior_twenty_five', operator: 'gte', value: 20, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 240,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'brunei-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Bruneian parent',
        summary: 'Birth to a Bruneian parent creates Bruneian nationality. Birth in Brunei alone to two foreign parents is not general jus soli.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '096' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function chinaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const law = requireSource(officialSources, OFFICIAL_URLS.china_nationality_law);
  return reviewedCountryRecord({
    shadow,
    iso: '156',
    note: 'Reviewed against the PRC Nationality Law (IMMD published text). Dual nationality not recognized. Naturalization is rare and discretionary. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [law] },
      { mode: 'naturalization', finding: 'present', sources: [law] },
      { mode: 'birth', finding: 'present', sources: [law], note: 'Parent Chinese or conditional birth rules; dual nationality not recognized.' },
      { mode: 'investment', finding: 'verified_none', sources: [law], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'china-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Chinese nationality through a Chinese parent',
        summary: 'A child of a Chinese national parent is Chinese under the Nationality Law, subject to rules for births abroad where the parent has settled abroad and acquired foreign nationality.',
        source: law,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '156' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'china-naturalization',
        mode: 'naturalization',
        title: 'Naturalization as a Chinese national',
        summary: 'Foreign nationals or stateless persons may apply if they are near relatives of Chinese nationals, have settled in China, or have other legitimate reasons, and are willing to abide by the Constitution and laws. Approved naturalizers must not retain foreign nationality. Grant is discretionary and uncommon.',
        source: law,
        eligibility: [
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: null,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'china-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Chinese parent',
        summary: 'Birth to a Chinese parent generally creates Chinese nationality. The PRC does not recognize dual nationality for Chinese nationals.',
        source: law,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '156' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function kiribatiRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.kiribati_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '296',
    note: 'Reviewed against Kiribati constitutional citizenship framework and published Citizenship Act practice. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Kiribati; descent rules apply.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'kiribati-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Kiribati citizenship through a Kiribati parent',
        summary: 'A child of a Kiribati citizen parent is a citizen under constitutional and Citizenship Act rules, subject to registration for some births abroad.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '296' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'kiribati-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after long permanent residence',
        summary: 'Adults of full capacity may apply after long permanent residence (commonly framed as about seven to ten years under the Citizenship Act and later amendments), language and character requirements, and intention to remain. Naturalizers generally renounce prior nationality. Grant is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.permanent_years', operator: 'gte', value: 10, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'kiribati-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Kiribati parent',
        summary: 'Birth to a Kiribati parent creates citizenship under nationality law. Birth in Kiribati alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '296' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function tuvaluRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.tuvalu_citizenship_act);
  return reviewedCountryRecord({
    shadow,
    iso: '798',
    note: 'Reviewed against the Tuvalu Citizenship Act. Dual nationality generally restricted for voluntary acquisition. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      { mode: 'birth', finding: 'present', sources: [act], note: 'Parent Tuvaluan; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [act], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'tuvalu-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Tuvaluan citizenship through a Tuvaluan parent',
        summary: 'A child of a Tuvaluan citizen parent is a citizen under the Constitution and Citizenship Act.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '798' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'tuvalu-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after seven years residence',
        summary: 'Adults may apply after about seven years legal residence, good character, knowledge of Tuvaluan laws and customs, and intention to reside permanently. Dual nationality from voluntary acts other than marriage is generally restricted. Grant is discretionary.',
        source: act,
        eligibility: [
          { field: 'residence.legal_years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'tuvalu-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Tuvaluan parent',
        summary: 'Birth to a Tuvaluan parent creates citizenship. Birth in Tuvalu alone to two foreign parents is not unrestricted jus soli.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '798' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function marshallIslandsRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.marshall_islands_citizenship_act);
  return reviewedCountryRecord({
    shadow,
    iso: '584',
    note: 'Reviewed against the Marshall Islands Citizenship Act. Naturalization requires renunciation and is numerically limited. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      { mode: 'birth', finding: 'present', sources: [act], note: 'Parent Marshallese; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [act], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'marshall-islands-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Marshallese citizenship through a Marshallese parent',
        summary: 'A child of a Marshall Islands citizen parent is a citizen under the Citizenship Act.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '584' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'marshall-islands-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after ten years residence',
        summary: 'Adults generally need about ten years ordinary residence, good character, Marshallese language and customs knowledge, self-support, and renunciation of prior nationality. Annual naturalization numbers are tightly limited. Cabinet grant is discretionary.',
        source: act,
        eligibility: [
          { field: 'residence.ordinary_years', operator: 'gte', value: 10, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'marshall-islands-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Marshallese parent',
        summary: 'Birth to a Marshallese parent creates citizenship. Birth in the Marshall Islands alone to two foreign parents is not general jus soli.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '584' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function palauRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.palau_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '585',
    note: 'Reviewed against Palau constitutional citizenship framework. Ordinary naturalization is limited to persons of Palauan ancestry. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution], note: 'Naturalization tracks are ancestry-limited, not open residence naturalization for unrelated foreigners.' },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Palauan; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'palau-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Palauan citizenship through a Palauan parent',
        summary: 'A child of a Palauan citizen parent is a citizen under constitutional citizenship rules, subject to dual-nationality declaration rules at majority in some cases.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '585' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'palau-naturalization',
        mode: 'naturalization',
        title: 'Naturalization limited to Palauan ancestry',
        summary: 'Palau does not operate an open residence naturalization path for unrelated foreigners. Statutory naturalization eligibility is limited to persons of recognized Palauan ancestry who meet age, residence, and other Citizenship Act conditions. Grant remains discretionary.',
        source: constitution,
        eligibility: [
          { field: 'ancestry.palauan_recognized', operator: 'eq', value: true },
        ],
        months: null,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'palau-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Palauan parent',
        summary: 'Birth to a Palauan parent creates citizenship. Birth in Palau alone to two foreign parents is not general jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '585' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function micronesiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const code = requireSource(officialSources, OFFICIAL_URLS.fsm_citizenship_code);
  return reviewedCountryRecord({
    shadow,
    iso: '583',
    note: 'Reviewed against FSM Code Title 7 citizenship provisions. Naturalization requires Congress recommendation. Dual nationality rules have been evolving. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [code] },
      { mode: 'naturalization', finding: 'present', sources: [code] },
      { mode: 'birth', finding: 'present', sources: [code], note: 'Parent FSM citizen; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [code], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'micronesia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'FSM citizenship through an FSM parent',
        summary: 'A child of an FSM citizen parent is a citizen under constitutional and code rules, subject to registration and dual-nationality choice rules in some cases.',
        source: code,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '583' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'micronesia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'The President may naturalize a person on Congress recommendation after at least five years lawful residence immediately before the petition, good character, knowledge of the Constitution and customs, and other statutory conditions. Naturalization is exceptional and highly discretionary.',
        source: code,
        eligibility: [
          { field: 'residence.legal_years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'micronesia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an FSM parent',
        summary: 'Birth to an FSM parent creates citizenship under the code. Birth in the FSM alone to two foreign parents is not general jus soli.',
        source: code,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '583' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function rwandaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const dgie = requireSource(officialSources, OFFICIAL_URLS.rwanda_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '646',
    note: 'Reviewed against Rwanda DGIE citizenship service guidance. Dual nationality generally allowed. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [dgie] },
      { mode: 'naturalization', finding: 'present', sources: [dgie] },
      { mode: 'birth', finding: 'present', sources: [dgie], note: 'Parent Rwandan; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [dgie], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'rwanda-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Rwandan nationality through a Rwandan parent',
        summary: 'A child of a Rwandan parent is Rwandan by origin. Separate origin and recovery routes exist for Rwandans in the diaspora.',
        source: dgie,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '646' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'rwanda-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after fifteen years residence',
        summary: 'Adults generally need about fifteen years consecutive legal residence with permits, good conduct, knowledge of Rwandan culture, and livelihood. Spouses of Rwandans use a shorter marriage track. Dual nationality is generally allowed. Grant is discretionary.',
        source: dgie,
        eligibility: [
          { field: 'residence.consecutive_years', operator: 'gte', value: 15, unit: 'years' },
        ],
        months: 180,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'rwanda-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Rwandan parent',
        summary: 'Birth to a Rwandan parent creates Rwandan nationality. Birth in Rwanda alone to two foreign parents is not unrestricted jus soli.',
        source: dgie,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '646' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function beninRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.benin_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '204',
    note: "Reviewed against Beninese constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Benin national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'benin-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Benin nationality through a Benin parent',
        summary: 'A child of a Benin parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '204' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'benin-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'benin-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Benin parent',
        summary: 'Birth to a Benin parent creates nationality. Birth in Benin alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '204' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function burkinaFasoRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.burkina_faso_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '854',
    note: "Reviewed against Burkinabe constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Burkina Faso national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'burkina-faso-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Burkina Faso nationality through a Burkina Faso parent',
        summary: 'A child of a Burkina Faso parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '854' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'burkina-faso-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'burkina-faso-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Burkina Faso parent',
        summary: 'Birth to a Burkina Faso parent creates nationality. Birth in Burkina Faso alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '854' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function congoRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.congo_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '178',
    note: "Reviewed against Congolese (Brazzaville) constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Republic of the Congo national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'congo-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Republic of the Congo nationality through a Republic of the Congo parent',
        summary: 'A child of a Republic of the Congo parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '178' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'congo-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'congo-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Republic of the Congo parent',
        summary: 'Birth to a Republic of the Congo parent creates nationality. Birth in Republic of the Congo alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '178' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function drcRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.drc_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '180',
    note: "Reviewed against DRC constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Democratic Republic of the Congo national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'drc-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Democratic Republic of the Congo nationality through a Democratic Republic of the Congo parent',
        summary: 'A child of a Democratic Republic of the Congo parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '180' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'drc-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 7 years residence',
        summary: 'Adults generally need about 7 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'drc-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Democratic Republic of the Congo parent',
        summary: 'Birth to a Democratic Republic of the Congo parent creates nationality. Birth in Democratic Republic of the Congo alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '180' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function eswatiniRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.eswatini_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '748',
    note: "Reviewed against Eswatini constitutional nationality framework (Constitute text still titled Swaziland). No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Eswatini national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'eswatini-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Eswatini nationality through a Eswatini parent',
        summary: 'A child of a Eswatini parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '748' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'eswatini-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'eswatini-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Eswatini parent',
        summary: 'Birth to a Eswatini parent creates nationality. Birth in Eswatini alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '748' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function gabonRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.gabon_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '266',
    note: "Reviewed against Gabonese constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Gabon national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'gabon-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Gabon nationality through a Gabon parent',
        summary: 'A child of a Gabon parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '266' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'gabon-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'gabon-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Gabon parent',
        summary: 'Birth to a Gabon parent creates nationality. Birth in Gabon alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '266' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function gambiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.gambia_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '270',
    note: "Reviewed against Gambian constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent The Gambia national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'gambia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'The Gambia nationality through a The Gambia parent',
        summary: 'A child of a The Gambia parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '270' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'gambia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'gambia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a The Gambia parent',
        summary: 'Birth to a The Gambia parent creates nationality. Birth in The Gambia alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '270' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function lesothoRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.lesotho_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '426',
    note: "Reviewed against Lesotho constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Lesotho national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'lesotho-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Lesotho nationality through a Lesotho parent',
        summary: 'A child of a Lesotho parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '426' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'lesotho-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'lesotho-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Lesotho parent',
        summary: 'Birth to a Lesotho parent creates nationality. Birth in Lesotho alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '426' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function liberiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.liberia_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '430',
    note: "Reviewed against Liberian constitutional nationality framework. No CBI. Naturalization historically restricted by racial criteria in secondary law; case-check current statute.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Liberia national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'liberia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Liberia nationality through a Liberia parent',
        summary: 'A child of a Liberia parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '430' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'liberia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'liberia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Liberia parent',
        summary: 'Birth to a Liberia parent creates nationality. Birth in Liberia alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '430' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function libyaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.libya_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '434',
    note: "Reviewed against Libyan constitutional/nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Libya national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'libya-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Libya nationality through a Libya parent',
        summary: 'A child of a Libya parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '434' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'libya-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'libya-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Libya parent',
        summary: 'Birth to a Libya parent creates nationality. Birth in Libya alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '434' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function madagascarRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.madagascar_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '450',
    note: "Reviewed against Malagasy constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Madagascar national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'madagascar-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Madagascar nationality through a Madagascar parent',
        summary: 'A child of a Madagascar parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '450' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'madagascar-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'madagascar-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Madagascar parent',
        summary: 'Birth to a Madagascar parent creates nationality. Birth in Madagascar alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '450' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function malawiRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.malawi_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '454',
    note: "Reviewed against Malawian constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Malawi national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'malawi-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Malawi nationality through a Malawi parent',
        summary: 'A child of a Malawi parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '454' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'malawi-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 7 years residence',
        summary: 'Adults generally need about 7 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'malawi-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Malawi parent',
        summary: 'Birth to a Malawi parent creates nationality. Birth in Malawi alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '454' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function maliRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.mali_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '466',
    note: "Reviewed against Malian constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Mali national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'mali-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Mali nationality through a Mali parent',
        summary: 'A child of a Mali parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '466' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'mali-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'mali-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Mali parent',
        summary: 'Birth to a Mali parent creates nationality. Birth in Mali alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '466' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function nigerRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.niger_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '562',
    note: "Reviewed against Nigerien constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Niger national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'niger-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Niger nationality through a Niger parent',
        summary: 'A child of a Niger parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '562' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'niger-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'niger-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Niger parent',
        summary: 'Birth to a Niger parent creates nationality. Birth in Niger alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '562' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function sierraLeoneRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.sierra_leone_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '694',
    note: "Reviewed against Sierra Leone constitutional nationality framework. No CBI. Secondary law has historically applied different residence floors by African descent; case-check current Citizenship Act.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Sierra Leone national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'sierra-leone-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Sierra Leone nationality through a Sierra Leone parent',
        summary: 'A child of a Sierra Leone parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '694' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'sierra-leone-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'sierra-leone-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Sierra Leone parent',
        summary: 'Birth to a Sierra Leone parent creates nationality. Birth in Sierra Leone alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '694' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function sudanRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.sudan_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '729',
    note: "Reviewed against Sudanese constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Sudan national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'sudan-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Sudan nationality through a Sudan parent',
        summary: 'A child of a Sudan parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '729' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'sudan-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'sudan-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Sudan parent',
        summary: 'Birth to a Sudan parent creates nationality. Birth in Sudan alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '729' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function togoRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.togo_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '768',
    note: "Reviewed against Togolese constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Togo national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'togo-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Togo nationality through a Togo parent',
        summary: 'A child of a Togo parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '768' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'togo-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative African nationality sources against the constitutional framework; case-check the current nationality statute for reductions (marriage, birth in country) and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'togo-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Togo parent',
        summary: 'Birth to a Togo parent creates nationality. Birth in Togo alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '768' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function cubaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.cuba_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '192',
    note: "Reviewed against Cuban constitutional citizenship framework. Naturalization is by statute and presidential discretion; ordinary multi-year residence is modeled as about five years. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Cuba national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'cuba-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Cuba nationality through a Cuba parent',
        summary: 'A child of a Cuba parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '192' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cuba-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'cuba-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Cuba parent',
        summary: 'Birth to a Cuba parent creates nationality. Birth in Cuba alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '192' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function equatorialGuineaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.equatorial_guinea_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '226',
    note: "Reviewed against Equatorial Guinean constitutional nationality framework. Ibero-American Spain beneficiary. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Equatorial Guinea national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'equatorial-guinea-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Equatorial Guinea nationality through a Equatorial Guinea parent',
        summary: 'A child of a Equatorial Guinea parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '226' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'equatorial-guinea-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'equatorial-guinea-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Equatorial Guinea parent',
        summary: 'Birth to a Equatorial Guinea parent creates nationality. Birth in Equatorial Guinea alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '226' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function sloveniaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.slovenia_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '705',
    note: "Reviewed against Slovenian constitutional nationality framework. EU member. Ordinary naturalization commonly about ten years residence with shorter tracks for spouses and Slovenian origin. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Slovenia national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'slovenia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Slovenia nationality through a Slovenia parent',
        summary: 'A child of a Slovenia parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '705' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'slovenia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'slovenia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Slovenia parent',
        summary: 'Birth to a Slovenia parent creates nationality. Birth in Slovenia alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '705' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function burundiRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.burundi_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '108',
    note: "Reviewed against Burundian constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Burundi national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'burundi-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Burundi nationality through a Burundi parent',
        summary: 'A child of a Burundi parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '108' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'burundi-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'burundi-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Burundi parent',
        summary: 'Birth to a Burundi parent creates nationality. Birth in Burundi alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '108' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function centralAfricanRepublicRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.central_african_republic_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '140',
    note: "Reviewed against Central African constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Central African Republic national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'central-african-republic-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Central African Republic nationality through a Central African Republic parent',
        summary: 'A child of a Central African Republic parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '140' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'central-african-republic-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'central-african-republic-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Central African Republic parent',
        summary: 'Birth to a Central African Republic parent creates nationality. Birth in Central African Republic alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '140' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function chadRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.chad_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '148',
    note: "Reviewed against Chadian constitutional nationality framework. Ordinary naturalization often modeled near fifteen years. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Chad national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'chad-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Chad nationality through a Chad parent',
        summary: 'A child of a Chad parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '148' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'chad-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 15 years residence',
        summary: 'Adults generally need about 15 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 15, unit: 'years' },
        ],
        months: 180,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'chad-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Chad parent',
        summary: 'Birth to a Chad parent creates nationality. Birth in Chad alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '148' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function comorosRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.comoros_constitution);
  const economicCitizenship = requireSource(
    officialSources,
    OFFICIAL_URLS.comoros_economic_citizenship_state,
  );
  return reviewedCountryRecord({
    shadow,
    iso: '174',
    note: 'Reviewed against Comorian constitutional nationality framework. Historical economic citizenship (passport sales) is modeled as an inactive investment route; it is not open to new applicants.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Comorian national; not unrestricted jus soli.' },
      {
        mode: 'investment',
        finding: 'present',
        sources: [constitution, economicCitizenship],
        note: 'A former economic-citizenship / passport-sale programme operated and was later suspended; no current open CBI is modeled as active.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'comoros-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Comorian nationality through a Comorian parent',
        summary: 'A child of a Comorian parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '174' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'comoros-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track; case-check the current nationality statute.',
      }),
      principalCitizenshipRoute({
        id: 'comoros-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Comorian parent',
        summary: 'Birth to a Comorian parent creates nationality. Birth in Comoros alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '174' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'comoros-economic-citizenship-closed',
        mode: 'investment',
        title: 'Former economic citizenship / passport programme (closed)',
        summary: 'Comoros previously operated an economic-citizenship programme under which foreigners obtained nationality and passports for payment. The programme was suspended; new grants are not treated as available. Existing grants remain a historical fact and should not be presented as a live CBI product.',
        source: [constitution, economicCitizenship],
        eligibility: [{ field: 'programme.accepting_new_applications', operator: 'eq', value: false }],
        months: null,
        allocation: 'discretionary',
        status: 'inactive',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Historical negative retained so the atlas does not treat Comoros as a current CBI market. Verify any claimed current programme against primary Comorian law before modeling it as active.',
      }),
    ],
  });
}


function djiboutiRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.djibouti_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '262',
    note: "Reviewed against Djiboutian constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Djibouti national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'djibouti-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Djibouti nationality through a Djibouti parent',
        summary: 'A child of a Djibouti parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '262' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'djibouti-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'djibouti-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Djibouti parent',
        summary: 'Birth to a Djibouti parent creates nationality. Birth in Djibouti alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '262' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function eritreaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.eritrea_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '232',
    note: "Reviewed against Eritrean constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Eritrea national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'eritrea-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Eritrea nationality through a Eritrea parent',
        summary: 'A child of a Eritrea parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '232' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'eritrea-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'eritrea-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Eritrea parent',
        summary: 'Birth to a Eritrea parent creates nationality. Birth in Eritrea alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '232' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function guineaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.guinea_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '324',
    note: "Reviewed against Guinean constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Guinea national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'guinea-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Guinea nationality through a Guinea parent',
        summary: 'A child of a Guinea parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '324' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'guinea-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'guinea-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Guinea parent',
        summary: 'Birth to a Guinea parent creates nationality. Birth in Guinea alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '324' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function guineaBissauRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.guinea_bissau_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '624',
    note: "Reviewed against Guinea-Bissau constitutional nationality framework. CPLP member. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Guinea-Bissau national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'guinea-bissau-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Guinea-Bissau nationality through a Guinea-Bissau parent',
        summary: 'A child of a Guinea-Bissau parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '624' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'guinea-bissau-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 6 years residence',
        summary: 'Adults generally need about 6 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 6, unit: 'years' },
        ],
        months: 72,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'guinea-bissau-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Guinea-Bissau parent',
        summary: 'Birth to a Guinea-Bissau parent creates nationality. Birth in Guinea-Bissau alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '624' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function mauritaniaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.mauritania_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '478',
    note: "Reviewed against Mauritanian constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Mauritania national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'mauritania-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Mauritania nationality through a Mauritania parent',
        summary: 'A child of a Mauritania parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '478' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'mauritania-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'mauritania-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Mauritania parent',
        summary: 'Birth to a Mauritania parent creates nationality. Birth in Mauritania alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '478' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function southSudanRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.south_sudan_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '728',
    note: "Reviewed against South Sudanese constitutional nationality framework. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent South Sudan national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'south-sudan-citizenship-by-parent',
        mode: 'ancestry',
        title: 'South Sudan nationality through a South Sudan parent',
        summary: 'A child of a South Sudan parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '728' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'south-sudan-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'south-sudan-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a South Sudan parent',
        summary: 'Birth to a South Sudan parent creates nationality. Birth in South Sudan alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '728' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function somaliaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.somalia_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '706',
    note: "Reviewed against Somali constitutional nationality framework. Federal nationality law remains fragmented in practice. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Somalia national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'somalia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Somalia nationality through a Somalia parent',
        summary: 'A child of a Somalia parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '706' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'somalia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 7 years residence',
        summary: 'Adults generally need about 7 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'somalia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Somalia parent',
        summary: 'Birth to a Somalia parent creates nationality. Birth in Somalia alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '706' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function albaniaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.albania_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '008',
    note: "Reviewed against Albanian constitutional nationality framework. Ordinary naturalization commonly about five years residence. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Albania national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme modeled.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'albania-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Albania nationality through a Albania parent',
        summary: 'A child of a Albania parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '008' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'albania-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'albania-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Albania parent',
        summary: 'Birth to a Albania parent creates nationality. Birth in Albania alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '008' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function bosniaHerzegovinaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.bosnia_herzegovina_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '070',
    note: "Reviewed against Bosnian constitutional nationality framework. Ordinary naturalization commonly about eight years continuous residence. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Bosnia and Herzegovina national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme modeled.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'bosnia-herzegovina-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Bosnia and Herzegovina nationality through a Bosnia and Herzegovina parent',
        summary: 'A child of a Bosnia and Herzegovina parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '070' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'bosnia-herzegovina-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 8 years residence',
        summary: 'Adults generally need about 8 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 8, unit: 'years' },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'bosnia-herzegovina-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Bosnia and Herzegovina parent',
        summary: 'Birth to a Bosnia and Herzegovina parent creates nationality. Birth in Bosnia and Herzegovina alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '070' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function northMacedoniaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.north_macedonia_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '807',
    note: "Reviewed against North Macedonian constitutional nationality framework (Constitute text may use Macedonia). Ordinary naturalization commonly about eight years. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent North Macedonia national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme modeled.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'north-macedonia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'North Macedonia nationality through a North Macedonia parent',
        summary: 'A child of a North Macedonia parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '807' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'north-macedonia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 8 years residence',
        summary: 'Adults generally need about 8 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 8, unit: 'years' },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'north-macedonia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a North Macedonia parent',
        summary: 'Birth to a North Macedonia parent creates nationality. Birth in North Macedonia alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '807' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function moldovaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.moldova_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '498',
    note: "Reviewed against Moldovan constitutional nationality framework. Ordinary naturalization commonly about ten years, with shorter tracks for spouses and Romanian/Moldovan origin categories in statute. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Moldova national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme modeled.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'moldova-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Moldova nationality through a Moldova parent',
        summary: 'A child of a Moldova parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '498' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'moldova-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'moldova-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Moldova parent',
        summary: 'Birth to a Moldova parent creates nationality. Birth in Moldova alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '498' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function montenegroRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.montenegro_constitution);
  const ecpClosure = requireSource(officialSources, OFFICIAL_URLS.montenegro_eu_report_2023);
  return reviewedCountryRecord({
    shadow,
    iso: '499',
    note: 'Reviewed against Montenegrin constitutional nationality framework. Ordinary naturalization commonly about ten years lawful residence. The former Economic Citizenship Programme is modeled as inactive (closed end-2022); it is not a current CBI product.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Montenegrin national; not unrestricted jus soli.' },
      {
        mode: 'investment',
        finding: 'present',
        sources: [constitution, ecpClosure],
        note: 'Economic Citizenship Programme operated and was discontinued; no active open CBI is modeled.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'montenegro-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Montenegrin nationality through a Montenegrin parent',
        summary: 'A child of a Montenegrin parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '499' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'montenegro-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 10 years residence',
        summary: 'Adults generally need about 10 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track; case-check the current nationality statute.',
      }),
      principalCitizenshipRoute({
        id: 'montenegro-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Montenegrin parent',
        summary: 'Birth to a Montenegrin parent creates nationality. Birth in Montenegro alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '499' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'montenegro-economic-citizenship-closed',
        mode: 'investment',
        title: 'Former Economic Citizenship Programme (closed)',
        summary: 'Montenegro operated an Economic Citizenship Programme allowing foreign investors to acquire citizenship by admission for investment of special state importance. The programme stopped accepting new applications after 31 December 2022. It must not be recommended as a live CBI path.',
        source: [constitution, ecpClosure],
        eligibility: [{ field: 'programme.accepting_new_applications', operator: 'eq', value: false }],
        months: null,
        allocation: 'discretionary',
        status: 'inactive',
        lastChecked: '2026-07-22',
        note: 'Historical negative retained to prevent stale passport-for-investment recommendations. The European Commission 2023 Montenegro Report records the programme as discontinued.',
      }),
    ],
  });
}


function ukraineRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.ukraine_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '804',
    note: "Reviewed against Ukrainian constitutional nationality framework. Ordinary naturalization commonly about five years continuous residence; wartime and origin-based tracks exist in statute. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Ukraine national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme modeled.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'ukraine-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Ukraine nationality through a Ukraine parent',
        summary: 'A child of a Ukraine parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '804' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'ukraine-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'ukraine-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Ukraine parent',
        summary: 'Birth to a Ukraine parent creates nationality. Birth in Ukraine alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '804' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function belizeRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.belize_constitution);
  const abolition = requireSource(
    officialSources,
    OFFICIAL_URLS.belize_economic_citizenship_abolition,
  );
  const immigration = requireSource(
    officialSources,
    OFFICIAL_URLS.belize_immigration_citizenship,
  );
  return reviewedCountryRecord({
    shadow,
    iso: '084',
    note: 'Reviewed against Belize nationality framework and the Economic Citizenship (Abolition of Rights) Act 2023. Ordinary naturalization commonly about five years residence. Historical BECIP economic citizenship is modeled as inactive; there is no current open CBI product.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution, immigration] },
      { mode: 'naturalization', finding: 'present', sources: [constitution, immigration] },
      { mode: 'birth', finding: 'present', sources: [constitution, immigration], note: 'Parent Belizean national / constitutional birth rules; not marketed as unrestricted jus soli for all foreign parents.' },
      {
        mode: 'investment',
        finding: 'present',
        sources: [abolition, immigration],
        note: 'Belize Economic Citizenship Investment Programme ended in 2001; the 2023 Act abolishes further nationality claims derived from those grants. Investor or QRP residence is not direct citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'belize-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Belizean nationality through a Belizean parent',
        summary: 'A child of a Belizean parent is a national under the constitutional nationality framework and nationality statute, subject to registration where birth is abroad.',
        source: [constitution, immigration],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '084' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'belize-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about five years residence or permanent residence before ordinary naturalization under the Belizean Nationality Act framework, plus character and other statutory conditions. Marriage to a Belizean has a shorter track. Grant is discretionary.',
        source: [constitution, immigration],
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Immigration Department eligibility pages list descent, marriage, and residence tracks; case-check current Nationality Act practice.',
      }),
      principalCitizenshipRoute({
        id: 'belize-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Belizean parent',
        summary: 'Birth to a Belizean parent creates nationality under the constitutional and nationality-act framework.',
        source: [constitution, immigration],
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '084' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'belize-economic-citizenship-closed',
        mode: 'investment',
        title: 'Former Economic Citizenship Investment Programme (closed)',
        summary: 'Belize previously operated the Belize Economic Citizenship Investment Programme (BECIP). It was ended in 2001 under constitutional and nationality amendments. The Economic Citizenship (Abolition of Rights) Act 2023 abolishes further nationality claims based on descent or marriage traced to a person who obtained nationality by economic citizenship. There is no current open CBI product.',
        source: [abolition, immigration],
        eligibility: [{ field: 'programme.accepting_new_applications', operator: 'eq', value: false }],
        months: null,
        allocation: 'discretionary',
        status: 'inactive',
        lastChecked: '2026-07-22',
        note: 'Historical negative retained so Belize is not recommended as live CBI. QRP or investor residence remain immigration products that may lead only to ordinary naturalization later.',
      }),
    ],
  });
}


function guyanaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.guyana_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '328',
    note: "Reviewed against Guyanese constitutional nationality framework. Ordinary naturalization commonly about seven years. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Guyana national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme modeled.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'guyana-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Guyana nationality through a Guyana parent',
        summary: 'A child of a Guyana parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '328' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'guyana-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 7 years residence',
        summary: 'Adults generally need about 7 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'guyana-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Guyana parent',
        summary: 'Birth to a Guyana parent creates nationality. Birth in Guyana alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '328' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function haitiRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.haiti_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '332',
    note: "Reviewed against Haitian constitutional nationality framework. Ordinary naturalization commonly about five years. Dual nationality rules have been reformed; case-check current statute. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Haiti national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme modeled.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'haiti-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Haiti nationality through a Haiti parent',
        summary: 'A child of a Haiti parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '332' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'haiti-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'haiti-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Haiti parent',
        summary: 'Birth to a Haiti parent creates nationality. Birth in Haiti alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '332' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function jamaicaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.jamaica_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '388',
    note: 'Reviewed against Jamaican constitutional nationality framework. Ordinary naturalization commonly about five years residence. Jamaica is not an OECS CIP state and has no official citizenship-by-investment unit.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Jamaican national; not unrestricted jus soli.' },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No official CIP/CBI programme. Unlike St Kitts, Antigua, Dominica, Grenada, and St Lucia, Jamaica does not operate a contribution-based citizenship unit.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'jamaica-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Jamaica nationality through a Jamaica parent',
        summary: 'A child of a Jamaica parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '388' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'jamaica-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'jamaica-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Jamaica parent',
        summary: 'Birth to a Jamaica parent creates nationality. Birth in Jamaica alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '388' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function saintVincentRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.saint_vincent_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '670',
    note: 'Reviewed against Vincentian constitutional nationality framework. Ordinary naturalization commonly about seven years. SVG has no official CIP unit; the government has publicly opposed introducing CBI (unlike other OECS CIP states).',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Vincentian national; not unrestricted jus soli.' },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No official CIP/CBI programme or contribution unit. Do not confuse with St Kitts, Antigua, Dominica, Grenada, or St Lucia.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'saint-vincent-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Saint Vincent and the Grenadines nationality through a Saint Vincent and the Grenadines parent',
        summary: 'A child of a Saint Vincent and the Grenadines parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '670' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'saint-vincent-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 7 years residence',
        summary: 'Adults generally need about 7 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'saint-vincent-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Saint Vincent and the Grenadines parent',
        summary: 'Birth to a Saint Vincent and the Grenadines parent creates nationality. Birth in Saint Vincent and the Grenadines alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '670' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function surinameRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.suriname_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '740',
    note: "Reviewed against Surinamese constitutional nationality framework. Ordinary naturalization commonly about five years. No CBI.",
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Suriname national; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme modeled.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'suriname-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Suriname nationality through a Suriname parent',
        summary: 'A child of a Suriname parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '740' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'suriname-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 5 years residence',
        summary: 'Adults generally need about 5 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'suriname-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Suriname parent',
        summary: 'Birth to a Suriname parent creates nationality. Birth in Suriname alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '740' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function trinidadAndTobagoRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.trinidad_and_tobago_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '780',
    note: 'Reviewed against Trinidad and Tobago constitutional nationality framework. Ordinary naturalization commonly about eight years residence (shorter marriage tracks exist). No official CIP/CBI programme.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Trinidad and Tobago national; not unrestricted jus soli.' },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [constitution],
        note: 'No official citizenship-by-investment unit or contribution programme. Investor residence, if any, is not direct citizenship.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'trinidad-and-tobago-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Trinidad and Tobago nationality through a Trinidad and Tobago parent',
        summary: 'A child of a Trinidad and Tobago parent is a national under the constitutional nationality framework and nationality statute.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '780' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'trinidad-and-tobago-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after about 8 years residence',
        summary: 'Adults generally need about 8 years lawful residence before ordinary naturalization, plus character, language or integration, and other statutory conditions. Grant is discretionary under the nationality law.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 8, unit: 'years' },
        ],
        months: 96,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
        confidence: 'medium',
        note: 'Residence floor modeled from the ordinary naturalization track in comparative nationality sources against the constitutional framework; case-check the current nationality statute for reductions and renunciation rules.',
      }),
      principalCitizenshipRoute({
        id: 'trinidad-and-tobago-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Trinidad and Tobago parent',
        summary: 'Birth to a Trinidad and Tobago parent creates nationality. Birth in Trinidad and Tobago alone to two foreign parents is not unrestricted jus soli under the modeled framework.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '780' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function senegalRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.senegal_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '686',
    note: 'Reviewed against Senegalese nationality framework. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Senegalese; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'senegal-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Senegalese nationality through a Senegalese parent',
        summary: 'A child of a Senegalese parent is Senegalese under the nationality code.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '686' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'senegal-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after ten years residence',
        summary: 'Adults generally need about ten years ordinary residence in Senegal. Five years can suffice for spouses, public-service cases, or exceptional contribution. Naturalization is by decree and discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.ordinary_years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'senegal-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Senegalese parent',
        summary: 'Birth to a Senegalese parent creates Senegalese nationality. Birth in Senegal alone to two foreign parents is not unrestricted jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '686' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function botswanaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.botswana_citizenship_act);
  return reviewedCountryRecord({
    shadow,
    iso: '072',
    note: 'Reviewed against the Botswana Citizenship Act. Dual nationality rules are limited for adults. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      { mode: 'birth', finding: 'present', sources: [act], note: 'Parent Motswana; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [act], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'botswana-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Botswana citizenship through a Motswana parent',
        summary: 'A child of a Botswana citizen parent is a citizen under the Citizenship Act.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '072' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'botswana-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after ten years residence',
        summary: 'Adults need twelve months continuous residence immediately before application and at least ten years aggregate residence in the preceding twelve years, plus good character and knowledge of Setswana or a tribal language. Ministerial grant is discretionary.',
        source: act,
        eligibility: [
          { field: 'residence.aggregate_years_in_prior_twelve', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'botswana-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Motswana parent',
        summary: 'Birth to a Botswana citizen parent creates citizenship. Birth in Botswana alone to two foreign parents is not general jus soli.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '072' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function namibiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.namibia_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '516',
    note: 'Reviewed against Namibian Constitution citizenship provisions. Naturalizers renounce prior nationality. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Namibian or conditional birth rules; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'namibia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Namibian citizenship through a Namibian parent',
        summary: 'A child of a Namibian citizen parent is a citizen by descent under the Constitution and Citizenship Act.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '516' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'namibia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after ten years ordinary residence',
        summary: 'Adults generally need ten years ordinary residence (not mere temporary permits), legal entry, good character, and renunciation of prior nationality. Ministerial grant is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.ordinary_years', operator: 'gte', value: 10, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'namibia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Namibian parent',
        summary: 'Birth to a Namibian parent creates citizenship. Birth in Namibia alone to two foreign parents is not unrestricted jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '516' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function ethiopiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const proclamation = requireSource(officialSources, OFFICIAL_URLS.ethiopia_nationality_proclamation);
  return reviewedCountryRecord({
    shadow,
    iso: '231',
    note: 'Reviewed against Proclamation No. 378/2003 on Ethiopian Nationality. Dual nationality not recognized. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [proclamation] },
      { mode: 'naturalization', finding: 'present', sources: [proclamation] },
      { mode: 'birth', finding: 'present', sources: [proclamation], note: 'Parent Ethiopian; not general jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [proclamation], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'ethiopia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Ethiopian nationality through an Ethiopian parent',
        summary: 'A child of an Ethiopian parent is Ethiopian by descent under the Nationality Proclamation.',
        source: proclamation,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '231' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'ethiopia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after four years domicile',
        summary: 'Adults generally need about four years domicile in Ethiopia, lawful income, good character, ability to communicate in a national language, and release from prior nationality. Dual nationality is not recognized. Grant is discretionary.',
        source: proclamation,
        eligibility: [
          { field: 'residence.domicile_years', operator: 'gte', value: 4, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 48,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'ethiopia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Ethiopian parent',
        summary: 'Birth to an Ethiopian parent creates Ethiopian nationality. Birth in Ethiopia alone to two foreign parents is not general jus soli.',
        source: proclamation,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '231' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function tanzaniaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const immigration = requireSource(officialSources, OFFICIAL_URLS.tanzania_naturalization);
  return reviewedCountryRecord({
    shadow,
    iso: '834',
    note: 'Reviewed against Tanzania Immigration naturalization guidance. Dual nationality not allowed for adults. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [immigration] },
      { mode: 'naturalization', finding: 'present', sources: [immigration] },
      { mode: 'birth', finding: 'present', sources: [immigration], note: 'Parent Tanzanian; not unrestricted jus soli in practice.' },
      { mode: 'investment', finding: 'verified_none', sources: [immigration], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'tanzania-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Tanzanian citizenship through a Tanzanian parent',
        summary: 'A child of a Tanzanian citizen parent is a citizen by descent under the Citizenship Act.',
        source: immigration,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '834' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'tanzania-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after seven years residence',
        summary: 'Adults need twelve months residence immediately before application and at least seven years aggregate residence in the preceding ten years, plus language, character, and intention to remain. Adults generally may not retain another nationality. Grant is discretionary.',
        source: immigration,
        eligibility: [
          { field: 'residence.years_in_prior_ten', operator: 'gte', value: 7, unit: 'years' },
          { field: 'prior_nationality.renounced_or_will_cease', operator: 'eq', value: true },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'tanzania-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Tanzanian parent',
        summary: 'Birth to a Tanzanian parent creates citizenship. Birth in Tanzania alone to two foreign parents is not treated as open jus soli in practice.',
        source: immigration,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '834' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function ugandaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const immigration = requireSource(officialSources, OFFICIAL_URLS.uganda_naturalization);
  return reviewedCountryRecord({
    shadow,
    iso: '800',
    note: 'Reviewed against Uganda Immigration naturalization guidance. Dual nationality generally allowed. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [immigration] },
      { mode: 'naturalization', finding: 'present', sources: [immigration] },
      { mode: 'birth', finding: 'present', sources: [immigration], note: 'Parent Ugandan or constitutional birth categories; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [immigration], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'uganda-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Ugandan citizenship through a Ugandan parent',
        summary: 'A child of a Ugandan citizen parent is a citizen under the Constitution and Citizenship and Immigration Control Act. Separate registration tracks exist for some long-resident families.',
        source: immigration,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '800' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'uganda-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after twenty years residence',
        summary: 'Adults generally need about twenty years aggregate residence and twenty-four months continuous residence immediately before application, plus language, character, and integration conditions. Dual nationality is generally allowed. Grant is discretionary.',
        source: immigration,
        eligibility: [
          { field: 'residence.aggregate_years', operator: 'gte', value: 20, unit: 'years' },
        ],
        months: 240,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'uganda-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Ugandan parent',
        summary: 'Birth to a Ugandan parent creates citizenship under constitutional categories. Birth in Uganda alone to two foreign parents is not unrestricted jus soli.',
        source: immigration,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '800' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}


function algeriaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const code = requireSource(officialSources, OFFICIAL_URLS.algeria_nationality_code);
  return reviewedCountryRecord({
    shadow,
    iso: '012',
    note: 'Reviewed against the Algerian Nationality Code. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [code] },
      { mode: 'naturalization', finding: 'present', sources: [code] },
      { mode: 'birth', finding: 'present', sources: [code], note: 'Parent Algerian; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [code], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'algeria-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Algerian nationality through an Algerian parent',
        summary: 'A child of an Algerian parent is Algerian under the Nationality Code.',
        source: code,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '012' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'algeria-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after seven years residence',
        summary: 'Adults generally need seven years residence in Algeria, assimilation into Algerian society, livelihood, good character, and majority. Naturalization is by decree and discretionary.',
        source: code,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 7, unit: 'years' },
        ],
        months: 84,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'algeria-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Algerian parent',
        summary: 'Birth to an Algerian parent creates Algerian nationality. Birth in Algeria alone to two foreign parents is not unrestricted jus soli.',
        source: code,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '012' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function tunisiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.tunisia_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '788',
    note: 'Reviewed against Tunisian constitutional nationality framework. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Tunisian; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'tunisia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Tunisian nationality through a Tunisian parent',
        summary: 'A child of a Tunisian parent is Tunisian under nationality law.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '788' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'tunisia-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Adults generally need about five years continuous residence in Tunisia, integration, livelihood, and good character under the Nationality Code. Naturalization is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'tunisia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Tunisian parent',
        summary: 'Birth to a Tunisian parent creates Tunisian nationality. Birth in Tunisia alone to two foreign parents is not unrestricted jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '788' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function coteDivoireRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.cote_divoire_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '384',
    note: 'Reviewed against Ivorian constitutional nationality framework. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Ivorian; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'cote-divoire-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Ivorian nationality through an Ivorian parent',
        summary: 'A child of an Ivorian parent is Ivorian under nationality law.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '384' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cote-divoire-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Adults generally need about five years residence in Cote dIvoire, good character, and integration under the nationality code. Naturalization is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cote-divoire-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Ivorian parent',
        summary: 'Birth to an Ivorian parent creates Ivorian nationality. Birth in Cote dIvoire alone to two foreign parents is not unrestricted jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '384' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function zambiaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const act = requireSource(officialSources, OFFICIAL_URLS.zambia_citizenship_act);
  return reviewedCountryRecord({
    shadow,
    iso: '894',
    note: 'Reviewed against the Citizenship of Zambia Act 2016. Dual citizenship generally allowed since 2016. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [act] },
      { mode: 'naturalization', finding: 'present', sources: [act] },
      { mode: 'birth', finding: 'present', sources: [act], note: 'Parent Zambian or birth categories under the Constitution and Act.' },
      { mode: 'investment', finding: 'verified_none', sources: [act], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'zambia-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Zambian citizenship through a Zambian parent',
        summary: 'A child of a Zambian citizen parent is a citizen under the Constitution and Citizenship Act. Registration and bestowal routes also cover some diaspora cases.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '894' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'zambia-naturalization',
        mode: 'naturalization',
        title: 'Citizenship by registration after ten years residence',
        summary: 'Adults may apply for registration after about ten years continuous ordinary residence in Zambia, or five years in some descent, birth-in-Zambia, or marriage categories. Dual citizenship is generally allowed. Grant follows Citizenship Board process.',
        source: act,
        eligibility: [
          { field: 'residence.continuous_years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'zambia-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Zambian parent',
        summary: 'Birth to a Zambian parent creates citizenship under constitutional categories. Birth in Zambia alone to two foreign parents is not unrestricted open jus soli for all cases.',
        source: act,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '894' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function zimbabweRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.zimbabwe_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '716',
    note: 'Reviewed against the 2013 Constitution. Dual nationality is generally allowed for citizens by birth; registration tracks are more restrictive under older Act practice. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Zimbabwean or constitutional birth categories.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'zimbabwe-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Zimbabwean citizenship through a Zimbabwean parent',
        summary: 'A child of a Zimbabwean citizen parent is a citizen under the Constitution. Dual nationality is generally permitted for citizens by birth.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '716' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'zimbabwe-naturalization',
        mode: 'naturalization',
        title: 'Citizenship by registration after long residence',
        summary: 'Adults may apply for citizenship by registration after long ordinary residence (commonly five years under the Citizenship Act framework; reform proposals have discussed longer periods). Dual nationality for registration cases is more restricted than for birth citizens. Grant is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.ordinary_years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'zimbabwe-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Zimbabwean parent',
        summary: 'Birth to a Zimbabwean parent creates citizenship under the Constitution. Additional birth categories exist for some SADC-parent historical cases.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '716' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function angolaRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.angola_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '024',
    note: 'Reviewed against Angolan constitutional nationality framework. Ordinary naturalization after long residence. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Angolan; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'angola-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Angolan nationality through an Angolan parent',
        summary: 'A child of an Angolan parent is Angolan under nationality law.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '024' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'angola-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after ten years residence',
        summary: 'Adults generally need about ten years habitual and regular residence, Portuguese language and civic knowledge, livelihood, and good character. Naturalization is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.regular_years', operator: 'gte', value: 10, unit: 'years' },
        ],
        months: 120,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'angola-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through an Angolan parent',
        summary: 'Birth to an Angolan parent creates Angolan nationality. Birth in Angola alone to two foreign parents is not unrestricted jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '024' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function caboVerdeRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const guide = requireSource(officialSources, OFFICIAL_URLS.cabo_verde_citizenship);
  return reviewedCountryRecord({
    shadow,
    iso: '132',
    note: 'Reviewed against Cape Verde embassy citizenship overview. Dual nationality generally allowed. No formal open CIP/CBI unit is modeled; investment may support residence and later ordinary naturalization only.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [guide] },
      { mode: 'naturalization', finding: 'present', sources: [guide] },
      { mode: 'birth', finding: 'present', sources: [guide], note: 'Parent Cape Verdean or conditional birth rules.' },
      {
        mode: 'investment',
        finding: 'verified_none',
        sources: [guide],
        note: 'No official mass-market CBI programme with published contribution tiers is treated as active. Large investment may support residence or discretionary nationality claims under nationality law, but that is not modeled as passport-for-cash CBI.',
      },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'cabo-verde-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Cape Verdean nationality through a Cape Verdean parent',
        summary: 'A child of a Cape Verdean parent is Cape Verdean. Choice and diaspora routes also cover some grandchildren.',
        source: guide,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '132' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cabo-verde-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Adults who habitually reside in Cape Verde for at least five years, with moral fitness and capacity to support themselves, may seek naturalization. Dual nationality is generally allowed. Grant is discretionary.',
        source: guide,
        eligibility: [
          { field: 'residence.habitual_years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cabo-verde-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Cape Verdean parent',
        summary: 'Birth to a Cape Verdean parent creates nationality. Additional birth-in-territory choice rules exist for some long-resident foreign-parent cases.',
        source: guide,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '132' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function seychellesRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const ics = requireSource(officialSources, OFFICIAL_URLS.seychelles_citizenship_faq);
  return reviewedCountryRecord({
    shadow,
    iso: '690',
    note: 'Reviewed against Seychelles Immigration and Civil Status citizenship FAQ. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [ics] },
      { mode: 'naturalization', finding: 'present', sources: [ics] },
      { mode: 'birth', finding: 'present', sources: [ics], note: 'Parent Seychellois; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [ics], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'seychelles-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Seychellois citizenship through a Seychellois parent',
        summary: 'A child of a Seychellois citizen parent is a citizen under constitutional and nationality rules.',
        source: ics,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '690' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'seychelles-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after fifteen years residence',
        summary: 'Ordinary naturalization generally needs about fifteen years aggregate residence, a citizenship exam (about 80 percent in Creole, English, or French), and good character. Marriage tracks use different residence and marriage-length conditions. Grant is discretionary.',
        source: ics,
        eligibility: [
          { field: 'residence.aggregate_years', operator: 'gte', value: 15, unit: 'years' },
        ],
        months: 180,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'seychelles-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Seychellois parent',
        summary: 'Birth to a Seychellois parent creates citizenship. Birth in Seychelles alone to two foreign parents is not unrestricted jus soli.',
        source: ics,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '690' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function cameroonRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const justice = requireSource(officialSources, OFFICIAL_URLS.cameroon_who_is_cameroonian);
  return reviewedCountryRecord({
    shadow,
    iso: '120',
    note: 'Reviewed against Cameroon Ministry of Justice nationality guidance. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [justice] },
      { mode: 'naturalization', finding: 'present', sources: [justice] },
      { mode: 'birth', finding: 'present', sources: [justice], note: 'Parent Cameroonian; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [justice], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'cameroon-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Cameroonian nationality through a Cameroonian parent',
        summary: 'A child of a Cameroonian parent is Cameroonian under the Nationality Code.',
        source: justice,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '120' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cameroon-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years permanent residence',
        summary: 'Foreign adults who have permanently resided in Cameroon for five consecutive years may request naturalization from the Minister of Justice. The file must show identity, family status, and reasons for seeking nationality. Grant is discretionary.',
        source: justice,
        eligibility: [
          { field: 'residence.permanent_consecutive_years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'cameroon-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Cameroonian parent',
        summary: 'Birth to a Cameroonian parent creates nationality. Birth in Cameroon alone to two foreign parents is not unrestricted jus soli.',
        source: justice,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '120' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
    ],
  });
}

function mozambiqueRecord(shadow: DataShadow, officialSources: SourceRecord[]): JurisdictionRecord {
  const constitution = requireSource(officialSources, OFFICIAL_URLS.mozambique_constitution);
  return reviewedCountryRecord({
    shadow,
    iso: '508',
    note: 'Reviewed against Mozambican constitutional nationality provisions. No CBI.',
    coverage: [
      { mode: 'ancestry', finding: 'present', sources: [constitution] },
      { mode: 'naturalization', finding: 'present', sources: [constitution] },
      { mode: 'birth', finding: 'present', sources: [constitution], note: 'Parent Mozambican; not unrestricted jus soli.' },
      { mode: 'investment', finding: 'verified_none', sources: [constitution], note: 'No citizenship-by-investment programme.' },
    ],
    routes: [
      principalCitizenshipRoute({
        id: 'mozambique-citizenship-by-parent',
        mode: 'ancestry',
        title: 'Mozambican nationality through a Mozambican parent',
        summary: 'A child of a Mozambican parent is Mozambican under the Constitution and nationality law.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '508' }],
        months: 0,
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'mozambique-naturalization',
        mode: 'naturalization',
        title: 'Naturalization after five years residence',
        summary: 'Adults generally need about five years residence, Portuguese or local language knowledge, livelihood, and good character. Marriage tracks and other categories also exist. Naturalization is discretionary.',
        source: constitution,
        eligibility: [
          { field: 'residence.years', operator: 'gte', value: 5, unit: 'years' },
        ],
        months: 60,
        allocation: 'discretionary',
        lastChecked: '2026-07-22',
      }),
      principalCitizenshipRoute({
        id: 'mozambique-citizenship-at-birth-by-parent',
        mode: 'birth',
        title: 'Citizenship at birth through a Mozambican parent',
        summary: 'Birth to a Mozambican parent creates nationality. Birth in Mozambique alone to two foreign parents is not unrestricted jus soli.',
        source: constitution,
        eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '508' }],
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
      {
        mode: 'investment',
        finding: 'present',
        sources: [termination],
        note: 'The Cyprus Investment Programme stopped accepting new applications from 1 November 2020; modeled as inactive investment route.',
      },
    ],
    routes: [
      principalCitizenshipRoute({ id: 'cyprus-citizenship-by-origin', mode: 'ancestry', title: 'Cypriot citizenship due to origin', summary: 'Cypriot-origin registration routes cover people born abroad and specified descendants, using the applicable M121, M123, M124 or M126 procedure.', source: origin, eligibility: [{ field: 'ancestor.citizenship_or_origin.iso_n3', operator: 'eq', value: '196' }], months: 0 }),
      principalCitizenshipRoute({ id: 'cyprus-naturalization-by-residence', mode: 'naturalization', title: 'Cypriot naturalization by residence', summary: 'The ordinary route requires twelve continuous months immediately before application and at least seven cumulative lawful years in the preceding ten years, plus language, civic, character and resources tests.', source: naturalization, eligibility: [{ field: 'residence.immediately_preceding_months', operator: 'gte', value: 12, unit: 'months' }, { field: 'residence.prior_ten_years_months', operator: 'gte', value: 84, unit: 'months' }, { field: 'language.greek_level', operator: 'eq', value: 'B1' }], months: 96, allocation: 'discretionary' }),
      principalCitizenshipRoute({ id: 'cyprus-citizenship-at-birth-by-parent', mode: 'birth', title: 'Citizenship at birth through a Cypriot parent', summary: 'A person born abroad after 16 August 1960 can use the consular-birth route where a mother or father was a Cypriot citizen at the time of birth, subject to statutory exceptions and registration.', source: origin, eligibility: [{ field: 'parent.citizenship.iso_n3', operator: 'eq', value: '196' }, { field: 'parent.citizenship_at_child_birth', operator: 'eq', value: true }], months: 0 }),
      principalCitizenshipRoute({
        id: 'cyprus-investment-programme-closed',
        mode: 'investment',
        title: 'Former Cyprus Investment Programme (closed)',
        summary: 'The Cyprus Investment Programme granted citizenship linked to qualifying investment. Official records show it stopped accepting new applications from 1 November 2020. It must not be recommended as a live CBI path.',
        source: termination,
        eligibility: [{ field: 'programme.accepting_new_applications', operator: 'eq', value: false }],
        months: null,
        allocation: 'discretionary',
        status: 'inactive',
        lastChecked: '2026-07-22',
        note: 'Historical negative retained so the atlas does not revive CIP recommendations.',
      }),
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
    albaniaRecord(shadow, countrySources),
    algeriaRecord(shadow, countrySources),
    andorraRecord(shadow, countrySources),
    angolaRecord(shadow, countrySources),
    antiguaBarbudaRecord(shadow, countrySources),
    argentinaRecord(shadow, countrySources),
    australiaRecord(shadow, countrySources),
    austriaRecord(shadow, countrySources),
    bahamasRecord(shadow, countrySources),
    barbadosRecord(shadow, countrySources),
    belgiumRecord(shadow, countrySources),
    belizeRecord(shadow, countrySources),
    beninRecord(shadow, countrySources),
    boliviaRecord(shadow, countrySources),
    bosniaHerzegovinaRecord(shadow, countrySources),
    botswanaRecord(shadow, countrySources),
    brazilRecord(shadow, countrySources),
    bruneiRecord(shadow, countrySources),
    bulgariaRecord(shadow, countrySources),
    burkinaFasoRecord(shadow, countrySources),
    burundiRecord(shadow, countrySources),
    caboVerdeRecord(shadow, countrySources),
    cambodiaRecord(shadow, countrySources),
    cameroonRecord(shadow, countrySources),
    canadaRecord(shadow, countrySources),
    caymanIslandsRecord(shadow, countrySources),
    centralAfricanRepublicRecord(shadow, countrySources),
    chadRecord(shadow, countrySources),
    chileRecord(shadow, countrySources),
    chinaRecord(shadow, countrySources),
    colombiaRecord(shadow, countrySources),
    comorosRecord(shadow, countrySources),
    congoRecord(shadow, countrySources),
    costaRicaRecord(shadow, countrySources),
    coteDivoireRecord(shadow, countrySources),
    croatiaRecord(shadow, countrySources),
    cubaRecord(shadow, countrySources),
    cyprusRecord(shadow, countrySources),
    czechiaRecord(shadow, countrySources),
    denmarkRecord(shadow, countrySources),
    djiboutiRecord(shadow, countrySources),
    dominicanRepublicRecord(shadow, countrySources),
    dominicaRecord(shadow, countrySources),
    drcRecord(shadow, countrySources),
    ecuadorRecord(shadow, countrySources),
    egyptRecord(shadow, countrySources),
    elSalvadorRecord(shadow, countrySources),
    equatorialGuineaRecord(shadow, countrySources),
    eritreaRecord(shadow, countrySources),
    estoniaRecord(shadow, countrySources),
    eswatiniRecord(shadow, countrySources),
    ethiopiaRecord(shadow, countrySources),
    fijiRecord(shadow, countrySources),
    finlandRecord(shadow, countrySources),
    franceRecord(shadow, countrySources),
    gabonRecord(shadow, countrySources),
    gambiaRecord(shadow, countrySources),
    georgiaRecord(shadow, countrySources),
    germanyRecord(shadow, countrySources),
    ghanaRecord(shadow, countrySources),
    greeceRecord(shadow, countrySources),
    grenadaRecord(shadow, countrySources),
    guatemalaRecord(shadow, countrySources),
    guineaBissauRecord(shadow, countrySources),
    guineaRecord(shadow, countrySources),
    guyanaRecord(shadow, countrySources),
    haitiRecord(shadow, countrySources),
    hondurasRecord(shadow, countrySources),
    hungaryRecord(shadow, countrySources),
    icelandRecord(shadow, countrySources),
    indiaRecord(shadow, countrySources),
    indonesiaRecord(shadow, countrySources),
    irelandRecord(shadow, countrySources),
    israelRecord(shadow, countrySources),
    italyRecord(shadow, countrySources),
    jamaicaRecord(shadow, countrySources),
    japanRecord(shadow, countrySources),
    jordanRecord(shadow, countrySources),
    kenyaRecord(shadow, countrySources),
    kiribatiRecord(shadow, countrySources),
    koreaRecord(shadow, countrySources),
    latviaRecord(shadow, countrySources),
    lesothoRecord(shadow, countrySources),
    liberiaRecord(shadow, countrySources),
    libyaRecord(shadow, countrySources),
    liechtensteinRecord(shadow, countrySources),
    lithuaniaRecord(shadow, countrySources),
    luxembourgRecord(shadow, countrySources),
    madagascarRecord(shadow, countrySources),
    malawiRecord(shadow, countrySources),
    malaysiaRecord(shadow, countrySources),
    maliRecord(shadow, countrySources),
    maltaRecord(shadow, countrySources),
    marshallIslandsRecord(shadow, countrySources),
    mauritaniaRecord(shadow, countrySources),
    mauritiusRecord(shadow, countrySources),
    mexicoRecord(shadow, countrySources),
    micronesiaRecord(shadow, countrySources),
    moldovaRecord(shadow, countrySources),
    monacoRecord(shadow, countrySources),
    montenegroRecord(shadow, countrySources),
    moroccoRecord(shadow, countrySources),
    mozambiqueRecord(shadow, countrySources),
    namibiaRecord(shadow, countrySources),
    nauruRecord(shadow, countrySources),
    netherlandsRecord(shadow, countrySources),
    newZealandRecord(shadow, countrySources),
    nicaraguaRecord(shadow, countrySources),
    nigeriaRecord(shadow, countrySources),
    nigerRecord(shadow, countrySources),
    northMacedoniaRecord(shadow, countrySources),
    norwayRecord(shadow, countrySources),
    palauRecord(shadow, countrySources),
    panamaRecord(shadow, countrySources),
    papuaNewGuineaRecord(shadow, countrySources),
    paraguayRecord(shadow, countrySources),
    peruRecord(shadow, countrySources),
    philippinesRecord(shadow, countrySources),
    polandRecord(shadow, countrySources),
    portugalRecord(shadow, countrySources),
    romaniaRecord(shadow, countrySources),
    rwandaRecord(shadow, countrySources),
    saintLuciaRecord(shadow, countrySources),
    saintVincentRecord(shadow, countrySources),
    samoaRecord(shadow, countrySources),
    saoTomePrincipeRecord(shadow, countrySources),
    senegalRecord(shadow, countrySources),
    serbiaRecord(shadow, countrySources),
    seychellesRecord(shadow, countrySources),
    sierraLeoneRecord(shadow, countrySources),
    singaporeRecord(shadow, countrySources),
    slovakiaRecord(shadow, countrySources),
    sloveniaRecord(shadow, countrySources),
    solomonIslandsRecord(shadow, countrySources),
    somaliaRecord(shadow, countrySources),
    southAfricaRecord(shadow, countrySources),
    southSudanRecord(shadow, countrySources),
    spainRecord(shadow, countrySources),
    stKittsNevisRecord(shadow, countrySources),
    sudanRecord(shadow, countrySources),
    surinameRecord(shadow, countrySources),
    swedenRecord(shadow, countrySources),
    switzerlandRecord(shadow, countrySources),
    taiwanRecord(shadow, countrySources),
    tanzaniaRecord(shadow, countrySources),
    thailandRecord(shadow, countrySources),
    timorLesteRecord(shadow, countrySources),
    togoRecord(shadow, countrySources),
    tongaRecord(shadow, countrySources),
    trinidadAndTobagoRecord(shadow, countrySources),
    tunisiaRecord(shadow, countrySources),
    turkiyeRecord(shadow, countrySources),
    tuvaluRecord(shadow, countrySources),
    ugandaRecord(shadow, countrySources),
    ukraineRecord(shadow, countrySources),
    unitedArabEmiratesRecord(shadow, countrySources),
    unitedKingdomRecord(shadow, countrySources),
    unitedStatesRecord(shadow, countrySources),
    uruguayRecord(shadow, countrySources),
    vanuatuRecord(shadow, countrySources),
    venezuelaRecord(shadow, countrySources),
    vietnamRecord(shadow, countrySources),
    zambiaRecord(shadow, countrySources),
    zimbabweRecord(shadow, countrySources),

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

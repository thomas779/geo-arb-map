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
}: {
  title: string;
  url: string;
  source_type: SourceRecord['source_type'];
  jurisdictions: string[];
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
    language: null,
    published_at: null,
    last_checked: '2026-07-19',
  });
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

function franceRecord(shadow: DataShadow): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === '250');
  const legacy = candidate?.routes.find(
    route => route.id === 'france-study-naturalization-residence',
  );
  if (!candidate || !legacy) throw new Error('France pilot route is missing');
  const [article17, article18, servicePublic, ceseda] = legacy.sources;
  if (!article17 || !article18 || !servicePublic || !ceseda) {
    throw new Error('France pilot sources are incomplete');
  }
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:250',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'partial',
      confidence: legacy.confidence,
      last_checked: legacy.last_checked,
      note: 'Naturalization education accelerator reviewed; other acquisition modes remain incomplete.',
    },
    coverage: [
      {
        mode: 'ancestry',
        finding: 'unknown',
        review: { state: 'unchecked', confidence: 'low', last_checked: null },
        source_refs: [],
      },
      {
        mode: 'naturalization',
        finding: 'present',
        review: {
          state: 'partial',
          confidence: legacy.confidence,
          last_checked: legacy.last_checked,
          note: 'Ordinary and French higher-education variants are represented.',
        },
        source_refs: refs(legacy.sources, ['/coverage/naturalization']),
      },
      {
        mode: 'birth',
        finding: 'unknown',
        review: { state: 'unchecked', confidence: 'low', last_checked: null },
        source_refs: [],
      },
      {
        mode: 'investment',
        finding: 'unknown',
        review: { state: 'unchecked', confidence: 'low', last_checked: null },
        source_refs: [],
      },
    ],
    routes: [{
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
    }],
  });
}

function portugalRecord(shadow: DataShadow): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === '620');
  const ordinary = candidate?.routes.find(
    route => route.id === 'portugal-ordinary-naturalization-2026',
  );
  const birth = candidate?.routes.find(
    route => route.id === 'portugal-birth-parent-residence-2026',
  );
  if (!candidate || !ordinary || !birth) throw new Error('Portugal pilot routes are missing');
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:620',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'partial',
      confidence: 'high',
      last_checked: ordinary.last_checked,
      note: 'Ordinary naturalization and one conditional birth route reviewed.',
    },
    coverage: [
      {
        mode: 'ancestry',
        finding: 'unknown',
        review: { state: 'unchecked', confidence: 'low', last_checked: null },
        source_refs: [],
      },
      {
        mode: 'naturalization',
        finding: 'present',
        review: {
          state: 'partial',
          confidence: ordinary.confidence,
          last_checked: ordinary.last_checked,
        },
        source_refs: refs(ordinary.sources, ['/coverage/naturalization']),
      },
      {
        mode: 'birth',
        finding: 'present',
        review: {
          state: 'partial',
          confidence: birth.confidence,
          last_checked: birth.last_checked,
        },
        source_refs: refs(birth.sources, ['/coverage/birth']),
      },
      {
        mode: 'investment',
        finding: 'unknown',
        review: { state: 'unchecked', confidence: 'low', last_checked: null },
        source_refs: [],
      },
    ],
    routes: [
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

function spainRecord(shadow: DataShadow): JurisdictionRecord {
  const candidate = shadow.jurisdictions.find(item => item.jurisdiction.iso_n3 === '724');
  if (!candidate) throw new Error('Spain pilot jurisdiction is missing');
  return JurisdictionRecordSchema.parse({
    schema_version: 2,
    entity_type: 'jurisdiction',
    id: 'jurisdiction:724',
    jurisdiction: { ...candidate.jurisdiction, type: 'sovereign' },
    review: {
      state: 'unchecked',
      confidence: 'low',
      last_checked: null,
      note: 'No country-law route has been promoted from the legacy dataset yet.',
    },
    coverage: [
      'ancestry',
      'naturalization',
      'birth',
      'investment',
    ].map(mode => ({
      mode,
      finding: 'unknown',
      review: { state: 'unchecked', confidence: 'low', last_checked: null },
      source_refs: [],
    })),
    routes: [],
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
      const identified = current.find(item =>
        typeof item === 'object'
        && item !== null
        && 'id' in item
        && item.id === part);
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
      ? entity.routes.flatMap(route =>
        route.variants.flatMap(variant => variant.source_refs))
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
  const jurisdictions = [
    franceRecord(shadow),
    portugalRecord(shadow),
    spainRecord(shadow),
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

import { z } from 'zod';

const IsoN3 = z.string().regex(/^\d{3}$/, 'Expected a three-digit ISO numeric code');
const EntityId = z.string().regex(
  /^[a-z0-9][a-z0-9:_-]*$/,
  'Expected a stable lowercase entity ID',
);
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const NullableDate = DateOnly.nullable();
const Confidence = z.enum(['high', 'medium', 'low']);
const ReviewState = z.enum(['unchecked', 'legacy', 'pending', 'partial', 'reviewed']);
export const AcquisitionModeSchema = z.enum([
  'ancestry',
  'naturalization',
  'birth',
  'investment',
]);

export const ReviewSchema = z.strictObject({
  state: ReviewState,
  confidence: Confidence,
  last_checked: NullableDate,
  note: z.string().min(1).optional(),
});

export const SourceReferenceSchema = z.strictObject({
  source_id: EntityId,
  supports_fields: z.array(
    z.string().regex(/^\//, 'Supported fields must be stable ID-addressed paths'),
  ).min(1),
  note: z.string().min(1).optional(),
});

export const SourceRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  entity_type: z.literal('source'),
  id: EntityId,
  title: z.string().min(1),
  url: z.url(),
  publisher: z.string().min(1),
  source_type: z.enum([
    'primary_law',
    'official_gazette',
    'official_guidance',
    'treaty',
    'court_decision',
    'secondary_legal',
    'discovery',
  ]),
  jurisdictions: z.array(IsoN3),
  language: z.string().min(2).nullable(),
  published_at: NullableDate,
  last_checked: DateOnly,
  monitoring: z.strictObject({
    source_id: EntityId,
    method: z.enum(['api', 'http', 'rss', 'email', 'telegram', 'youtube']),
    url: z.url(),
    status: z.enum(['active', 'planned', 'paused']),
  }).optional(),
});

export const EligibilityConditionSchema = z.strictObject({
  field: z.string().regex(
    /^[a-z][a-z0-9_.]*$/,
    'Eligibility fields use stable dot-separated identifiers',
  ),
  operator: z.enum(['eq', 'neq', 'in', 'not_in', 'gte', 'lte', 'exists']),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
    z.null(),
  ]),
  unit: z.enum(['months', 'years', 'days', 'count']).optional(),
  note: z.string().min(1).optional(),
});

export const TimelineSchema = z.strictObject({
  eligibility_minimum_months: z.number().int().nonnegative().nullable(),
  processing_typical_months: z.number().int().positive().nullable(),
  confidence: Confidence,
  note: z.string().min(1).optional(),
});

export const MilestoneSchema = z.strictObject({
  status: z.string().regex(/^[a-z][a-z0-9_]*$/),
  minimum_months: z.number().int().nonnegative().nullable(),
  note: z.string().min(1).optional(),
});

export const RouteVariantSchema = z.strictObject({
  id: EntityId,
  label: z.string().min(1),
  outcome: z.enum(['citizenship', 'residence', 'permanent_residence', 'work']),
  allocation: z.enum(['right', 'discretionary', 'ballot', 'quota_queue']),
  eligibility: z.array(EligibilityConditionSchema),
  milestones: z.array(MilestoneSchema),
  timeline: TimelineSchema,
  source_refs: z.array(SourceReferenceSchema),
});

export const RouteSchema = z.strictObject({
  id: EntityId,
  mode: AcquisitionModeSchema,
  status: z.enum(['active', 'inactive', 'verified_negative', 'pending_verification']),
  title: z.string().min(1),
  summary: z.string().min(1),
  effective: z.strictObject({
    from: NullableDate,
    to: NullableDate,
    supersedes: z.array(EntityId),
  }),
  review: ReviewSchema,
  variants: z.array(RouteVariantSchema).min(1),
});

const JurisdictionIdentitySchema = z.strictObject({
  iso_n3: IsoN3,
  name: z.string().min(1),
  type: z.enum(['sovereign', 'territory', 'special']),
});

export const JurisdictionRecordV1Schema = z.strictObject({
  schema_version: z.literal(1),
  entity_type: z.literal('jurisdiction'),
  id: z.string().regex(/^jurisdiction:\d{3}$/),
  jurisdiction: JurisdictionIdentitySchema,
  review: ReviewSchema,
  routes: z.array(RouteSchema),
});

export const ModeCoverageSchema = z.strictObject({
  mode: AcquisitionModeSchema,
  finding: z.enum(['unknown', 'present', 'verified_none']),
  review: ReviewSchema,
  source_refs: z.array(SourceReferenceSchema),
});

const REQUIRED_MODES = AcquisitionModeSchema.options;

export const JurisdictionRecordSchema = z.strictObject({
  schema_version: z.literal(2),
  entity_type: z.literal('jurisdiction'),
  id: z.string().regex(/^jurisdiction:\d{3}$/),
  jurisdiction: JurisdictionIdentitySchema,
  review: ReviewSchema,
  coverage: z.array(ModeCoverageSchema).length(REQUIRED_MODES.length),
  routes: z.array(RouteSchema),
}).superRefine((record, context) => {
  const modes = record.coverage.map(item => item.mode);
  for (const mode of REQUIRED_MODES) {
    if (modes.filter(item => item === mode).length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['coverage'],
        message: `Coverage must contain exactly one ${mode} record`,
      });
    }
  }
  for (const item of record.coverage) {
    const routeCount = record.routes.filter(route => route.mode === item.mode).length;
    if (item.finding === 'present' && routeCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['coverage', modes.indexOf(item.mode), 'finding'],
        message: `Coverage finding present requires a ${item.mode} route`,
      });
    }
    if (item.finding === 'verified_none' && routeCount > 0) {
      context.addIssue({
        code: 'custom',
        path: ['coverage', modes.indexOf(item.mode), 'finding'],
        message: `Coverage finding verified_none cannot have a ${item.mode} route`,
      });
    }
    if (item.finding === 'verified_none'
      && (item.review.state !== 'reviewed' || item.source_refs.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['coverage', modes.indexOf(item.mode)],
        message: 'A reviewed negative requires reviewed state and evidence',
      });
    }
  }
});

export const JurisdictionPayloadSchema = z.union([
  JurisdictionRecordV1Schema,
  JurisdictionRecordSchema,
]);

const ParticipantSchema = z.strictObject({
  members: z.array(IsoN3),
  former_members: z.array(IsoN3),
  destinations: z.array(IsoN3),
  beneficiaries: z.array(IsoN3),
  beneficiaries_note: z.string().min(1).optional(),
});

export const ArrangementRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  entity_type: z.literal('arrangement'),
  id: EntityId,
  kind: z.enum(['regional', 'bilateral', 'heritage']),
  name: z.string().min(1),
  status: z.enum(['active', 'inactive', 'pending']),
  directionality: z.enum(['symmetric', 'asymmetric']),
  participants: ParticipantSchema,
  display: z.strictObject({
    category: z.enum(['full', 'partial', 'hub_spoke', 'one_way', 'closed', 'proto']),
    strength: z.number().nonnegative().max(1),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }),
  rights_by_status: z.strictObject({
    temporary_residence: z.string(),
    permanent_residence: z.string(),
    citizenship: z.string(),
  }),
  pathways: z.array(RouteVariantSchema),
  editorial: z.strictObject({
    fastest_entry: z.string().optional(),
    notes: z.string().optional(),
    limits: z.string().optional(),
  }),
  review: ReviewSchema,
  source_refs: z.array(SourceReferenceSchema),
});

export const ChangeProposalSchema = z.strictObject({
  schema_version: z.literal(1),
  entity_type: z.literal('change_proposal'),
  id: EntityId,
  signal_ids: z.array(EntityId).min(1),
  target_entity_id: EntityId,
  action: z.enum(['create', 'update', 'retire']),
  effective_from: NullableDate,
  operations: z.array(z.strictObject({
    op: z.enum(['add', 'replace', 'remove']),
    path: z.string().regex(/^\//, 'Operations must use stable ID-addressed paths'),
    value: z.unknown().optional(),
  })).min(1),
  source_refs: z.array(SourceReferenceSchema).min(1),
  rationale: z.string().min(1),
  review_status: z.enum(['draft', 'evidence_verified', 'approved', 'rejected']),
  created_at: z.iso.datetime(),
});

export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type AcquisitionMode = z.infer<typeof AcquisitionModeSchema>;
export type ModeCoverage = z.infer<typeof ModeCoverageSchema>;
export type JurisdictionRecordV1 = z.infer<typeof JurisdictionRecordV1Schema>;
export type JurisdictionRecord = z.infer<typeof JurisdictionRecordSchema>;
export type JurisdictionPayload = z.infer<typeof JurisdictionPayloadSchema>;
export type ArrangementRecord = z.infer<typeof ArrangementRecordSchema>;
export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;

export const CANONICAL_SCHEMAS = {
  source: SourceRecordSchema,
  jurisdiction: JurisdictionPayloadSchema,
  arrangement: ArrangementRecordSchema,
  change_proposal: ChangeProposalSchema,
} as const;

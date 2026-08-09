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

export const NationalityEligibilitySchema = z.strictObject({
  kind: z.enum(['open', 'treaty_list', 'exclusions']),
  included_iso_n3: z.array(IsoN3),
  excluded_iso_n3: z.array(IsoN3),
  detail: z.string().min(1),
  source_refs: z.array(SourceReferenceSchema).min(1),
}).superRefine((eligibility, context) => {
  if (eligibility.kind === 'open'
    && (eligibility.included_iso_n3.length > 0 || eligibility.excluded_iso_n3.length > 0)) {
    context.addIssue({
      code: 'custom',
      path: ['kind'],
      message: 'Open nationality eligibility cannot carry included or excluded country lists',
    });
  }
  if (eligibility.kind === 'treaty_list' && eligibility.included_iso_n3.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['included_iso_n3'],
      message: 'Treaty-list eligibility requires at least one included nationality',
    });
  }
  if (eligibility.kind === 'exclusions' && eligibility.excluded_iso_n3.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['excluded_iso_n3'],
      message: 'Exclusion eligibility requires at least one excluded nationality',
    });
  }
});

export const ParentResidenceRightSchema = z.strictObject({
  exists: z.boolean(),
  wait_months: z.number().int().nonnegative().nullable(),
  leads_to_citizenship: z.boolean(),
  instrument: z.string().min(1),
  source_refs: z.array(SourceReferenceSchema).min(1),
}).superRefine((right, context) => {
  if (!right.exists && (right.wait_months !== null || right.leads_to_citizenship)) {
    context.addIssue({
      code: 'custom',
      path: ['exists'],
      message: 'A verified absence cannot carry a wait period or lead to citizenship',
    });
  }
});

export const TransmissionAbroadSchema = z.strictObject({
  kind: z.enum([
    'unlimited',
    'registration_required',
    'first_generation_only',
    'unknown',
  ]),
  detail: z.string().min(1),
  source_refs: z.array(SourceReferenceSchema).min(1),
});

export const DualNationalitySchema = z.strictObject({
  status: z.enum(['allowed', 'conditional', 'prohibited', 'unknown']),
  detail: z.string().min(1),
  source_refs: z.array(SourceReferenceSchema).min(1),
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

/**
 * A separately-evidenced assertion attached to a route.
 *
 * `review.confidence` is ONE badge for a whole route, and routes routinely mix
 * evidence of very different strength. `nepal-citizenship-by-descent` is the live
 * case: the s. 3(1) descent rule is high confidence from the 2006 Act, while the
 * Fourth Amendment procedure for an unidentified father is press-reported. The
 * author's only options were to downgrade the whole route, losing the strength of
 * the core rule, or keep `high` and hedge in prose — and prose hedges do not
 * survive extraction into a country slice.
 *
 * A claim carries its own confidence and its own sources, so "core rule high, this
 * added detail medium" becomes machine-readable instead of a sentence.
 *
 * This does NOT weaken the route badge. `effectiveConfidence` takes the weakest of
 * the route and its claims, so adding a weak claim can only ever lower what a
 * consumer sees, never raise it.
 */
export const RouteClaimSchema = z.strictObject({
  /** Stable slug so a claim can be referenced and superseded. */
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  /** What is being asserted, in one sentence. */
  statement: z.string().min(1),
  confidence: Confidence,
  /**
   * Empty is allowed and meaningful: it says this claim rests on no registered
   * source, which is exactly the state that should force a low confidence rather
   * than be hidden.
   */
  source_refs: z.array(SourceReferenceSchema),
});

const MoneySchema = z.strictObject({
  amount: z.number().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 currency code'),
});

/**
 * What a route costs to use, and what you must be able to show to use it.
 *
 * Exists because there was nowhere else. `iceland-naturalization` recorded ISK
 * 259,951/month means and ISK 60,000/30,000 fees inside `variant.timeline.note`,
 * which is for caveats about the CLOCK, and `gibraltar-employment-residence-permit`
 * had to put GBP 250 into prose. Both validated, and neither was queryable: a
 * country page asking "what does this actually cost" could not see either, and a
 * cost dimension for the rights index could not either.
 *
 * Shared by citizenship and residence routes rather than kept as two shapes, per
 * the #169 decision.
 *
 * NULL MEANS NOT RECORDED, never free and never no threshold. A fee that exists
 * but has not been read must not render as zero, which is the same rule that
 * governs `max_age` and `work_rights`.
 */
export const RouteCostsSchema = z.strictObject({
  /**
   * Application or processing fees, one row per applicant class.
   *
   * `amount` is nullable for the same reason `means.amount` is. Paraguay sets every
   * migration fee in *jornales* (Ley 6984/2022 art. 100), a statutory day-wage unit,
   * and publishes the guaraní equivalent separately. The instrument fixes the number
   * of jornales; the cash figure moves whenever the jornal is revalued. Recording
   * PYG 2,926,925 as the fee would freeze a number the law never set.
   */
  fees: z.array(z.strictObject({
    /** Who or what the fee applies to: `adult`, `child`, `family_filing`, `renewal`. */
    applies_to: z.string().regex(/^[a-z][a-z0-9_]*$/),
    amount: MoneySchema.nullable().default(null),
    /** What the fee tracks when it is not a fixed sum, e.g. a statutory wage unit. */
    pegged_to: z.string().default(''),
    detail: z.string().default(''),
  })).default([]),
  /**
   * Self-support or means threshold. `pegged_to` matters as much as the number:
   * Iceland's is aligned to City of Reykjavík financial-aid criteria and Gibraltar's
   * to the Employment Survey average, so both move without the instrument changing.
   * An amount recorded without saying what it tracks reads as more fixed than it is.
   */
  means: z.strictObject({
    amount: MoneySchema.nullable(),
    period: z.enum(['monthly', 'annual']),
    applies_to: z.string().regex(/^[a-z][a-z0-9_]*$/),
    pegged_to: z.string().default(''),
    detail: z.string().default(''),
  }).nullable().default(null),
  /** Fee schedules are dated instruments and change more often than nationality law. */
  effective: z.strictObject({
    from: NullableDate,
    to: NullableDate,
  }).default({ from: null, to: null }),
  /** Required, same as transmission_abroad: an amount with no source is the failure mode. */
  source_refs: z.array(SourceReferenceSchema).min(1),
});

export const RouteSchema = z.strictObject({
  id: EntityId,
  mode: AcquisitionModeSchema,
  status: z.enum(['active', 'inactive', 'pending_verification']),
  title: z.string().min(1),
  summary: z.string().min(1),
  effective: z.strictObject({
    from: NullableDate,
    to: NullableDate,
    supersedes: z.array(EntityId),
  }),
  review: ReviewSchema,
  variants: z.array(RouteVariantSchema).min(1),
  // These fields are optional during migration. Absence means “not recorded”,
  // never an inferred open/negative result.
  nationality_eligibility: NationalityEligibilitySchema.optional(),
  parent_residence_right: ParentResidenceRightSchema.optional(),
  transmission_abroad: TransmissionAbroadSchema.optional(),
  /** Separately-evidenced assertions; see RouteClaimSchema. */
  claims: z.array(RouteClaimSchema).optional(),
  /** Fees and means thresholds; see RouteCostsSchema. Absent means not recorded. */
  costs: RouteCostsSchema.optional(),
  /**
   * Descent facts the instrument states but the eligibility conditions do not encode.
   *
   * `descent-relations.ts` derives reach from eligibility FIELD NAMES, which is sound
   * but blind to prose. Israel forced this: its summary says the Law of Return extends
   * "to a child and grandchild of a Jew", while its only authored condition names a
   * parent, so it derived as parent-only — and Germany's Spätaussiedler route derived
   * as nothing at all, because ethnic origin is not a generation.
   *
   * Same discipline as the derivation: positive-only. `unlimited` records that the
   * instrument states no cutoff; never that nobody wrote one down.
   */
  authored_descent: z.strictObject({
    relations: z.array(z.enum(['parent', 'grandparent', 'great_grandparent', 'ancestor_unspecified'])).default([]),
    origin_based: z.boolean().default(false),
    unlimited: z.boolean().default(false),
    /** Cite the provision, so an authored value is always traceable. */
    basis: z.string().min(1),
  }).optional(),
}).superRefine((route, context) => {
  if (route.authored_descent && route.mode !== 'ancestry') {
    context.addIssue({
      code: 'custom',
      path: ['authored_descent'],
      message: 'Authored descent belongs only on ancestry routes',
    });
  }
  if (route.nationality_eligibility && route.mode !== 'investment') {
    context.addIssue({
      code: 'custom',
      path: ['nationality_eligibility'],
      message: 'Citizenship nationality eligibility belongs only on investment routes',
    });
  }
  if (route.parent_residence_right && route.mode !== 'birth') {
    context.addIssue({
      code: 'custom',
      path: ['parent_residence_right'],
      message: 'Parent residence rights belong only on birth routes',
    });
  }
  if (route.transmission_abroad && route.mode !== 'ancestry' && route.mode !== 'birth') {
    context.addIssue({
      code: 'custom',
      path: ['transmission_abroad'],
      message: 'Transmission abroad belongs only on ancestry or birth routes',
    });
  }
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

// --- Residence layer (parallel family; keeps the 4-mode citizenship taxonomy untouched) ---



export const ResidenceCategorySchema = z.enum([
  'investment', // golden visa / residence-by-investment
  'digital_nomad', // physical long-stay remote-work visa/permit
  'digital_identity', // e-residency / digital ID — not immigration residence
  'retirement_pension',
  'talent_skilled',
  'general_permanent_residence',
]);

export const ResidenceRouteSchema = z.strictObject({
  id: EntityId,
  category: ResidenceCategorySchema,
  status: z.enum(['active', 'inactive', 'pending_verification']),
  title: z.string().min(1),
  summary: z.string().min(1),
  effective: z.strictObject({
    from: NullableDate,
    to: NullableDate,
    supersedes: z.array(EntityId),
  }),
  review: ReviewSchema,
  // Residence-specific dimensions (see docs/fact-check-handoff.md): a renewable
  // long-stay permit is not necessarily a settlement route, so record explicitly
  // whether time under this permit counts toward PR and toward naturalization.
  counts_toward_permanent_residence: z.boolean(),
  counts_toward_naturalization: z.boolean(),
  min_investment: MoneySchema.nullable(),
  min_income_monthly: MoneySchema.nullable(),
  physical_presence_days_per_year: z.number().int().nonnegative().nullable(),
  // What the permit lets you DO locally. null = not yet read from the
  // instrument — never inferred. 'remote_only' (nomad visas), 'none'
  // (rentista/retirement permits that bar local work), 'employer_sponsored'
  // (tied to the petitioning employer), 'self_employment' (own business only),
  // 'full' (open labour-market access).
  work_rights: z.enum(['full', 'employer_sponsored', 'self_employment', 'remote_only', 'none']).nullable().default(null),
  // The permit's own term: how long one grant lasts, and whether it renews.
  // Distinct from eligibility timelines (time-to-PR) and never inferred:
  // null = not read from the instrument. Renewability is recorded only when
  // stated — silence stays null, never false.
  permit_duration_months: z.number().int().positive().nullable().default(null),
  permit_renewable: z.boolean().nullable().default(null),
  // Applicant age gates, read from the instrument. CRITICAL SEMANTICS: null means
  // NOT RECORDED, never "no age limit". A recommender must therefore treat null
  // as "cannot confirm eligibility" rather than "eligible": only 6 of 33
  // retirement routes currently carry a verified gate, so assuming absence means
  // unrestricted would recommend pensioner visas to thirty-year-olds.
  min_age: z.number().int().positive().max(120).nullable().default(null),
  max_age: z.number().int().positive().max(120).nullable().default(null),
  nationality_eligibility: NationalityEligibilitySchema.optional(),
  /**
   * Same shape as the citizenship route's, deliberately. #169 asked whether to keep
   * two, and one wins: a fee is a fee, and a country page rendering "what this
   * costs" should not branch on which family the route belongs to.
   */
  costs: RouteCostsSchema.optional(),
  variants: z.array(RouteVariantSchema).min(1),
}).superRefine((route, context) => {
  route.variants.forEach((variant, index) => {
    if (variant.outcome !== 'residence' && variant.outcome !== 'permanent_residence') {
      context.addIssue({
        code: 'custom',
        path: ['variants', index, 'outcome'],
        message: 'Residence route variants must resolve to residence or permanent_residence',
      });
    }
  });
});

export const ResidenceCoverageSchema = z.strictObject({
  category: ResidenceCategorySchema,
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
  // Residence layer — optional and separate from the 4-mode citizenship coverage.
  residence_routes: z.array(ResidenceRouteSchema).optional(),
  residence_coverage: z.array(ResidenceCoverageSchema).optional(),
  dual_nationality: DualNationalitySchema.optional(),
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

  // Residence layer consistency (mirrors the citizenship coverage discipline).
  const residenceRoutes = record.residence_routes ?? [];
  const residenceCoverage = record.residence_coverage ?? [];
  const seenCategories = new Set<string>();
  residenceCoverage.forEach((item, index) => {
    if (seenCategories.has(item.category)) {
      context.addIssue({
        code: 'custom',
        path: ['residence_coverage', index, 'category'],
        message: `Duplicate residence coverage for ${item.category}`,
      });
    }
    seenCategories.add(item.category);
    const routeCount = residenceRoutes.filter(route => route.category === item.category).length;
    if (item.finding === 'present' && routeCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['residence_coverage', index, 'finding'],
        message: `Coverage finding present requires a ${item.category} residence route`,
      });
    }
    if (item.finding === 'verified_none' && routeCount > 0) {
      context.addIssue({
        code: 'custom',
        path: ['residence_coverage', index, 'finding'],
        message: `Coverage finding verified_none cannot have a ${item.category} residence route`,
      });
    }
    if (item.finding === 'verified_none'
      && (item.review.state !== 'reviewed' || item.source_refs.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['residence_coverage', index],
        message: 'A reviewed residence negative requires reviewed state and evidence',
      });
    }
  });
  // Every residence route needs a matching present coverage entry (no orphan routes).
  residenceRoutes.forEach((route, index) => {
    const cover = residenceCoverage.find(item => item.category === route.category);
    if (!cover || cover.finding !== 'present') {
      context.addIssue({
        code: 'custom',
        path: ['residence_routes', index],
        message: `Residence route ${route.id} requires a present ${route.category} residence_coverage entry`,
      });
    }
  });
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

/**
 * What an arrangement actually confers, as something a scorer can read.
 *
 * `rights_by_status` is three free-text strings, and dimensions A1 (settlement by
 * right) and A2 (work by right) cannot be computed from prose. The prose is also
 * editorial rather than legal in places — one entry reads "Strongest bloc in the
 * world" — and it overstates in others: ECOWAS is recorded as conferring
 * "residency rights bloc-wide" when its free movement is phased, with the right of
 * entry realised and residence and establishment uneven.
 *
 * Two enums, deliberately separate, because residence and work are different
 * rights and conflating them is what makes A2 impossible. A permit that lets you
 * live somewhere without working is a materially weaker thing.
 *
 * `unknown` is a first-class value and the default. It means the instrument was not
 * read or does not say, never "no right", per the index rule that unrecorded is
 * never zero.
 */
export const RightsGrantSchema = z.strictObject({
  /** Whether the holder may reside, and on what terms. */
  reside: z.enum(['indefinite', 'conditional', 'none', 'unknown']),
  /** Whether the holder may work without a separate permit. */
  work: z.enum(['unrestricted', 'conditional', 'none', 'unknown']),
  /**
   * Machine-readable gates on a `conditional` grant, e.g. a CARICOM Skills
   * Certificate or a registration step. Empty on an unconditional grant.
   */
  conditions: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)),
  /** Free text kept alongside, so the legal nuance is not lost to the enums. */
  detail: z.string(),
});

export const RightsMatrixSchema = z.strictObject({
  temporary_residence: RightsGrantSchema,
  permanent_residence: RightsGrantSchema,
  citizenship: RightsGrantSchema,
  source_refs: z.array(SourceReferenceSchema),
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
    /**
     * Legacy display TIER, not a normalised score: 1 is the strongest rung and 3
     * the weakest, with 0 reserved for bilateral lanes, which project no strength
     * and carry it as structural filler.
     *
     * This was `.max(1)` until the #162 bloc batch. That bound was not a modelled
     * constraint — it was generalised from the only two blocs then canonical
     * (eu_eea and mercosur, both tier 1) plus the lanes' 0, and it read the field
     * as a 0-1 fraction. Fourteen of the 24 legacy blocs are tier 2 or 3, so the
     * schema rejected valid source data the moment a third bloc was migrated.
     * Widened to the domain the data actually has, and pinned by a test rather
     * than left open-ended.
     */
    strength: z.number().int().nonnegative().max(3),
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
  /** Structured form of rights_by_status; see RightsMatrixSchema. */
  rights_matrix: RightsMatrixSchema.optional(),
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
export type ResidenceCategory = z.infer<typeof ResidenceCategorySchema>;
export type ResidenceRoute = z.infer<typeof ResidenceRouteSchema>;
export type ResidenceCoverage = z.infer<typeof ResidenceCoverageSchema>;
export type NationalityEligibility = z.infer<typeof NationalityEligibilitySchema>;
export type ParentResidenceRight = z.infer<typeof ParentResidenceRightSchema>;
export type TransmissionAbroad = z.infer<typeof TransmissionAbroadSchema>;
export type DualNationality = z.infer<typeof DualNationalitySchema>;
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

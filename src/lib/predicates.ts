import type { Profile } from './planner';

/**
 * Typed predicates — the edge-gate model behind `GraphEdge.predicates`.
 *
 * Replaces the flat `needs: string[]` vocabulary (`ancestor:380`,
 * `heritage:israel_law_of_return`, `citizenship_any:620,724`,
 * `willing_child_abroad`), which could only ever describe the applicant and
 * could only ever be parsed by string sniffing.
 *
 * Two properties the string form could not carry:
 *
 *  - `subject` — WHOSE fact this is. A household is a set of people, and the
 *    step-2 solver has to reason about a partner's nationality or a child's
 *    birthplace as separate variables. `self` and `partner` are evaluable
 *    today; `parent` and `child` are declared here so the corpus can be
 *    written against them, and REJECTED at build time until the household
 *    solver can read them (see UNSUPPORTED_SUBJECTS below).
 *
 *  - `provenance` — WHERE the fact comes from. "the law says" (`sourced`,
 *    derived from a statute or the canonical corpus) versus "you told us"
 *    (`self_attested`, a checkbox nobody has verified). The UI has to be able
 *    to show that difference; carrying it from the start means the data does
 *    not have to be regenerated to acquire it.
 *
 * THE RULE: an unrecognised predicate fails LOUDLY. The old interpreter ended
 * in `return false`, so adding an unmodelled gate to the data deleted the edge
 * from the graph in silence — the planner would simply have got quieter and
 * nobody would have noticed. Here, an unknown attribute, an op the attribute
 * does not support, a subject nothing can read, or a malformed value is an
 * error: at build time (`validatePredicates`, called on every edge by
 * scripts/build_edges.js) and again at solve time (`predicatesSatisfied`
 * throws). Only a WELL-FORMED predicate whose fact the profile happens not to
 * carry is allowed to evaluate to false.
 */

export const PREDICATE_SUBJECTS = ['self', 'partner', 'parent', 'child'] as const;
export const PREDICATE_OPS = ['eq', 'in', 'gte', 'lte', 'exists'] as const;
export const PREDICATE_PROVENANCES = ['sourced', 'self_attested'] as const;

export type PredicateSubject = (typeof PREDICATE_SUBJECTS)[number];
export type PredicateOp = (typeof PREDICATE_OPS)[number];
export type PredicateProvenance = (typeof PREDICATE_PROVENANCES)[number];

export interface Predicate {
  subject: PredicateSubject;
  attribute: string;
  op: PredicateOp;
  value: unknown;
  provenance: PredicateProvenance;
}

/**
 * What a predicate is evaluated against: the stored profile plus the
 * citizenships held at THIS point in the search, which diverge as soon as a
 * path acquires one (see pathfinder `transition`).
 */
export interface PredicateContext {
  profile: Profile;
  citizenships: ReadonlySet<string>;
}

/**
 * A reading is either a set of categorical values (nationalities, claim ids)
 * or an ordinal one (a generation depth, a count of years). `eq`/`in`/`exists`
 * apply to sets; `gte`/`lte` apply to ordinals. Keeping the two kinds apart is
 * what lets validation reject `citizenship gte 3` instead of quietly
 * coercing it.
 */
export type AttributeReading =
  | { kind: 'set'; values: ReadonlySet<string> }
  | { kind: 'ordinal'; value: number | null };

export interface AttributeSpec {
  kind: AttributeReading['kind'];
  /** Subjects this attribute can be read for. Anything else is a hard error. */
  subjects: readonly PredicateSubject[];
  ops: readonly PredicateOp[];
  read(subject: PredicateSubject, ctx: PredicateContext): AttributeReading;
  describe: string;
}

export type AttributeRegistry = Readonly<Record<string, AttributeSpec>>;

/** Thrown by every loud path: build validation and solve-time evaluation alike. */
export class UnknownPredicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownPredicateError';
  }
}

const SET_OPS = ['eq', 'in', 'exists'] as const;
const ORDINAL_OPS = ['gte', 'lte', 'exists'] as const;

const setOf = (values: Iterable<string>): AttributeReading => ({
  kind: 'set',
  values: values instanceof Set ? values : new Set(values),
});

/**
 * The attribute vocabulary. Adding an entry here is what makes a new gate
 * legal; until then the data cannot use it, because build_edges.js refuses to
 * emit an edge carrying an attribute this map does not contain.
 */
export const PREDICATE_ATTRIBUTES: AttributeRegistry = {
  citizenship: {
    kind: 'set',
    subjects: ['self', 'partner'],
    ops: SET_OPS,
    describe: 'nationalities held (self = held at this point in the path)',
    read: (subject, ctx) => subject === 'partner'
      ? setOf(ctx.profile.partnerCitizenships)
      : setOf(ctx.citizenships),
  },
  ancestry: {
    kind: 'set',
    subjects: ['self'],
    ops: SET_OPS,
    // Profile.ancestors is a flat ISO list with no generation, which is why
    // there is no degree here yet. See `ancestry_degree` in the report notes:
    // the corpus records reach, the profile cannot yet answer it.
    describe: 'jurisdictions an ancestor came from (no generation recorded)',
    read: (_subject, ctx) => setOf(ctx.profile.ancestors),
  },
  heritage: {
    kind: 'set',
    subjects: ['self'],
    ops: SET_OPS,
    describe: 'self-attested personal claims (Law of Return, Spätaussiedler, …)',
    read: (_subject, ctx) => setOf(ctx.profile.heritages),
  },
  intent: {
    kind: 'set',
    subjects: ['self'],
    ops: SET_OPS,
    describe: 'declared intentions the planner may gate on (e.g. child_abroad)',
    read: (_subject, ctx) => setOf(ctx.profile.intents),
  },
};

/**
 * Subjects the model can EXPRESS but nothing can yet READ. Rejected at build
 * time with a pointer rather than silently evaluating false — that silence is
 * exactly the failure mode this change exists to remove. The household solver
 * (step 2) is what clears these.
 */
const UNSUPPORTED_SUBJECTS: Record<string, string> = {
  parent: 'no parent facts are modelled yet — the household solver (step 2) introduces them',
  child: 'no child facts are modelled yet — the household solver (step 2) introduces them',
};

function describePredicate(p: Predicate): string {
  return `${p.subject}.${p.attribute} ${p.op} ${JSON.stringify(p.value)}`;
}

/**
 * Structural check. Returns a human-readable reason, or null when the
 * predicate is well formed. Build-time validation and solve-time evaluation
 * both run this, so the two can never disagree about what is legal.
 */
export function predicateProblem(
  value: unknown,
  registry: AttributeRegistry = PREDICATE_ATTRIBUTES,
): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `predicate must be an object, got ${JSON.stringify(value)}`;
  }
  const p = value as Partial<Predicate>;
  if (typeof p.attribute !== 'string' || !p.attribute) return 'predicate has no attribute';
  if (!PREDICATE_SUBJECTS.includes(p.subject as PredicateSubject)) {
    return `unknown subject ${JSON.stringify(p.subject)} (expected ${PREDICATE_SUBJECTS.join(' | ')})`;
  }
  if (!PREDICATE_OPS.includes(p.op as PredicateOp)) {
    return `unknown op ${JSON.stringify(p.op)} (expected ${PREDICATE_OPS.join(' | ')})`;
  }
  if (!PREDICATE_PROVENANCES.includes(p.provenance as PredicateProvenance)) {
    return `unknown provenance ${JSON.stringify(p.provenance)} `
      + `(expected ${PREDICATE_PROVENANCES.join(' | ')})`;
  }

  const spec = registry[p.attribute];
  if (!spec) {
    return `unknown attribute ${JSON.stringify(p.attribute)} `
      + `(known: ${Object.keys(registry).sort().join(', ')})`;
  }
  if (!spec.subjects.includes(p.subject as PredicateSubject)) {
    const why = UNSUPPORTED_SUBJECTS[p.subject as string];
    return `attribute ${p.attribute} cannot be read for subject ${p.subject}`
      + (why ? ` — ${why}` : ` (readable for ${spec.subjects.join(', ')})`);
  }
  if (!spec.ops.includes(p.op as PredicateOp)) {
    return `attribute ${p.attribute} is ${spec.kind}-valued and does not support op ${p.op} `
      + `(supports ${spec.ops.join(', ')})`;
  }

  const op = p.op as PredicateOp;
  if (op === 'eq' && typeof p.value !== 'string' && typeof p.value !== 'number') {
    return `op eq needs a scalar value, got ${JSON.stringify(p.value)}`;
  }
  if (op === 'in' && (!Array.isArray(p.value) || p.value.length === 0)) {
    return `op in needs a non-empty array, got ${JSON.stringify(p.value)}`;
  }
  if ((op === 'gte' || op === 'lte') && typeof p.value !== 'number') {
    return `op ${op} needs a numeric value, got ${JSON.stringify(p.value)}`;
  }
  return null;
}

/** Build-time gate. Throws on the first malformed predicate, naming the edge. */
export function validatePredicates(
  predicates: readonly unknown[],
  label: string,
  registry: AttributeRegistry = PREDICATE_ATTRIBUTES,
): void {
  if (!Array.isArray(predicates)) {
    throw new UnknownPredicateError(`${label}: predicates must be an array`);
  }
  for (const predicate of predicates) {
    const problem = predicateProblem(predicate, registry);
    if (problem) throw new UnknownPredicateError(`${label}: ${problem}`);
  }
}

/**
 * Evaluate one predicate. Throws (never returns false) when the predicate is
 * not something this build knows how to answer.
 */
export function evaluatePredicate(
  predicate: Predicate,
  ctx: PredicateContext,
  registry: AttributeRegistry = PREDICATE_ATTRIBUTES,
): boolean {
  const problem = predicateProblem(predicate, registry);
  if (problem) {
    throw new UnknownPredicateError(
      `cannot evaluate predicate ${describePredicate(predicate)}: ${problem}`,
    );
  }
  const spec = registry[predicate.attribute]!;
  const reading = spec.read(predicate.subject, ctx);

  if (reading.kind === 'set') {
    const held = reading.values;
    if (predicate.op === 'exists') return held.size > 0;
    if (predicate.op === 'eq') return held.has(String(predicate.value));
    if (predicate.op === 'in') {
      return (predicate.value as unknown[]).some(v => held.has(String(v)));
    }
    /* c8 ignore next */
    throw new UnknownPredicateError(`op ${predicate.op} is not defined over a set reading`);
  }

  const actual = reading.value;
  if (predicate.op === 'exists') return actual !== null;
  // A missing ordinal is unknown, not zero: never let "we don't know" pass a
  // threshold test.
  if (actual === null) return false;
  if (predicate.op === 'gte') return actual >= (predicate.value as number);
  if (predicate.op === 'lte') return actual <= (predicate.value as number);
  /* c8 ignore next */
  throw new UnknownPredicateError(`op ${predicate.op} is not defined over an ordinal reading`);
}

/** Conjunction, matching the old `needs.every(...)` semantics. */
export function predicatesSatisfied(
  predicates: readonly Predicate[],
  ctx: PredicateContext,
  registry: AttributeRegistry = PREDICATE_ATTRIBUTES,
): boolean {
  return predicates.every(p => evaluatePredicate(p, ctx, registry));
}

/**
 * Compatibility shim for the legacy `needs: string[]` vocabulary.
 *
 * Four forms, translated 1:1 so the migration can be incremental: edges that
 * still carry only `needs` behave exactly as before. Anything else THROWS —
 * the old interpreter's `return false` default is the silent-drop bug.
 *
 * Provenance follows where the fact comes from. `ancestor:` and
 * `citizenship_any:` are derived from statute (the corpus's descent routes and
 * a naturalisation clause's qualifying-nationality list), so `sourced`.
 * `heritage:` and `willing_child_abroad` are checkboxes the user ticks about
 * themselves, so `self_attested`.
 */
export function predicatesFromNeeds(needs: readonly string[]): Predicate[] {
  return needs.map((need): Predicate => {
    if (need.startsWith('ancestor:')) {
      return {
        subject: 'self',
        attribute: 'ancestry',
        op: 'eq',
        value: need.slice('ancestor:'.length),
        provenance: 'sourced',
      };
    }
    if (need.startsWith('heritage:')) {
      return {
        subject: 'self',
        attribute: 'heritage',
        op: 'eq',
        value: need.slice('heritage:'.length),
        provenance: 'self_attested',
      };
    }
    if (need.startsWith('citizenship_any:')) {
      return {
        subject: 'self',
        attribute: 'citizenship',
        op: 'in',
        value: need.slice('citizenship_any:'.length).split(',').filter(Boolean),
        provenance: 'sourced',
      };
    }
    if (need === 'willing_child_abroad') {
      return {
        subject: 'self',
        attribute: 'intent',
        op: 'eq',
        value: 'child_abroad',
        provenance: 'self_attested',
      };
    }
    throw new UnknownPredicateError(
      `unknown legacy gate ${JSON.stringify(need)} — add a predicate rather than a new string form `
      + '(the string vocabulary is frozen at ancestor:, heritage:, citizenship_any:, willing_child_abroad)',
    );
  });
}

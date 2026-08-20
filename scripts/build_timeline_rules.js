#!/usr/bin/env bun
/**
 * Compile data/timeline_rules.json into a compact browser/graph index.
 *
 * Reviewed durations remain references to numeric facts in
 * data/citizenship_routes.json. The generated public file resolves those
 * references so browser code does not bundle the full research corpus.
 * The generated module lives under src/ because Vite intentionally forbids
 * importing application data from public/ during development.
 */

import fs from 'node:fs';
import { buildCanonicalPilot, CANONICAL_SOURCE_IS_SAMPLE } from './lib/canonical-source';
import { deriveDescentRelations } from './lib/descent-relations';

// Eligibility fields that mark a variant as a SPECIAL track rather than the
// ordinary residence one: spouses, descent, investors, merit. The planner's
// ordinary edge must never inherit a privileged tier's shorter clock.
const SPECIAL_FIELD = /^(spouse|partner|marriage|heritage|programme_type|applicant|parent|investment|prior_nationality)\./;

/**
 * Derive ordinary-track naturalization timelines from the canonical corpus.
 *
 * The curated `data/timeline_rules.json` covers 32 jurisdictions and was never
 * grown with the dataset, while canonical carries sourced figures for far more.
 * Deriving them removes a hand-maintained bottleneck AND makes coverage grow
 * automatically as verification lands.
 *
 * Three rules keep this honest:
 *  - `status: 'active'` only, so closed programmes never become traversable
 *    edges (Malta 2025, Moldova 2020, Bulgaria 2022 must stay out).
 *  - `confidence: 'high'` only, so the planner never asserts a modelled figure.
 *  - the ordinary variant is the BASELINE, so where a route has tiers we take
 *    the explicit `ordinary` variant, else the LONGEST unconditioned one.
 *    Understating a wait is the harmful direction.
 */
export function deriveOrdinaryNaturalization(pilot) {
  const derived = new Map();
  for (const jurisdiction of pilot.jurisdictions) {
    for (const route of jurisdiction.routes) {
      if (route.mode !== 'naturalization' || route.status !== 'active') continue;
      if (route.review.confidence !== 'high') continue;
      const plain = route.variants.filter(variant =>
        variant.eligibility.some(condition => condition.field.startsWith('residence.'))
        && !variant.eligibility.some(condition => SPECIAL_FIELD.test(condition.field))
        && typeof variant.timeline.eligibility_minimum_months === 'number'
        && variant.timeline.eligibility_minimum_months > 0);
      if (!plain.length) continue;
      const ordinary = plain.find(variant => variant.id === 'ordinary')
        ?? plain.reduce((longest, variant) =>
          variant.timeline.eligibility_minimum_months > longest.timeline.eligibility_minimum_months
            ? variant : longest);
      const iso = jurisdiction.jurisdiction.iso_n3;
      const months = ordinary.timeline.eligibility_minimum_months;
      const previous = derived.get(iso);
      if (!previous || months > previous.ordinary_months) {
        derived.set(iso, {
          iso_n3: iso,
          ordinary_months: months,
          confidence: 'high',
          // Carried so the graph stops flattening every naturalisation to `right`.
          // It is NOT an exclusion filter — see `isRationed` in pathfinder.ts for
          // why formal discretion cannot be one. It is here so the UI can say the
          // grant is not automatic, which is true of 338 of 412 pathways.
          allocation: ordinary.allocation ?? 'right',
          derived_from: `${route.id}#${ordinary.id}`,
        });
      }
    }
  }
  return derived;
}

function durationMonths(inlineMonths, reference, routeById, context) {
  if (inlineMonths !== undefined) return inlineMonths;
  if (!reference) throw new Error(`${context} has no duration`);
  const route = routeById.get(reference.route_id);
  const value = route?.facts?.[reference.fact];
  if (typeof value !== 'number') {
    throw new Error(`${context} references missing numeric fact ${reference.route_id}.${reference.fact}`);
  }
  return reference.unit === 'years' ? value * 12 : value;
}

export function buildTimelineRules(source, citizenshipRoutes, derivedNaturalization = new Map()) {
  const routeById = new Map(citizenshipRoutes.routes.map(route => [route.id, route]));
  return {
    meta: {
      ...source.meta,
      generated_from: 'data/timeline_rules.json + data/citizenship_routes.json',
    },
    naturalization: source.naturalization.map(rule => ({
      iso_n3: rule.iso_n3,
      ordinary_months: durationMonths(
        rule.ordinary_months,
        rule.ordinary_ref,
        routeById,
        `Naturalization timeline ${rule.iso_n3}`,
      ),
      confidence: rule.confidence,
      conditional: rule.conditional?.map(condition => ({
        id: condition.id,
        minimum_months: durationMonths(
          condition.minimum_months,
          condition.minimum_ref,
          routeById,
          `Conditional timeline ${rule.iso_n3}:${condition.id}`,
        ),
        ...condition.qualifying_lane_id
          ? { qualifying_lane_id: condition.qualifying_lane_id }
          : {},
        ...condition.qualifying_bloc_ids
          ? { qualifying_bloc_ids: condition.qualifying_bloc_ids }
          : {},
        ...condition.excluded_iso_n3
          ? { excluded_iso_n3: condition.excluded_iso_n3 }
          : {},
      })),
    })),
    heritage: source.heritage,
    investment: source.investment,
  };
}

/**
 * Attach the recorded ancestral relations to each curated descent rule.
 *
 * The 12 curated heritage rules carry a duration and a binary `gate: 'ancestor'`,
 * so the planner has been telling anyone who ticks Italy that citizenship is 18
 * months away regardless of whether their Italian relative is a parent or a
 * great-great-grandparent. It cannot check the degree, because the profile has no
 * degree and the corpus never projected one.
 *
 * This does not invent the missing check. It surfaces what the corpus actually
 * records so the claim stops being unconditional, and `limit_recorded` carries the
 * honest caveat: false means the cutoff is unknown, NOT that there is none.
 */
export function attachDescentRelations(heritage, pilot) {
  const byRouteId = new Map();
  for (const jurisdiction of pilot.jurisdictions) {
    for (const route of jurisdiction.routes ?? []) {
      if (route.mode !== 'ancestry') continue;
      byRouteId.set(route.id, (route.variants ?? []).flatMap(v => v.eligibility ?? []));
    }
  }
  return heritage.map(rule => {
    const conditions = byRouteId.get(rule.route_id);
    const finding = conditions ? deriveDescentRelations(conditions) : null;
    if (!finding) return rule;
    return {
      ...rule,
      relations: finding.relations,
      deepest_recorded_degree: finding.deepest_recorded_degree,
      limit_recorded: finding.limit_recorded,
      ...(finding.maximum_degree !== null ? { maximum_degree: finding.maximum_degree } : {}),
    };
  });
}

/**
 * Curated rules WIN where they exist: they carry conditional tiers (Portugal's
 * CPLP/EU split, Spain's Ibero-American track) that canonical facts cannot yet
 * express, and overriding them would change shipped planner output. Derived
 * rules only FILL GAPS, so this is additive by construction. Upgrading the
 * remaining `legacy` curated figures to canonical is a separate, per-case review:
 * 18 of them disagree with canonical today.
 */
export function mergeDerivedNaturalization(output, derived) {
  const curated = new Set(output.naturalization.map(rule => rule.iso_n3));
  const added = [...derived.values()].filter(rule => !curated.has(rule.iso_n3));
  return {
    ...output,
    meta: {
      ...output.meta,
      naturalization_curated: curated.size,
      naturalization_derived: added.length,
    },
    naturalization: [...output.naturalization, ...added]
      .sort((a, b) => a.iso_n3.localeCompare(b.iso_n3)),
  };
}

if (import.meta.main) {
  const source = JSON.parse(fs.readFileSync('data/timeline_rules.json', 'utf8'));
  const citizenshipRoutes = JSON.parse(fs.readFileSync('data/citizenship_routes.json', 'utf8'));
  const pilot = buildCanonicalPilot();
  const derived = deriveOrdinaryNaturalization(pilot);
  const merged = mergeDerivedNaturalization(
    buildTimelineRules(source, citizenshipRoutes), derived);
  const output = { ...merged, heritage: attachDescentRelations(merged.heritage, pilot) };
  const curatedIsos = new Set(source.naturalization.map(rule => rule.iso_n3));
  const added = output.naturalization.length - curatedIsos.size;

  fs.writeFileSync('src/data/timeline_rules.generated.json', `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    `src/data/timeline_rules.generated.json: ${output.naturalization.length} naturalization `
    + `(${curatedIsos.size} curated + ${added} derived from canonical), `
    + `${output.heritage.length} heritage, ${output.investment.length} investment`,
  );
  if (CANONICAL_SOURCE_IS_SAMPLE) {
    console.warn(
      '  WARNING: canonical source is the 6-jurisdiction sample, so derived coverage is '
      + 'minimal. Regenerate on a maintainer checkout before committing.',
    );
  }
}

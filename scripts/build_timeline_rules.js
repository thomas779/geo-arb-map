#!/usr/bin/env bun
/**
 * Compile data/timeline_rules.json into a compact browser/graph index.
 *
 * Reviewed durations remain references to numeric facts in
 * data/citizenship_routes.json. The generated public file resolves those
 * references so browser code does not bundle the full research corpus.
 */

import fs from 'node:fs';

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

export function buildTimelineRules(source, citizenshipRoutes) {
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

if (import.meta.main) {
  const source = JSON.parse(fs.readFileSync('data/timeline_rules.json', 'utf8'));
  const citizenshipRoutes = JSON.parse(fs.readFileSync('data/citizenship_routes.json', 'utf8'));
  const output = buildTimelineRules(source, citizenshipRoutes);
  fs.writeFileSync('public/timeline_rules.json', `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    `public/timeline_rules.json: ${output.naturalization.length} naturalization, `
    + `${output.heritage.length} heritage, ${output.investment.length} investment`,
  );
}

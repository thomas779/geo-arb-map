import timelineRulesJson from '../data/timeline_rules.generated.json';
import type { BlocsData } from '../types';

export type TimelineConfidence = 'high' | 'medium' | 'legacy';

export interface TimelineCondition {
  id: string;
  minimum_months: number;
  qualifying_lane_id?: string;
  qualifying_bloc_ids?: string[];
  excluded_iso_n3?: string[];
}

export interface NaturalizationTimeline {
  iso_n3: string;
  ordinary_months: number;
  confidence: TimelineConfidence;
  conditional?: TimelineCondition[];
}

/** Personal descent / diaspora claim → destination path (was "heritage lanes"). */
export interface DescentTimeline {
  iso_n3: string;
  route_id: string;
  duration_months: number;
  /** `ancestor` = profile.ancestors includes iso; `claim:<id>` = profile.heritages includes id */
  gate: string;
  confidence: TimelineConfidence;
}

interface TimelineRules {
  naturalization: NaturalizationTimeline[];
  heritage: DescentTimeline[];
  investment: Array<{
    iso_n3: string;
    duration_months: number;
    confidence: TimelineConfidence;
  }>;
}

export const monthsToYears = (months: number): number => months / 12;

export const TIMELINE_RULES = timelineRulesJson as TimelineRules;

/** Years to citizenship (or settlement-then-cit) for descent paths, keyed by destination ISO. */
export const DESCENT_YEARS: Record<string, number> = Object.fromEntries(
  TIMELINE_RULES.heritage.map(rule => [rule.iso_n3, monthsToYears(rule.duration_months)]),
);

/** All descent path rules (planner, edges, UI). */
export const DESCENT_PATHS: DescentTimeline[] = TIMELINE_RULES.heritage;

export const CBI_YEARS: Record<string, number> = Object.fromEntries(
  TIMELINE_RULES.investment.map(rule => [rule.iso_n3, monthsToYears(rule.duration_months)]),
);

export function naturalizationYears(): Map<string, number> {
  return new Map(
    TIMELINE_RULES.naturalization.map(rule => [
      rule.iso_n3,
      monthsToYears(rule.ordinary_months),
    ]),
  );
}

export function timelineBeneficiaryIsos(
  data: BlocsData,
  condition: TimelineCondition,
): string[] {
  const isos = new Set<string>();
  if (condition.qualifying_lane_id) {
    data.bilateral_lanes
      .find(lane => lane.id === condition.qualifying_lane_id)
      ?.beneficiaries.forEach(member => isos.add(member.iso_n3));
  }
  for (const blocId of condition.qualifying_bloc_ids ?? []) {
    data.blocs
      .find(bloc => bloc.id === blocId)
      ?.members.forEach(member => isos.add(member.iso_n3));
  }
  for (const iso of condition.excluded_iso_n3 ?? []) isos.delete(iso);
  return [...isos];
}

export function naturalizationRule(iso: string): NaturalizationTimeline | undefined {
  return TIMELINE_RULES.naturalization.find(rule => rule.iso_n3 === iso);
}

/** Whether a profile satisfies a descent-path gate. */
export function descentGateSatisfied(
  gate: string,
  profile: { ancestors: string[]; heritages: string[] },
  iso_n3: string,
): boolean {
  if (gate === 'ancestor') return profile.ancestors.includes(iso_n3);
  if (gate.startsWith('claim:')) return profile.heritages.includes(gate.slice(6));
  return false;
}

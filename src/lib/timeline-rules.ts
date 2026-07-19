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

interface TimelineRules {
  naturalization: NaturalizationTimeline[];
  heritage: Array<{
    lane_id: string;
    duration_months: number;
    confidence: TimelineConfidence;
  }>;
  investment: Array<{
    iso_n3: string;
    duration_months: number;
    confidence: TimelineConfidence;
  }>;
}

export const monthsToYears = (months: number): number => months / 12;

export const TIMELINE_RULES = timelineRulesJson as TimelineRules;

export const DESCENT_YEARS: Record<string, number> = Object.fromEntries(
  TIMELINE_RULES.heritage.map(rule => [rule.lane_id, monthsToYears(rule.duration_months)]),
);

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

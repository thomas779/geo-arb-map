import type { ResidenceCategory, ResidenceRoute } from '@/types';

/** Shared labels for residence categories (country pages + panels). */
export const RESIDENCE_CATEGORY_LABELS: Record<ResidenceCategory, string> = {
  investment: 'Investment (golden visa)',
  digital_nomad: 'Digital nomad',
  digital_identity: 'Digital identity',
  retirement_pension: 'Retirement',
  talent_skilled: 'Talent',
  general_permanent_residence: 'Permanent residence',
};

/** Short labels for dense UI (panel chips). */
export const RESIDENCE_CATEGORY_SHORT: Record<ResidenceCategory, string> = {
  investment: 'Investment',
  digital_nomad: 'Digital nomad',
  digital_identity: 'Digital ID',
  retirement_pension: 'Retirement',
  talent_skilled: 'Talent',
  general_permanent_residence: 'Permanent residence',
};

export const RESIDENCE_STATUS_ORDER = [
  'active',
  'pending_verification',
  'inactive',
  'verified_negative',
] as const;

export const RESIDENCE_STATUS_LABELS: Record<string, string> = {
  inactive: 'paused',
  verified_negative: 'closed',
  pending_verification: 'unverified',
};

/** Explicit PR / naturalization ladder chips for residence cards. */
export function residenceLadderBadges(route: ResidenceRoute): Array<{
  key: string;
  label: string;
  tone: 'positive' | 'neutral' | 'muted';
}> {
  return [
    {
      key: 'pr',
      label: route.counts_toward_permanent_residence ? 'PR path: yes' : 'PR path: no',
      tone: route.counts_toward_permanent_residence ? 'positive' : 'muted',
    },
    {
      key: 'nat',
      label: route.counts_toward_naturalization ? 'Citizenship path: yes' : 'Citizenship path: no',
      tone: route.counts_toward_naturalization ? 'positive' : 'muted',
    },
  ];
}

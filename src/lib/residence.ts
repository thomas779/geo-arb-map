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
  // "Golden visa", not "Investment": citizenship routes already use mode
  // 'investment' for citizenship-BY-investment, and the collision made readers
  // assume a residence investment route ends in a passport. It usually doesn't —
  // of 141 golden visas, 54 lead no further than residence.
  investment: 'Golden visa',
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

/**
 * Explicit PR / naturalization ladder chips for residence cards.
 *
 * The category says what you put in; only these say what you get out. Both the
 * country page and the Atlas panel must read them from here — they previously
 * computed the same yes/no twice with different wording, so the same route
 * rendered as "PR path: no" on one surface and "PR no" on the other.
 * `variant: 'short'` is for the dense panel rows.
 */
export function residenceLadderBadges(
  route: ResidenceRoute,
  { variant = 'long' }: { variant?: 'long' | 'short' } = {},
): Array<{
  key: string;
  label: string;
  tone: 'positive' | 'neutral' | 'muted';
}> {
  const pr = route.counts_toward_permanent_residence;
  const nat = route.counts_toward_naturalization;
  const short = variant === 'short';
  return [
    {
      key: 'pr',
      label: short ? (pr ? 'PR yes' : 'PR no') : (pr ? 'PR path: yes' : 'PR path: no'),
      tone: pr ? 'positive' : 'muted',
    },
    {
      key: 'nat',
      label: short
        ? (nat ? 'cit. yes' : 'cit. no')
        : (nat ? 'Citizenship path: yes' : 'Citizenship path: no'),
      tone: nat ? 'positive' : 'muted',
    },
  ];
}

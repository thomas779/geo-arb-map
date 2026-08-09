import type { ResidenceCategory, ResidenceRouteSummary } from '@/types';

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

/**
 * Product inventory for the atlas: programmes that exist (or existed).
 *
 * - `active` — live route
 * - `inactive` — ended real programme (keep the story + dates)
 * - `pending_verification` — claimed product still under review
 *
 * Absences are not stored and not footnoted. If we have no golden visa row for
 * a country, silence is enough — writing "not recorded / verified absent" is
 * just another way of publishing a negative.
 */
export function residenceCardRoutes<T extends ResidenceRouteSummary>(residence: T[]): T[] {
  return residence.filter(route =>
    route.status === 'active'
    || route.status === 'inactive'
    || route.status === 'pending_verification',
  );
}

export const RESIDENCE_STATUS_ORDER = [
  'active',
  'pending_verification',
  'inactive',
] as const;

export const RESIDENCE_STATUS_LABELS: Record<string, string> = {
  inactive: 'ended',
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
// What the permit lets you DO locally, read from the instrument — never
// inferred (null = not recorded, and no chip renders). Rentista/retirement
// permits typically bar local work entirely; nomad visas allow only foreign
// remote work; that difference was previously invisible on every surface.
export const WORK_RIGHTS_LABELS: Record<string, { long: string; short: string }> = {
  full: { long: 'Local work: yes', short: 'work yes' },
  employer_sponsored: { long: 'Work: sponsor-tied', short: 'sponsor-tied' },
  self_employment: { long: 'Work: own business only', short: 'own business' },
  remote_only: { long: 'Remote work only', short: 'remote only' },
  none: { long: 'Local work: no', short: 'work no' },
};

export function residenceLadderBadges(
  route: ResidenceRouteSummary,
  { variant = 'long' }: { variant?: 'long' | 'short' } = {},
): Array<{
  key: string;
  label: string;
  tone: 'positive' | 'neutral' | 'muted';
}> {
  const pr = route.counts_toward_permanent_residence;
  const nat = route.counts_toward_naturalization;
  const short = variant === 'short';
  const badges: Array<{ key: string; label: string; tone: 'positive' | 'neutral' | 'muted' }> = [
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
  const work = route.work_rights ? WORK_RIGHTS_LABELS[route.work_rights] : null;
  if (work) {
    badges.push({
      key: 'work',
      label: short ? work.short : work.long,
      tone: route.work_rights === 'full' ? 'positive' : 'neutral',
    });
  }
  return badges;
}

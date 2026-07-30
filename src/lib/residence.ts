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

/**
 * Categories a reader will actively look for on any country. When a reviewed
 * jurisdiction simply has no row in one of these, the page derives a one-line
 * "not recorded" statement instead of storing a negative route.
 *
 * Why derived: stored negatives had become an arbitrary signal — Germany had a
 * "no golden visa" row while Sweden (same fact) had silence, and silence reads
 * as "unchecked". Stored `verified_negative` rows are reserved for CONTESTED
 * absences — every one of the 27 investment negatives is a country the IMC
 * industry map claims has an RBI programme — while the default case is computed
 * here, so it is consistent by construction.
 */
export const HEADLINE_CATEGORIES: ReadonlyArray<{ category: ResidenceCategory; absenceLabel: string }> = [
  { category: 'investment', absenceLabel: 'golden visa / residence-by-investment' },
  { category: 'digital_nomad', absenceLabel: 'digital-nomad programme' },
];

/**
 * Headline categories with no row of ANY status for this jurisdiction.
 * Fires only when the jurisdiction has residence coverage at all — deriving
 * "no golden visa recorded" for a country whose residence layer was never
 * reviewed would claim more than we know. Categories whose absence was
 * VERIFIED (a verified_negative row exists) are excluded here: they get the
 * stronger sourced statement from verifiedResidenceNegatives instead.
 */
export function derivedResidenceAbsences(residence: ResidenceRoute[]): string[] {
  if (!residence.length) return [];
  const present = new Set(residence.map(route => route.category));
  return HEADLINE_CATEGORIES.filter(h => !present.has(h.category)).map(h => h.absenceLabel);
}

/**
 * Verified non-existence, presented as a quiet sourced line rather than a card.
 *
 * Owner rule: never give a card to something that never existed. A card titled
 * "No dedicated digital nomad visa" reads with the same visual weight as a real
 * programme; the checked fact belongs in a footnote with its official source.
 * Cards are reserved for things with a story — active routes and lapsed
 * programmes (`inactive`, which carry their run dates).
 */
export function verifiedResidenceNegatives(residence: ResidenceRoute[]): ResidenceRoute[] {
  return residence.filter(route => route.status === 'verified_negative');
}

/** Everything that should render as a card: active, lapsed, pending. */
export function residenceCardRoutes(residence: ResidenceRoute[]): ResidenceRoute[] {
  return residence.filter(route => route.status !== 'verified_negative');
}

export const RESIDENCE_STATUS_ORDER = [
  'active',
  'pending_verification',
  'inactive',
  'verified_negative',
] as const;

export const RESIDENCE_STATUS_LABELS: Record<string, string> = {
  inactive: 'ended',
  // Not "closed": a verified negative means the programme was checked and does
  // not exist (every stored one is a contested claim, usually the IMC map).
  // "closed" implied a programme once ran and ended — the wrong story on
  // Germany, which never had a golden visa. Lapsed programmes use `inactive`.
  verified_negative: 'does not exist',
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

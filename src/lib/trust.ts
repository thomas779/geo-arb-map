export const REPOSITORY_URL = 'https://github.com/thomas779/geo-arb-map';

const URL_PATTERN = /https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/i;

export function sourceUrl(source: string): string | null {
  const match = source.match(URL_PATTERN)?.[0]?.replace(/[.,;:]+$/, '');
  if (!match) return null;
  return match.startsWith('http') ? match : `https://${match}`;
}

// contextId prefix (country:/bloc:/lane:) → the matching data-correction.yml
// `entry_type` dropdown option, so the report opens with the right type chosen.
const ENTRY_TYPE_BY_KIND: Record<string, string> = {
  country: 'Country profile (citizenship / residence routes)',
  bloc: 'Regional system / bloc (/rights page)',
  lane: 'Heritage or treaty route (/route or lane)',
};

/**
 * Build a prefilled GitHub issue-form URL. GitHub prefills a form field when a
 * query param matches its `id` — so instead of dumping metadata into the title,
 * we set a clean title and prefill `context` (name + id) and the `entry_type`
 * dropdown from the contextId prefix. Leaves the actual claim for the reporter.
 */
export function dataCorrectionUrl(label?: string, contextId?: string): string {
  const url = new URL(`${REPOSITORY_URL}/issues/new`);
  url.searchParams.set('template', 'data-correction.yml');
  if (label) url.searchParams.set('title', `[Data correction] ${label}`);
  if (contextId) {
    url.searchParams.set('context', label ? `${label} — ${contextId}` : contextId);
    const entryType = ENTRY_TYPE_BY_KIND[contextId.split(':')[0]];
    if (entryType) url.searchParams.set('entry_type', entryType);
  } else if (label) {
    url.searchParams.set('context', label);
  }
  return url.toString();
}

export function productFeedbackUrl(): string {
  const url = new URL(`${REPOSITORY_URL}/issues/new`);
  url.searchParams.set('template', 'product-feedback.yml');
  return url.toString();
}

export const METHODOLOGY_URL = `${REPOSITORY_URL}#where-the-data-comes-from`;


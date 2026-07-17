export const REPOSITORY_URL = 'https://github.com/thomas779/geo-arb-map';

const URL_PATTERN = /https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/i;

export function sourceUrl(source: string): string | null {
  const match = source.match(URL_PATTERN)?.[0]?.replace(/[.,;:]+$/, '');
  if (!match) return null;
  return match.startsWith('http') ? match : `https://${match}`;
}

export function dataCorrectionUrl(label?: string, contextId?: string): string {
  const url = new URL(`${REPOSITORY_URL}/issues/new`);
  url.searchParams.set('template', 'data-correction.yml');
  if (label) {
    const context = contextId ? ` (${contextId})` : '';
    url.searchParams.set('title', `[Data correction] ${label}${context}`);
  }
  return url.toString();
}

export function productFeedbackUrl(): string {
  const url = new URL(`${REPOSITORY_URL}/issues/new`);
  url.searchParams.set('template', 'product-feedback.yml');
  return url.toString();
}

export const METHODOLOGY_URL = `${REPOSITORY_URL}#where-the-data-comes-from`;


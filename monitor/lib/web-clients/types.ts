export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string | null;
  published: string | null;
  score: number | null;
  raw?: unknown;
}

export interface WebSearchResult {
  provider: 'exa' | 'tavily' | 'firecrawl';
  hits: WebSearchHit[];
  /** Provider credit units when reported (Tavily/Firecrawl). */
  credits_used: number | null;
  /** Exa dollar estimate when reported. */
  cost_dollars: number | null;
  /** Structured synthesis payload when the provider returns one (Exa output). */
  structured: unknown | null;
  request_id: string | null;
  error?: string;
}

export interface WebScrapeResult {
  provider: 'firecrawl';
  url: string;
  markdown: string | null;
  credits_used: number | null;
  error?: string;
}

export const SOCIAL_NOISE_DOMAINS = [
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'reddit.com',
  'pinterest.com',
  'linkedin.com',
] as const;

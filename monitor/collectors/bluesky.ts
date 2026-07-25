// Bluesky discovery via the AT Protocol public AppView (keyless, $0). Two modes:
//   - `bluesky`        — an account's feed (getAuthorFeed): follow a known
//                        immigration lawyer / agency / specialist.
//   - `bluesky_search` — a keyword search across the network (searchPosts).
// Both emit one Signal per post, flagging the jurisdiction for the verify sweep,
// and their post URLs feed the citation loop. Discovery only — a Bluesky post
// never verifies a dataset change on its own.

import { makeSignal, type Signal, type SignalTier } from '../schema/signal';

const APPVIEW = 'https://public.api.bsky.app/xrpc';

export interface BlueskySource {
  id: string;
  tier: SignalTier;
  adapter: 'bluesky' | 'bluesky_search';
  url?: string;      // profile URL (author feed), e.g. https://bsky.app/profile/<handle>
  handle?: string;   // alternative to url
  query?: string;    // explicit search query (bluesky_search)
  keywords?: string[]; // used as the query when none is given, and to filter posts
  jurisdictions?: string[];
  max_items?: number;
}

// Extract a handle/DID from a profile URL, or accept a bare handle.
export function handleFromProfileUrl(value?: string): string | null {
  if (!value) return null;
  const match = value.match(/bsky\.app\/profile\/([^/?#]+)/i);
  if (match) return match[1];
  return /^[a-z0-9.:_-]+$/i.test(value) ? value : null;
}

// Public web URL for an at:// post URI (rkey is the URI's last segment).
export function postUrl(uri: string, handle: string): string {
  const rkey = uri.split('/').pop() ?? '';
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

interface BlueskyPost {
  uri?: string;
  author?: { handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string };
  indexedAt?: string;
}

// Accepts both getAuthorFeed (`feed[].post`) and searchPosts (`posts[]`) shapes.
export function parseBlueskyPosts(
  json: unknown,
  source: BlueskySource,
  { retrievedAt }: { retrievedAt?: string } = {},
): Signal[] {
  const body = json as { feed?: Array<{ post?: BlueskyPost }>; posts?: BlueskyPost[] };
  const posts: BlueskyPost[] = body.feed
    ? body.feed.map(entry => entry.post).filter((post): post is BlueskyPost => Boolean(post))
    : (body.posts ?? []);
  const max = Number(source.max_items ?? 25);
  const seen = new Set<string>();
  const signals: Signal[] = [];
  for (const post of posts.slice(0, max)) {
    const uri = post?.uri;
    const handle = post?.author?.handle;
    const text = post?.record?.text?.trim().replace(/\s+/g, ' ');
    if (!uri || !handle || !text || seen.has(uri)) continue;
    seen.add(uri);
    signals.push(makeSignal({
      sourceId: source.id,
      tier: source.tier,
      jurisdiction: source.jurisdictions?.[0] ?? 'multi',
      externalId: uri,
      url: postUrl(uri, handle),
      title: text.slice(0, 140),
      excerpt: text.slice(0, 500),
      publishedAt: post?.record?.createdAt ?? post?.indexedAt ?? null,
      retrievedAt,
    }));
  }
  return signals;
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'flag-paths-monitor' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`bluesky: ${endpointLabel(url)} failed (${response.status})`);
  return response.json();
}

function endpointLabel(url: string): string {
  return url.includes('searchPosts') ? 'searchPosts' : 'getAuthorFeed';
}

export function blueskyEndpoint(source: BlueskySource): string {
  const limit = Number(source.max_items ?? 25);
  if (source.adapter === 'bluesky_search') {
    const query = source.query || (source.keywords ?? []).join(' ');
    if (!query) throw new Error(`bluesky_search ${source.id}: no query or keywords`);
    return `${APPVIEW}/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=${limit}&sort=latest`;
  }
  const handle = source.handle ?? handleFromProfileUrl(source.url);
  if (!handle) throw new Error(`bluesky ${source.id}: no handle (set url or handle)`);
  return `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${limit}&filter=posts_no_replies`;
}

export async function collectBluesky(
  source: BlueskySource,
  { fetchImpl = fetch, retrievedAt }: { fetchImpl?: typeof fetch; retrievedAt?: string } = {},
): Promise<Signal[]> {
  return parseBlueskyPosts(await getJson(blueskyEndpoint(source), fetchImpl), source, { retrievedAt });
}

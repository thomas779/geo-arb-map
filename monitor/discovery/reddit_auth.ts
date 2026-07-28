#!/usr/bin/env bun

// Reddit OAuth for the hand-raiser radar.
//
// Anonymous access does not survive a full watchlist run — see the header of
// reddit_intent.ts. A free registered "script" app raises the limit to ~100
// requests/minute per client and is the supported path.
//
// Setup (one-off, needs your Reddit login):
//   1. https://www.reddit.com/prefs/apps → "create another app..."
//   2. type: script · name: flag-paths-monitor · redirect uri: http://localhost:8080
//   3. copy the client id (under the app name) and the secret
//   4. put these in .env (gitignored) or the GitHub Actions secrets:
//        MONITOR_REDDIT_CLIENT_ID
//        MONITOR_REDDIT_CLIENT_SECRET
//        MONITOR_REDDIT_USERNAME
//        MONITOR_REDDIT_PASSWORD
//
// The script grant only works for the account that owns the app, which is what
// we want: the radar reads as you, and any comment posted is posted by you.

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
export const USER_AGENT =
  'flag-paths-monitor/1.0 (open citizenship atlas; https://flagpaths.com)';

export interface RedditCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

/** Read credentials from the environment, or null when not fully configured. */
export function redditCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): RedditCredentials | null {
  const clientId = env.MONITOR_REDDIT_CLIENT_ID;
  const clientSecret = env.MONITOR_REDDIT_CLIENT_SECRET;
  const username = env.MONITOR_REDDIT_USERNAME;
  const password = env.MONITOR_REDDIT_PASSWORD;
  if (!clientId || !clientSecret || !username || !password) return null;
  return { clientId, clientSecret, username, password };
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/** Parse and validate a token response, failing loudly on Reddit's error shape. */
export function parseTokenResponse(body: unknown): { token: string; expiresAt: number } {
  if (typeof body !== 'object' || body === null) {
    throw new Error('reddit token: response was not an object');
  }
  const record = body as Record<string, unknown>;
  if (typeof record.error === 'string' || typeof record.error === 'number') {
    // Reddit answers bad credentials with 200 + {"error": "invalid_grant"}, so a
    // status check alone is not enough.
    throw new Error(`reddit token: ${record.error}${record.message ? ` — ${record.message}` : ''}`);
  }
  if (typeof record.access_token !== 'string' || !record.access_token) {
    throw new Error('reddit token: no access_token in response');
  }
  const expiresIn = typeof record.expires_in === 'number' ? record.expires_in : 3600;
  // Refresh a minute early so a long run never trips over expiry mid-flight.
  return { token: record.access_token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
}

export class RedditClient {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly credentials: RedditCredentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString('base64');
    const response = await this.fetcher(TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: this.credentials.username,
        password: this.credentials.password,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const parsed = parseTokenResponse(await response.json());
    this.token = parsed.token;
    this.expiresAt = parsed.expiresAt;
    return parsed.token;
  }

  /** Authenticated request against oauth.reddit.com. Returns parsed JSON. */
  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.accessToken();
    const response = await this.fetcher(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${token}`,
        'user-agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    if (Number.isFinite(remaining) && remaining < 5) {
      const reset = Number(response.headers.get('x-ratelimit-reset')) || 60;
      console.warn(`reddit: ${remaining} requests left, window resets in ${reset}s`);
    }
    if (!response.ok) {
      throw new Error(`reddit ${path}: ${response.status} ${await response.text()}`);
    }
    return response.json();
  }

  /** Newest posts in a subreddit, via the authenticated listing endpoint. */
  async newPosts(subreddit: string, limit = 50): Promise<Array<Record<string, unknown>>> {
    const body = await this.request(`/r/${subreddit}/new?limit=${limit}&raw_json=1`);
    const children = (body as { data?: { children?: Array<{ data?: unknown }> } })?.data?.children;
    if (!Array.isArray(children)) return [];
    return children
      .map(child => child.data)
      .filter((data): data is Record<string, unknown> => typeof data === 'object' && data !== null);
  }

  /**
   * Post a comment. Deliberately takes a fully-formed body that a human wrote —
   * there is no generate-and-post path, because a promotional pattern can get
   * flagpaths.com domain-banned site-wide, which is not recoverable.
   */
  async comment(thingId: string, body: string): Promise<unknown> {
    if (!/^t[13]_[a-z0-9]+$/i.test(thingId)) {
      throw new Error(`reddit comment: expected a t3_/t1_ fullname, got ${thingId}`);
    }
    if (!body.trim()) throw new Error('reddit comment: empty body');
    return this.request('/api/comment', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_type: 'json', thing_id: thingId, text: body }),
    });
  }
}

/** Build a client from the environment, or null when credentials are absent. */
export function redditClientFromEnv(fetcher: typeof fetch = fetch): RedditClient | null {
  const credentials = redditCredentialsFromEnv();
  return credentials ? new RedditClient(credentials, fetcher) : null;
}

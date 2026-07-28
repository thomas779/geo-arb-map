#!/usr/bin/env bun

// Reddit hand-raiser radar. People post timestamped, self-qualified questions
// ("is the Portugal golden visa still open?", "how do I get residency in
// Georgia?") in a handful of subreddits — exactly the questions the Atlas
// answers with primary sources. This watcher finds fresh posts that match an
// intent phrase AND a topic keyword and compiles a digest for the OWNER to
// answer personally on Reddit. It never posts, never emails, never scrapes
// user identities — leads only, human answers. (Cold-outreach automation would
// burn the exact communities the Atlas needs.)
//
// Zero-key: uses Reddit's public Atom listings with a descriptive user-agent
// at a polite rate (one request per subreddit per run).
//
// KNOWN LIMIT (2026-07-28): anonymous access does not survive a full watchlist.
// A 10-subreddit run at 3s pacing 429s on ~8 of them, and repeated runs escalate
// to a hard block — www.reddit.com starts failing TLS verification outright while
// old.reddit.com returns 403. Backoff below helps with throttling but cannot fix a
// block. Do NOT schedule this until it authenticates: a free registered "script"
// OAuth app raises the limit to ~100 requests/minute and is the supported path.
// Until then treat it as a manual, occasional tool.
//
// CLI: bun monitor/discovery/reddit_intent.ts [--hours 12] [--config <path>]
//   Writes monitor/.out/reddit-leads.json + prints a human digest.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG = path.join(ROOT, 'sources', 'reddit-intent.json');
const USER_AGENT = 'flag-paths-monitor/1.0 (open citizenship atlas; https://flagpaths.com)';

export interface RedditIntentConfig {
  subreddits: string[];
  intent_phrases: string[];
  topic_keywords: string[];
}

export interface RedditLead {
  id: string;
  subreddit: string;
  title: string;
  url: string;
  created_utc: number;
  age_hours: number;
  matched_intent: string[];
  matched_topics: string[];
  score: number;
  excerpt: string;
}

interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  selftext?: string;
  permalink: string;
  created_utc: number;
}

const decodeXml = (value: string) => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Parse Reddit's Atom feed (the JSON listings 403 anonymous clients; RSS does not). */
export function parseRedditAtom(xml: string, subreddit: string): RedditPost[] {
  const posts: RedditPost[] = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const title = decodeXml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const link = entry.match(/<link href="([^"]+)"/)?.[1] ?? '';
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1]
      ?? entry.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? '';
    const id = entry.match(/<id>t3_([a-z0-9]+)<\/id>/)?.[1] ?? link;
    const contentHtml = decodeXml(entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? '');
    const selftext = contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const createdUtc = published ? Date.parse(published) / 1000 : 0;
    if (!title || !link || !createdUtc) continue;
    posts.push({
      id,
      subreddit,
      title,
      selftext,
      permalink: link.replace(/^https:\/\/www\.reddit\.com/, ''),
      created_utc: createdUtc,
    });
  }
  return posts;
}

/** Score a post: needs >=1 intent phrase AND >=1 topic keyword to count. */
export function scorePost(
  post: Pick<RedditPost, 'title' | 'selftext'>,
  config: Pick<RedditIntentConfig, 'intent_phrases' | 'topic_keywords'>,
): { intents: string[]; topics: string[]; score: number } {
  const haystack = `${post.title}\n${post.selftext ?? ''}`.toLowerCase();
  const intents = config.intent_phrases.filter(p => haystack.includes(p.toLowerCase()));
  const topics = config.topic_keywords.filter(k => haystack.includes(k.toLowerCase()));
  if (intents.length === 0 || topics.length === 0) return { intents, topics, score: 0 };
  // Question marks and first-person asks are stronger signals; titles beat bodies.
  let score = intents.length + topics.length;
  if (post.title.includes('?')) score += 2;
  if (/\b(i|we|my|our)\b/i.test(post.title)) score += 1;
  if (config.topic_keywords.some(k => post.title.toLowerCase().includes(k.toLowerCase()))) score += 2;
  return { intents, topics, score };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Anonymous Reddit throttles the RSS endpoint hard: a flat 3s pace 429s most of a
 *  10-subreddit run. Retry on 429/5xx with exponential backoff, honouring
 *  Retry-After when Reddit sends it. */
async function fetchNewPosts(
  subreddit: string,
  fetcher: typeof fetch = fetch,
  attempts = 3,
): Promise<RedditPost[]> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetcher(`https://www.reddit.com/r/${subreddit}/new.rss?limit=50`, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return parseRedditAtom(await response.text(), subreddit);

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts) {
      console.warn(`r/${subreddit}: ${response.status} — skipped`);
      return [];
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 5000 * 2 ** (attempt - 1);
    console.warn(`r/${subreddit}: ${response.status} — retrying in ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
  return [];
}

export function buildDigest(leads: RedditLead[]): string {
  if (leads.length === 0) return 'no hand-raisers in the window';
  return leads.map(lead =>
    `[${lead.score}] r/${lead.subreddit} · ${lead.age_hours.toFixed(1)}h ago\n` +
    `    ${lead.title}\n` +
    `    ${lead.url}\n` +
    `    matched: ${[...lead.matched_intent, ...lead.matched_topics].join(', ')}`,
  ).join('\n\n');
}

async function main(): Promise<void> {
  const hoursIndex = process.argv.indexOf('--hours');
  const windowHours = hoursIndex >= 0 ? Number(process.argv[hoursIndex + 1]) : 12;
  const configIndex = process.argv.indexOf('--config');
  const configPath = configIndex >= 0 ? path.resolve(process.argv[configIndex + 1]) : DEFAULT_CONFIG;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RedditIntentConfig;

  const now = Date.now() / 1000;
  const leads: RedditLead[] = [];
  let reached = 0;
  for (const subreddit of config.subreddits) {
    const posts = await fetchNewPosts(subreddit);
    if (posts.length > 0) reached += 1;
    for (const post of posts) {
      const ageHours = (now - post.created_utc) / 3600;
      if (ageHours > windowHours) continue;
      const { intents, topics, score } = scorePost(post, config);
      if (score === 0) continue;
      leads.push({
        id: post.id,
        subreddit: post.subreddit,
        title: post.title.slice(0, 200),
        url: `https://www.reddit.com${post.permalink}`,
        created_utc: post.created_utc,
        age_hours: ageHours,
        matched_intent: intents,
        matched_topics: topics,
        score,
        excerpt: (post.selftext ?? '').replace(/\s+/g, ' ').slice(0, 280),
      });
    }
    // polite pacing between subreddit requests; 3s was not enough to stay under
    // the anonymous RSS limit across a full watchlist
    await sleep(8000);
  }

  leads.sort((a, b) => b.score - a.score || a.age_hours - b.age_hours);
  const outDir = path.join(ROOT, '.out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'reddit-leads.json'), `${JSON.stringify(leads, null, 1)}\n`);
  // A zero-lead run is ambiguous: quiet communities and a Reddit block look the
  // same. Say which it was, so an empty digest is never read as "nothing to answer".
  if (reached === 0) {
    console.error(
      `reached 0 of ${config.subreddits.length} subreddits — Reddit is blocking this client, ` +
      'not a quiet window. Wait for the block to lapse, or add OAuth (see file header).',
    );
    process.exitCode = 1;
  } else if (reached < config.subreddits.length) {
    console.warn(`partial run: reached ${reached} of ${config.subreddits.length} subreddits\n`);
  }
  console.log(`${leads.length} hand-raiser(s) in the last ${windowHours}h across ${reached} subreddit(s)\n`);
  console.log(buildDigest(leads));
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

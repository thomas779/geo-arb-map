// Citation-mining for the discovery layer. Every grounded sweep cites the
// outlets it read to surface a change (Finding.citations). Those citations are
// the empirical answer to "which outlets report mobility law changes, and for
// which countries" — far better than hand-guessing a feed list. We accumulate
// each unique cited URL in the monitor_citations ledger, then rank the domains
// (and social accounts) by how often, and for how many jurisdictions, they
// surface real changes, and probe each for an RSS/Atom feed to subscribe to.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import type { Finding } from '../sweep/run';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 flag-paths-monitor';
const FETCH_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*',
};

// Host without a leading www., lowercased. null for anything unparseable.
export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Social hosts publish per-account, not per-site, so they must be grouped by
// account — one row for @lawyerA, another for @lawyerB on the same instance.
export function isSocialHost(host: string): boolean {
  return /(^|\.)mastodon\./.test(host)
    || /\.social$/.test(host)
    || host === 'bsky.app'
    || host === 'bsky.social'
    || host === 'threads.net'
    || host === 'x.com'
    || host === 'twitter.com'
    || host === 'nitter.net';
}

// A rough .gov/.gob/.gouv/.govt/.go detector plus a few known official hosts.
// Used only to LABEL a candidate (agencies are wanted, but should be
// distinguishable from independent outlets in the report), never to exclude.
// Official legislation portals that carry no .gov-family suffix. Every one of
// these was hit while sourcing real jurisdictions, and each would otherwise be
// scored as an independent outlet — which matters because the same predicate
// feeds source-candidate ranking. Keep sorted by host for scanning.
const OFFICIAL_LEGISLATION_HOSTS = [
  'adilet.zan.kz', // Kazakhstan, Ministry of Justice legal information system (Әділет)
  'arlis.am', // Armenia, Legal Information System of the Republic of Armenia
  'e-tar.lt', // Lithuania, Teisės aktų registras
  'ejustice.just.fgov.be', // Belgium, Moniteur belge / Belgisch Staatsblad
  'elperuano.pe', // Peru, Diario Oficial El Peruano
  'indiacode.nic.in', // India, official code repository
  'kenyalaw.org', // Kenya, National Council for Law Reporting (statutory body)
  'legis.md', // Moldova, Registrul de stat al actelor juridice
  'legislation.gov.uk', // UK, The National Archives
  'legislation.mt', // Malta, Laws of Malta
  'legislatie.just.ro', // Romania, Ministry of Justice
  'pisrs.si', // Slovenia, Pravno-informacijski sistem
  'portaljuridicandorra.ad', // Andorra, Portal Jurídic
  'riigiteataja.ee', // Estonia, State Gazette
  'slov-lex.sk', // Slovakia, Slov-Lex (incl. static.slov-lex.sk)
  'tuvalu-legislation.tv', // Tuvalu, PacLII-hosted national legislation
  'uradni-list.si', // Slovenia, Uradni list RS (Official Gazette publisher)
  'zakon.rada.gov.ua', // Ukraine, Verkhovna Rada
];

export function isGovish(host: string): boolean {
  return /(^|\.)(gov|gob|gouv|govt|go)(\.[a-z]{2,3})?$/.test(host)
    || host.endsWith('.gc.ca')
    || /(^|\.)europa\.eu$/.test(host)
    || host.endsWith('.admin.ch')
    || OFFICIAL_LEGISLATION_HOSTS.some(official => host === official || host.endsWith(`.${official}`));
}

// The aggregation key: a domain, or domain/@account for social hosts.
export function sourceKeyFromUrl(url: string): string | null {
  const host = hostFromUrl(url);
  if (!host) return null;
  if (isSocialHost(host)) {
    try {
      const segment = new URL(url).pathname.split('/').filter(Boolean)[0];
      if (segment) return `${host}/${segment.toLowerCase()}`;
    } catch {
      /* fall through to bare host */
    }
  }
  return host;
}

// Feed URLs worth trying for a sample source URL. Mastodon accounts expose a
// deterministic <@user>.rss; Bluesky/X have no free feed (they need a dedicated
// adapter), so we return none and let the report flag them separately.
export function feedCandidateUrls(sampleUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(sampleUrl);
  } catch {
    return [];
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const account = parsed.pathname.match(/\/@[^/]+/);
  if (isSocialHost(host)) {
    if (/\.social$/.test(host) || /(^|\.)mastodon\./.test(host)) {
      return account ? [`${parsed.origin}${account[0]}.rss`] : [];
    }
    return []; // bsky / x / threads — no RSS
  }
  return ['/feed/', '/feed', '/rss', '/rss.xml', '/atom.xml', '/feed.xml', '/index.xml', '/en/feed/', '/news/feed/']
    .map(suffix => `${parsed.origin}${suffix}`);
}

async function looksLikeFeed(url: string, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: FETCH_HEADERS });
    if (!response.ok) return false;
    const head = (await response.text()).slice(0, 2000).toLowerCase();
    return head.includes('<rss') || head.includes('<feed') || head.includes('<rdf:rdf');
  } catch {
    return false;
  }
}

// Resolve a subscribable feed for a source, or null. Tries, in order: a
// deterministic Mastodon .rss, the homepage's <link rel="alternate"> hint, then
// common feed paths. Never throws — a source with no discoverable feed is a
// valid (feed-less) result the report still lists for manual/adapter handling.
export async function discoverFeed(sampleUrl: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const deterministic = feedCandidateUrls(sampleUrl).find(candidate => candidate.endsWith('.rss'));
  if (deterministic) return deterministic;

  let origin: string;
  try {
    origin = new URL(sampleUrl).origin;
  } catch {
    return null;
  }
  try {
    const home = await fetcher(origin, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: FETCH_HEADERS });
    if (home.ok) {
      const html = await home.text();
      const tag = html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
      const href = tag?.match(/href=["']([^"']+)["']/i)?.[1];
      if (href) {
        const absolute = new URL(href, origin).toString();
        if (await looksLikeFeed(absolute, fetcher)) return absolute;
      }
    }
  } catch {
    /* autodiscovery is best-effort */
  }
  for (const candidate of feedCandidateUrls(sampleUrl)) {
    if (await looksLikeFeed(candidate, fetcher)) return candidate;
  }
  return null;
}

// Hosts already covered by the manifest, so the analyzer never re-proposes a
// source we already subscribe to.
export function manifestHosts(root: string): Set<string> {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'monitor/sources/manifest.json'), 'utf8')) as {
    sources?: Array<{ url?: string; pages?: Array<{ url?: string }> }>;
  };
  const hosts = new Set<string>();
  for (const source of manifest.sources ?? []) {
    for (const url of [source.url, ...(source.pages?.map(page => page.url) ?? [])]) {
      const host = url ? hostFromUrl(url) : null;
      if (host) hosts.add(host);
    }
  }
  return hosts;
}

export interface Candidate {
  source_key: string;
  domain: string;
  citations: number;
  jurisdictions: number;
  confirmed: number;
  last_seen: string;
  isos: string[];
  gov: boolean;
  social: boolean;
  sample_url: string;
  sample_title: string;
  score: number;
}

// Outlets that keep surfacing real changes, for the most jurisdictions, most
// recently, rank highest. Confirmed findings weigh most: an outlet the sweep
// cited while confirming a change is a better subscription than one cited on a
// rumour that fizzled.
function score(row: { citations: number; jurisdictions: number; confirmed: number }): number {
  return row.confirmed * 3 + row.citations + row.jurisdictions * 2;
}

// Accumulating store for cited sources. Mirrors NewsPostStore: read a D1 export
// (.sql / .sqlite), buffer portable INSERTs for the workflow to apply, and work
// in-memory when no path is given (local / test).
export class CitationStore {
  readonly database: Database;
  readonly mutations: string[] = [];
  private temporaryDirectory: string | null = null;

  constructor(root: string, inputPath?: string | null) {
    if (inputPath?.endsWith('.sql')) {
      this.temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-paths-citations-'));
      this.database = new Database(path.join(this.temporaryDirectory, 'state.sqlite'), { create: true, strict: true });
      this.database.exec(fs.readFileSync(inputPath, 'utf8'));
    } else {
      this.database = new Database(inputPath || ':memory:', { create: true, strict: true });
    }
    this.database.exec(fs.readFileSync(path.join(root, 'data/d1/migrations/0005_monitor_citations.sql'), 'utf8'));
  }

  // Record a single cited URL. Returns false for an unparseable URL. The URL is
  // the primary key, so repeats collapse to one row in D1 (INSERT OR IGNORE).
  recordCitation(url: string, isoN3: string, status: string, title: string, seenAt: string): boolean {
    const key = sourceKeyFromUrl(url);
    const domain = hostFromUrl(url);
    if (!key || !domain) return false;
    const values = [url, domain, key, isoN3, status, title ?? '', seenAt];
    const sql = `INSERT OR IGNORE INTO monitor_citations (url, domain, source_key, iso_n3, status, title, seen_at) VALUES (${values
      .map(value => (value === null ? 'NULL' : `'${String(value).replace(/[\r\n]+/g, ' ').replace(/'/g, "''")}'`))
      .join(', ')});`;
    this.database.exec(sql);
    this.mutations.push(sql);
    return true;
  }

  // Record every cited URL from the findings. Returns how many rows landed.
  recordFindings(findings: Finding[], seenAt: string): number {
    let recorded = 0;
    for (const finding of findings) {
      for (const citation of finding.citations ?? []) {
        if (this.recordCitation(citation.uri, finding.iso_n3, finding.status, citation.title ?? '', seenAt)) recorded += 1;
      }
    }
    return recorded;
  }

  // Rank cited sources into subscription candidates, excluding hosts already in
  // the manifest. `sinceDays` bounds recency; `limit` caps the returned list.
  topCandidates(options: { excludeHosts?: Set<string>; sinceDays?: number; limit?: number; now?: Date } = {}): Candidate[] {
    const exclude = options.excludeHosts ?? new Set<string>();
    const limit = options.limit ?? 40;
    const cutoff = options.sinceDays
      ? new Date((options.now ?? new Date()).getTime() - options.sinceDays * 86_400_000).toISOString()
      : '';
    const rows = this.database
      .query(
        `SELECT source_key, domain,
           COUNT(*) AS citations,
           COUNT(DISTINCT iso_n3) AS jurisdictions,
           SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
           MAX(seen_at) AS last_seen,
           GROUP_CONCAT(DISTINCT iso_n3) AS isos
         FROM monitor_citations
         ${cutoff ? 'WHERE seen_at >= ?1' : ''}
         GROUP BY source_key`,
      )
      .all(...(cutoff ? [cutoff] : [])) as Array<{
      source_key: string;
      domain: string;
      citations: number;
      jurisdictions: number;
      confirmed: number;
      last_seen: string;
      isos: string | null;
    }>;

    const sample = this.database.query(
      'SELECT url, title FROM monitor_citations WHERE source_key = ?1 ORDER BY seen_at DESC LIMIT 1',
    );

    return rows
      .filter(row => !exclude.has(row.domain))
      .map(row => {
        const s = sample.get(row.source_key) as { url: string; title: string } | null;
        return {
          source_key: row.source_key,
          domain: row.domain,
          citations: row.citations,
          jurisdictions: row.jurisdictions,
          confirmed: row.confirmed,
          last_seen: row.last_seen,
          isos: (row.isos ?? '').split(',').filter(Boolean),
          gov: isGovish(row.domain),
          social: isSocialHost(row.domain),
          sample_url: s?.url ?? `https://${row.domain}/`,
          sample_title: s?.title ?? '',
          score: score(row),
        };
      })
      .sort((a, b) => b.score - a.score || b.confirmed - a.confirmed || b.last_seen.localeCompare(a.last_seen))
      .slice(0, limit);
  }

  writeMutations(outputPath: string): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${this.mutations.join('\n')}\n`);
  }

  close(): void {
    this.database.close();
    if (this.temporaryDirectory) fs.rmSync(this.temporaryDirectory, { recursive: true, force: true });
  }
}

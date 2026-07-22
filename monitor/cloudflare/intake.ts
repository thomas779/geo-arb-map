import PostalMime, { type Email } from 'postal-mime';
import type { NormalizedNewsletterMessage } from '../schema/newsletter';

export interface NewsletterRoute {
  source_id: string;
  recipient: string;
  allowed_sender_domains: string[];
  canonical_hosts: string[];
}

export interface NormalizedIntake {
  message_hash: string;
  sender_domain: string;
  normalized: NormalizedNewsletterMessage | null;
  ignored_reason: string | null;
}

const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'ref',
]);

const NON_ARTICLE_PATHS = [
  '/account',
  '/author/',
  '/category/',
  '/email-preferences',
  '/manage-preferences',
  '/privacy',
  '/tag/',
  '/unsubscribe',
];

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string array`);
  }
  return value.map((entry, index) => requiredString(entry, `${field}[${index}]`).toLowerCase());
}

function canonicalAddress(value: string): string {
  return value.trim().toLowerCase();
}

function hostnameMatches(hostname: string, allowed: string[]): boolean {
  const candidate = hostname.toLowerCase();
  return allowed.some(host => candidate === host || candidate.endsWith(`.${host}`));
}

/**
 * One row of the `monitor_routes` D1 table. The two list columns are stored as
 * JSON-array text so the routing policy can be managed as data instead of a
 * write-only Worker secret.
 */
export interface MonitorRouteRow {
  source_id: string;
  recipient: string;
  allowed_sender_domains: string;
  canonical_hosts: string;
}

function buildRoute(value: unknown, index: number): NewsletterRoute {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`SOURCE_ROUTES[${index}] must be an object`);
  }
  const route = value as Record<string, unknown>;
  const recipient = canonicalAddress(requiredString(route.recipient, `SOURCE_ROUTES[${index}].recipient`));
  return {
    source_id: requiredString(route.source_id, `SOURCE_ROUTES[${index}].source_id`),
    recipient,
    allowed_sender_domains: stringList(
      route.allowed_sender_domains,
      `SOURCE_ROUTES[${index}].allowed_sender_domains`,
    ),
    canonical_hosts: stringList(
      route.canonical_hosts,
      `SOURCE_ROUTES[${index}].canonical_hosts`,
    ),
  };
}

// Shared invariant check for any route source: unique source ids, and — for a
// shared intake address — non-overlapping sender-domain allowlists so every
// message attributes to exactly one source.
function assertRouteSet(routes: NewsletterRoute[]): NewsletterRoute[] {
  const sourceIds = new Set<string>();
  routes.forEach((route, index) => {
    if (sourceIds.has(route.source_id)) {
      throw new TypeError(`Duplicate SOURCE_ROUTES source_id: ${route.source_id}`);
    }
    sourceIds.add(route.source_id);
    for (const previous of routes.slice(0, index)) {
      if (previous.recipient !== route.recipient) continue;
      const overlaps = route.allowed_sender_domains.some(domain =>
        previous.allowed_sender_domains.some(previousDomain =>
          domain === previousDomain ||
          domain.endsWith(`.${previousDomain}`) ||
          previousDomain.endsWith(`.${domain}`),
        ),
      );
      if (overlaps) {
        throw new TypeError(
          `Ambiguous SOURCE_ROUTES sender mapping for recipient: ${route.recipient}`,
        );
      }
    }
  });
  return routes;
}

export function normalizeRoutes(entries: unknown[]): NewsletterRoute[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('Newsletter routes must contain at least one route');
  }
  return assertRouteSet(entries.map((value, index) => buildRoute(value, index)));
}

export function parseNewsletterRoutes(raw: string): NewsletterRoute[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError('SOURCE_ROUTES must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new TypeError('SOURCE_ROUTES must contain at least one route');
  }
  return normalizeRoutes(parsed);
}

// Build validated routes from `monitor_routes` rows. The JSON-array columns are
// parsed here; malformed text falls through to stringList, which rejects it.
export function routesFromRows(rows: MonitorRouteRow[]): NewsletterRoute[] {
  return normalizeRoutes(rows.map(row => ({
    source_id: row.source_id,
    recipient: row.recipient,
    allowed_sender_domains: safeJsonParse(row.allowed_sender_domains),
    canonical_hosts: safeJsonParse(row.canonical_hosts),
  })));
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function routesForRecipient(
  routes: NewsletterRoute[],
  recipient: string,
): NewsletterRoute[] {
  const candidate = canonicalAddress(recipient);
  return routes.filter(route => route.recipient === candidate);
}

export function senderDomain(sender: string): string {
  const address = sender.match(/<([^>]+)>/)?.[1] ?? sender;
  const domain = address.trim().toLowerCase().split('@').pop();
  return domain && domain.includes('.') ? domain : '';
}

export function senderAllowed(route: NewsletterRoute, sender: string): boolean {
  const domain = senderDomain(sender);
  return Boolean(domain) && hostnameMatches(domain, route.allowed_sender_domains);
}

export function routeForMessage(
  routes: NewsletterRoute[],
  recipient: string,
  sender: string,
): NewsletterRoute | null {
  return routesForRecipient(routes, recipient)
    .find(route => senderAllowed(route, sender)) ?? null;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[),.;:\]}>]+$/g, '');
}

function urlsFromText(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map(match => trimUrlPunctuation(decodeHtmlAttribute(match[0])));
}

function urlsFromHtml(html: string): string[] {
  return [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)]
    .map(match => trimUrlPunctuation(decodeHtmlAttribute(match[1])));
}

function embeddedDestinations(url: URL): string[] {
  const destinations: string[] = [];
  for (const key of ['destination', 'redirect', 'target', 'u', 'url']) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    for (const candidate of [value, safeDecode(value)]) {
      if (/^https?:\/\//i.test(candidate)) destinations.push(candidate);
    }
  }
  return destinations;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanCanonicalUrl(url: URL): string {
  url.hash = '';
  const keys: string[] = [];
  url.searchParams.forEach((_value, key) => keys.push(key));
  for (const key of keys) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

function articleScore(url: URL): number {
  const path = url.pathname.toLowerCase();
  if (NON_ARTICLE_PATHS.some(fragment => path.includes(fragment))) return -100;
  const segments = path.split('/').filter(Boolean);
  let score = segments.length * 3;
  if (segments.length === 0) score -= 20;
  if (/\b(19|20)\d{2}\b/.test(path)) score += 3;
  if (path.includes('/news') || path.includes('/insight') || path.includes('/article')) score += 4;
  return score;
}

export function canonicalArticleUrl(
  email: Pick<Email, 'html' | 'text'>,
  canonicalHosts: string[],
): string | null {
  const found = [
    ...urlsFromHtml(email.html ?? ''),
    ...urlsFromText(email.text ?? ''),
  ];
  const expanded = [...found];
  for (const raw of found) {
    try {
      expanded.push(...embeddedDestinations(new URL(raw)));
    } catch {
      // Ignore malformed links from otherwise parseable newsletter content.
    }
  }

  const candidates = new Map<string, { url: URL; score: number; position: number }>();
  expanded.forEach((raw, position) => {
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (!hostnameMatches(url.hostname, canonicalHosts)) return;
      const cleaned = cleanCanonicalUrl(url);
      const candidate = { url: new URL(cleaned), score: articleScore(url), position };
      const previous = candidates.get(cleaned);
      if (!previous || candidate.score > previous.score) candidates.set(cleaned, candidate);
    } catch {
      // Ignore malformed links.
    }
  });

  return [...candidates.values()]
    .filter(candidate => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.position - right.position)[0]
    ?.url.toString() ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function excerpt(email: Pick<Email, 'html' | 'text'>): string {
  return (email.text || stripHtml(email.html ?? ''))
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function isoDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function normalizeIncomingEmail(
  raw: ArrayBuffer,
  envelopeFrom: string,
  route: NewsletterRoute,
  receivedAt = new Date().toISOString(),
  reservedMessageHash?: string,
): Promise<NormalizedIntake> {
  const email = await PostalMime.parse(raw, {
    attachmentEncoding: 'arraybuffer',
    maxHeadersSize: 256 * 1024,
    maxNestingDepth: 20,
  });
  const rawHash = await sha256(raw);
  const externalId = email.messageId?.trim() || rawHash;
  const messageHash = reservedMessageHash ?? await sha256(`${route.source_id}:${externalId}`);
  const canonicalUrl = canonicalArticleUrl(email, route.canonical_hosts);

  if (!canonicalUrl) {
    return {
      message_hash: messageHash,
      sender_domain: senderDomain(envelopeFrom),
      normalized: null,
      ignored_reason: 'no allowed public canonical article URL found',
    };
  }

  return {
    message_hash: messageHash,
    sender_domain: senderDomain(envelopeFrom),
    normalized: {
      message_id: messageHash,
      from: senderDomain(envelopeFrom),
      subject: email.subject?.trim() || 'Newsletter update',
      text: excerpt(email),
      received_at: isoDate(email.date, receivedAt),
      canonical_url: canonicalUrl,
    },
    ignored_reason: null,
  };
}

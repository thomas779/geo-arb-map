import {
  normalizeIncomingEmail,
  parseNewsletterRoutes,
  routeForMessage,
  routesForRecipient,
  routesFromRows,
  sha256,
  type MonitorRouteRow,
  type NewsletterRoute,
} from './intake';

interface Env {
  DB: D1Database;
  RAW_EMAILS: R2Bucket;
  SOURCE_ROUTES?: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_EVENT_TYPE?: string;
  MAX_EMAIL_BYTES?: string;
}

// Routing policy lives in the `monitor_routes` D1 table so it can be managed as
// data. The SOURCE_ROUTES secret remains a fallback for transition/DR: it is
// used only when the table is empty or unreadable.
async function loadRoutes(env: Env): Promise<NewsletterRoute[]> {
  try {
    const { results } = await env.DB
      .prepare(
        'SELECT source_id, recipient, allowed_sender_domains, canonical_hosts FROM monitor_routes WHERE enabled = 1',
      )
      .all<MonitorRouteRow>();
    if (results && results.length > 0) return routesFromRows(results);
  } catch (error) {
    console.error('monitor_routes lookup failed; falling back to SOURCE_ROUTES', error);
  }
  if (env.SOURCE_ROUTES) return parseNewsletterRoutes(env.SOURCE_ROUTES);
  throw new Error('No newsletter routes are configured');
}

type IntakeStatus = 'processing' | 'ignored' | 'dispatched' | 'failed';

interface IntakeRow {
  status: IntakeStatus;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function maxEmailBytes(env: Env): number {
  const configured = Number(env.MAX_EMAIL_BYTES ?? DEFAULT_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

function rawKey(sourceId: string, messageHash: string, receivedAt: string): string {
  const date = receivedAt.slice(0, 10);
  return `${date}/${sourceId}/${messageHash}.eml`;
}

async function reserveMessage(
  env: Env,
  route: NewsletterRoute,
  messageHash: string,
  receivedAt: string,
): Promise<boolean> {
  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO email_intake
      (message_hash, source_id, status, attempts, received_at, updated_at)
    VALUES (?1, ?2, 'processing', 1, ?3, ?3)
  `).bind(messageHash, route.source_id, receivedAt).run();
  if ((inserted.meta.changes ?? 0) > 0) return true;

  const existing = await env.DB.prepare(
    'SELECT status FROM email_intake WHERE message_hash = ?1',
  ).bind(messageHash).first<IntakeRow>();
  if (existing?.status !== 'failed') return false;

  const retried = await env.DB.prepare(`
    UPDATE email_intake
    SET status = 'processing', attempts = attempts + 1, last_error = NULL, updated_at = ?2
    WHERE message_hash = ?1 AND status = 'failed'
  `).bind(messageHash, receivedAt).run();
  return (retried.meta.changes ?? 0) > 0;
}

async function updateMessage(
  env: Env,
  messageHash: string,
  status: IntakeStatus,
  values: {
    rawKey?: string;
    canonicalUrl?: string;
    subject?: string;
    error?: string;
    dispatchedAt?: string;
  } = {},
): Promise<void> {
  await env.DB.prepare(`
    UPDATE email_intake
    SET status = ?2,
        raw_key = COALESCE(?3, raw_key),
        canonical_url = COALESCE(?4, canonical_url),
        subject = COALESCE(?5, subject),
        last_error = ?6,
        dispatched_at = COALESCE(?7, dispatched_at),
        updated_at = ?8
    WHERE message_hash = ?1
  `).bind(
    messageHash,
    status,
    values.rawKey ?? null,
    values.canonicalUrl ?? null,
    values.subject ?? null,
    values.error ?? null,
    values.dispatchedAt ?? null,
    new Date().toISOString(),
  ).run();
}

async function dispatchToGitHub(
  env: Env,
  sourceId: string,
  message: {
    message_id: string;
    subject: string;
    text: string;
    received_at: string;
    canonical_url: string;
  },
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'flag-paths-newsletter-intake/0.1',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        event_type: env.GITHUB_EVENT_TYPE || 'newsletter_signal',
        client_payload: {
          source_id: sourceId,
          message,
        },
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`GitHub repository dispatch failed (${response.status}): ${detail}`);
  }
}

export default {
  async email(message, env): Promise<void> {
    let routes: NewsletterRoute[];
    try {
      routes = await loadRoutes(env);
    } catch (error) {
      console.error('Invalid newsletter route configuration', error);
      message.setReject('Newsletter intake is not configured');
      return;
    }

    if (routesForRecipient(routes, message.to).length === 0) {
      message.setReject('Unknown newsletter intake address');
      return;
    }
    const route = routeForMessage(routes, message.to, message.from);
    if (!route) {
      message.setReject('Sender domain is not allowed for this intake address');
      return;
    }
    if (message.rawSize > maxEmailBytes(env)) {
      message.setReject('Newsletter message is too large');
      return;
    }

    const receivedAt = new Date().toISOString();
    const raw = await new Response(message.raw).arrayBuffer();
    const externalId = message.headers.get('message-id')?.trim() || await sha256(raw);
    const messageHash = await sha256(`${route.source_id}:${externalId}`);
    const key = rawKey(route.source_id, messageHash, receivedAt);
    if (!await reserveMessage(env, route, messageHash, receivedAt)) return;

    let archived = false;
    try {
      await env.RAW_EMAILS.put(key, raw, {
        httpMetadata: { contentType: 'message/rfc822' },
        customMetadata: {
          source_id: route.source_id,
          message_hash: messageHash,
          sender_domain: message.from.split('@').pop()?.toLowerCase() ?? '',
        },
      });
      archived = true;
      const intake = await normalizeIncomingEmail(
        raw,
        message.from,
        route,
        receivedAt,
        messageHash,
      );

      if (!intake.normalized) {
        await updateMessage(env, messageHash, 'ignored', {
          rawKey: key,
          error: intake.ignored_reason ?? 'message did not produce a signal',
        });
        return;
      }

      await dispatchToGitHub(env, route.source_id, {
        message_id: intake.normalized.message_id,
        subject: intake.normalized.subject,
        text: intake.normalized.text,
        received_at: intake.normalized.received_at,
        canonical_url: intake.normalized.canonical_url,
      });
      await updateMessage(env, messageHash, 'dispatched', {
        rawKey: key,
        canonicalUrl: intake.normalized.canonical_url,
        subject: intake.normalized.subject,
        dispatchedAt: new Date().toISOString(),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`Newsletter intake failed for ${route.source_id}`, error);
      await updateMessage(env, messageHash, 'failed', {
        rawKey: archived ? key : undefined,
        error: detail.slice(0, 1000),
      });
    }
  },
} satisfies ExportedHandler<Env>;

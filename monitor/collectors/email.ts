// Provider-neutral boundary for newsletters and agency client alerts.
// The mailbox/webhook transport must normalize each message into this shape,
// including a public canonical article URL. This module deliberately does not
// own credentials, mailbox polling, or provider-specific payloads.

import { makeSignal, type Signal, type SignalTier } from '../schema/signal';
import type { NormalizedNewsletterMessage } from '../schema/newsletter';

export type { NormalizedNewsletterMessage } from '../schema/newsletter';

export interface EmailSource {
  id: string;
  tier: SignalTier;
  adapter: 'email';
  jurisdictions?: string[];
}

interface ParseOptions {
  retrievedAt?: string;
}

export function parseNewsletterMessages(
  messages: NormalizedNewsletterMessage[],
  source: EmailSource,
  { retrievedAt }: ParseOptions = {},
): Signal[] {
  return messages.flatMap(message => {
    if (!message.message_id || !message.subject || !message.canonical_url) return [];
    let canonicalUrl: URL;
    try {
      canonicalUrl = new URL(message.canonical_url);
    } catch {
      return [];
    }
    if (canonicalUrl.protocol !== 'https:' && canonicalUrl.protocol !== 'http:') return [];

    return [makeSignal({
      sourceId: source.id,
      tier: source.tier,
      jurisdiction: source.jurisdictions?.[0] ?? 'multi',
      externalId: message.message_id,
      url: canonicalUrl.toString(),
      title: message.subject,
      excerpt: message.text,
      publishedAt: message.received_at,
      retrievedAt,
    })];
  });
}

export interface NormalizedNewsletterMessage {
  message_id: string;
  from?: string;
  subject: string;
  text: string;
  received_at: string;
  canonical_url: string;
}

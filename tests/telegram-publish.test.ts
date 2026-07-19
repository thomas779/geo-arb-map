import { describe, expect, test } from 'bun:test';
import {
  auditTelegramPost,
  buildTelegramPost,
  checkTelegramConnection,
  parseEvidenceAudit,
  sendTelegramPost,
  type ReviewIssue,
} from '../monitor/publish/telegram';

const reviewedIssue: ReviewIssue = {
  number: 42,
  title: '[Monitor lead] France: Student residence treatment changed',
  url: 'https://github.com/thomas779/geo-arb-map/issues/42',
  body: `## Reviewer checklist

- [x] Locate and cite the current primary legal or government source.
- [x] Confirm the effective date and any transition rules.
- [x] Identify the exact dataset entities and fields affected.
- [x] Add or update a regression invariant with any data correction.
- [x] Cross-check every sentence in the public brief against the evidence below.

## Verified evidence

- Primary: [French government notice](https://example.gouv.fr/notice)
- Effective date: 1 September 2026

## Public brief

France has updated how qualifying student residence is assessed. The rule takes effect
on 1 September 2026; transitional cases should be checked against the official notice.

## Internal notes

Do not publish this section.`,
};

describe('Telegram publication gate', () => {
  test('builds a source-backed post only after every review item is checked', () => {
    const post = buildTelegramPost(reviewedIssue);
    expect(post.issue_number).toBe(42);
    expect(post.sources).toEqual(['https://example.gouv.fr/notice']);
    expect(post.text).toContain('France: Student residence treatment changed');
    expect(post.text).toContain('Review trail: https://github.com/thomas779/geo-arb-map/issues/42');
    expect(post.text).not.toContain('Internal notes');
  });

  test('rejects incomplete review and placeholder publication copy', () => {
    expect(() => buildTelegramPost({
      ...reviewedIssue,
      body: reviewedIssue.body.replace('- [x] Confirm the effective', '- [ ] Confirm the effective'),
    })).toThrow('Every item');
    expect(() => buildTelegramPost({
      ...reviewedIssue,
      body: reviewedIssue.body.replace(
        /## Public brief[\s\S]*?## Internal notes/,
        '## Public brief\n\nReplace this with final publication copy.\n\n## Internal notes',
      ),
    })).toThrow('Replace the Public brief');
  });

  test('sends plain text to the configured Telegram channel', async () => {
    const captured: { body?: Record<string, unknown> } = {};
    const messageId = await sendTelegramPost(buildTelegramPost(reviewedIssue), {
      token: '123:secret',
      channelId: '@flagpathsbriefing',
      fetcher: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured.body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          ok: true,
          result: { message_id: 77 },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });
    expect(messageId).toBe(77);
    expect(captured.body?.chat_id).toBe('@flagpathsbriefing');
    expect(captured.body?.text).toContain('Primary source:');
  });

  test('requires the AI evidence audit to return a clean publishable result', async () => {
    expect(parseEvidenceAudit('```json\n{"publishable":true,"unsupported_claims":[],"missing_context":[]}\n```'))
      .toEqual({ publishable: true, unsupported_claims: [], missing_context: [] });

    await expect(auditTelegramPost(reviewedIssue, buildTelegramPost(reviewedIssue), {
      llm: {
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'test-model',
        timeoutMs: 1000,
      },
      fetcher: (async () => new Response(JSON.stringify({
        content: [{
          type: 'text',
          text: JSON.stringify({
            publishable: false,
            unsupported_claims: ['The evidence does not quote the changed rule.'],
            missing_context: [],
          }),
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
    })).rejects.toThrow('AI evidence audit blocked publication');
  });

  test('checks that the configured destination is a channel where the bot can post', async () => {
    const responses = [
      { ok: true, result: { id: 99, username: 'FlagPathsPublisherBot' } },
      {
        ok: true,
        result: { id: -100123, title: 'Flag Paths', type: 'channel', username: 'flagpaths' },
      },
      {
        ok: true,
        result: { status: 'administrator', can_post_messages: true },
      },
    ];
    const status = await checkTelegramConnection({
      token: '123:secret',
      channelId: '@flagpaths',
      fetcher: (async () => new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
    });
    expect(status).toEqual({
      bot_username: '@FlagPathsPublisherBot',
      channel_title: 'Flag Paths',
      channel_username: '@flagpaths',
      member_status: 'administrator',
      can_post_messages: true,
    });
  });
});

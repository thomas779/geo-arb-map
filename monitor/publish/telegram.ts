#!/usr/bin/env bun

import {
  generateLlmText,
  llmConfigFromEnv,
  type LlmConfig,
} from '../llm/client';

export interface ReviewIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  comments?: Array<{ body?: string | null }>;
}

export interface TelegramPost {
  issue_number: number;
  issue_url: string;
  text: string;
  sources: string[];
}

export interface EvidenceAudit {
  publishable: boolean;
  unsupported_claims: string[];
  missing_context: string[];
}

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: {
    message_id?: number;
  };
}

interface PublishOptions {
  apply: boolean;
  check: boolean;
  issueNumber: number | null;
}

const TELEGRAM_MESSAGE_LIMIT = 4096;
const PLACEHOLDER_PATTERN = /replace this|write the final|not ready|todo|tbd/i;
const PUBLISHED_MARKER = '<!-- telegram-published:';

function readArgs(argv: string[]): PublishOptions {
  const options: PublishOptions = {
    apply: false,
    check: false,
    issueNumber: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') options.apply = true;
    else if (value === '--dry-run') options.apply = false;
    else if (value === '--check') options.check = true;
    else if (value === '--issue') options.issueNumber = Number(argv[++index]);
    else throw new Error(`Unknown Telegram publish option: ${value}`);
  }
  if (!options.check && (
    !Number.isInteger(options.issueNumber) || Number(options.issueNumber) <= 0
  )) {
    throw new Error('Pass a positive GitHub issue number with --issue');
  }
  return options;
}

function runGh(args: string[]): string {
  const process = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (process.exitCode !== 0) {
    throw new Error(process.stderr.toString().trim() || `gh ${args.join(' ')} failed`);
  }
  return process.stdout.toString().trim();
}

function section(body: string, heading: string): string {
  const content = String(body);
  const headings = [...content.matchAll(/^##\s+(.+?)\s*$/gm)];
  const currentIndex = headings.findIndex(
    match => String(match[1]).trim().toLowerCase() === heading.trim().toLowerCase(),
  );
  if (currentIndex < 0) return '';
  const start = Number(headings[currentIndex].index) + headings[currentIndex][0].length;
  const end = headings[currentIndex + 1]?.index ?? content.length;
  return content.slice(start, end).trim();
}

function markdownUrls(value: string): string[] {
  const urls = [
    ...String(value).matchAll(/\]\((https?:\/\/[^)\s]+)\)/gi),
    ...String(value).matchAll(/(?<!\()(https?:\/\/[^\s<>)\]]+)/gi),
  ].map(match => match[1].replace(/[.,;:]+$/, ''));
  return [...new Set(urls)];
}

function checklistComplete(body: string): boolean {
  const checklist = section(body, 'Reviewer checklist');
  const boxes = [...checklist.matchAll(/^\s*-\s+\[([ xX])\]\s+/gm)];
  return boxes.length >= 4 && boxes.every(match => match[1].toLowerCase() === 'x');
}

function normalizedTitle(title: string): string {
  return String(title)
    .replace(/^\[Monitor lead\]\s*/i, '')
    .trim()
    .slice(0, 180);
}

export function buildTelegramPost(issue: ReviewIssue): TelegramPost {
  if (!checklistComplete(issue.body)) {
    throw new Error('Every item in the Reviewer checklist must be checked before publishing');
  }

  const evidence = section(issue.body, 'Verified evidence');
  const sources = markdownUrls(evidence);
  if (sources.length === 0) {
    throw new Error('Verified evidence must contain at least one http(s) source');
  }

  const brief = section(issue.body, 'Public brief')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (!brief || PLACEHOLDER_PATTERN.test(brief)) {
    throw new Error('Replace the Public brief placeholder with final publication copy');
  }

  const text = [
    normalizedTitle(issue.title),
    '',
    brief,
    '',
    sources.length === 1 ? 'Primary source:' : 'Sources:',
    ...sources.map(url => `• ${url}`),
    '',
    `Review trail: ${issue.url}`,
    '',
    'Information only — verify the rule for your circumstances.',
  ].join('\n');

  if (text.length > TELEGRAM_MESSAGE_LIMIT) {
    throw new Error(
      `Telegram post is ${text.length} characters; maximum is ${TELEGRAM_MESSAGE_LIMIT}`,
    );
  }

  return {
    issue_number: issue.number,
    issue_url: issue.url,
    text,
    sources,
  };
}

export async function sendTelegramPost(
  post: TelegramPost,
  {
    token,
    channelId,
    fetcher = fetch,
    parseMode,
    disablePreview = false,
  }: {
    token: string;
    channelId: string;
    fetcher?: typeof fetch;
    parseMode?: string;
    disablePreview?: boolean;
  },
): Promise<number> {
  if (!token.trim()) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  if (!channelId.trim()) throw new Error('TELEGRAM_CHANNEL_ID is not configured');

  const response = await fetcher(
    `https://api.telegram.org/bot${encodeURIComponent(token.trim())}/sendMessage`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: channelId.trim(),
        text: post.text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        link_preview_options: { is_disabled: disablePreview },
      }),
    },
  );
  const result = await response.json() as TelegramResponse;
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram returned HTTP ${response.status}`);
  }
  const messageId = Number(result.result?.message_id);
  if (!Number.isInteger(messageId)) throw new Error('Telegram did not return a message ID');
  return messageId;
}

async function telegramApi<T>(
  method: string,
  payload: Record<string, unknown>,
  {
    token,
    fetcher,
  }: {
    token: string;
    fetcher: typeof fetch;
  },
): Promise<T> {
  const response = await fetcher(
    `https://api.telegram.org/bot${encodeURIComponent(token.trim())}/${method}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const result = await response.json() as TelegramResponse & { result?: T };
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram ${method} returned HTTP ${response.status}`);
  }
  return result.result as T;
}

export async function checkTelegramConnection(
  {
    token,
    channelId,
    fetcher = fetch,
  }: {
    token: string;
    channelId: string;
    fetcher?: typeof fetch;
  },
): Promise<{
  bot_username: string;
  channel_title: string;
  channel_username: string;
  member_status: string;
  can_post_messages: boolean;
}> {
  if (!token.trim()) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  if (!channelId.trim()) throw new Error('TELEGRAM_CHANNEL_ID is not configured');

  const bot = await telegramApi<{ id: number; username?: string }>('getMe', {}, {
    token,
    fetcher,
  });
  const channel = await telegramApi<{
    id: number;
    title?: string;
    type?: string;
    username?: string;
  }>('getChat', { chat_id: channelId.trim() }, { token, fetcher });
  if (channel.type !== 'channel') {
    throw new Error(
      `TELEGRAM_CHANNEL_ID resolves to a ${channel.type || 'non-channel'} chat, not a channel`,
    );
  }
  const member = await telegramApi<{
    status?: string;
    can_post_messages?: boolean;
  }>('getChatMember', {
    chat_id: channelId.trim(),
    user_id: bot.id,
  }, { token, fetcher });
  const isAdministrator = member.status === 'administrator' || member.status === 'creator';
  if (!isAdministrator || member.can_post_messages !== true) {
    throw new Error(
      'The bot must be a channel administrator with the Post Messages permission',
    );
  }

  return {
    bot_username: `@${bot.username || 'unknown'}`,
    channel_title: channel.title || '',
    channel_username: `@${channel.username || channelId.replace(/^@/, '')}`,
    member_status: member.status || '',
    can_post_messages: true,
  };
}

export function parseEvidenceAudit(value: string): EvidenceAudit {
  const clean = String(value).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Evidence audit did not contain a JSON object');
  const parsed = JSON.parse(clean.slice(first, last + 1)) as Record<string, unknown>;
  const unsupportedClaims = Array.isArray(parsed.unsupported_claims)
    ? parsed.unsupported_claims.map(String).map(item => item.trim()).filter(Boolean)
    : [];
  const missingContext = Array.isArray(parsed.missing_context)
    ? parsed.missing_context.map(String).map(item => item.trim()).filter(Boolean)
    : [];
  return {
    publishable: parsed.publishable === true,
    unsupported_claims: unsupportedClaims,
    missing_context: missingContext,
  };
}

export async function auditTelegramPost(
  issue: ReviewIssue,
  post: TelegramPost,
  {
    llm,
    fetcher = fetch,
  }: {
    llm: LlmConfig;
    fetcher?: typeof fetch;
  },
): Promise<EvidenceAudit> {
  const evidence = section(issue.body, 'Verified evidence');
  const prompt = `Audit a proposed public legal, tax, citizenship, or mobility news brief.
Use only the supplied verified-evidence text. Do not rely on your memory and do not
assume that a linked page says anything not quoted here.

Verified evidence:
${evidence}

Proposed Telegram post:
${post.text}

Return one JSON object only:
{"publishable":boolean,"unsupported_claims":["claim"],"missing_context":["item"]}

Set publishable=false if any factual statement, date, scope, transition rule, or
qualification in the post is not supported by the supplied evidence, or if the
evidence lacks a relevant quoted passage. Ignore the standard information-only
disclaimer and review-trail URL.`;
  const result = parseEvidenceAudit(await generateLlmText(prompt, llm, {
    maxTokens: 1200,
    fetcher,
  }));
  if (!result.publishable || result.unsupported_claims.length || result.missing_context.length) {
    const details = [
      ...result.unsupported_claims.map(item => `unsupported: ${item}`),
      ...result.missing_context.map(item => `missing: ${item}`),
    ];
    throw new Error(`AI evidence audit blocked publication${details.length ? ` — ${details.join('; ')}` : ''}`);
  }
  return result;
}

function readIssue(issueNumber: number): ReviewIssue {
  const value = JSON.parse(runGh([
    'issue',
    'view',
    String(issueNumber),
    '--json',
    'number,title,body,url,comments',
  ])) as ReviewIssue;
  if (!value.body) throw new Error(`Issue #${issueNumber} has no body`);
  return value;
}

if (import.meta.main) {
  try {
    const options = readArgs(process.argv.slice(2));
    if (options.check) {
      const status = await checkTelegramConnection({
        token: process.env.TELEGRAM_BOT_TOKEN ?? '',
        channelId: process.env.TELEGRAM_CHANNEL_ID ?? '',
      });
      console.log(JSON.stringify(status, null, 2));
      console.log('Telegram connection is ready; no public message was sent.');
      process.exit(0);
    }
    const issue = readIssue(options.issueNumber!);
    const post = buildTelegramPost(issue);
    if (!options.apply) {
      console.log(post.text);
      console.log('\nDry run only; pass --apply to publish.');
    } else {
      if (issue.comments?.some(comment => String(comment.body).includes(PUBLISHED_MARKER))) {
        throw new Error(`Issue #${issue.number} has already been published to Telegram`);
      }
      const llm = llmConfigFromEnv();
      if (!llm) throw new Error('A monitoring LLM must be configured before publication');
      await auditTelegramPost(issue, post, {
        llm,
      });
      const messageId = await sendTelegramPost(post, {
        token: process.env.TELEGRAM_BOT_TOKEN ?? '',
        channelId: process.env.TELEGRAM_CHANNEL_ID ?? '',
      });
      runGh([
        'issue',
        'comment',
        String(issue.number),
        '--body',
        [
          `Published to \`${process.env.TELEGRAM_CHANNEL_ID}\` as message ${messageId}.`,
          '',
          `${PUBLISHED_MARKER}${messageId} -->`,
        ].join('\n'),
      ]);
      console.log(`Published GitHub issue #${issue.number} as Telegram message ${messageId}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

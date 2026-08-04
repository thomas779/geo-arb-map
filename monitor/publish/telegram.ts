#!/usr/bin/env bun

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import countries from 'i18n-iso-countries';
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// The lead-template epilogue is part of every monitoring issue body and sits
// after the Public brief with no heading of its own — it must never publish.
const LEAD_BOILERPLATE = 'This issue is an unverified monitoring lead';

function flagEmoji(isoN3: string): string {
  try {
    const alpha2 = countries.numericToAlpha2(isoN3);
    if (!alpha2 || alpha2.length !== 2) return '🌍';
    return String.fromCodePoint(...[...alpha2.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
  } catch {
    return '🌍';
  }
}

/**
 * Flag for the headline, resolved from the triage table's Jurisdiction cell
 * against the registry names in the public artifact. The globe fallback is
 * house style too (the auto path uses it for unmapped jurisdictions).
 */
export function issueJurisdiction(issueBody: string): string | null {
  const cell = issueBody.match(/\|\s*Jurisdiction\s*\|\s*([^|\n]+)\|/);
  return cell?.[1]?.trim() || null;
}

export function issueFlag(issueBody: string): string {
  const name = issueJurisdiction(issueBody);
  if (!name) return '🌍';
  try {
    const artifact = JSON.parse(fs.readFileSync(
      fileURLToPath(new URL('../../data/compiled/citizenship_routes.json', import.meta.url)), 'utf8',
    )) as { jurisdictions: Array<{ iso_n3: string; name: string }> };
    // Triage tables abbreviate registry names ("Cayman Is.", "Antigua and
    // Barb."), so fall back to prefix matching with the trailing dot dropped.
    const needle = name.toLowerCase().replace(/\.$/, '');
    const match = artifact.jurisdictions.find(j => j.name === name)
      ?? artifact.jurisdictions.find(j => j.name.toLowerCase().startsWith(needle));
    return match ? flagEmoji(match.iso_n3) : '🌍';
  } catch {
    return '🌍';
  }
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
    .split(LEAD_BOILERPLATE)[0]
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (!brief || PLACEHOLDER_PATTERN.test(brief)) {
    throw new Error('Replace the Public brief placeholder with final publication copy');
  }

  // House pattern, identical to the auto-news path in news.ts: bold headline,
  // short body, a clean Source anchor. No internal links or review notes —
  // the review trail lives on the GitHub issue, not in the channel. Issue
  // titles carry a "Jurisdiction:" routing prefix that the flag already
  // communicates, so it drops from the headline.
  const jurisdiction = issueJurisdiction(issue.body);
  let headline = normalizedTitle(issue.title);
  if (jurisdiction && headline.toLowerCase().startsWith(`${jurisdiction.toLowerCase()}:`)) {
    headline = headline.slice(jurisdiction.length + 1).trim();
  }
  const text = [
    `${issueFlag(issue.body)} <b>${escapeHtml(headline)}</b>`,
    '',
    escapeHtml(brief),
    '',
    sources.length === 1
      ? `<a href="${sources[0]}">Source</a>`
      : sources.map((url, index) => `<a href="${url}">Source ${index + 1}</a>`).join(' · '),
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

// Shared audit instructions. Keep this strict on *material* facts and loose on
// presentation — pedantic date/HTML/paraphrase failures (Sweden 2026-06-06 vs
// "6 June 2026") blocked true posts without improving accuracy.
export function buildEvidenceAuditPrompt(evidence: string, postText: string): string {
  return `Audit a proposed public legal, tax, citizenship, or mobility news brief.
Use only the supplied verified-evidence text. Do not rely on your memory and do not
assume that a linked page says anything not quoted here.

Verified evidence:
${evidence}

Proposed Telegram post:
${postText}

Return one JSON object only:
{"publishable":boolean,"unsupported_claims":["claim"],"missing_context":["item"]}

## Fail only on MATERIAL unsupported substance
Set publishable=false only if the post asserts a material fact that the evidence does
not support, for example:
- a different jurisdiction, programme, or legal instrument
- a different threshold, duration, fee, or count (wrong number)
- a different effective date or transition rule (wrong day/month/year, or inventing
  transitional relief the evidence never mentions)
- inventing scope, eligibility, or exceptions the evidence does not support
- evidence has no relevant quoted passage about the change at all

unsupported_claims / missing_context must list only those material problems.

## Do NOT fail for wording, format, or equivalent presentation
These are NOT unsupported claims — set publishable=true:
- Date formats that name the same calendar day (ISO "2026-06-06", "6 June 2026",
  "June 6, 2026", "2026-06-06T00:00:00Z" are the same fact)
- Year present only in an ISO date in the evidence when the post says the same day
  in prose (and vice versa)
- Paraphrase, compression, or reordering that keeps the same meaning
- HTML markup, flag emoji, bold tags, or "Source" link chrome in the post
- Minor grammar, capitalisation, or punctuation differences
- Omitting background colour that is not needed to state the change accurately
- Standard information-only disclaimers and review-trail URLs

Ignore the standard information-only disclaimer and review-trail URL.`;
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
  const prompt = buildEvidenceAuditPrompt(evidence, post.text);
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
        parseMode: 'HTML',
        disablePreview: true,
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

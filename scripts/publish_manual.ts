#!/usr/bin/env bun
// Manual publisher for human-reviewed news items, using the SAME clean format as
// the automated news path (buildNewsPost). Posts come from the MANUAL_POSTS env
// var (a JSON array of findings) or a --file, so nothing post-specific is ever
// committed. Dry-runs (prints the posts) unless --apply is passed with a
// TELEGRAM_BOT_TOKEN in the environment.
//
//   MANUAL_POSTS='[{...}]' bun scripts/publish_manual.ts            # preview
//   MANUAL_POSTS='[{...}]' bun scripts/publish_manual.ts --apply    # publish
//   bun scripts/publish_manual.ts --file posts.json                # local file

import fs from 'node:fs';
import { buildNewsPost, verifySourceUrl } from '../monitor/publish/news';
import { sendTelegramPost } from '../monitor/publish/telegram';
import type { Finding } from '../monitor/sweep/run';

const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const apply = process.argv.includes('--apply');
const file = argValue('--file');
const raw = (process.env.MANUAL_POSTS && process.env.MANUAL_POSTS.trim())
  || (file ? fs.readFileSync(file, 'utf8') : '');
if (!raw) throw new Error('No posts: set MANUAL_POSTS (JSON array) or pass --file <path>');

const findings = JSON.parse(raw) as Finding[];
if (!Array.isArray(findings) || findings.length === 0) {
  throw new Error('MANUAL_POSTS must be a non-empty JSON array');
}

const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const channelId = process.env.TELEGRAM_CHANNEL_ID ?? '';

let published = 0;
for (const finding of findings) {
  finding.primary_urls = await Promise.all(finding.primary_urls.map(url => verifySourceUrl(url)));
  const post = buildNewsPost(finding);
  if (!apply || !token) {
    console.log(`\n--- ${finding.iso_n3} (${apply ? 'no token — skipped' : 'dry-run'}) ---\n${post.text}\n`);
    continue;
  }
  const messageId = await sendTelegramPost(post, { token, channelId, parseMode: 'HTML', disablePreview: true });
  published += 1;
  console.log(`published ${finding.iso_n3} as Telegram message ${messageId}`);
}
console.log(apply && token ? `published ${published}` : `previewed ${findings.length}`);

#!/usr/bin/env bun
// Manual publisher for human-reviewed news items, using the SAME clean format as
// the automated news path (buildNewsPost). Reads findings from a JSON file and
// posts each to the Telegram channel. Dry-runs (prints the posts) unless --apply
// is passed with a TELEGRAM_BOT_TOKEN in the environment.
//
//   bun scripts/publish_manual.ts              # dry-run preview
//   bun scripts/publish_manual.ts --apply      # publish (needs TELEGRAM_BOT_TOKEN)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNewsPost, verifySourceUrl } from '../monitor/publish/news';
import { sendTelegramPost } from '../monitor/publish/telegram';
import type { Finding } from '../monitor/sweep/run';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const file = argValue('--file') ?? path.join(ROOT, 'monitor/publish/manual-posts.json');
const apply = process.argv.includes('--apply');
const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const channelId = process.env.TELEGRAM_CHANNEL_ID ?? '';

const findings = JSON.parse(fs.readFileSync(file, 'utf8')) as Finding[];

let published = 0;
for (const finding of findings) {
  finding.primary_urls = await Promise.all(finding.primary_urls.map(url => verifySourceUrl(url)));
  const post = buildNewsPost(finding);
  if (!apply || !token) {
    console.log(`\n--- ${finding.iso_n3} (${apply ? 'no token — skipped' : 'dry-run'}) ---\n${post.text}\n`);
    continue;
  }
  const messageId = await sendTelegramPost(post, {
    token,
    channelId,
    parseMode: 'HTML',
    disablePreview: true,
  });
  published += 1;
  console.log(`published ${finding.iso_n3} as Telegram message ${messageId}`);
}
console.log(`${apply && token ? 'published' : 'previewed'} ${apply && token ? published : findings.length}`);

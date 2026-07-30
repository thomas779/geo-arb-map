#!/usr/bin/env bun
// Manual publisher for human-reviewed news items, using the SAME clean format as
// the automated news path (buildNewsPost). Posts come from the MANUAL_POSTS env
// var (a JSON array of findings) or a --file, so nothing post-specific is ever
// committed. Dry-runs (prints the posts) unless --apply is passed with a
// TELEGRAM_BOT_TOKEN in the environment.
//
// After a successful send, records the finding in the monitor_posts dedup ledger
// (same store as monitor:news) so the auto-publish path cannot re-post it.
//
//   MANUAL_POSTS='[{...}]' bun scripts/publish_manual.ts            # preview
//   MANUAL_POSTS='[{...}]' bun scripts/publish_manual.ts --apply    # publish
//   bun scripts/publish_manual.ts --file posts.json                # local file
//   bun scripts/publish_manual.ts --apply --state-db before.sql --state-sql out.sql

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildNewsPost,
  fingerprint,
  NewsPostStore,
  verifySourceUrl,
} from '../monitor/publish/news';
import { sendTelegramPost } from '../monitor/publish/telegram';
import type { Finding } from '../monitor/sweep/run';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const apply = process.argv.includes('--apply');
const file = argValue('--file');
const stateDb = argValue('--state-db')
  ?? (process.env.MONITOR_STATE_DB ? path.resolve(process.env.MONITOR_STATE_DB) : null);
const stateSql = argValue('--state-sql')
  ?? path.join(ROOT, 'monitor/.out/monitor-posts.sql');
const dedupWindowDays = Number(process.env.MONITOR_NEWS_DEDUP_WINDOW_DAYS) || 120;

const raw = (process.env.MANUAL_POSTS && process.env.MANUAL_POSTS.trim())
  || (file ? fs.readFileSync(file, 'utf8') : '');
if (!raw) throw new Error('No posts: set MANUAL_POSTS (JSON array) or pass --file <path>');

const findings = JSON.parse(raw) as Finding[];
if (!Array.isArray(findings) || findings.length === 0) {
  throw new Error('MANUAL_POSTS must be a non-empty JSON array');
}

const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const channelId = process.env.TELEGRAM_CHANNEL_ID ?? '';

// Mirror monitor:news: refuse to publish without a dedup ledger when applying.
// Dry-run still works without one.
if (apply && token && !stateDb) {
  throw new Error(
    '--apply with a bot token requires --state-db (the dedup ledger export); '
    + 'refusing to publish without dedup so auto-news cannot re-post',
  );
}

const store = apply
  ? new NewsPostStore(ROOT, stateDb)
  : null;

let published = 0;
let skipped = 0;
try {
  for (const finding of findings) {
    const fp = fingerprint(finding);
    if (store?.has(fp)) {
      skipped += 1;
      console.log(`skip (already posted): ${finding.iso_n3} ${finding.claim?.slice(0, 60) ?? finding.headline}`);
      continue;
    }
    if (store?.hasRecentChange(finding.iso_n3, finding.category, dedupWindowDays, new Date())) {
      skipped += 1;
      console.log(
        `skip (same ${finding.category} change for ${finding.iso_n3} within ${dedupWindowDays}d): `
        + `${finding.claim?.slice(0, 60) ?? finding.headline}`,
      );
      continue;
    }

    finding.primary_urls = await Promise.all(finding.primary_urls.map(url => verifySourceUrl(url)));
    const post = buildNewsPost(finding);
    if (!apply || !token) {
      console.log(`\n--- ${finding.iso_n3} (${apply ? 'no token — skipped' : 'dry-run'}) ---\n${post.text}\n`);
      continue;
    }

    let messageId: number;
    try {
      messageId = await sendTelegramPost(post, {
        token,
        channelId,
        parseMode: 'HTML',
        disablePreview: true,
      });
    } catch (error) {
      skipped += 1;
      console.warn(
        `skip (send failed): ${finding.iso_n3}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    // Record immediately so a later send failure cannot drop this post from the ledger.
    store?.record(fp, finding, messageId, new Date().toISOString());
    published += 1;
    console.log(`published ${finding.iso_n3} as Telegram message ${messageId}`);
  }
} finally {
  if (store) {
    if (store.mutations.length > 0) store.writeMutations(stateSql);
    store.close();
  }
}

console.log(
  apply && token
    ? `published ${published}, skipped ${skipped}`
    : `previewed ${findings.length}`,
);

#!/usr/bin/env bun
// Delete Telegram channel messages by id. The bot must be an admin with delete
// rights in the channel. Ids come from the MESSAGE_IDS env var (comma-separated).
// Dry-runs unless --apply is passed with a TELEGRAM_BOT_TOKEN in the environment.
//
//   MESSAGE_IDS="8,14" bun scripts/delete_telegram.ts            # dry-run
//   MESSAGE_IDS="8,14" bun scripts/delete_telegram.ts --apply    # delete

export {}; // module marker so top-level await typechecks

const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
const chatId = (process.env.TELEGRAM_CHANNEL_ID ?? '').trim();
const apply = process.argv.includes('--apply');

const ids = (process.env.MESSAGE_IDS ?? '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
if (ids.length === 0) throw new Error('Set MESSAGE_IDS (comma-separated), e.g. MESSAGE_IDS="8,14"');

let deleted = 0;
for (const id of ids) {
  if (!apply || !token) {
    console.log(`would delete message ${id}`);
    continue;
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: Number(id) }),
  });
  const result = (await response.json()) as { ok: boolean; description?: string };
  if (result.ok) {
    deleted += 1;
    console.log(`deleted message ${id}`);
  } else {
    console.warn(`failed to delete ${id}: ${result.description ?? response.status}`);
  }
}
console.log(apply && token ? `deleted ${deleted}/${ids.length}` : `previewed ${ids.length}`);

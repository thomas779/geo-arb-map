#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';

interface SweepReport {
  mode?: string;
  model?: string | null;
  jurisdictions_selected?: number;
  calls_made?: number;
  findings?: number;
  by_status?: Record<string, number>;
  affects_dataset?: number;
}

interface CollectionReport {
  sources_attempted?: number;
  sources_failed?: number;
  signal_count?: number;
}

interface NewsReport {
  published?: number;
  skipped?: number;
  blocked?: number;
  dispositions?: Array<{
    jurisdiction?: string;
    headline?: string;
    outcome?: string;
    reason?: string;
  }>;
}

function readJson<T>(directory: string, name: string): T | null {
  const file = path.join(directory, name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function cell(value: unknown): string {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

export function renderMonitorSummary(directory: string): string {
  const collection = readJson<CollectionReport>(directory, 'collection-report.json');
  const sweep = readJson<SweepReport>(directory, 'sweep-report.json');
  const news = readJson<NewsReport>(directory, 'news-report.json');
  const lines = [
    '## Flag Paths monitor',
    '',
    '| Stage | Result |',
    '| --- | --- |',
    `| Discovery | ${collection ? `${cell(collection.signal_count)} signals from ${cell(collection.sources_attempted)} sources; ${cell(collection.sources_failed)} failures` : 'not run'} |`,
    `| Grounded sweep | ${sweep ? `${cell(sweep.findings)} findings across ${cell(sweep.jurisdictions_selected)} jurisdictions (${cell(sweep.calls_made)} calls)` : 'not run'} |`,
    `| Dataset leads | ${sweep ? cell(sweep.affects_dataset) : '—'} |`,
    `| Telegram | ${news ? `${cell(news.published)} published; ${cell(news.blocked)} blocked; ${cell(news.skipped)} skipped` : 'not run'} |`,
    '',
  ];
  if (sweep) {
    const statuses = Object.entries(sweep.by_status ?? {})
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');
    lines.push(`Sweep mode: **${cell(sweep.mode)}** · model: **${cell(sweep.model)}**${statuses ? ` · ${cell(statuses)}` : ''}`, '');
  }
  const dispositions = news?.dispositions ?? [];
  if (dispositions.length > 0) {
    lines.push('### Publication decisions', '', '| Country | Outcome | Reason | Headline |', '| --- | --- | --- | --- |');
    for (const item of dispositions.slice(0, 50)) {
      lines.push(`| ${cell(item.jurisdiction)} | ${cell(item.outcome)} | ${cell(item.reason)} | ${cell(item.headline)} |`);
    }
    lines.push('');
  } else if (news) {
    lines.push('No confirmed findings reached the publication loop.', '');
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.main) {
  const directory = path.resolve(process.argv[2] ?? 'monitor/.out');
  process.stdout.write(renderMonitorSummary(directory));
}

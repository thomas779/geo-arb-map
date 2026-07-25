#!/usr/bin/env bun

// Rank the outlets the sweep keeps citing into a "subscribe to these" report.
// Reads the accumulated monitor_citations ledger (a D1 export), excludes hosts
// already in the manifest, ranks by how often + for how many jurisdictions each
// source surfaced real changes, probes the top ones for an RSS/Atom feed, and
// writes a Markdown + JSON report with ready-to-paste manifest entries. Read-
// only against the data; it never subscribes to anything on its own.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CitationStore, discoverFeed, manifestHosts, type Candidate } from './citations';
import type { Finding } from '../sweep/run';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Options {
  stateDb: string | null;
  findings: string | null;
  sinceDays: number;
  limit: number;
  probe: number;
  outMd: string;
  outJson: string;
}

function readArgs(argv: string[]): Options {
  const options: Options = {
    stateDb: process.env.MONITOR_STATE_DB ? path.resolve(process.env.MONITOR_STATE_DB) : null,
    findings: null,
    sinceDays: 180,
    limit: 40,
    probe: 25,
    outMd: path.join(ROOT, '.generated/monitor/source-candidates.md'),
    outJson: path.join(ROOT, '.generated/monitor/source-candidates.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--state-db') options.stateDb = path.resolve(argv[++index]);
    else if (value === '--findings') options.findings = path.resolve(argv[++index]);
    else if (value === '--since-days') options.sinceDays = Number(argv[++index]);
    else if (value === '--limit') options.limit = Number(argv[++index]);
    else if (value === '--probe') options.probe = Number(argv[++index]);
    else if (value === '--out-md') options.outMd = path.resolve(argv[++index]);
    else if (value === '--out-json') options.outJson = path.resolve(argv[++index]);
    else throw new Error(`Unknown candidates option: ${value}`);
  }
  return options;
}

function slug(sourceKey: string): string {
  return sourceKey.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 48);
}

function kind(candidate: Candidate): string {
  if (candidate.social) return 'social';
  if (candidate.gov) return 'agency/official';
  return 'outlet';
}

// A ready-to-paste manifest entry for a candidate with a discovered feed.
function manifestEntry(candidate: Candidate & { feed: string | null }): Record<string, unknown> {
  return {
    id: `${slug(candidate.source_key)}-rss`,
    tier: 'discovery',
    adapter: 'rss',
    status: 'active',
    url: candidate.feed,
    jurisdictions: candidate.isos.length === 1 ? candidate.isos : ['multi'],
    keywords: ['visa', 'immigration', 'residence', 'residency', 'permit', 'citizenship', 'nationality'],
    keyword_match: 'any',
    notes: `Auto-proposed from sweep citations: surfaced ${candidate.confirmed} confirmed change(s) across ${candidate.jurisdictions} jurisdiction(s). Discovery only; verify against primary sources.`,
  };
}

function renderMarkdown(ranked: Array<Candidate & { feed: string | null }>, options: Options, generatedAt: string): string {
  const withFeed = ranked.filter(candidate => candidate.feed);
  const lines: string[] = [
    '# Candidate discovery sources',
    '',
    `Generated ${generatedAt} from the monitor_citations ledger (last ${options.sinceDays} days).`,
    'Ranked by how often, and for how many jurisdictions, the grounded sweep cited each',
    'source while surfacing changes. Hosts already in the manifest are excluded.',
    'Discovery only — every accepted source still verifies against primary sources.',
    '',
    '| # | Source | Type | Score | Confirmed | Juris | Feed | Sample |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  ranked.forEach((candidate, index) => {
    const feed = candidate.feed ? `[feed](${candidate.feed})` : (candidate.social ? '_needs adapter_' : '—');
    const sample = candidate.sample_title ? candidate.sample_title.slice(0, 60).replace(/\|/g, '\\|') : candidate.sample_url;
    lines.push(
      `| ${index + 1} | \`${candidate.source_key}\` | ${kind(candidate)} | ${candidate.score} | ${candidate.confirmed} | ${candidate.jurisdictions} | ${feed} | ${sample} |`,
    );
  });
  lines.push('', `## Ready-to-paste manifest entries (${withFeed.length} with a discovered feed)`, '');
  if (withFeed.length === 0) {
    lines.push('_No feeds discovered yet — accumulate more sweeps, or handle social accounts via the Bluesky/Mastodon path._');
  } else {
    lines.push('```json', JSON.stringify(withFeed.map(manifestEntry), null, 2), '```');
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.main) {
  (async () => {
    try {
      const options = readArgs(process.argv.slice(2));
      const store = new CitationStore(ROOT, options.stateDb);
      // Optionally fold the current run's findings in (in-memory only, so a local
      // report reflects the latest sweep before its citations are persisted).
      if (options.findings && fs.existsSync(options.findings)) {
        store.recordFindings(JSON.parse(fs.readFileSync(options.findings, 'utf8')) as Finding[], new Date().toISOString());
      }
      const candidates = store.topCandidates({
        excludeHosts: manifestHosts(ROOT),
        sinceDays: options.sinceDays,
        limit: options.limit,
      });
      store.close();

      const ranked: Array<Candidate & { feed: string | null }> = [];
      for (const [index, candidate] of candidates.entries()) {
        const feed = index < options.probe ? await discoverFeed(candidate.sample_url) : null;
        ranked.push({ ...candidate, feed });
      }

      const generatedAt = new Date().toISOString();
      fs.mkdirSync(path.dirname(options.outMd), { recursive: true });
      fs.writeFileSync(options.outMd, renderMarkdown(ranked, options, generatedAt));
      fs.writeFileSync(options.outJson, `${JSON.stringify({ generated_at: generatedAt, candidates: ranked }, null, 2)}\n`);
      const feeds = ranked.filter(candidate => candidate.feed).length;
      console.log(`ranked ${ranked.length} candidate sources (${feeds} with a discovered feed) → ${options.outMd}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  })();
}

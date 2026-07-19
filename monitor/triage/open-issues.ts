#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIssueDraft, type IssueDraft } from './issues';
import type { Lead } from './triage';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface IssueOptions {
  apply: boolean;
  leads: string;
  output: string;
}

function readArgs(argv: string[]): IssueOptions {
  const options: IssueOptions = {
    apply: false,
    leads: path.join(ROOT, '.out', 'leads.json'),
    output: path.join(ROOT, '.out', 'issue-drafts.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') options.apply = true;
    else if (value === '--dry-run') options.apply = false;
    else if (value === '--leads') options.leads = path.resolve(argv[++index]);
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown issue option: ${value}`);
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

export function createIssueDrafts(leads: Lead[]): IssueDraft[] {
  return leads.map(buildIssueDraft);
}

export function publishIssues(drafts: IssueDraft[]): string[] {
  runGh([
    'label', 'create', 'monitor-lead',
    '--color', 'BFDADC',
    '--description', 'Automated, unverified monitoring lead',
    '--force',
  ]);
  const urls: string[] = [];
  for (const draft of drafts) {
    urls.push(runGh([
      'issue', 'create',
      '--title', draft.title,
      '--body', draft.body,
      '--label', 'monitor-lead',
    ]));
  }
  return urls;
}

if (import.meta.main) {
  try {
    const options = readArgs(process.argv.slice(2));
    const leads = JSON.parse(fs.readFileSync(options.leads, 'utf8')) as Lead[];
    const drafts = createIssueDrafts(leads);
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(drafts, null, 2)}\n`);
    console.log(`wrote ${drafts.length} issue drafts to ${options.output}`);
    if (options.apply) {
      const urls = publishIssues(drafts);
      urls.forEach(url => console.log(url));
    } else {
      console.log('dry run only; pass --apply to create GitHub issues');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

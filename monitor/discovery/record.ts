#!/usr/bin/env bun

// Record the sweep's grounding citations into the monitor_citations ledger.
// Runs after each sweep: reads findings.json, emits portable INSERT OR IGNOREs
// keyed on the cited URL (idempotent, so it needs no prior D1 state), and the
// workflow applies them to D1. This is what accumulates the raw material the
// candidate-source analyzer ranks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CitationStore } from './citations';
import type { Finding } from '../sweep/run';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readArgs(argv: string[]): { findings: string; signals: string; out: string } {
  const options = {
    findings: path.join(ROOT, 'monitor/.out/findings.json'),
    signals: path.join(ROOT, 'monitor/.out/signals.json'),
    out: path.join(ROOT, 'monitor/.out/monitor-citations.sql'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--findings') options.findings = path.resolve(argv[++index]);
    else if (value === '--signals') options.signals = path.resolve(argv[++index]);
    else if (value === '--out') options.out = path.resolve(argv[++index]);
    else throw new Error(`Unknown record option: ${value}`);
  }
  return options;
}

function readJson<T>(file: string): T[] {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T[]) : [];
}

if (import.meta.main) {
  try {
    const options = readArgs(process.argv.slice(2));
    const now = new Date().toISOString();
    const store = new CitationStore(ROOT, null);

    // Sweep grounding citations — the outlets the model read to surface a change.
    const findings = readJson<Finding>(options.findings);
    const fromFindings = store.recordFindings(findings, now);

    // X-search discovery hits — the X posts (accounts) that surfaced a change, so
    // the candidate loop can rank which X accounts are worth following.
    const signals = readJson<{ source_id?: string; url?: string; jurisdiction?: string; title?: string }>(options.signals);
    let fromSignals = 0;
    for (const signal of signals) {
      if (signal.source_id === 'x-search' && signal.url) {
        if (store.recordCitation(signal.url, signal.jurisdiction ?? '', 'signal', signal.title ?? '', now)) fromSignals += 1;
      }
    }

    store.writeMutations(options.out);
    store.close();
    console.log(`recorded ${fromFindings} citation rows from ${findings.length} findings + ${fromSignals} from X-search signals → ${options.out}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

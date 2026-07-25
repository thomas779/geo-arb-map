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

function readArgs(argv: string[]): { findings: string; out: string } {
  const options = {
    findings: path.join(ROOT, 'monitor/.out/findings.json'),
    out: path.join(ROOT, 'monitor/.out/monitor-citations.sql'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--findings') options.findings = path.resolve(argv[++index]);
    else if (value === '--out') options.out = path.resolve(argv[++index]);
    else throw new Error(`Unknown record option: ${value}`);
  }
  return options;
}

if (import.meta.main) {
  try {
    const options = readArgs(process.argv.slice(2));
    const findings = fs.existsSync(options.findings)
      ? (JSON.parse(fs.readFileSync(options.findings, 'utf8')) as Finding[])
      : [];
    const store = new CitationStore(ROOT, null);
    const recorded = store.recordFindings(findings, new Date().toISOString());
    store.writeMutations(options.out);
    store.close();
    console.log(`recorded ${recorded} citation rows from ${findings.length} findings → ${options.out}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

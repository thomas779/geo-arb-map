#!/usr/bin/env bun

// IMC world-map watcher. The Investment Migration Council homepage inlines its
// entire CBI/RBI country map as one base64 JSON blob (window.wpgmp.mapdata1).
// We treat it as a CHANGE SIGNAL, not as facts (the map has been stale before —
// EB-5 at pre-2022 amounts): when the IMC updates a country entry, that is a
// lead for the review pipeline to verify against primary sources (#108).
//
// The committed snapshot stores only our parsed FACTS (programme labels,
// figures, official URLs) — never IMC's prose — so the repo carries data, not
// their copyrighted compilation.
//
// CLI: bun monitor/discovery/imc_map.ts [--update] [--snapshot <path>]
//   Prints a human-readable diff vs the snapshot; --update rewrites it.
//   Exits 0 always; the workflow decides what to do with a non-empty diff.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SNAPSHOT = path.join(ROOT, 'sources', 'imc-map-snapshot.json');
const IMC_URL = 'https://investmentmigration.org/';

export interface ImcCountry {
  country: string;
  // Labeled fields exactly as parsed ("Minimum Investment" -> ["From USD 250,000"]).
  fields: Record<string, string[]>;
  urls: string[];
}

export type ImcSnapshot = Record<string, ImcCountry>;

/** Pull the base64 map blob out of the homepage HTML. */
export function extractMapData(html: string): unknown {
  const match = html.match(/window\.wpgmp\.mapdata1\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('wpgmp mapdata blob not found on the IMC homepage');
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
}

const decodeEntities = (value: string) => value
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Parse one place's infowindow HTML into labeled fact fields + URLs. */
export function parsePlaceContent(content: string): Pick<ImcCountry, 'fields' | 'urls'> {
  const text = decodeEntities(content);
  const fields: Record<string, string[]> = {};
  for (const m of text.matchAll(/<strong>\s*([^<:]+?):?\s*<\/strong>\s*([^<]*)/g)) {
    const key = m[1].trim().replace(/^[A-Z]\.\s*/, '');
    const value = m[2].trim().replace(/\s+/g, ' ');
    if (!value) continue;
    (fields[key] ??= []).push(value);
  }
  const urls = [...new Set([...text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+/g)].map(m => m[0]))];
  return { fields, urls };
}

export function parseSnapshot(mapData: unknown): ImcSnapshot {
  const places = (mapData as { places?: Array<{ title?: string; content?: string }> }).places ?? [];
  const snapshot: ImcSnapshot = {};
  for (const place of places) {
    const country = String(place.title ?? '').trim();
    if (!country) continue;
    snapshot[country] = { country, ...parsePlaceContent(String(place.content ?? '')) };
  }
  return snapshot;
}

/** Human-readable diff; empty array = no change. */
export function diffSnapshots(before: ImcSnapshot, after: ImcSnapshot): string[] {
  const lines: string[] = [];
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of [...names].sort()) {
    const a = before[name];
    const b = after[name];
    if (!a) { lines.push(`+ ${name}: country ADDED to the IMC map`); continue; }
    if (!b) { lines.push(`- ${name}: country REMOVED from the IMC map`); continue; }
    const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
    for (const key of [...keys].sort()) {
      const av = (a.fields[key] ?? []).join(' | ');
      const bv = (b.fields[key] ?? []).join(' | ');
      if (av !== bv) lines.push(`~ ${name} · ${key}: "${av || '(none)'}" -> "${bv || '(none)'}"`);
    }
    const aUrls = a.urls.join(' ');
    const bUrls = b.urls.join(' ');
    if (aUrls !== bUrls) lines.push(`~ ${name} · urls: ${aUrls || '(none)'} -> ${bUrls || '(none)'}`);
  }
  return lines;
}

async function fetchSnapshot(fetcher: typeof fetch = fetch): Promise<ImcSnapshot> {
  const response = await fetcher(IMC_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!response.ok) throw new Error(`IMC homepage returned ${response.status}`);
  return parseSnapshot(extractMapData(await response.text()));
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update');
  const snapIndex = process.argv.indexOf('--snapshot');
  const snapshotPath = snapIndex >= 0 ? path.resolve(process.argv[snapIndex + 1]) : DEFAULT_SNAPSHOT;

  const current = await fetchSnapshot();
  const countries = Object.keys(current).length;
  if (countries < 50) throw new Error(`parsed only ${countries} countries — page layout may have changed`);

  const previous: ImcSnapshot = fs.existsSync(snapshotPath)
    ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
    : {};
  const diff = diffSnapshots(previous, current);

  if (Object.keys(previous).length === 0) {
    console.log(`no previous snapshot — seeding with ${countries} countries`);
  } else if (diff.length === 0) {
    console.log(`no changes (${countries} countries)`);
  } else {
    console.log(`${diff.length} change(s) vs snapshot:`);
    for (const line of diff) console.log(line);
  }

  if (update) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, `${JSON.stringify(current, null, 1)}\n`);
    console.log(`snapshot written: ${snapshotPath}`);
  }

  // Machine-readable output for the workflow.
  const outDir = path.join(ROOT, '.out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'imc-map-diff.txt'), diff.length ? `${diff.join('\n')}\n` : '');
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

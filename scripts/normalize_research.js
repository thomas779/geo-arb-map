#!/usr/bin/env bun
/**
 * Normalize external research batches into our blocs_data.json shapes.
 *
 * Foreign format (per external researcher):
 *   category: "A" (bloc) | "B" (bilateral lane) | "C" (identity lane)
 *           | "D" (one-way / territorial) | "E" (proto/proposed)
 *   TR/PR/CIT: booleans; iso_numeric; destination_countries[]; beneficiary_countries[]
 *   confidence: "high: ..." | "medium: ..." | "low: ..."
 *
 * Routing rules:
 *   - confidence high  + leads_to_settlement       -> live
 *   - confidence med/lo + leads_to_settlement      -> pending_verification
 *   - !leads_to_settlement                         -> out_of_scope (temporary; excluded by policy)
 *   - CIT-only records (TR=false, PR=false, CIT=true) that regulate keeping two
 *     nationalities rather than granting mobility  -> dual_citizenship bucket
 *   - iso_numeric "000" placeholders are dropped from member lists (flagged)
 *
 * Usage: bun scripts/normalize_research.js <batch.json> [--out <dir>]
 * Output: JSON report on stdout: { live, pending, out_of_scope, dual_citizenship, warnings }
 * Editorial merge into public/blocs_data.json stays manual — this script only
 * classifies and maps fields; it does not write the dataset.
 */

const fs = require('fs');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: bun scripts/normalize_research.js <batch.json>');
  process.exit(1);
}

const records = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const warnings = [];

function mapMembers(list, recId) {
  const out = [];
  for (const m of list ?? []) {
    if (m.iso_numeric === '000') {
      warnings.push(`${recId}: dropped placeholder member "${m.name}" (iso 000)`);
      continue;
    }
    out.push({ name: m.name, iso_n3: m.iso_numeric });
  }
  return out;
}

function confLevel(rec) {
  return String(rec.confidence ?? '').split(/[:\s]/)[0].toLowerCase() || 'unknown';
}

function toLane(rec) {
  const dests = mapMembers(rec.destination_countries, rec.id);
  if (dests.length > 1) {
    warnings.push(`${rec.id}: multiple destinations — needs manual modelling`);
  }
  return {
    id: rec.id,
    name: rec.name,
    color: 'TODO-assign-unused',
    destination: dests[0] ?? null,
    beneficiaries: rec.category === 'C' ? [] : mapMembers(rec.beneficiary_countries, rec.id),
    ...(rec.category === 'C' ? { beneficiaries_note: 'identity/descent-based — beneficiaries not mapped' } : {}),
    grants: rec.fastest_entry ?? '',
    limits: [rec.physical_presence, rec.last_change].filter(Boolean).join(' Last change: '),
    leads_to_settlement: !!rec.leads_to_settlement,
    confidence: confLevel(rec),
    volatility: rec.volatility,
    sources: rec.sources ?? [],
  };
}

const out = { live: [], pending: [], out_of_scope: [], dual_citizenship: [], warnings };

for (const rec of records) {
  const conf = confLevel(rec);
  const citOnly = rec.CIT === true && rec.TR === false && rec.PR === false;
  const looksLikeDualCompat = citOnly && /citizenship|nationality/i.test(rec.name);

  if (looksLikeDualCompat) {
    out.dual_citizenship.push({
      id: rec.id,
      parties: mapMembers(
        [...(rec.destination_countries ?? []), ...(rec.beneficiary_countries ?? [])]
          .filter((m, i, a) => a.findIndex(x => x.iso_numeric === m.iso_numeric) === i),
        rec.id,
      ),
      effect: rec.fastest_entry ?? '',
      status: rec.status,
      confidence: conf,
      sources: rec.sources ?? [],
    });
    continue;
  }

  if (!rec.leads_to_settlement) {
    out.out_of_scope.push({ id: rec.id, name: rec.name, reason: 'temporary / no settlement path', confidence: conf });
    continue;
  }

  const shaped = rec.category === 'A' || rec.category === 'E'
    ? { proposed_shape: rec.category === 'A' ? 'bloc (partial)' : 'proto/excluded', raw: rec }
    : toLane(rec);

  if (conf === 'high') {
    out.live.push(shaped);
  } else {
    out.pending.push({
      id: rec.id,
      name: rec.name,
      proposed_shape: rec.category === 'A' ? 'bloc' : 'lane',
      confidence: conf,
      reason: rec.confidence ?? '',
      volatility: rec.volatility,
      sources: rec.sources ?? [],
      record: shaped,
    });
  }
}

console.log(JSON.stringify(out, null, 2));
console.error(`\n${records.length} records -> live: ${out.live.length}, pending: ${out.pending.length}, out_of_scope: ${out.out_of_scope.length}, dual_citizenship: ${out.dual_citizenship.length}, warnings: ${warnings.length}`);

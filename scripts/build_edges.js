#!/usr/bin/env bun
/**
 * Generate public/edges.json — the strategy-explorer graph layer.
 *
 * Implements docs/explorer-spec.md derivation rules (conservative):
 *   - full/closed blocs:      cit:X → settle_full:Y   (0 yrs) for co-members
 *   - partial/hub_spoke:      cit:X → settle_partial:Y (0 yrs)
 *   - one_way + proto blocs:  NO edges (category cards / not real rights)
 *   - settlement lanes:       cit:beneficiary → settle_partial:dest (0 yrs),
 *                             carrying allocation (ballot/quota/discretionary
 *                             edges exist but planners must suppress them)
 *   - work-only lanes:        cit:beneficiary → work:dest — TERMINAL, no
 *                             outgoing edges ever leave a work node
 *   - identity lanes:         conditional cit:dest edges gated by `needs`
 *                             (ancestor:ISO or heritage:<laneId>)
 *   - naturalization:         pr/settle_full/settle_partial:X → cit:X using
 *                             dataset-parsed years, with audited ordinary +
 *                             nationality-gated edges where the fastest track
 *                             is conditional; renounces_previous set from
 *                             dual_citizenship
 *   - child-birth events:     conditional edges gated by needs
 *                             ['willing_child_abroad'] (from manual_edges)
 */

import fs from 'node:fs';
import {
  acquisitionYears,
} from '../src/lib/planner.ts';
import {
  CBI_YEARS,
  DESCENT_YEARS,
  naturalizationRule,
  timelineBeneficiaryIsos,
} from '../src/lib/timeline-rules.ts';

export function buildEdges(data, manualEdges) {
  const edges = [];
  const bans = data.dual_citizenship?.countries ?? {};
  const renounces = (iso) => bans[iso]?.status === 'banned';

  const push = (e) => edges.push({
    allocation: 'right', confidence: 'high', needs: [], years: 0, ...e,
  });

  // ── Bloc edges ──
  for (const b of data.blocs) {
    if (b.category === 'proto' || b.category === 'one_way') continue;
    const target = (b.category === 'full' || b.category === 'closed')
      ? 'settle_full' : 'settle_partial';
    for (const m1 of b.members) {
      for (const m2 of b.members) {
        if (m1.iso_n3 === m2.iso_n3) continue;
        push({ from: `cit:${m1.iso_n3}`, to: `${target}:${m2.iso_n3}`, mechanism: b.id });
      }
    }
  }

  // ── Lane edges ──
  for (const l of data.bilateral_lanes) {
    const allocation = l.allocation ?? 'right';
    if (l.beneficiaries.length === 0) {
      // Identity lane → conditional citizenship-by-descent/heritage edge
      if (!l.leads_to_settlement) continue;
      const heritage = ['israel_law_of_return', 'germany_spaetaussiedler', 'kazakhstan_qandas', 'russia_compatriot'].includes(l.id);
      push({
        from: '*', to: `cit:${l.destination.iso_n3}`, mechanism: l.id,
        years: DESCENT_YEARS[l.id] ?? 2, allocation,
        needs: [heritage ? `heritage:${l.id}` : `ancestor:${l.destination.iso_n3}`],
        renounces_previous: renounces(l.destination.iso_n3) || undefined,
      });
      continue;
    }
    for (const ben of l.beneficiaries) {
      if (!l.leads_to_settlement) {
        push({ from: `cit:${ben.iso_n3}`, to: `work:${l.destination.iso_n3}`, mechanism: l.id, allocation });
      } else {
        push({ from: `cit:${ben.iso_n3}`, to: `settle_partial:${l.destination.iso_n3}`, mechanism: l.id, allocation });
      }
    }
  }

  // ── Citizenship-by-investment: open to anyone (money-gated, a right) ──
  // Active OECS programs per the oecs bloc notes (SVG's is still planned).
  for (const [iso, years] of Object.entries(CBI_YEARS)) {
    push({ from: '*', to: `cit:${iso}`, mechanism: 'cbi', years });
  }

  // ── Naturalization edges (dataset-parsed residence→citizenship years) ──
  const years = acquisitionYears(data);
  for (const [iso, y] of years) {
    const rule = naturalizationRule(iso);
    const ordinaryYears = rule?.ordinary_months ? rule.ordinary_months / 12 : y;
    for (const fromKind of ['pr', 'settle_full', 'settle_partial']) {
      push({
        from: `${fromKind}:${iso}`, to: `cit:${iso}`, mechanism: 'naturalization',
        years: ordinaryYears,
        confidence: rule?.confidence === 'high' ? 'audited-ordinary' : 'legacy-canonical',
        renounces_previous: renounces(iso) || undefined,
      });
      for (const conditional of rule?.conditional ?? []) {
        const beneficiaries = timelineBeneficiaryIsos(data, conditional);
        if (beneficiaries.length === 0) {
          throw new Error(`Conditional timeline ${iso}:${conditional.id} has no beneficiaries`);
        }
        push({
          from: `${fromKind}:${iso}`, to: `cit:${iso}`, mechanism: 'naturalization',
          years: conditional.minimum_months / 12,
          confidence: 'audited-conditional',
          needs: [`citizenship_any:${beneficiaries.join(',')}`],
          renounces_previous: renounces(iso) || undefined,
        });
      }
    }
  }

  // ── Child-birth event accelerators (hand-audited manual edges) ──
  for (const ev of manualEdges?.edges ?? []) {
    if (ev.reason_code !== 'event_accelerator') continue;
    for (const grant of ev.grants) {
      if (grant.who !== 'parent') continue;
      push({
        from: '*', to: grant.node.replace(':', ':').startsWith('cit') ? grant.node : grant.node,
        mechanism: ev.id, years: grant.years,
        needs: ['willing_child_abroad'],
        confidence: ev.confidence ?? 'high',
      });
    }
  }

  return {
    meta: {
      description: 'Status-graph edges for the strategy explorer. Nodes: cit:ISO, pr:ISO, work:ISO (terminal), settle_full:ISO, settle_partial:ISO. Wildcard from "*" = conditional edge gated entirely by needs.',
      generated_from: 'blocs_data.json + data/manual_edges.json + data/timeline_rules.json via scripts/build_edges.js',
      rules: 'docs/explorer-spec.md',
      counts: { edges: edges.length },
    },
    edges,
  };
}

if (import.meta.main) {
  const data = JSON.parse(fs.readFileSync('public/blocs_data.json', 'utf8'));
  const manual = JSON.parse(fs.readFileSync('data/manual_edges.json', 'utf8'));
  const out = buildEdges(data, manual);
  out.meta.counts.edges = out.edges.length;
  fs.writeFileSync('public/edges.json', JSON.stringify(out) + '\n');
  const byMech = {};
  for (const e of out.edges) byMech[e.mechanism] = (byMech[e.mechanism] ?? 0) + 1;
  console.log(`public/edges.json: ${out.edges.length} edges`);
  console.log('top mechanisms:', Object.entries(byMech).sort((a, b) => b[1] - a[1]).slice(0, 6));
}

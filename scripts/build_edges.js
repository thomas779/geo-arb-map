#!/usr/bin/env bun
/**
 * Generate data/compiled/edges.json — the strategy-explorer graph layer.
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
 *   - descent paths:          conditional cit:dest edges from timeline
 *                             heritage rules (ancestor:ISO or heritage:<claimId>)
 *   - naturalization:         pr/settle_full/settle_partial:X → cit:X using
 *                             dataset-parsed years, with audited ordinary +
 *                             nationality-gated edges where the fastest track
 *                             is conditional; renounces_previous set from the
 *                             canonical dual_nationality field (#144)
 *   - child-birth events:     conditional edges gated on the self-attested
 *                             `child_abroad` intent (from manual_edges)
 *
 * Every edge carries BOTH the legacy `needs: string[]` gate and the typed
 * `predicates: Predicate[]` one (src/lib/predicates.ts). Predicates are derived
 * from `needs` unless an emitter supplies them, and validated on emission, so an
 * unknown attribute/op/subject fails this build instead of silently deleting the
 * edge at solve time.
 */

import fs from 'node:fs';
import {
  acquisitionYears,
  pluralityIndex,
  renouncesOnAcquiring,
} from '../src/lib/planner.ts';
import {
  CBI_YEARS,
  DESCENT_PATHS,
  DESCENT_YEARS,
  naturalizationRule,
  timelineBeneficiaryIsos,
} from '../src/lib/timeline-rules.ts';
import {
  edgeSubjectProblem,
  predicatesFromNeeds,
  UnknownPredicateError,
  validatePredicates,
} from '../src/lib/predicates.ts';

/**
 * Build-time gate: every emitted edge must carry predicates the solver can
 * actually answer. Throws (naming the edge) on an unknown attribute, an op the
 * attribute does not support, a subject nothing can read yet, or a malformed
 * value.
 *
 * This is the loud half of the contract in src/lib/predicates.ts. Before it,
 * `needsSatisfied` answered `false` for anything it did not recognise, so a new
 * gate in the data deleted its edge from the graph in silence.
 */
export function validateBuiltEdges(edges) {
  for (const edge of edges) {
    const label = `edge ${edge.mechanism} ${edge.from} -> ${edge.to}`;
    validatePredicates(edge.predicates ?? [], label);
    // Second half of the contract: the gate must be legal AND answerable by the
    // member who will evaluate it. A `parent` gate on an edge that is not the
    // child's would land in the applicant's own search, where nothing can read
    // it, and throw mid-solve instead of failing here.
    const mismatch = edgeSubjectProblem(edge.actor, edge.predicates ?? []);
    if (mismatch) throw new UnknownPredicateError(`${label}: ${mismatch}`);
  }
  return edges;
}

/**
 * @param data        public/blocs_data.json
 * @param manualEdges data/manual_edges.json
 * @param corpus      data/compiled/citizenship_routes.json — the canonical
 *                    projection carrying `jurisdictions[].dual_nationality`.
 *                    Before #144 this flag came from a rival 25-row model inside
 *                    blocs_data on its own enum (`banned`); that model is retired,
 *                    so the flag now comes from the field the coverage audit
 *                    measures and the planner reads.
 */
export function buildEdges(data, manualEdges, corpus) {
  const edges = [];
  const plurality = pluralityIndex(corpus ?? null);
  const renounces = (iso) => renouncesOnAcquiring(plurality.get(iso));

  // Every edge is validated as it is emitted, so a bad gate fails the build at
  // the line that produced it rather than surfacing as a quieter graph later.
  const push = (e) => {
    const edge = { allocation: 'right', confidence: 'high', needs: [], years: 0, ...e };
    edge.predicates = edge.predicates ?? predicatesFromNeeds(edge.needs);
    const label = `edge ${edge.mechanism} ${edge.from} -> ${edge.to}`;
    validatePredicates(edge.predicates, label);
    const mismatch = edgeSubjectProblem(edge.actor, edge.predicates);
    if (mismatch) throw new UnknownPredicateError(`${label}: ${mismatch}`);
    edges.push(edge);
  };

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

  // ── Lane edges (nationality-based bilateral only; descent is separate) ──
  for (const l of data.bilateral_lanes) {
    const allocation = l.allocation ?? 'right';
    if (l.beneficiaries.length === 0) continue; // legacy guard; heritage lanes dissolved
    for (const ben of l.beneficiaries) {
      if (!l.leads_to_settlement) {
        push({ from: `cit:${ben.iso_n3}`, to: `work:${l.destination.iso_n3}`, mechanism: l.id, allocation });
      } else {
        push({ from: `cit:${ben.iso_n3}`, to: `settle_partial:${l.destination.iso_n3}`, mechanism: l.id, allocation });
      }
    }
  }

  // ── Descent / diaspora claim paths (country routes, not a separate badge layer) ──
  for (const path of DESCENT_PATHS) {
    const iso = path.iso_n3;
    const need = path.gate === 'ancestor'
      ? `ancestor:${iso}`
      : path.gate.startsWith('claim:')
        ? `heritage:${path.gate.slice(6)}`
        : null;
    // An unrecognised gate used to `continue`, dropping the route from the graph
    // without a word. A descent rule that cannot be gated is a data bug.
    if (!need) {
      throw new Error(
        `Descent path ${path.route_id} (${iso}) has unrecognised gate ${JSON.stringify(path.gate)} `
        + '— expected "ancestor" or "claim:<id>"',
      );
    }
    push({
      from: '*',
      to: `cit:${iso}`,
      mechanism: path.route_id,
      years: DESCENT_YEARS[iso] ?? path.duration_months / 12,
      needs: [need],
      renounces_previous: renounces(iso) || undefined,
    });
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
  //
  // Both halves of every accelerator now reach the graph. What used to happen
  // here: `who: 'child'` grants were skipped, so the jus-soli half — the child's
  // own citizenship, the fact the whole accelerator turns on — was dropped, and
  // `grant.via` was ignored, so a parent walked straight into a nationality
  // without ever holding the residence the statute counts the year from.
  for (const ev of manualEdges?.edges ?? []) {
    if (ev.reason_code !== 'event_accelerator') continue;
    const allocation = ev.allocation ?? 'right';
    const confidence = ev.confidence ?? 'high';
    for (const grant of ev.grants) {
      if (grant.who === 'parent') {
        // `via` is the intermediate status the accelerator actually runs
        // through. Brazil's one-year clock runs from residence, so the shape is
        // `* -> pr:076 -> cit:076`, not one free-standing edge into citizenship.
        // Splitting it also makes the intermediate status reachable in its own
        // right, which is what Argentina's grant (family PR and nothing more)
        // has always been.
        const hops = grant.via
          ? [
            { from: '*', to: grant.via, years: 0 },
            { from: grant.via, to: grant.node, years: grant.years },
          ]
          : [{ from: '*', to: grant.node, years: grant.years }];
        for (const hop of hops) {
          push({
            ...hop,
            mechanism: ev.id,
            needs: ['willing_child_abroad'],
            allocation,
            confidence,
          });
        }
      } else if (grant.who === 'child') {
        // The child is their OWN actor with their own status set, so this is an
        // `actor: 'child'` edge gated on a PARENT's declared intent — the child
        // does not intend their own birth. Expressing that needed per-actor
        // state; until it existed the only honest thing to do was drop the edge.
        push({
          from: '*', to: grant.node,
          mechanism: ev.id, years: grant.years,
          actor: 'child',
          predicates: [{
            subject: 'parent',
            attribute: 'intent',
            op: 'eq',
            value: 'child_abroad',
            provenance: 'self_attested',
          }],
          allocation,
          confidence,
        });
      } else {
        // Not a `continue`: an unmodelled grantee is a data bug, and skipping it
        // is how the child grants stayed invisible for a month.
        throw new Error(
          `Event accelerator ${ev.id} has grant for unknown who=${JSON.stringify(grant.who)} `
          + '— expected "parent" or "child"',
        );
      }
    }
  }

  return {
    meta: {
      description: 'Status-graph edges for the strategy explorer. Nodes: cit:ISO, pr:ISO, work:ISO (terminal), settle_full:ISO, settle_partial:ISO. Wildcard from "*" = conditional edge gated entirely by its predicates. Each edge carries typed `predicates` (subject/attribute/op/value/provenance) plus the frozen legacy `needs` strings they were derived from.',
      generated_from: 'blocs_data.json + data/manual_edges.json + data/timeline_rules.json + data/compiled/citizenship_routes.json (dual_nationality) via scripts/build_edges.js',
      rules: 'docs/explorer-spec.md',
      counts: { edges: edges.length },
    },
    edges,
  };
}

if (import.meta.main) {
  const data = JSON.parse(fs.readFileSync('public/blocs_data.json', 'utf8'));
  const manual = JSON.parse(fs.readFileSync('data/manual_edges.json', 'utf8'));
  const corpus = JSON.parse(fs.readFileSync('data/compiled/citizenship_routes.json', 'utf8'));
  const out = buildEdges(data, manual, corpus);
  validateBuiltEdges(out.edges);
  out.meta.counts.edges = out.edges.length;
  out.meta.counts.gated_edges = out.edges.filter(e => e.predicates.length > 0).length;
  fs.writeFileSync('data/compiled/edges.json', JSON.stringify(out) + '\n');
  const byMech = {};
  for (const e of out.edges) byMech[e.mechanism] = (byMech[e.mechanism] ?? 0) + 1;
  console.log(`data/compiled/edges.json: ${out.edges.length} edges`);
  console.log('top mechanisms:', Object.entries(byMech).sort((a, b) => b[1] - a[1]).slice(0, 6));
}

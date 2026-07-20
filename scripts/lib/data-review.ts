import fs from 'node:fs';
import path from 'node:path';
import type { DataRelease } from './data-build';
import { REPO_ROOT } from './data-build';

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).split('|').join('\\|').split('\n').join(' ');
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '—';
}

function months(value: number | null): string {
  return value === null ? '—' : `${value} months`;
}

function reviewLine(review: {
  state: string;
  confidence: string;
  last_checked: string | null;
  note?: string;
}): string {
  return [
    `state: \`${review.state}\``,
    `confidence: \`${review.confidence}\``,
    `last checked: \`${review.last_checked ?? 'not checked'}\``,
    review.note ? `note: ${review.note}` : null,
  ].filter(Boolean).join(' · ');
}

function sourceReferences(
  refs: Array<{ source_id: string; supports_fields: string[]; note?: string }>,
): string[] {
  if (refs.length === 0) return ['- No source references.'];
  return refs.flatMap(ref => [
    `- \`${ref.source_id}\``,
    `  - fields: ${ref.supports_fields.map(field => `\`${field}\``).join(', ')}`,
    ...(ref.note ? [`  - note: ${ref.note}`] : []),
  ]);
}

export function renderDataReview(release: DataRelease): string {
  const rows = new Map(release.api_release_rows.map(row => [row.entity_id, row]));
  const lines: string[] = [
    '# Canonical data review packet',
    '',
    `Release candidate: \`${release.manifest.release_id}\``,
    '',
    `Database content hash: \`${release.manifest.database.content_hash}\``,
    '',
    `Selection mode: \`${release.manifest.database.selection_mode}\``,
    '',
    `Canonical scope: ${release.manifest.counts.canonical_entities} entities, `
      + `${release.manifest.counts.routes} routes, `
      + `${release.manifest.counts.graph_edges} graph edges.`,
    '',
    '> This packet is evidence for human review. Generating it does not approve a',
    '> revision, publish a release, replace public JSON, or deploy the website.',
    '',
    '## Approval checklist',
    '',
    '- [ ] Every selected revision ID and content hash is expected.',
    '- [ ] Every material claim is supported by the listed source and field path.',
    '- [ ] Timelines distinguish eligibility minimums from processing estimates.',
    '- [ ] Unknown values remain unknown rather than inferred.',
    '- [ ] Participant and beneficiary lists are complete in both directions.',
    '- [ ] The sanctioned Spain correction is accepted.',
    '- [ ] No unsanctioned compatibility or graph drift is present.',
    '',
    '## Revision manifest',
    '',
    '| Entity | Type | Revision | Status | Content hash |',
    '|---|---|---|---|---|',
    ...[...release.api_release_rows]
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .map(row => `| \`${cell(row.entity_id)}\` | ${cell(row.entity_type)} | `
        + `\`${cell(row.revision_id)}\` | ${cell(row.review_status)} | `
        + `\`${cell(row.content_hash)}\` |`),
    '',
    '## Sources',
    '',
    '| Source | Publisher | Type | Last checked | URL |',
    '|---|---|---|---|---|',
    ...[...release.sources]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(source => `| \`${cell(source.id)}\` | ${cell(source.publisher)} | `
        + `${cell(source.source_type)} | ${cell(source.last_checked)} | `
        + `[${cell(source.title)}](${source.url}) |`),
  ];

  for (const jurisdiction of [...release.jurisdictions]
    .sort((a, b) => a.jurisdiction.iso_n3.localeCompare(b.jurisdiction.iso_n3))) {
    const row = rows.get(jurisdiction.id);
    lines.push(
      '',
      `## ${jurisdiction.jurisdiction.name} (${jurisdiction.jurisdiction.iso_n3})`,
      '',
      `Entity: \`${jurisdiction.id}\` · revision: \`${row?.revision_id ?? 'missing'}\``,
      '',
      reviewLine(jurisdiction.review),
    );

    if (jurisdiction.routes.length === 0) {
      lines.push('', 'No canonical routes in this migration scope.');
      continue;
    }

    for (const route of [...jurisdiction.routes].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(
        '',
        `### ${route.title}`,
        '',
        `Route: \`${route.id}\` · mode: \`${route.mode}\` · status: \`${route.status}\``,
        '',
        route.summary,
        '',
        reviewLine(route.review),
        '',
        `Effective from: \`${route.effective.from ?? 'unknown'}\` · `
          + `to: \`${route.effective.to ?? 'open'}\` · `
          + `supersedes: ${list(route.effective.supersedes)}`,
        '',
        '| Variant | Outcome | Allocation | Eligibility minimum | Processing typical | Confidence |',
        '|---|---|---|---|---|---|',
        ...[...route.variants]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(variant => `| \`${cell(variant.id)}\` | ${cell(variant.outcome)} | `
            + `${cell(variant.allocation)} | `
            + `${months(variant.timeline.eligibility_minimum_months)} | `
            + `${months(variant.timeline.processing_typical_months)} | `
            + `${cell(variant.timeline.confidence)} |`),
      );

      for (const variant of [...route.variants].sort((a, b) => a.id.localeCompare(b.id))) {
        lines.push(
          '',
          `#### ${variant.label}`,
          '',
          ...(variant.eligibility.length > 0
            ? variant.eligibility.map(condition =>
              `- eligibility: \`${condition.field} ${condition.operator} `
                + `${JSON.stringify(condition.value)}\``
                + (condition.unit ? ` ${condition.unit}` : '')
                + (condition.note ? ` — ${condition.note}` : ''))
            : ['- eligibility: no additional structured condition']),
          ...variant.milestones.map(milestone =>
            `- milestone: \`${milestone.status}\` at `
              + `\`${milestone.minimum_months ?? 'unknown'} months\``
              + (milestone.note ? ` — ${milestone.note}` : '')),
          ...sourceReferences(variant.source_refs),
        );
      }
    }
  }

  for (const arrangement of [...release.arrangements].sort((a, b) => a.id.localeCompare(b.id))) {
    const row = rows.get(arrangement.id);
    lines.push(
      '',
      `## ${arrangement.name}`,
      '',
      `Entity: \`${arrangement.id}\` · revision: \`${row?.revision_id ?? 'missing'}\``,
      '',
      `Kind: \`${arrangement.kind}\` · status: \`${arrangement.status}\` · `
        + `directionality: \`${arrangement.directionality}\``,
      '',
      reviewLine(arrangement.review),
      '',
      `- members: ${list(arrangement.participants.members)}`,
      `- former members: ${list(arrangement.participants.former_members)}`,
      `- destinations: ${list(arrangement.participants.destinations)}`,
      `- beneficiaries: ${list(arrangement.participants.beneficiaries)}`,
      ...(arrangement.participants.beneficiaries_note
        ? [`- beneficiary note: ${arrangement.participants.beneficiaries_note}`]
        : []),
      '',
      '### Rights',
      '',
      `- temporary residence: ${arrangement.rights_by_status.temporary_residence || '—'}`,
      `- permanent residence: ${arrangement.rights_by_status.permanent_residence || '—'}`,
      `- citizenship: ${arrangement.rights_by_status.citizenship || '—'}`,
      '',
      '### Sources',
      '',
      ...sourceReferences(arrangement.source_refs),
    );

    for (const pathway of [...arrangement.pathways].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(
        '',
        `### ${pathway.label}`,
        '',
        `Pathway: \`${pathway.id}\` · outcome: \`${pathway.outcome}\` · `
          + `allocation: \`${pathway.allocation}\``,
        '',
        `Eligibility minimum: ${months(pathway.timeline.eligibility_minimum_months)} · `
          + `processing typical: ${months(pathway.timeline.processing_typical_months)} · `
          + `confidence: \`${pathway.timeline.confidence}\``,
        ...pathway.eligibility.map(condition =>
          `- eligibility: \`${condition.field} ${condition.operator} `
            + `${JSON.stringify(condition.value)}\``
            + (condition.unit ? ` ${condition.unit}` : '')
            + (condition.note ? ` — ${condition.note}` : '')),
        ...pathway.milestones.map(milestone =>
          `- milestone: \`${milestone.status}\` at `
            + `\`${milestone.minimum_months ?? 'unknown'} months\``
            + (milestone.note ? ` — ${milestone.note}` : '')),
        ...sourceReferences(pathway.source_refs),
      );
    }
  }

  lines.push(
    '',
    '## Sanctioned differences',
    '',
    ...release.parity.reviewed_differences.map(difference =>
      `- \`${difference.entity_id}\` · **${difference.kind}** — ${difference.description}`),
    '',
    '## Parity gates',
    '',
    '| Gate | Result |',
    '|---|---|',
    ...release.parity.gates.map(gate => `| \`${cell(gate.gate)}\` | ${cell(gate.status)} |`),
    '',
    `Overall parity: **${release.parity.passed ? 'passed' : 'failed'}**`,
    '',
  );
  return lines.join('\n');
}

export function writeDataReview(
  release: DataRelease,
  root = REPO_ROOT,
): string {
  const outputRoot = path.join(root, '.generated/data-canonical/reviews');
  const output = path.join(outputRoot, `${release.manifest.release_id}.md`);
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(output, renderDataReview(release));
  return output;
}

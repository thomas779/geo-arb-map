import path from 'node:path';

type Coverage = Record<string, string>;

export interface PromotionArtifact {
  jurisdictions: Array<{ iso_n3: string; coverage: Coverage }>;
  routes: Array<{ id: string }>;
  residence_routes?: Array<{ id: string }>;
}

export interface PromotionRegression {
  kind: 'citizenship_route_removed' | 'residence_route_removed' | 'coverage_downgraded';
  id: string;
  before?: string;
  after?: string;
}

/**
 * Promotion is forward-only relative to the committed public artifact.
 *
 * This catches the dangerous stale-private-source case: a candidate can be
 * internally valid and still silently delete routes that another session has
 * already shipped. Routes that end should remain present with an inactive or
 * verified-negative status; reviewed coverage must never fall back to unknown.
 */
export function promotionRegressions(
  committed: PromotionArtifact,
  candidate: PromotionArtifact,
): PromotionRegression[] {
  const regressions: PromotionRegression[] = [];
  const candidateCitizenship = new Set(candidate.routes.map(route => route.id));
  const candidateResidence = new Set((candidate.residence_routes ?? []).map(route => route.id));

  for (const route of committed.routes) {
    if (!candidateCitizenship.has(route.id)) {
      regressions.push({ kind: 'citizenship_route_removed', id: route.id });
    }
  }
  for (const route of committed.residence_routes ?? []) {
    if (!candidateResidence.has(route.id)) {
      regressions.push({ kind: 'residence_route_removed', id: route.id });
    }
  }

  const candidateJurisdictions = new Map(
    candidate.jurisdictions.map(jurisdiction => [jurisdiction.iso_n3, jurisdiction]),
  );
  for (const jurisdiction of committed.jurisdictions) {
    const next = candidateJurisdictions.get(jurisdiction.iso_n3);
    for (const [mode, before] of Object.entries(jurisdiction.coverage)) {
      const after = next?.coverage[mode] ?? 'missing';
      if (before === 'reviewed' && after !== 'reviewed') {
        regressions.push({
          kind: 'coverage_downgraded',
          id: `${jurisdiction.iso_n3}:${mode}`,
          before,
          after,
        });
      }
    }
  }

  return regressions.sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}

export function assertPromotionPreservesHead(
  committed: PromotionArtifact,
  candidate: PromotionArtifact,
): void {
  const regressions = promotionRegressions(committed, candidate);
  if (regressions.length === 0) return;

  const preview = regressions.slice(0, 20).map(item =>
    item.kind === 'coverage_downgraded'
      ? `${item.kind}: ${item.id} (${item.before} -> ${item.after})`
      : `${item.kind}: ${item.id}`,
  );
  const remaining = regressions.length - preview.length;
  throw new Error([
    `Promotion would regress ${regressions.length} item(s) relative to HEAD.`,
    ...preview,
    ...(remaining > 0 ? [`...and ${remaining} more`] : []),
    'Reconcile the private canonical source with committed public data before promoting.',
  ].join('\n'));
}

export function readHeadPromotionArtifact(repoRoot: string): PromotionArtifact {
  const relativePath = 'public/citizenship_routes.json';
  const result = Bun.spawnSync(['git', 'show', `HEAD:${relativePath}`], {
    cwd: path.resolve(repoRoot),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(`Cannot read HEAD:${relativePath}; refusing an unguarded promotion${detail ? `: ${detail}` : ''}`);
  }
  return JSON.parse(result.stdout.toString()) as PromotionArtifact;
}

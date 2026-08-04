import fs from 'node:fs';
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
    `Promotion would regress ${regressions.length} item(s) relative to the published baseline.`,
    ...preview,
    ...(remaining > 0 ? [`...and ${remaining} more`] : []),
    'Reconcile the private canonical source with what is already published (flag-paths-data / local compiled) before promoting. A blind promote drops canonical-only routes.',
  ].join('\n'));
}

/**
 * Baseline for forward-only promotion.
 *
 * Since 2026-08-04 the compiled corpus is gitignored and lives in the private
 * `flag-paths-data` repo. Compare against, in order:
 *   1. on-disk `data/compiled/citizenship_routes.json` (last local promote)
 *   2. `.generated/flag-paths-data/compiled/citizenship_routes.json` (cloned published)
 *   3. `git show HEAD:data/compiled/...` (legacy, only if still tracked)
 * Refusing to promote without a baseline is intentional — silent drops hurt.
 */
export function readHeadPromotionArtifact(repoRoot: string): PromotionArtifact {
  const resolved = path.resolve(repoRoot);
  const candidates = [
    path.join(resolved, 'data/compiled/citizenship_routes.json'),
    path.join(resolved, '.generated/flag-paths-data/compiled/citizenship_routes.json'),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PromotionArtifact;
    }
  }

  const relativePath = 'data/compiled/citizenship_routes.json';
  const result = Bun.spawnSync(['git', 'show', `HEAD:${relativePath}`], {
    cwd: resolved,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode === 0) {
    return JSON.parse(result.stdout.toString()) as PromotionArtifact;
  }

  const detail = result.stderr.toString().trim();
  throw new Error(
    `Cannot locate a promotion baseline (looked for local compiled, flag-paths-data clone, and HEAD:${relativePath}); refusing an unguarded promotion${detail ? `: ${detail}` : ''}. `
    + 'Fetch or promote once so data/compiled/citizenship_routes.json exists, or clone flag-paths-data into .generated/flag-paths-data.',
  );
}

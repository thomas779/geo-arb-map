#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AcquisitionMode,
  JurisdictionRecord,
  SourceRecord,
} from '../../scripts/lib/canonical-schema';
import { loadCanonicalDatabase } from '../../scripts/lib/data-build';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODES: AcquisitionMode[] = ['ancestry', 'naturalization', 'birth', 'investment'];
const IMPLEMENTED_ACTIVE_ADAPTERS = new Set(['rss', 'telegram_html', 'html_index']);
const METHOD_ADAPTERS: Record<string, string> = {
  api: 'api',
  email: 'email',
  http: 'html_index',
  rss: 'rss',
  telegram: 'telegram_html',
  youtube: 'youtube',
};

interface RegistryMember {
  iso_n3: string;
  name: string;
}

interface RegistrySpecial {
  id: string;
  name: string;
}

export interface JurisdictionRegistry {
  sovereigns: RegistryMember[];
  territories: RegistryMember[];
  special: RegistrySpecial[];
}

export interface MonitorSource {
  id: string;
  tier: 'discovery' | 'verification';
  adapter: string;
  status: 'active' | 'planned';
  jurisdictions?: string[];
  url?: string;
}

export interface SourceManifest {
  sources: MonitorSource[];
}

export interface CanonicalAuditInput {
  sources: SourceRecord[];
  jurisdictions: JurisdictionRecord[];
}

interface RegistryRow {
  iso_n3: string;
  name: string;
  type: 'sovereign' | 'territory' | 'special';
}

export interface MonitoringCoverageAudit {
  schema_version: 1;
  summary: {
    registry_jurisdictions: number;
    sovereigns: number;
    territories: number;
    special: number;
    canonical_jurisdictions: number;
    fully_reviewed_jurisdictions: number;
    registered_monitor_sources: number;
    active_monitor_sources: number;
    jurisdictions_with_registered_verification: number;
    jurisdictions_with_active_verification: number;
  };
  structural_errors: string[];
  global_discovery_sources: Array<{ id: string; status: string; adapter: string }>;
  jurisdictions: Array<{
    iso_n3: string;
    name: string;
    type: RegistryRow['type'];
    canonical_review: string;
    modes: Record<AcquisitionMode, { finding: string; review: string; routes: number }>;
    canonical_source_records: number;
    canonical_monitor_ids: string[];
    registered_verification_ids: string[];
    active_verification_ids: string[];
    gaps: string[];
  }>;
}

function registryRows(registry: JurisdictionRegistry): RegistryRow[] {
  return [
    ...registry.sovereigns.map(item => ({ ...item, type: 'sovereign' as const })),
    ...registry.territories.map(item => ({ ...item, type: 'territory' as const })),
    ...registry.special.map(item => ({ iso_n3: item.id, name: item.name, type: 'special' as const })),
  ].sort((left, right) => left.iso_n3.localeCompare(right.iso_n3));
}

function modeSummary(record: JurisdictionRecord | undefined): MonitoringCoverageAudit['jurisdictions'][number]['modes'] {
  return Object.fromEntries(MODES.map(mode => {
    const coverage = record?.coverage.find(item => item.mode === mode);
    return [mode, {
      finding: coverage?.finding ?? 'unknown',
      review: coverage?.review.state ?? 'unchecked',
      routes: record?.routes.filter(route => route.mode === mode).length ?? 0,
    }];
  })) as MonitoringCoverageAudit['jurisdictions'][number]['modes'];
}

function isPrimary(source: SourceRecord): boolean {
  return !['discovery', 'secondary_legal'].includes(source.source_type);
}

export function buildMonitoringCoverageAudit(
  registry: JurisdictionRegistry,
  manifest: SourceManifest,
  canonical: CanonicalAuditInput,
): MonitoringCoverageAudit {
  const rows = registryRows(registry);
  const registryIds = new Set(rows.map(item => item.iso_n3));
  const structuralErrors: string[] = [];
  const manifestById = new Map<string, MonitorSource>();

  for (const source of manifest.sources) {
    if (manifestById.has(source.id)) structuralErrors.push(`duplicate monitor source id: ${source.id}`);
    manifestById.set(source.id, source);
    if (source.status === 'active' && !IMPLEMENTED_ACTIVE_ADAPTERS.has(source.adapter)) {
      structuralErrors.push(`active monitor source ${source.id} uses unimplemented adapter ${source.adapter}`);
    }
    for (const jurisdiction of source.jurisdictions ?? []) {
      if (!registryIds.has(jurisdiction) && !['multi', 'eu'].includes(jurisdiction)) {
        structuralErrors.push(`monitor source ${source.id} uses unknown jurisdiction ${jurisdiction}`);
      }
    }
  }

  for (const source of canonical.sources) {
    if (!source.monitoring) continue;
    const registered = manifestById.get(source.monitoring.source_id);
    if (!registered) {
      structuralErrors.push(
        `canonical source ${source.id} references missing monitor ${source.monitoring.source_id}`,
      );
      continue;
    }
    const expectedAdapter = METHOD_ADAPTERS[source.monitoring.method];
    if (expectedAdapter !== registered.adapter) {
      structuralErrors.push(
        `canonical monitor ${source.monitoring.source_id} uses ${source.monitoring.method} but manifest adapter is ${registered.adapter}`,
      );
    }
  }

  const canonicalByIso = new Map(
    canonical.jurisdictions.map(item => [item.jurisdiction.iso_n3, item]),
  );
  const auditedJurisdictions = rows.map(jurisdiction => {
    const record = canonicalByIso.get(jurisdiction.iso_n3);
    const modes = modeSummary(record);
    const sourceRecords = canonical.sources.filter(source =>
      source.jurisdictions.includes(jurisdiction.iso_n3));
    const canonicalMonitorIds = [...new Set(sourceRecords.flatMap(source =>
      source.monitoring ? [source.monitoring.source_id] : []))].sort();
    const verification = manifest.sources.filter(source =>
      source.tier === 'verification' && source.jurisdictions?.includes(jurisdiction.iso_n3));
    const registeredVerificationIds = verification.map(source => source.id).sort();
    const activeVerificationIds = verification
      .filter(source => source.status === 'active')
      .map(source => source.id)
      .sort();
    const gaps: string[] = [];
    if (!record) gaps.push('no_canonical_record');
    if (MODES.some(mode => modes[mode].finding === 'unknown')) gaps.push('mode_coverage_unknown');
    if (!sourceRecords.some(isPrimary)) gaps.push('no_canonical_primary_source');
    if (registeredVerificationIds.length === 0) gaps.push('no_registered_verification_source');
    if (activeVerificationIds.length === 0) gaps.push('no_active_verification_source');

    return {
      ...jurisdiction,
      canonical_review: record?.review.state ?? 'unchecked',
      modes,
      canonical_source_records: sourceRecords.length,
      canonical_monitor_ids: canonicalMonitorIds,
      registered_verification_ids: registeredVerificationIds,
      active_verification_ids: activeVerificationIds,
      gaps,
    };
  });

  const fullyReviewed = auditedJurisdictions.filter(item =>
    item.canonical_review === 'reviewed'
    && MODES.every(mode => item.modes[mode].review === 'reviewed'));

  return {
    schema_version: 1,
    summary: {
      registry_jurisdictions: rows.length,
      sovereigns: registry.sovereigns.length,
      territories: registry.territories.length,
      special: registry.special.length,
      canonical_jurisdictions: canonical.jurisdictions.length,
      fully_reviewed_jurisdictions: fullyReviewed.length,
      registered_monitor_sources: manifest.sources.length,
      active_monitor_sources: manifest.sources.filter(source => source.status === 'active').length,
      jurisdictions_with_registered_verification: auditedJurisdictions.filter(
        item => item.registered_verification_ids.length > 0,
      ).length,
      jurisdictions_with_active_verification: auditedJurisdictions.filter(
        item => item.active_verification_ids.length > 0,
      ).length,
    },
    structural_errors: [...new Set(structuralErrors)].sort(),
    global_discovery_sources: manifest.sources
      .filter(source => source.tier === 'discovery' && source.jurisdictions?.includes('multi'))
      .map(source => ({ id: source.id, status: source.status, adapter: source.adapter }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    jurisdictions: auditedJurisdictions,
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

if (import.meta.main) {
  const databasePath = argument('--db') ?? '.generated/data-canonical/canonical.sqlite';
  const outputPath = path.resolve(
    argument('--output') ?? path.join(ROOT, '.generated/monitor/source-coverage.json'),
  );
  const registry = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/registry.json'), 'utf8'),
  ) as JurisdictionRegistry;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'monitor/sources/manifest.json'), 'utf8'),
  ) as SourceManifest;
  const loaded = loadCanonicalDatabase(databasePath, ROOT);
  const audit = buildMonitoringCoverageAudit(registry, manifest, loaded);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify(audit.summary, null, 2));
  console.log(outputPath);
  if (audit.structural_errors.length > 0) {
    for (const error of audit.structural_errors) console.error(`source audit: ${error}`);
    process.exitCode = 1;
  }
}

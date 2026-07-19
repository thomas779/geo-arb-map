import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BilateralLane,
  Bloc,
  BlocsData,
  CitizenshipRoute,
  Member,
} from '../../src/types';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ISO_N3 = /^\d{3}$/;
const ENTITY_ID = /^[a-z0-9][a-z0-9_-]*$/;

interface MigrationPilot {
  schema_version: 1;
  status: 'shadow';
  jurisdictions: string[];
  arrangements: {
    blocs: string[];
    bilateral_lanes: string[];
  };
  cutover_gate: string;
}

interface CuratedCitizenshipData {
  meta: Record<string, unknown>;
  routes: CitizenshipRoute[];
}

interface RegistryEntry extends Member {
  type?: string;
}

interface Registry {
  sovereigns: RegistryEntry[];
  territories: RegistryEntry[];
  special: Array<{ id: string; name: string }>;
}

export interface ShadowJurisdiction {
  schema_version: 1;
  entity_type: 'jurisdiction';
  jurisdiction: Member;
  migration: {
    status: 'shadow';
    legacy_route_positions: number[];
  };
  routes: CitizenshipRoute[];
}

export interface ShadowArrangement {
  schema_version: 1;
  entity_type: 'arrangement';
  arrangement_kind: 'bloc' | 'bilateral_lane';
  migration: {
    status: 'shadow';
    legacy_position: number;
  };
  record: Bloc | BilateralLane;
}

export interface DataShadow {
  pilot: MigrationPilot;
  jurisdictions: ShadowJurisdiction[];
  arrangements: ShadowArrangement[];
  compatibility: {
    mobility: BlocsData;
    citizenship: CuratedCitizenshipData;
  };
  manifest: {
    schema_version: 1;
    release_id: string;
    mode: 'shadow';
    counts: {
      jurisdictions: number;
      arrangements: number;
      citizenship_routes: number;
    };
    source_hashes: Record<string, string>;
    compatibility_hashes: Record<string, string>;
  };
}

function readJson<T>(root: string, relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertUnique(values: string[], label: string): void {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate) throw new Error(`${label} contains duplicate ${duplicate}`);
}

function validatePilot(pilot: MigrationPilot): void {
  if (pilot.schema_version !== 1 || pilot.status !== 'shadow') {
    throw new Error('Migration pilot must be schema_version 1 in shadow mode');
  }
  if (!pilot.cutover_gate.trim()) throw new Error('Migration pilot requires a cutover gate');
  for (const iso of pilot.jurisdictions) {
    if (!ISO_N3.test(iso)) throw new Error(`Invalid pilot jurisdiction ${iso}`);
  }
  for (const [kind, ids] of Object.entries(pilot.arrangements)) {
    for (const id of ids) {
      if (!ENTITY_ID.test(id)) throw new Error(`Invalid ${kind} id ${id}`);
    }
  }
  assertUnique(pilot.jurisdictions, 'Pilot jurisdictions');
  assertUnique(pilot.arrangements.blocs, 'Pilot blocs');
  assertUnique(pilot.arrangements.bilateral_lanes, 'Pilot bilateral lanes');
}

function registryMembers(registry: Registry): Map<string, Member> {
  const entries: Member[] = [
    ...registry.sovereigns,
    ...registry.territories,
    ...registry.special.map(entry => ({ iso_n3: entry.id, name: entry.name })),
  ];
  return new Map(entries.map(entry => [entry.iso_n3, {
    iso_n3: entry.iso_n3,
    name: entry.name,
  }]));
}

function splitAtPositions<T>(
  records: T[],
  selected: (record: T) => boolean,
): { legacy: T[]; extracted: Array<{ position: number; record: T }> } {
  const legacy: T[] = [];
  const extracted: Array<{ position: number; record: T }> = [];
  records.forEach((record, position) => {
    if (selected(record)) extracted.push({ position, record });
    else legacy.push(record);
  });
  return { legacy, extracted };
}

function reassembleAtPositions<T>(
  legacy: T[],
  extracted: Array<{ position: number; record: T }>,
): T[] {
  const byPosition = new Map(extracted.map(item => [item.position, item.record]));
  let legacyIndex = 0;
  return Array.from({ length: legacy.length + extracted.length }, (_, position) => {
    const migrated = byPosition.get(position);
    if (migrated !== undefined) return migrated;
    const record = legacy[legacyIndex];
    legacyIndex += 1;
    if (record === undefined) throw new Error(`Missing legacy record at position ${position}`);
    return record;
  });
}

export function buildDataShadow(root = REPO_ROOT): DataShadow {
  const pilot = readJson<MigrationPilot>(root, 'data/migration-pilot.json');
  const mobility = readJson<BlocsData>(root, 'public/blocs_data.json');
  const citizenship = readJson<CuratedCitizenshipData>(root, 'data/citizenship_routes.json');
  const registry = readJson<Registry>(root, 'data/registry.json');
  validatePilot(pilot);

  const members = registryMembers(registry);
  const selectedJurisdictions = new Set(pilot.jurisdictions);
  const routeSplit = splitAtPositions(
    citizenship.routes,
    route => selectedJurisdictions.has(route.country.iso_n3),
  );
  const jurisdictions = pilot.jurisdictions.map(iso => {
    const jurisdiction = members.get(iso);
    if (!jurisdiction) throw new Error(`Pilot jurisdiction ${iso} is absent from the registry`);
    const selectedRoutes = routeSplit.extracted.filter(
      item => item.record.country.iso_n3 === iso,
    );
    return {
      schema_version: 1 as const,
      entity_type: 'jurisdiction' as const,
      jurisdiction,
      migration: {
        status: 'shadow' as const,
        legacy_route_positions: selectedRoutes.map(item => item.position),
      },
      routes: selectedRoutes.map(item => item.record),
    };
  });

  const blocIds = new Set(pilot.arrangements.blocs);
  const laneIds = new Set(pilot.arrangements.bilateral_lanes);
  const blocSplit = splitAtPositions(mobility.blocs, bloc => blocIds.has(bloc.id));
  const laneSplit = splitAtPositions(
    mobility.bilateral_lanes,
    lane => laneIds.has(lane.id),
  );
  for (const id of blocIds) {
    if (!blocSplit.extracted.some(item => item.record.id === id)) {
      throw new Error(`Pilot bloc ${id} does not exist`);
    }
  }
  for (const id of laneIds) {
    if (!laneSplit.extracted.some(item => item.record.id === id)) {
      throw new Error(`Pilot bilateral lane ${id} does not exist`);
    }
  }
  const arrangements: ShadowArrangement[] = [
    ...blocSplit.extracted.map(item => ({
      schema_version: 1 as const,
      entity_type: 'arrangement' as const,
      arrangement_kind: 'bloc' as const,
      migration: {
        status: 'shadow' as const,
        legacy_position: item.position,
      },
      record: item.record,
    })),
    ...laneSplit.extracted.map(item => ({
      schema_version: 1 as const,
      entity_type: 'arrangement' as const,
      arrangement_kind: 'bilateral_lane' as const,
      migration: {
        status: 'shadow' as const,
        legacy_position: item.position,
      },
      record: item.record,
    })),
  ];

  const compatibilityMobility: BlocsData = {
    ...mobility,
    blocs: reassembleAtPositions(blocSplit.legacy, blocSplit.extracted),
    bilateral_lanes: reassembleAtPositions(laneSplit.legacy, laneSplit.extracted),
  };
  const compatibilityCitizenship: CuratedCitizenshipData = {
    ...citizenship,
    routes: reassembleAtPositions(routeSplit.legacy, routeSplit.extracted),
  };
  const sourceHashes = {
    'public/blocs_data.json': hashJson(mobility),
    'data/citizenship_routes.json': hashJson(citizenship),
    'data/registry.json': hashJson(registry),
    'data/migration-pilot.json': hashJson(pilot),
  };
  const releaseId = hashJson(sourceHashes).slice(0, 16);

  return {
    pilot,
    jurisdictions,
    arrangements,
    compatibility: {
      mobility: compatibilityMobility,
      citizenship: compatibilityCitizenship,
    },
    manifest: {
      schema_version: 1,
      release_id: releaseId,
      mode: 'shadow',
      counts: {
        jurisdictions: jurisdictions.length,
        arrangements: arrangements.length,
        citizenship_routes: routeSplit.extracted.length,
      },
      source_hashes: sourceHashes,
      compatibility_hashes: {
        mobility: hashJson(compatibilityMobility),
        citizenship: hashJson(compatibilityCitizenship),
      },
    },
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeDataShadow(shadow: DataShadow, root = REPO_ROOT): string {
  const releaseRoot = path.join(
    root,
    '.generated/data-shadow/releases',
    shadow.manifest.release_id,
  );
  for (const jurisdiction of shadow.jurisdictions) {
    writeJson(
      path.join(releaseRoot, 'jurisdictions', `${jurisdiction.jurisdiction.iso_n3}.json`),
      jurisdiction,
    );
  }
  for (const arrangement of shadow.arrangements) {
    writeJson(
      path.join(releaseRoot, 'arrangements', `${arrangement.record.id}.json`),
      arrangement,
    );
  }
  writeJson(path.join(releaseRoot, 'compatibility/blocs_data.json'), shadow.compatibility.mobility);
  writeJson(
    path.join(releaseRoot, 'compatibility/citizenship_routes.json'),
    shadow.compatibility.citizenship,
  );
  writeJson(path.join(releaseRoot, 'manifest.json'), shadow.manifest);
  writeJson(path.join(root, '.generated/data-shadow/latest.json'), {
    release_id: shadow.manifest.release_id,
    manifest: `releases/${shadow.manifest.release_id}/manifest.json`,
  });
  return releaseRoot;
}

import type { Signal } from '../schema/signal';

interface Coverage {
  ancestry: string;
  naturalization: string;
  birth: string;
  investment: string;
}

export interface JurisdictionRecord {
  iso_n3: string;
  name: string;
  coverage: Coverage;
}

interface CitizenshipRoute {
  id: string;
  country?: { iso_n3: string; name: string };
  mode: string;
  status: string;
  title: string;
  summary: string;
  last_checked: string;
}

export interface CitizenshipData {
  jurisdictions: JurisdictionRecord[];
  routes: CitizenshipRoute[];
}

interface CountryRef {
  iso_n3: string;
  name: string;
}

interface Bloc {
  id: string;
  name: string;
  members?: CountryRef[];
}

interface BilateralLane {
  id: string;
  name: string;
  destination?: CountryRef;
  beneficiaries?: CountryRef[];
}

export interface BlocsData {
  blocs?: Bloc[];
  bilateral_lanes?: BilateralLane[];
}

export interface DatasetContext {
  signal_jurisdictions: Record<string, string[]>;
  jurisdictions: Array<{ iso_n3: string; name: string; coverage: Coverage }>;
  citizenship_routes: Array<{
    id: string;
    country?: CountryRef;
    mode: string;
    status: string;
    title: string;
    summary: string;
    last_checked: string;
  }>;
  regional_access: Array<{
    type: 'bloc' | 'bilateral_lane';
    id: string;
    name: string;
    destination?: CountryRef;
    beneficiaries?: CountryRef[];
  }>;
}

const COUNTRY_ALIASES: Record<string, string[]> = {
  'United States of America': ['united states', 'u.s.a.', 'usa'],
  'United Kingdom': ['united kingdom', 'britain', 'british', 'u.k.'],
  Czechia: ['czechia', 'czech republic'],
  Türkiye: ['turkiye', 'turkey'],
  'Russian Federation': ['russian federation', 'russia'],
  'Republic of Korea': ['republic of korea', 'south korea'],
};

function normalizedText(value: string): string {
  return ` ${String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

export function inferJurisdictions(
  signal: Signal,
  jurisdictions: Array<Pick<JurisdictionRecord, 'iso_n3' | 'name'>>,
): string[] {
  if (signal.jurisdiction !== 'multi') return [signal.jurisdiction];
  const haystack = normalizedText(`${signal.title} ${signal.excerpt}`);
  const matches: string[] = [];
  for (const jurisdiction of jurisdictions) {
    const aliases = COUNTRY_ALIASES[jurisdiction.name] ?? [jurisdiction.name];
    if (aliases.some(alias => haystack.includes(normalizedText(alias)))) {
      matches.push(jurisdiction.iso_n3);
    }
  }
  return [...new Set(matches)].slice(0, 6);
}

export function buildDatasetContext(
  signals: Signal[],
  citizenshipData: CitizenshipData,
  blocsData: BlocsData,
): DatasetContext {
  const jurisdictionById = new Map(
    citizenshipData.jurisdictions.map(item => [item.iso_n3, item]),
  );
  const signalJurisdictions = Object.fromEntries(
    signals.map(signal => [signal.id, inferJurisdictions(signal, citizenshipData.jurisdictions)]),
  ) as Record<string, string[]>;
  const ids = new Set(Object.values(signalJurisdictions).flat());

  return {
    signal_jurisdictions: signalJurisdictions,
    jurisdictions: [...ids].flatMap(id => {
      const item = jurisdictionById.get(id);
      return item ? [{ iso_n3: item.iso_n3, name: item.name, coverage: item.coverage }] : [];
    }),
    citizenship_routes: citizenshipData.routes
      .filter(route => route.country && ids.has(route.country.iso_n3))
      .map(route => ({
        id: route.id,
        country: route.country,
        mode: route.mode,
        status: route.status,
        title: route.title,
        summary: route.summary,
        last_checked: route.last_checked,
      })),
    regional_access: [
      ...(blocsData.blocs ?? [])
        .filter(bloc => bloc.members?.some(member => ids.has(member.iso_n3)))
        .map(bloc => ({ type: 'bloc' as const, id: bloc.id, name: bloc.name })),
      ...(blocsData.bilateral_lanes ?? [])
        .filter(lane =>
          (lane.destination && ids.has(lane.destination.iso_n3)) ||
          lane.beneficiaries?.some(beneficiary => ids.has(beneficiary.iso_n3)))
        .map(lane => ({
          type: 'bilateral_lane' as const,
          id: lane.id,
          name: lane.name,
          destination: lane.destination,
          beneficiaries: lane.beneficiaries,
        })),
    ],
  };
}

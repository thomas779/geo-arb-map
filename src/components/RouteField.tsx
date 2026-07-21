import { useEffect, useState, type CSSProperties } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { cn } from '@/lib/utils';

interface Point {
  x: number;
  y: number;
  destination?: {
    label: string;
    dx: number;
    dy: number;
    anchor: 'start' | 'end';
  };
}

interface Route {
  d: string;
  tier: 'primary' | 'ambient';
}

interface Region {
  id: string;
  isos: string[];
}

interface GeographyPath {
  id: string;
  region: string;
  d: string;
}

const projection = {
  west: -70,
  east: 110,
  left: 700,
  right: 1120,
  equatorY: 330,
  latitudeScale: 4.2,
} as const;

const projectionScale = ((projection.right - projection.left)
  / (projection.east - projection.west)) * (180 / Math.PI);
const projectionTranslateX = projection.left
  - projectionScale * (projection.west * Math.PI / 180);
const plannerProjection = d3.geoProjection((longitude, latitude) => [longitude, latitude * 1.8])
  .scale(projectionScale)
  .translate([projectionTranslateX, projection.equatorY])
  .precision(0.25);
const plannerGeoPath = d3.geoPath(plannerProjection);

type AtlasFeature = {
  id: number | string;
  geometry: unknown;
  properties: Record<string, unknown>;
  type: 'Feature';
};

let atlasFeaturesPromise: Promise<AtlasFeature[]> | null = null;

function loadAtlasFeatures(): Promise<AtlasFeature[]> {
  if (!atlasFeaturesPromise) {
    atlasFeaturesPromise = fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json')
      .then(response => {
        if (!response.ok) throw new Error(`World atlas request failed: ${response.status}`);
        return response.json();
      })
      .then(world => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (topojson.feature(world, world.objects.countries) as any).features as AtlasFeature[];
      });
  }
  return atlasFeaturesPromise;
}

function useGeographyPaths(regions: Region[]): GeographyPath[] {
  const [paths, setPaths] = useState<GeographyPath[]>([]);
  const regionKey = regions
    .map(region => `${region.id}:${[...region.isos].sort().join(',')}`)
    .sort()
    .join('|');

  useEffect(() => {
    let active = true;
    const regionByIso = new Map<string, string>();
    for (const region of regions) {
      for (const iso of region.isos) regionByIso.set(iso, region.id);
    }

    loadAtlasFeatures()
      .then(features => {
        if (!active) return;
        setPaths(features.flatMap(feature => {
          const iso = String(feature.id).padStart(3, '0');
          const region = regionByIso.get(iso);
          if (!region) return [];
          const d = plannerGeoPath(feature as unknown as d3.GeoPermissibleObjects);
          return d ? [{ id: iso, region, d }] : [];
        }));
      })
      .catch(() => {
        if (active) setPaths([]);
      });

    return () => { active = false; };
  // The stable membership signature is the meaningful dependency here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey]);

  return paths;
}

function destinationPoint(
  label: string,
  longitude: number,
  latitude: number,
  dx: number,
  dy: number,
  anchor: 'start' | 'end',
): Point {
  const longitudeRatio = (longitude - projection.west) / (projection.east - projection.west);
  return {
    x: projection.left + longitudeRatio * (projection.right - projection.left),
    y: projection.equatorY - latitude * projection.latitudeScale,
    destination: { label, dx, dy, anchor },
  };
}

const destinations: Point[] = [
  destinationPoint('Portugal', -8, 39.5, -14, -10, 'end'),
  destinationPoint('Germany', 10.5, 51, 14, -10, 'start'),
  destinationPoint('Argentina', -64, -34, -14, 18, 'end'),
  destinationPoint('Singapore', 103.8, 1.35, 14, -10, 'start'),
];

const edgePoints: Point[] = [
  { x: 0, y: 92 },
  { x: 1200, y: 74 },
  { x: 1200, y: 650 },
  { x: 0, y: 618 },
  { x: 410, y: 0 },
  { x: 585, y: 720 },
];

function routeBetween(
  start: Point,
  end: Point,
  bend: number,
  tier: Route['tier'] = 'primary',
): Route {
  const midpointX = (start.x + end.x) / 2;
  const midpointY = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(Math.hypot(dx, dy), 1);

  return {
    tier,
    d: [
      `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
      `Q ${(midpointX - (dy / length) * bend).toFixed(1)} ${(midpointY + (dx / length) * bend).toFixed(1)}`,
      `${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    ].join(' '),
  };
}

const field = {
  points: destinations,
  routes: [
    routeBetween(edgePoints[0], destinations[0], -118),
    routeBetween(destinations[0], destinations[3], -92),
    routeBetween(destinations[1], destinations[2], 142),
    routeBetween(destinations[2], edgePoints[2], -76),
    routeBetween(edgePoints[4], destinations[3], 168, 'ambient'),
    routeBetween(edgePoints[3], destinations[0], -160, 'ambient'),
    routeBetween(destinations[0], edgePoints[5], 68, 'ambient'),
    routeBetween(destinations[1], edgePoints[1], -80, 'ambient'),
  ],
};

interface Props {
  className?: string;
  compact?: boolean;
  cover?: boolean;
  regions?: Region[];
}

export function RouteField({ className, compact = false, cover = false, regions = [] }: Props) {
  const geographyPaths = useGeographyPaths(regions);

  return (
    <figure
      className={cn('planner-route-field relative aspect-[5/3] w-full overflow-hidden', className)}
      aria-label="An ambient field of routes between example destinations"
    >
      <svg
        className="absolute inset-0 size-full"
        viewBox={compact ? '600 40 620 600' : '0 0 1200 720'}
        role="img"
        aria-labelledby="planner-route-field-title planner-route-field-description"
        preserveAspectRatio={cover ? 'xMidYMid slice' : 'xMidYMid meet'}
      >
        <title id="planner-route-field-title">Global mobility route field</title>
        <desc id="planner-route-field-description">
          Destinations ordered by longitude and latitude across fine regional outlines, connected by animated routes.
        </desc>

        <g className="planner-geography" aria-hidden="true">
          {geographyPaths.map(path => (
            <path
              key={`${path.region}-${path.id}`}
              d={path.d}
              data-region={path.region}
              className="planner-geography-country"
            />
          ))}
        </g>

        <g className="planner-routes">
          {field.routes.map((route, index) => (
            <path
              key={route.d}
              d={route.d}
              className={cn(
                'planner-route',
                route.tier === 'primary' ? 'planner-route-primary' : 'planner-route-ambient',
              )}
              style={{ '--route-index': index } as CSSProperties}
            />
          ))}

          <g aria-hidden="true">
            {field.routes.filter(route => route.tier === 'primary').map((route, index) => (
              <circle key={route.d} className="planner-route-traveler" r="4">
                <animateMotion
                  dur={`${10 + index * 1.4}s`}
                  begin={`${index * -2.7}s`}
                  repeatCount="indefinite"
                  path={route.d}
                />
              </circle>
            ))}
          </g>
        </g>

        <g>
          {field.points.map((point, index) => (
            <g key={`${point.x}-${point.y}`}>
              {point.destination && (
                <circle
                  className="planner-route-halo"
                  cx={point.x}
                  cy={point.y}
                  r="13"
                  style={{ '--route-index': index } as CSSProperties}
                />
              )}
              <circle
                className={point.destination ? 'planner-route-node planner-route-node-key' : 'planner-route-node'}
                cx={point.x}
                cy={point.y}
                r={point.destination ? 5 : 2.6}
              />
              {point.destination && (
                <text
                  className="planner-route-label"
                  x={point.x + point.destination.dx}
                  y={point.y + point.destination.dy}
                  textAnchor={point.destination.anchor}
                >
                  {point.destination.label}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>
    </figure>
  );
}

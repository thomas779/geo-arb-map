import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { cn } from '@/lib/utils';

type AtlasFeature = {
  id: number | string;
  geometry: unknown;
  properties: Record<string, unknown>;
  type: 'Feature';
};

let atlasFeaturesPromise: Promise<AtlasFeature[]> | null = null;

function loadAtlasFeatures(): Promise<AtlasFeature[]> {
  if (!atlasFeaturesPromise) {
    atlasFeaturesPromise = fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
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

interface Destination {
  id: string;
  label: string;
  coordinates: [number, number];
  featured?: boolean;
  labelOffset?: {
    dx: number;
    dy: number;
    anchor: 'start' | 'end';
  };
}

interface RouteDefinition {
  id: string;
  from: Destination;
  to: Destination;
  duration: number;
  offset: number;
  tier: 'primary' | 'ambient';
}

const destinations: Record<string, Destination> = {
  argentina: {
    id: 'argentina',
    label: 'Argentina',
    coordinates: [-64, -34] as [number, number],
    featured: true,
    labelOffset: { dx: -14, dy: 20, anchor: 'end' as const },
  },
  australia: {
    id: 'australia',
    label: 'Australia',
    coordinates: [134, -25] as [number, number],
    featured: true,
    labelOffset: { dx: 14, dy: -12, anchor: 'start' as const },
  },
  brazil: {
    id: 'brazil',
    label: 'Brazil',
    coordinates: [-51, -10] as [number, number],
  },
  canada: {
    id: 'canada',
    label: 'Canada',
    coordinates: [-106, 56] as [number, number],
  },
  chile: {
    id: 'chile',
    label: 'Chile',
    coordinates: [-71, -33] as [number, number],
  },
  portugal: {
    id: 'portugal',
    label: 'Portugal',
    coordinates: [-8, 39.5] as [number, number],
    featured: true,
    labelOffset: { dx: -14, dy: -12, anchor: 'end' as const },
  },
  germany: {
    id: 'germany',
    label: 'Germany',
    coordinates: [10.5, 51] as [number, number],
    featured: true,
    labelOffset: { dx: 14, dy: -12, anchor: 'start' as const },
  },
  mexico: {
    id: 'mexico',
    label: 'Mexico',
    coordinates: [-102, 23] as [number, number],
  },
  netherlands: {
    id: 'netherlands',
    label: 'Netherlands',
    coordinates: [5.3, 52.1] as [number, number],
  },
  newZealand: {
    id: 'new-zealand',
    label: 'New Zealand',
    coordinates: [172, -41] as [number, number],
  },
  spain: {
    id: 'spain',
    label: 'Spain',
    coordinates: [-3.7, 40.4] as [number, number],
  },
  singapore: {
    id: 'singapore',
    label: 'Singapore',
    coordinates: [103.8, 1.35] as [number, number],
    featured: true,
    labelOffset: { dx: 14, dy: -12, anchor: 'start' as const },
  },
  unitedKingdom: {
    id: 'united-kingdom',
    label: 'United Kingdom',
    coordinates: [-2, 54] as [number, number],
  },
  unitedStates: {
    id: 'united-states',
    label: 'United States',
    coordinates: [-98, 39] as [number, number],
    featured: true,
    labelOffset: { dx: -14, dy: -12, anchor: 'end' as const },
  },
};

// A deliberately small, legible projection of real route families in the
// current atlas. This is an editorial sample, not a popularity ranking.
const routes: RouteDefinition[] = [
  { id: 'argentina-spain', from: destinations.argentina, to: destinations.spain, duration: 12_500, offset: 0.08, tier: 'primary' },
  { id: 'brazil-portugal', from: destinations.brazil, to: destinations.portugal, duration: 11_600, offset: 0.41, tier: 'primary' },
  { id: 'canada-us-tn', from: destinations.canada, to: destinations.unitedStates, duration: 8_600, offset: 0.25, tier: 'primary' },
  { id: 'us-netherlands-daft', from: destinations.unitedStates, to: destinations.netherlands, duration: 13_800, offset: 0.63, tier: 'primary' },
  { id: 'australia-uk', from: destinations.australia, to: destinations.unitedKingdom, duration: 15_800, offset: 0.78, tier: 'primary' },
  { id: 'singapore-us', from: destinations.singapore, to: destinations.unitedStates, duration: 17_200, offset: 0.52, tier: 'primary' },
  { id: 'mexico-us-tn', from: destinations.mexico, to: destinations.unitedStates, duration: 9_200, offset: 0.16, tier: 'ambient' },
  { id: 'chile-us', from: destinations.chile, to: destinations.unitedStates, duration: 13_400, offset: 0.71, tier: 'ambient' },
  { id: 'new-zealand-australia', from: destinations.newZealand, to: destinations.australia, duration: 8_800, offset: 0.34, tier: 'ambient' },
  { id: 'portugal-germany-eu', from: destinations.portugal, to: destinations.germany, duration: 8_200, offset: 0.58, tier: 'ambient' },
  { id: 'portugal-us-e2', from: destinations.portugal, to: destinations.unitedStates, duration: 12_900, offset: 0.84, tier: 'ambient' },
  { id: 'brazil-spain', from: destinations.brazil, to: destinations.spain, duration: 12_200, offset: 0.93, tier: 'ambient' },
];

const routeGeometry = routes.map(route => {
  const interpolate = d3.geoInterpolate(route.from.coordinates, route.to.coordinates);
  const coordinates = d3.range(65).map(index => interpolate(index / 64));
  return {
    ...route,
    interpolate,
    geometry: { type: 'LineString', coordinates } as GeoJSON.LineString,
  };
});

interface Props {
  className?: string;
  regionIsos?: string[];
}

export function GlobeRouteField({ className, regionIsos = [] }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const regionKey = [...regionIsos].sort().join(',');

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    let cancelled = false;
    let frame = 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const highlighted = new Set(regionIsos);
    const svg = d3.select(svgElement);
    const projection = d3.geoOrthographic()
      .translate([500, 500])
      .scale(452)
      .clipAngle(90)
      .precision(0.35);
    const path = d3.geoPath(projection);
    const graticule = d3.geoGraticule10();

    function isVisible(coordinates: [number, number], rotation: [number, number, number]) {
      return d3.geoDistance([-rotation[0], -rotation[1]], coordinates) < Math.PI / 2;
    }

    function draw(features: AtlasFeature[]) {
      svg.selectAll('*').remove();

      svg.append('circle')
        .attr('class', 'planner-globe-atmosphere')
        .attr('cx', 500)
        .attr('cy', 500)
        .attr('r', 472);

      svg.append('path')
        .datum({ type: 'Sphere' })
        .attr('class', 'planner-globe-sphere');

      svg.append('path')
        .datum(graticule)
        .attr('class', 'planner-globe-graticule');

      const countries = svg.append('g')
        .attr('class', 'planner-globe-countries')
        .selectAll('path')
        .data(features)
        .join('path')
        .attr('class', feature => highlighted.has(String(feature.id).padStart(3, '0'))
          ? 'planner-globe-country planner-globe-country-region'
          : 'planner-globe-country');

      const routePaths = svg.append('g')
        .attr('class', 'planner-globe-routes')
        .selectAll('path')
        .data(routeGeometry)
        .join('path')
        .attr('class', route => route.tier === 'primary'
          ? 'planner-globe-route planner-globe-route-primary'
          : 'planner-globe-route planner-globe-route-ambient')
        .style('--route-index', (_, index) => index);

      const travelerNodes = svg.append('g')
        .attr('class', 'planner-globe-travelers')
        .selectAll('circle')
        .data(routeGeometry.filter(route => route.tier === 'primary'))
        .join('circle')
        .attr('class', 'planner-globe-traveler')
        .attr('r', 5);

      const destinationNodes = svg.append('g')
        .attr('class', 'planner-globe-destinations')
        .selectAll('g')
        .data(Object.values(destinations))
        .join('g');

      destinationNodes.filter(destination => Boolean(destination.featured)).append('circle')
        .attr('class', 'planner-globe-destination-halo')
        .attr('r', 16);
      destinationNodes.append('circle')
        .attr('class', destination => destination.featured
          ? 'planner-globe-destination planner-globe-destination-featured'
          : 'planner-globe-destination planner-globe-destination-secondary')
        .attr('r', destination => destination.featured ? 6 : 3.2);
      destinationNodes.filter(destination => Boolean(destination.featured)).append('text')
        .attr('class', 'planner-globe-label')
        .attr('x', destination => destination.labelOffset?.dx ?? 14)
        .attr('y', destination => destination.labelOffset?.dy ?? -12)
        .attr('text-anchor', destination => destination.labelOffset?.anchor ?? 'start')
        .text(destination => destination.label);

      const started = performance.now();
      // Earth's 23.4° axial tilt keeps the globe from reading like a flat carousel.
      const baseRotation: [number, number, number] = [20, -14, -23.4];
      let lastPaint = -Infinity;

      const render = (now: number) => {
        if (cancelled) return;
        if (!reduceMotion && now - lastPaint < 50) {
          frame = requestAnimationFrame(render);
          return;
        }
        lastPaint = now;
        const elapsed = now - started;
        const rotation: [number, number, number] = reduceMotion
          ? baseRotation
          : [baseRotation[0] + elapsed * 0.00115, baseRotation[1], baseRotation[2]];
        projection.rotate(rotation);

        svg.select<SVGPathElement>('.planner-globe-sphere')
          .attr('d', datum => path(datum as d3.GeoPermissibleObjects));
        svg.select<SVGPathElement>('.planner-globe-graticule')
          .attr('d', datum => path(datum as d3.GeoPermissibleObjects));
        countries.attr('d', feature => path(feature as unknown as d3.GeoPermissibleObjects));
        routePaths.attr('d', route => path(route.geometry));

        destinationNodes
          .attr('transform', destination => {
            const point = projection(destination.coordinates);
            return point ? `translate(${point[0]},${point[1]})` : null;
          })
          .attr('opacity', destination => isVisible(destination.coordinates, rotation) ? 1 : 0);

        travelerNodes
          .attr('cx', route => {
            const progress = ((elapsed / route.duration) + route.offset) % 1;
            return projection(route.interpolate(progress))?.[0] ?? -100;
          })
          .attr('cy', route => {
            const progress = ((elapsed / route.duration) + route.offset) % 1;
            return projection(route.interpolate(progress))?.[1] ?? -100;
          })
          .attr('opacity', route => {
            const progress = ((elapsed / route.duration) + route.offset) % 1;
            return isVisible(route.interpolate(progress), rotation) ? 1 : 0;
          });

        if (!reduceMotion) frame = requestAnimationFrame(render);
      };

      render(started);
    }

    loadAtlasFeatures()
      .then(features => {
        if (!cancelled) draw(features);
      })
      .catch(() => {
        // The planner remains useful if the ambient network asset is unavailable.
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      svg.selectAll('*').remove();
    };
  // The stable ISO signature is the meaningful dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey]);

  return (
    <figure
      className={cn('planner-globe pointer-events-none', className)}
      aria-label="A rotating world showing example mobility routes"
    >
      <svg
        ref={svgRef}
        className="size-full overflow-visible"
        viewBox="0 0 1000 1000"
        role="img"
        aria-labelledby="planner-globe-title planner-globe-description"
      >
        <title id="planner-globe-title">Global mobility routes</title>
        <desc id="planner-globe-description">
          A tilted, slowly rotating globe with moving routes between prominent citizenship and mobility destinations.
        </desc>
      </svg>
    </figure>
  );
}

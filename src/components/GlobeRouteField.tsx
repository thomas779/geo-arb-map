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

interface Destination {
  id: string;
  label: string;
  coordinates: [number, number];
}

interface RouteDefinition {
  from: Destination;
  to: Destination;
  duration: number;
  offset: number;
}

const destinations = {
  argentina: {
    id: 'argentina',
    label: 'Argentina',
    coordinates: [-64, -34] as [number, number],
  },
  portugal: {
    id: 'portugal',
    label: 'Portugal',
    coordinates: [-8, 39.5] as [number, number],
  },
  germany: {
    id: 'germany',
    label: 'Germany',
    coordinates: [10.5, 51] as [number, number],
  },
  singapore: {
    id: 'singapore',
    label: 'Singapore',
    coordinates: [103.8, 1.35] as [number, number],
  },
};

const routes: RouteDefinition[] = [
  { from: destinations.argentina, to: destinations.portugal, duration: 12_500, offset: 0.08 },
  { from: destinations.portugal, to: destinations.germany, duration: 8_600, offset: 0.45 },
  { from: destinations.germany, to: destinations.singapore, duration: 15_800, offset: 0.68 },
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
        .attr('class', 'planner-globe-route')
        .style('--route-index', (_, index) => index);

      const travelerNodes = svg.append('g')
        .attr('class', 'planner-globe-travelers')
        .selectAll('circle')
        .data(routeGeometry)
        .join('circle')
        .attr('class', 'planner-globe-traveler')
        .attr('r', 5);

      const destinationNodes = svg.append('g')
        .attr('class', 'planner-globe-destinations')
        .selectAll('g')
        .data(Object.values(destinations))
        .join('g');

      destinationNodes.append('circle')
        .attr('class', 'planner-globe-destination-halo')
        .attr('r', 16);
      destinationNodes.append('circle')
        .attr('class', 'planner-globe-destination')
        .attr('r', 6);
      destinationNodes.append('text')
        .attr('class', 'planner-globe-label')
        .attr('x', destination => destination.id === 'argentina' ? -14 : 14)
        .attr('y', destination => destination.id === 'argentina' ? 20 : -12)
        .attr('text-anchor', destination => destination.id === 'argentina' ? 'end' : 'start')
        .text(destination => destination.label);

      const started = performance.now();
      const baseRotation: [number, number, number] = [20, -14, 0];
      let lastPaint = -Infinity;

      const render = (now: number) => {
        if (cancelled) return;
        if (!reduceMotion && now - lastPaint < 34) {
          frame = requestAnimationFrame(render);
          return;
        }
        lastPaint = now;
        const elapsed = now - started;
        const rotation: [number, number, number] = reduceMotion
          ? baseRotation
          : [baseRotation[0] + elapsed * 0.00115, baseRotation[1], 0];
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
          A slowly rotating globe with moving routes between Argentina, Portugal, Germany, and Singapore.
        </desc>
      </svg>
    </figure>
  );
}

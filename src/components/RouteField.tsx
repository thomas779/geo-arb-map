import type { CSSProperties } from 'react';
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
  primary: boolean;
}

const destinations: Point[] = [
  { x: 790, y: 160, destination: { label: 'Portugal', dx: -14, dy: -10, anchor: 'end' } },
  { x: 965, y: 105, destination: { label: 'Germany', dx: 14, dy: -10, anchor: 'start' } },
  { x: 860, y: 430, destination: { label: 'Argentina', dx: -14, dy: 18, anchor: 'end' } },
  { x: 1100, y: 330, destination: { label: 'Singapore', dx: 14, dy: -10, anchor: 'start' } },
];

const edgePoints: Point[] = [
  { x: 0, y: 92 },
  { x: 1200, y: 74 },
  { x: 1200, y: 650 },
  { x: 0, y: 618 },
  { x: 410, y: 0 },
  { x: 585, y: 720 },
];

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function routeBetween(start: Point, end: Point, bend: number, primary = false): Route {
  const midpointX = (start.x + end.x) / 2;
  const midpointY = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(Math.hypot(dx, dy), 1);

  return {
    d: [
      `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
      `Q ${(midpointX - (dy / length) * bend).toFixed(1)} ${(midpointY + (dx / length) * bend).toFixed(1)}`,
      `${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    ].join(' '),
    primary,
  };
}

function buildRouteField(seed: number): { points: Point[]; routes: Route[] } {
  const random = seededRandom(seed);
  const generatedPoints = Array.from({ length: 18 }, () => ({
    x: 45 + random() * 1110,
    y: 38 + random() * 644,
  }));
  const points = [...destinations, ...edgePoints, ...generatedPoints];
  const routes = [
    routeBetween(edgePoints[0], destinations[0], -118, true),
    routeBetween(destinations[0], destinations[3], -92, true),
    routeBetween(destinations[1], destinations[2], 142, true),
    routeBetween(destinations[2], edgePoints[2], -76, true),
  ];

  for (let index = 0; index < 16; index += 1) {
    const start = points[(index * 7 + 4) % points.length];
    const end = points[(index * 11 + 13) % points.length];
    routes.push(routeBetween(start, end, (random() - 0.5) * 230));
  }

  return { points, routes };
}

const field = buildRouteField(779);

interface Props {
  className?: string;
  cover?: boolean;
}

export function RouteField({ className, cover = false }: Props) {
  const primaryRoutes = field.routes.filter((route) => route.primary);

  return (
    <figure
      className={cn('planner-route-field relative aspect-[5/3] w-full overflow-hidden', className)}
      aria-label="An ambient field of routes between example destinations"
    >
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 1200 720"
        role="img"
        aria-labelledby="planner-route-field-title planner-route-field-description"
        preserveAspectRatio={cover ? 'xMidYMid slice' : 'xMidYMid meet'}
      >
        <title id="planner-route-field-title">Global mobility route field</title>
        <desc id="planner-route-field-description">
          Example destinations connected by routes that travel into and out of the page edges.
        </desc>

        <g className="planner-routes">
          {field.routes.map((route, index) => (
            <path
              key={route.d}
              d={route.d}
              className={route.primary ? 'planner-route planner-route-primary' : 'planner-route'}
              style={{ '--route-index': index } as CSSProperties}
            />
          ))}

          <g aria-hidden="true">
            {primaryRoutes.map((route, index) => (
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

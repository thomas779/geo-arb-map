import type { CSSProperties } from 'react';

interface Point {
  x: number;
  y: number;
  size: number;
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

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function buildRouteField(seed: number): { points: Point[]; routes: Route[] } {
  const random = seededRandom(seed);
  const destinations = new Map<number, Point['destination']>([
    [6, { label: 'Portugal', dx: 12, dy: 4, anchor: 'start' }],
    [9, { label: 'Argentina', dx: 12, dy: -10, anchor: 'start' }],
    [10, { label: 'Germany', dx: 12, dy: 4, anchor: 'start' }],
    [13, { label: 'Singapore', dx: -12, dy: -10, anchor: 'end' }],
  ]);
  const points = Array.from({ length: 16 }, (_, index) => {
    const angle = index * 2.399963 + random() * 0.28;
    const radius = Math.sqrt((index + 1) / 16);
    const destination = destinations.get(index);
    return {
      x: 280 + Math.cos(angle) * radius * (205 + random() * 26),
      y: 210 + Math.sin(angle) * radius * (142 + random() * 22),
      size: destination ? 5 : 2.6,
      destination,
    };
  });

  const routes = Array.from({ length: 11 }, (_, index) => {
    const start = points[(index * 5 + 1) % points.length];
    const end = points[(index * 7 + 6) % points.length];
    const midpointX = (start.x + end.x) / 2;
    const midpointY = (start.y + end.y) / 2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(Math.hypot(dx, dy), 1);
    const bend = (random() - 0.5) * 150;
    const controlX = midpointX - (dy / length) * bend;
    const controlY = midpointY + (dx / length) * bend;
    return {
      d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
      primary: index === 1 || index === 5 || index === 10,
    };
  });

  return { points, routes };
}

const field = buildRouteField(779);

export function RouteField() {
  return (
    <figure
      className="planner-route-field relative aspect-[4/3] w-full overflow-hidden"
      aria-label="A miniature atlas showing routes between example destinations"
    >
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 560 420"
        role="img"
        aria-labelledby="planner-route-field-title planner-route-field-description"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id="planner-route-field-title">Mobility route field</title>
        <desc id="planner-route-field-description">
          Example destinations connected by overlapping routes, with markers moving along three routes being evaluated.
        </desc>

        <g className="text-border" fill="none" stroke="currentColor">
          <ellipse cx="280" cy="210" rx="229" ry="160" opacity="0.5" />
          <ellipse cx="280" cy="210" rx="168" ry="118" opacity="0.38" />
          <ellipse cx="280" cy="210" rx="104" ry="72" opacity="0.28" />
          <path d="M 51 210 H 509" opacity="0.3" />
          <path d="M 280 50 V 370" opacity="0.3" />
          <path d="M 75 132 C 184 182 374 182 485 132" opacity="0.24" />
          <path d="M 75 288 C 184 238 374 238 485 288" opacity="0.24" />
        </g>

        <g className="planner-routes">
          {field.routes.map((route, index) => (
            <path
              key={route.d}
              d={route.d}
              className={route.primary ? 'planner-route planner-route-primary' : 'planner-route'}
              style={{ '--route-index': index } as CSSProperties}
            />
          ))}
        </g>

        <g aria-hidden="true">
          {field.routes.filter((route) => route.primary).map((route, index) => (
            <circle key={route.d} className="planner-route-traveler" r="4">
              <animateMotion
                dur={`${8.5 + index * 1.25}s`}
                begin={`${index * -2.4}s`}
                repeatCount="indefinite"
                path={route.d}
              />
            </circle>
          ))}
        </g>

        <g>
          {field.points.map((point, index) => (
            <g key={`${point.x}-${point.y}`}>
              {point.size > 4 && (
                <circle
                  className="planner-route-halo"
                  cx={point.x}
                  cy={point.y}
                  r="12"
                  style={{ '--route-index': index } as CSSProperties}
                />
              )}
              <circle
                className={point.size > 4 ? 'planner-route-node planner-route-node-key' : 'planner-route-node'}
                cx={point.x}
                cy={point.y}
                r={point.size}
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

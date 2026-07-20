import type { CSSProperties } from 'react';

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

const GLOBE = { cx: 280, cy: 210, radius: 164 } as const;

const destinations = [
  { label: 'Portugal', longitude: -8, latitude: 39, dx: -12, dy: -9, anchor: 'end' as const },
  { label: 'Germany', longitude: 10, latitude: 51, dx: 12, dy: -9, anchor: 'start' as const },
  { label: 'Argentina', longitude: -64, latitude: -34, dx: -12, dy: 16, anchor: 'end' as const },
  { label: 'Singapore', longitude: 104, latitude: 1, dx: 12, dy: -9, anchor: 'start' as const },
] as const;

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function project(longitude: number, latitude: number): Point {
  return {
    x: GLOBE.cx + (longitude / 180) * GLOBE.radius * 0.92,
    y: GLOBE.cy - (latitude / 90) * GLOBE.radius * 0.88,
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

function buildGlobe(seed: number): { points: Point[]; routes: Route[] } {
  const random = seededRandom(seed);
  const destinationPoints = destinations.map((destination) => ({
    ...project(destination.longitude, destination.latitude),
    destination: {
      label: destination.label,
      dx: destination.dx,
      dy: destination.dy,
      anchor: destination.anchor,
    },
  }));

  const generatedPoints = Array.from({ length: 13 }, () => {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * GLOBE.radius * 0.82;
    return {
      x: GLOBE.cx + Math.cos(angle) * radius,
      y: GLOBE.cy + Math.sin(angle) * radius,
    };
  });

  const points = [...destinationPoints, ...generatedPoints];
  const routes = [
    routeBetween(points[0], points[1], -24, true),
    routeBetween(points[1], points[3], -58, true),
    routeBetween(points[0], points[2], 48, true),
  ];

  for (let index = 0; index < 9; index += 1) {
    const start = points[4 + ((index * 5 + 1) % generatedPoints.length)];
    const end = points[4 + ((index * 7 + 5) % generatedPoints.length)];
    routes.push(routeBetween(start, end, (random() - 0.5) * 88));
  }

  return { points, routes };
}

const globe = buildGlobe(779);

export function RouteField() {
  const primaryRoutes = globe.routes.filter((route) => route.primary);

  return (
    <figure
      className="planner-route-field relative aspect-[4/3] w-full overflow-hidden"
      aria-label="A globe showing routes between example destinations"
    >
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 560 420"
        role="img"
        aria-labelledby="planner-route-field-title planner-route-field-description"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id="planner-route-field-title">Global mobility routes</title>
        <desc id="planner-route-field-description">
          A spherical globe with example destinations and markers moving along three routes being evaluated.
        </desc>

        <defs>
          <radialGradient id="planner-globe-fill" cx="35%" cy="28%" r="75%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.13" />
            <stop offset="62%" stopColor="var(--primary)" stopOpacity="0.035" />
            <stop offset="100%" stopColor="var(--background)" stopOpacity="0" />
          </radialGradient>
          <clipPath id="planner-globe-clip">
            <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.radius} />
          </clipPath>
        </defs>

        <circle
          className="planner-globe-surface"
          cx={GLOBE.cx}
          cy={GLOBE.cy}
          r={GLOBE.radius}
          fill="url(#planner-globe-fill)"
        />

        <g className="planner-globe-grid" fill="none">
          <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.radius} />
          <ellipse cx={GLOBE.cx} cy={GLOBE.cy} rx="68" ry={GLOBE.radius} />
          <ellipse cx={GLOBE.cx} cy={GLOBE.cy} rx="125" ry={GLOBE.radius} />
          <ellipse cx={GLOBE.cx} cy={GLOBE.cy} rx={GLOBE.radius} ry="54" />
          <ellipse cx={GLOBE.cx} cy={GLOBE.cy - 58} rx="142" ry="29" />
          <ellipse cx={GLOBE.cx} cy={GLOBE.cy + 58} rx="142" ry="29" />
        </g>

        <g className="planner-routes" clipPath="url(#planner-globe-clip)">
          {globe.routes.map((route, index) => (
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
                  dur={`${8.5 + index * 1.25}s`}
                  begin={`${index * -2.4}s`}
                  repeatCount="indefinite"
                  path={route.d}
                />
              </circle>
            ))}
          </g>
        </g>

        <g>
          {globe.points.map((point, index) => (
            <g key={`${point.x}-${point.y}`}>
              {point.destination && (
                <circle
                  className="planner-route-halo"
                  cx={point.x}
                  cy={point.y}
                  r="12"
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

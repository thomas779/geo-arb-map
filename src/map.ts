import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { BlocsData, AppState, Bloc } from './types';
import { blendColors, displayColor, isDarkTheme } from './lib/color';

interface MicroState {
  iso: string;
  name: string;
  lon: number;
  lat: number;
}

// Countries nearly invisible at world zoom — pre-defined centroids
const MICRO_STATES: MicroState[] = [
  { iso: '028', name: 'Antigua and Barbuda',        lon: -61.8, lat: 17.1 },
  { iso: '212', name: 'Dominica',                   lon: -61.4, lat: 15.4 },
  { iso: '308', name: 'Grenada',                    lon: -61.7, lat: 12.1 },
  { iso: '659', name: 'St. Kitts and Nevis',        lon: -62.7, lat: 17.3 },
  { iso: '662', name: 'St. Lucia',                  lon: -60.9, lat: 13.9 },
  { iso: '670', name: 'St. Vincent and Grenadines', lon: -61.2, lat: 13.3 },
  { iso: '500', name: 'Montserrat',                 lon: -62.2, lat: 16.7 },
  { iso: '583', name: 'Micronesia',                 lon: 150.6, lat:  7.4 },
  { iso: '584', name: 'Marshall Islands',           lon: 171.2, lat:  7.1 },
  { iso: '585', name: 'Palau',                      lon: 134.6, lat:  7.5 },
  { iso: '660', name: 'Anguilla',                   lon: -63.05, lat: 18.2 },
  { iso: '060', name: 'Bermuda',                    lon: -64.75, lat: 32.3 },
  { iso: '092', name: 'British Virgin Islands',     lon: -64.6, lat: 18.4 },
  { iso: '136', name: 'Cayman Islands',             lon: -81.2, lat: 19.3 },
  { iso: '292', name: 'Gibraltar',                  lon: -5.35, lat: 36.14 },
  { iso: '612', name: 'Pitcairn Islands',           lon: -128.3, lat: -24.4 },
  { iso: '654', name: 'St. Helena',                 lon: -5.7, lat: -15.95 },
  { iso: '796', name: 'Turks and Caicos Islands',   lon: -71.8, lat: 21.8 },
  { iso: '344', name: 'Hong Kong',                  lon: 114.17, lat: 22.3 },
  { iso: '446', name: 'Macau',                      lon: 113.55, lat: 22.19 },
  { iso: '520', name: 'Nauru',                      lon: 166.93, lat: -0.53 },
  { iso: '798', name: 'Tuvalu',                     lon: 179.2, lat: -8.5 },
  { iso: '776', name: 'Tonga',                      lon: -175.2, lat: -21.2 },
  { iso: '296', name: 'Kiribati',                   lon: 173.03, lat: 1.45 },
  { iso: '882', name: 'Samoa',                      lon: -172.1, lat: -13.76 },
  { iso: '184', name: 'Cook Islands',               lon: -159.78, lat: -21.23 },
  { iso: '570', name: 'Niue',                       lon: -169.87, lat: -19.05 },
  { iso: '772', name: 'Tokelau',                    lon: -171.85, lat: -9.2 },
  { iso: '492', name: 'Monaco',                     lon: 7.42, lat: 43.73 },
];

// Module-level state (init once)
let _projection: d3.GeoProjection;
let _path: d3.GeoPath;
let _byCountry: Map<string, Bloc[]>;
let _formerByCountry: Map<string, Bloc[]>;
let _currentK = 1;

let _gMap: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
let _gDots: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
let _svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let _zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
let _featureBounds: Map<string, [[number, number], [number, number]]>;
let _tooltip: HTMLElement;
let _isReady = false;
let _pendingRender: (() => void) | null = null;
let _lastFocus: string | null = null;

export function init(data: BlocsData, onSelect: (iso: string, name: string) => void): void {
  // Build iso → blocs index (current members only; former_members excluded from count)
  _byCountry = new Map();
  _formerByCountry = new Map();
  data.blocs.forEach(b => {
    b.members.forEach(m => {
      if (!_byCountry.has(m.iso_n3)) _byCountry.set(m.iso_n3, []);
      _byCountry.get(m.iso_n3)!.push(b);
    });
    b.former_members?.forEach(m => {
      if (!_formerByCountry.has(m.iso_n3)) _formerByCountry.set(m.iso_n3, []);
      _formerByCountry.get(m.iso_n3)!.push(b);
    });
  });

  _tooltip = document.getElementById('tooltip')!;

  const svg = d3.select<SVGSVGElement, unknown>('#map');
  _svg = svg;
  _gMap = svg.append('g');
  _gDots = svg.append('g').attr('class', 'dot-layer');

  _projection = d3.geoNaturalEarth1();
  _path = d3.geoPath(_projection);
  _featureBounds = new Map();

  // Zoom + pan
  _zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 12])
    .on('zoom', e => {
      _currentK = e.transform.k;
      _gMap.attr('transform', e.transform);
      _gDots.attr('transform', e.transform);
      // Keep dots and their leader labels at constant screen size
      _gDots.selectAll<SVGCircleElement, MicroState>('circle.micro-dot')
        .attr('r', 5 / _currentK);
      _gDots.selectAll('.dot-leader').remove();
    });
  svg.call(_zoom);

  function resize() {
    const wrap = document.getElementById('map-wrap')!;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    svg.attr('viewBox', `0 0 ${w} ${h}`);
    _projection.fitSize([w, h], { type: 'Sphere' });
    _gMap.selectAll<SVGPathElement, d3.GeoPermissibleObjects>('path')
      .attr('d', d => _path(d))
      .each(function (d) {
        // Bounds must be captured AFTER fitSize — they're used for zoom framing
        const id = (d as unknown as { id: number | string }).id;
        _featureBounds.set(String(id).padStart(3, '0'), _path.bounds(d));
      });
    updateDotPositions();
  }
  window.addEventListener('resize', resize);

  // Fetch world atlas topology
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d3.json<any>('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json')
    .then(world => {
      if (!world) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const features = (topojson.feature(world, world.objects.countries) as any).features as Array<{
        id: number | string;
        properties: { name: string };
        geometry: unknown;
      }>;

      _gMap.selectAll('path')
        .data(features)
        .join('path')
        .attr('class', 'country')
        .attr('d', d => _path(d as unknown as d3.GeoPermissibleObjects))
        .on('mousemove', (e, d) => {
          const iso = String(d.id).padStart(3, '0');
          showTooltip(e as MouseEvent, d.properties.name, iso);
        })
        .on('mouseleave', hideTooltip)
        .on('click', (_e, d) => {
          onSelect(String(d.id).padStart(3, '0'), d.properties.name);
        });

      // Dot markers for micro-states: hover shows a leader line + name label
      // (plus the shared tooltip); click selects exactly like a filled country.
      _gDots.selectAll('circle')
        .data(MICRO_STATES)
        .join('circle')
        .attr('class', 'micro-dot')
        .attr('r', 5)
        .on('mouseenter', (_e, d) => showDotLeader(d))
        .on('mousemove', (e, d) => {
          showTooltip(e as MouseEvent, d.name, d.iso);
        })
        .on('mouseleave', () => {
          hideTooltip();
          _gDots.selectAll('.dot-leader').remove();
        })
        .on('click', (_e, d) => onSelect(d.iso, d.name));

      _isReady = true;
      resize();

      if (_pendingRender) {
        _pendingRender();
        _pendingRender = null;
      }
    })
    .catch(() => {
      const hint = document.getElementById('hint');
      if (hint) hint.textContent = 'Map unavailable — could not reach cdn.jsdelivr.net.';
    });
}

function updateDotPositions(): void {
  _gDots.selectAll<SVGCircleElement, MicroState>('circle')
    .attr('cx', d => (_projection([d.lon, d.lat]) ?? [0, 0])[0])
    .attr('cy', d => (_projection([d.lon, d.lat]) ?? [0, 0])[1]);
}

function showDotLeader(d: MicroState): void {
  _gDots.selectAll('.dot-leader').remove();
  const [x, y] = _projection([d.lon, d.lat]) ?? [0, 0];
  const k = _currentK;
  const dx = 16 / k;
  const dy = -16 / k;
  const g = _gDots.append('g').attr('class', 'dot-leader');
  g.append('line')
    .attr('x1', x).attr('y1', y)
    .attr('x2', x + dx).attr('y2', y + dy)
    .attr('stroke', 'var(--map-accent)')
    .attr('stroke-width', 1 / k);
  g.append('text')
    .attr('x', x + dx + 4 / k)
    .attr('y', y + dy)
    .attr('dominant-baseline', 'middle')
    .attr('fill', 'var(--map-ink)')
    .attr('stroke', 'var(--map-ocean)')
    .attr('stroke-width', 3 / k)
    .attr('paint-order', 'stroke')
    .style('font', `500 ${12 / k}px Inter, sans-serif`)
    .text(d.name);
}

/** Animate the camera to frame a set of jurisdictions (with padding). */
function zoomToIsos(isos: string[]): void {
  const wrap = document.getElementById('map-wrap')!;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const iso of isos) {
    const b = _featureBounds.get(iso);
    if (b) {
      x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]);
      x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]);
      continue;
    }
    const micro = MICRO_STATES.find(m => m.iso === iso);
    if (micro) {
      const [mx, my] = _projection([micro.lon, micro.lat]) ?? [0, 0];
      x0 = Math.min(x0, mx - 8); y0 = Math.min(y0, my - 8);
      x1 = Math.max(x1, mx + 8); y1 = Math.max(y1, my + 8);
    }
  }
  if (!isFinite(x0)) { resetZoom(); return; }

  const k = Math.max(1, Math.min(8, 0.82 / Math.max((x1 - x0) / w, (y1 - y0) / h)));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  _svg.transition().duration(750).call(
    _zoom.transform,
    d3.zoomIdentity.translate(w / 2 - k * cx, h / 2 - k * cy).scale(k),
  );
}

function resetZoom(): void {
  _svg.transition().duration(600).call(_zoom.transform, d3.zoomIdentity);
}

/** Frame the current selection; called by render() when focus changes. */
function frameSelection(state: AppState, data: BlocsData): void {
  const focus = state.blocs.length
    ? state.blocs.join(',')
    : (state.lane ? `lane:${state.lane}` : null);
  if (focus === _lastFocus) return;
  _lastFocus = focus;

  if (state.blocs.length) {
    const selected = data.blocs.filter(x => state.blocs.includes(x.id));
    if (!selected.length) return resetZoom();
    zoomToIsos(selected.flatMap(b => [
      ...b.members.map(m => m.iso_n3),
      ...(b.former_members ?? []).map(m => m.iso_n3),
    ]));
  } else if (state.lane) {
    const l = data.bilateral_lanes.find(x => x.id === state.lane);
    if (!l) return resetZoom();
    zoomToIsos([l.destination.iso_n3, ...l.beneficiaries.map(m => m.iso_n3)]);
  } else {
    resetZoom();
  }
}

function showTooltip(e: MouseEvent, name: string, iso: string): void {
  const blocs = _byCountry.get(iso) ?? [];
  const former = _formerByCountry.get(iso) ?? [];
  const lines = [
    ...blocs.map(b => b.name),
    ...former.map(b => `${b.name} (former member — rights honored until further notice)`),
  ];
  _tooltip.style.display = 'block';
  _tooltip.style.left = (e.offsetX + 14) + 'px';
  _tooltip.style.top = (e.offsetY + 14) + 'px';
  _tooltip.innerHTML =
    `<div>${name}</div>` +
    (lines.length
      ? `<div class="tt-blocs">${lines.join(' · ')}</div>`
      : `<div class="tt-blocs">No bloc membership mapped</div>`);
}

function hideTooltip(): void {
  _tooltip.style.display = 'none';
}

function colorForIso(iso: string, state: AppState, data: BlocsData): string {
  const dark = isDarkTheme();
  if (state.lane) {
    const lane = data.bilateral_lanes.find(l => l.id === state.lane);
    if (!lane) return 'var(--map-land)';
    const laneColor = displayColor(lane.color, dark);
    if (lane.destination.iso_n3 === iso) return laneColor;
    if (lane.beneficiaries.some(m => m.iso_n3 === iso)) {
      const c = d3.color(laneColor) as d3.RGBColor | null;
      if (!c) return laneColor;
      c.opacity = 0.65;
      return c.formatRgb();
    }
    return 'var(--map-land)';
  }
  if (state.blocs.length) {
    const selected = data.blocs.filter(b => state.blocs.includes(b.id));
    const containing = selected.filter(b => b.members.some(m => m.iso_n3 === iso));

    if (containing.length >= 2) {
      // Overlap country: Lab-blend of every containing bloc's color
      return blendColors(containing.map(b => displayColor(b.color, dark)));
    }
    if (containing.length === 1) {
      const ab = containing[0];
      const blocColor = displayColor(ab.color, dark);
      if (ab.sub_bloc?.members_iso.includes(iso)) {
        const c = d3.color(blocColor);
        return (dark ? c?.brighter(0.7) : c?.brighter(0.4))?.formatHex() ?? blocColor;
      }
      return blocColor;
    }
    // Former members only render in single-bloc focus (avoids ambiguity in compare mode)
    if (selected.length === 1) {
      const ab = selected[0];
      if (ab.former_members?.some(m => m.iso_n3 === iso)) {
        const c = d3.color(displayColor(ab.color, dark));
        return (dark ? c?.darker(1.6) : c?.brighter(1.1))?.formatHex() ?? '#888';
      }
    }
    return 'var(--map-land)';
  }
  const count = (_byCountry?.get(iso) ?? []).length;
  if (!count) return 'var(--map-land)';
  // Count overlay gets its own ramp per theme (light needs darker blues)
  const t = Math.min((count - 1) / 3, 1);
  return dark
    ? d3.interpolateRgb('#33465C', '#6C93BF')(t)
    : d3.interpolateRgb('#9FB4CE', '#2F5E9E')(t);
}

function paintAll(state: AppState, data: BlocsData): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _gMap.selectAll<SVGPathElement, any>('.country')
    .attr('fill', d => colorForIso(String(d.id).padStart(3, '0'), state, data));

  _gDots.selectAll<SVGCircleElement, MicroState>('.micro-dot')
    .attr('fill', d => colorForIso(d.iso, state, data))
    .attr('stroke', d => {
      if (!state.blocs.length) return 'none';
      const inSelected = data.blocs.some(b =>
        state.blocs.includes(b.id) && b.members.some(m => m.iso_n3 === d.iso));
      return inSelected ? 'var(--map-accent)' : 'none';
    });
}

export function render(state: AppState, data: BlocsData): void {
  const mapEl = document.getElementById('map')!;
  const hint = document.getElementById('hint')!;

  if (state.view === 'stacking') {
    mapEl.style.display = 'none';
    hint.style.display = 'none';
    return;
  }

  mapEl.style.display = '';
  hint.style.display = '';

  if (!_isReady) {
    _pendingRender = () => {
      paintAll(state, data);
      frameSelection(state, data);
    };
  } else {
    paintAll(state, data);
    frameSelection(state, data);
  }
}

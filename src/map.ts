import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { BlocsData, AppState, Bloc } from './types';

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
let _tooltip: HTMLElement;
let _isReady = false;
let _pendingRender: (() => void) | null = null;

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
  _gMap = svg.append('g');
  _gDots = svg.append('g').attr('class', 'dot-layer');

  _projection = d3.geoNaturalEarth1();
  _path = d3.geoPath(_projection);

  // Zoom + pan
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 12])
    .on('zoom', e => {
      _currentK = e.transform.k;
      _gMap.attr('transform', e.transform);
      _gDots.attr('transform', e.transform);
      // Keep dots at constant screen size
      _gDots.selectAll<SVGCircleElement, MicroState>('circle')
        .attr('r', 5 / _currentK);
    });
  svg.call(zoom);

  function resize() {
    const wrap = document.getElementById('map-wrap')!;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    svg.attr('viewBox', `0 0 ${w} ${h}`);
    _projection.fitSize([w, h], { type: 'Sphere' });
    _gMap.selectAll<SVGPathElement, d3.GeoPermissibleObjects>('path')
      .attr('d', d => _path(d));
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

      // Dot markers for micro-states
      _gDots.selectAll('circle')
        .data(MICRO_STATES)
        .join('circle')
        .attr('class', 'micro-dot')
        .attr('r', 5)
        .on('mousemove', (e, d) => {
          showTooltip(e as MouseEvent, d.name, d.iso);
        })
        .on('mouseleave', hideTooltip)
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
  if (state.lane) {
    const lane = data.bilateral_lanes.find(l => l.id === state.lane);
    if (!lane) return 'var(--map-land)';
    if (lane.destination.iso_n3 === iso) return lane.color;
    if (lane.beneficiaries.some(m => m.iso_n3 === iso)) {
      const c = d3.color(lane.color) as d3.RGBColor | null;
      if (!c) return lane.color;
      c.opacity = 0.65;
      return c.formatRgb();
    }
    return 'var(--map-land)';
  }
  if (state.bloc) {
    const ab = data.blocs.find(b => b.id === state.bloc);
    if (!ab) return 'var(--map-land)';
    if (ab.sub_bloc?.members_iso.includes(iso)) {
      return d3.color(ab.color)?.brighter(0.7)?.formatHex() ?? ab.color;
    }
    if (ab.members.some(m => m.iso_n3 === iso)) return ab.color;
    if (ab.former_members?.some(m => m.iso_n3 === iso)) {
      return d3.color(ab.color)?.darker(1.6)?.formatHex() ?? '#333';
    }
    return 'var(--map-land)';
  }
  const count = (_byCountry?.get(iso) ?? []).length;
  if (!count) return 'var(--map-land)';
  // Linear interpolation in RGB space between the two sentinel colors
  const t = Math.min((count - 1) / 3, 1);
  return d3.interpolateRgb('#33465C', '#6C93BF')(t);
}

function paintAll(state: AppState, data: BlocsData): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _gMap.selectAll<SVGPathElement, any>('.country')
    .attr('fill', d => colorForIso(String(d.id).padStart(3, '0'), state, data));

  _gDots.selectAll<SVGCircleElement, MicroState>('.micro-dot')
    .attr('fill', d => colorForIso(d.iso, state, data))
    .attr('stroke', d => {
      if (!state.bloc) return 'none';
      const ab = data.blocs.find(b => b.id === state.bloc);
      return (ab && ab.members.some(m => m.iso_n3 === d.iso))
        ? 'var(--map-accent)'
        : 'none';
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
    _pendingRender = () => paintAll(state, data);
  } else {
    paintAll(state, data);
  }
}

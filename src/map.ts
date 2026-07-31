import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { BlocsData, AppState, Bloc } from './types';
import { blendColors, displayColor, isDarkTheme } from './lib/color';
import { EMPTY_PROFILE, type PlantedFlag, type Profile } from './lib/planner';

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
  { iso: '533', name: 'Aruba',                      lon: -69.97, lat: 12.52 },
  { iso: '531', name: 'Curacao',                    lon: -68.99, lat: 12.17 },
  { iso: '534', name: 'Sint Maarten',               lon: -63.11, lat: 17.98 },
  { iso: '535', name: 'Bonaire',                    lon: -68.26, lat: 12.20 },
  { iso: '663', name: 'Saint-Martin (France)',      lon: -62.99, lat: 18.11 },
];

// Territories that are separate Natural Earth features (own ISO code) but whose
// immigration/citizenship regime IS the parent country's, so they inherit its
// paint. Caribbean Netherlands → NL; Puerto Rico, Guam, USVI and the Northern
// Marianas → US (the INA applies directly). American Samoa is deliberately NOT
// mapped: it controls its own immigration and confers US nationality, not
// citizenship, at birth — painting it as the US would overclaim.
const MOBILITY_PARENT_ISO: Record<string, string> = {
  '535': '528', // Bonaire (Caribbean Netherlands) → Netherlands
  '630': '840', // Puerto Rico → United States
  '316': '840', // Guam → United States
  '850': '840', // U.S. Virgin Islands → United States
  '580': '840', // Northern Mariana Islands → United States
};

function mobilityIso(iso: string): string {
  return MOBILITY_PARENT_ISO[iso] ?? iso;
}

// Module-level state (init once)
let _projection: d3.GeoProjection;
let _path: d3.GeoPath;
let _byCountry: Map<string, Bloc[]>;
let _formerByCountry: Map<string, Bloc[]>;
// ISOs reachable via a bilateral/heritage lane (destination or beneficiary) —
// surfaced on the idle map so those routes aren't invisible grey.
let _laneByCountry: Set<string> = new Set();
let _currentK = 1;

let _gMap: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
let _gDots: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
let _gFlags: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
let _svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
let _zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
let _featureBounds: Map<string, [[number, number], [number, number]]>;
let _featureCentroids: Map<string, [number, number]>;
// Projected feature areas (px² at k=1), for the "too small to see its colour"
// test. Derived from the geometry each resize — no hand-maintained list.
let _featureAreas: Map<string, number> = new Map();
let _featureNames: Map<string, string> = new Map();
let _onSelect: ((iso: string, name: string) => void) | null = null;
let _canHover = false;

// Below this projected area a country's fill is effectively invisible, so
// members of an ACTIVE selection under the threshold get a ringed dot.
// Calibrated at a 1188×772 map: Singapore 0.5, Cyprus 6.7, Qatar 12.2,
// Fiji 19.4, Rwanda 25.9 (in) vs Albania 35.1, Belgium 41.4, Switzerland
// 53.7 (out — their paint reads fine). Scales with viewport: a smaller
// window legitimately needs more dots.
const SMALL_AREA_PX = 30;
let _tooltip: HTMLElement;
let _isReady = false;
let _pendingRender: (() => void) | null = null;
// Last painted (state, data), so resize can re-derive the selection dots:
// which jurisdictions count as "small" depends on the projected size, and a
// map that resized while hidden (0×0 container) computes every area as ~0.
let _lastPaint: { state: AppState; data: BlocsData } | null = null;
let _lastFocus: string | null = null;
let _resizeObserver: ResizeObserver | null = null;
let _abortController: AbortController | null = null;
let _initialized = false;

export function init(
  data: BlocsData,
  onSelect: (iso: string, name: string) => void,
): () => void {
  if (_initialized) destroy();
  _initialized = true;
  _onSelect = onSelect;

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

  // Lanes never contribute to bloc membership, but a country that is a lane
  // destination or beneficiary IS reachable — surface it on the idle map so
  // heritage/ancestry routes aren't invisible grey.
  _laneByCountry = new Set();
  data.bilateral_lanes.forEach(l => {
    _laneByCountry.add(l.destination.iso_n3);
    l.beneficiaries.forEach(m => _laneByCountry.add(m.iso_n3));
  });

  _tooltip = document.getElementById('tooltip')!;

  const svg = d3.select<SVGSVGElement, unknown>('#map');
  _svg = svg;
  // PR-tier hatch for route-class paint: the palette cannot carry a third
  // lightness step (see route-classes.ts), so the middle tier is the strong
  // hue with a 45-degree light hatch — texture as the secondary channel.
  // CSS vars inside the pattern track the theme automatically.
  const defs = svg.append('defs');
  const hatch = defs.append('pattern')
    .attr('id', 'pr-hatch').attr('patternUnits', 'userSpaceOnUse')
    .attr('width', 5).attr('height', 5).attr('patternTransform', 'rotate(45)');
  hatch.append('rect').attr('width', 5).attr('height', 5).attr('fill', 'var(--map-strong)');
  hatch.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5)
    .attr('stroke', 'var(--map-lane)').attr('stroke-width', 2);
  _gMap = svg.append('g');
  _gDots = svg.append('g').attr('class', 'dot-layer');
  _gFlags = svg.append('g').attr('class', 'flag-layer');

  _projection = d3.geoNaturalEarth1();
  _path = d3.geoPath(_projection);
  _featureBounds = new Map();
  _featureCentroids = new Map();

  // Zoom + pan
  _zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 12])
    .on('zoom', e => {
      _currentK = e.transform.k;
      _gMap.attr('transform', e.transform);
      _gDots.attr('transform', e.transform);
      _gFlags.attr('transform', e.transform);
      _gFlags.selectAll<SVGTextElement, PlantedFlag>('text')
        .style('font-size', `${18 / _currentK}px`)
        .attr('stroke-width', 3 / _currentK);
      // Keep dots and their leader labels at constant screen size
      _gDots.selectAll<SVGCircleElement, MicroState>('circle.micro-dot')
        .attr('r', 5 / _currentK);
      _gDots.selectAll<SVGCircleElement, { iso: string }>('circle.selection-dot')
        .attr('r', 5 / _currentK)
        .attr('stroke-width', 1.5 / _currentK);
      _gDots.selectAll('.dot-leader').remove();
    });
  svg.call(_zoom);

  function resize() {
    const wrap = document.getElementById('map-wrap')!;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    svg.attr('viewBox', `0 0 ${w} ${h}`);
    _projection.fitSize([w, h], { type: 'Sphere' });
    // Natural Earth ships some outlying territories as separate features that
    // carry the parent's ISO code (Ashmore & Cartier Is. is a second "036").
    // Keep the LARGEST feature's bounds/centroid per iso and sum the areas —
    // last-write-wins let the reef overwrite Australia, which then "qualified"
    // as a small jurisdiction and drew a phantom dot in the Timor Sea.
    const largestArea = new Map<string, number>();
    _featureAreas = new Map();
    _gMap.selectAll<SVGPathElement, d3.GeoPermissibleObjects>('path')
      .attr('d', d => _path(d))
      .each(function (d) {
        // Bounds must be captured AFTER fitSize — they're used for zoom framing
        const id = (d as unknown as { id: number | string }).id;
        const iso = String(id).padStart(3, '0');
        const area = _path.area(d);
        if (area > (largestArea.get(iso) ?? -1)) {
          largestArea.set(iso, area);
          _featureBounds.set(iso, _path.bounds(d));
          // Area-weighted centroid — bbox centers break on antimeridian-crossing
          // features (US/Russia/Fiji), whose boxes span the whole projection.
          _featureCentroids.set(iso, _path.centroid(d));
        }
        _featureAreas.set(iso, (_featureAreas.get(iso) ?? 0) + area);
      });
    updateDotPositions();
    updateFlagPositions();
    if (_isReady && _lastPaint) paintAll(_lastPaint.state, _lastPaint.data);
  }
  _resizeObserver = new ResizeObserver(resize);
  _resizeObserver.observe(document.getElementById('map-wrap')!);

  // Fetch world atlas topology
  _abortController = new AbortController();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d3.json<any>(
    'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
    { signal: _abortController.signal },
  )
    .then(world => {
      if (!world) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const features = (topojson.feature(world, world.objects.countries) as any).features as Array<{
        id: number | string;
        properties: { name: string };
        geometry: unknown;
      }>;

      features.forEach(f => _featureNames.set(String(f.id).padStart(3, '0'), f.properties.name));
      const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      _canHover = canHover;
      const countryPaths = _gMap.selectAll('path')
        .data(features)
        .join('path')
        .attr('class', 'country')
        .attr('data-iso', d => String(d.id).padStart(3, '0'))
        .attr('d', d => _path(d as unknown as d3.GeoPermissibleObjects))
        .on('click', (_e, d) => {
          onSelect(String(d.id).padStart(3, '0'), d.properties.name);
        });

      if (canHover) {
        countryPaths
          .on('mousemove', (e, d) => {
            const iso = String(d.id).padStart(3, '0');
            showTooltip(e as MouseEvent, d.properties.name, iso);
          })
          .on('mouseleave', hideTooltip);
      }

      // Dot markers for micro-states: hover shows a leader line + name label
      // (plus the shared tooltip); click selects exactly like a filled country.
      const microDots = _gDots.selectAll('circle')
        .data(MICRO_STATES)
        .join('circle')
        .attr('class', 'micro-dot')
        .attr('data-iso', d => d.iso)
        .attr('r', 5)
        .on('click', (_e, d) => onSelect(d.iso, d.name));

      if (canHover) {
        microDots
          .on('mouseenter', (_e, d) => showDotLeader(d))
          .on('mousemove', (e, d) => {
            showTooltip(e as MouseEvent, d.name, d.iso);
          })
          .on('mouseleave', () => {
            hideTooltip();
            _gDots.selectAll('.dot-leader').remove();
          });
      }

      _isReady = true;
      resize();

      if (_pendingRender) {
        _pendingRender();
        _pendingRender = null;
      }
    })
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const hint = document.getElementById('hint');
      if (hint) hint.textContent = 'Map unavailable — could not reach cdn.jsdelivr.net.';
    });

  return destroy;
}

export function destroy(): void {
  if (!_initialized) return;
  _resizeObserver?.disconnect();
  _resizeObserver = null;
  _abortController?.abort();
  _abortController = null;
  _svg.on('.zoom', null);
  _svg.selectAll('*').remove();
  if (_tooltip) _tooltip.style.display = 'none';
  _isReady = false;
  _pendingRender = null;
  _lastPaint = null;
  _lastFocus = null;
  _currentK = 1;
  _initialized = false;
}

function updateDotPositions(): void {
  _gDots.selectAll<SVGCircleElement, MicroState>('circle.micro-dot')
    .attr('cx', d => (_projection([d.lon, d.lat]) ?? [0, 0])[0])
    .attr('cy', d => (_projection([d.lon, d.lat]) ?? [0, 0])[1]);
  _gDots.selectAll<SVGCircleElement, string>('circle.selection-dot')
    .attr('cx', iso => (_featureCentroids.get(iso) ?? [0, 0])[0])
    .attr('cy', iso => (_featureCentroids.get(iso) ?? [0, 0])[1]);
}

function updateFlagPositions(): void {
  _gFlags
    .selectAll<SVGTextElement, { f: PlantedFlag; pos: [number, number] }>('text.flag-pin')
    .interrupt()
    .attr('x', d => centroidForIso(d.f.iso_n3)?.[0] ?? d.pos[0])
    .attr('y', d => centroidForIso(d.f.iso_n3)?.[1] ?? d.pos[1]);
}

function centroidForIso(iso: string): [number, number] | null {
  const c = _featureCentroids.get(iso);
  if (c && isFinite(c[0]) && isFinite(c[1])) return c;
  const micro = MICRO_STATES.find(m => m.iso === iso);
  if (micro) return _projection([micro.lon, micro.lat]) ?? null;
  return null;
}

/** "Planted" flag glyphs: held statuses (⚑) plus birthplace (⚐). */
function drawFlags(profile: Profile): void {
  const pseudo: PlantedFlag[] = profile.birthplace && !profile.flags.some(f => f.iso_n3 === profile.birthplace)
    ? [{ iso_n3: profile.birthplace, name: 'birthplace', status: 'tr' }]
    : [];
  const placed = [...profile.flags, ...pseudo]
    .map(f => ({ f, pos: centroidForIso(f.iso_n3) }))
    .filter((x): x is { f: PlantedFlag; pos: [number, number] } => x.pos !== null);

  _gFlags.selectAll<SVGTextElement, { f: PlantedFlag; pos: [number, number] }>('text')
    .data(placed, d => d.f.iso_n3)
    .join(
      enter => enter.append('text')
        .attr('class', 'flag-pin')
        .attr('data-iso', d => d.f.iso_n3)
        .attr('x', d => d.pos[0])
        .attr('y', d => d.pos[1] - 14)
        .attr('opacity', 0)
        .call(t => t.transition().duration(350)
          .attr('y', d => d.pos[1])
          .attr('opacity', 1)),
      update => update
        .attr('x', d => d.pos[0])
        .attr('y', d => d.pos[1]),
      exit => exit.transition().duration(200).attr('opacity', 0).remove(),
    )
    .attr('text-anchor', 'middle')
    .style('font-size', `${18 / _currentK}px`)
    .attr('fill', d => d.f.status === 'cit' ? 'var(--map-accent)' : 'var(--map-muted)')
    .attr('stroke', 'var(--map-ocean)')
    .attr('stroke-width', 3 / _currentK)
    .attr('paint-order', 'stroke')
    .attr('pointer-events', 'none')
    .text(d => d.f.name === 'birthplace' ? '⚐' : '⚑');
}

function showDotLeader(d: MicroState): void {
  const [x, y] = _projection([d.lon, d.lat]) ?? [0, 0];
  showDotLeaderAt(x, y, d.name);
}

function showDotLeaderAt(x: number, y: number, name: string): void {
  _gDots.selectAll('.dot-leader').remove();
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
    .text(name);
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
  // On mobile, selecting a country zooms to it — the animation doubles as the
  // "reveal" latency before the bottom sheet slides up. Desktop docks the panel
  // beside the map, so a single-country zoom would just be disruptive there.
  const mobile = typeof window !== 'undefined'
    && window.matchMedia('(max-width: 767px)').matches;
  const focus = state.blocs.length
    ? state.blocs.join(',')
    : state.lane ? `lane:${state.lane}`
      : (mobile && state.country) ? `country:${state.country}`
        : null;
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
  } else if (mobile && state.country) {
    zoomToIsos([state.country]);
  } else {
    resetZoom();
  }
}

function showTooltip(e: MouseEvent, name: string, iso: string): void {
  const lookupIso = mobilityIso(iso);
  const blocs = _byCountry.get(lookupIso) ?? [];
  const former = _formerByCountry.get(lookupIso) ?? [];
  const lines = [
    ...blocs.map(b => b.name),
    ...former.map(b => `${b.name} (former member — rights honored until further notice)`),
  ];
  _tooltip.style.display = 'block';
  _tooltip.style.left = (e.offsetX + 14) + 'px';
  _tooltip.style.top = (e.offsetY + 14) + 'px';
  // Escape: `name` comes from the (CDN-fetched) world-atlas and bloc names from
  // data — never inject them raw into innerHTML.
  const esc = (value: string) => value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  _tooltip.innerHTML =
    `<div>${esc(name)}</div>` +
    (lines.length
      ? `<div class="tt-blocs">${lines.map(esc).join(' · ')}</div>`
      : `<div class="tt-blocs">No bloc membership mapped</div>`);
}

function hideTooltip(): void {
  _tooltip.style.display = 'none';
}

/*
 * Idle-map encoding (nothing selected): CATEGORICAL by the strongest right a
 * country has, strongest wins. Replaces the old count ramp, which flattened
 * proto/one-way frameworks into the same weight as citizenship blocs and left
 * 79% of colored countries at one indistinguishable shade. Fills are CSS
 * tokens so a theme flip repaints via variables, no per-theme recompute.
 */
type IdleBucket = 'strong' | 'limited' | 'lane' | 'none';

// Fill-only encoding (standard for a categorical choropleth — outlines are for
// borders/selection, not data). The blue-hued tiers are the ramp of route
// strength; neutral grey is "no cross-border framework".
const IDLE_FILL: Record<IdleBucket, string> = {
  strong: 'var(--map-strong)',
  limited: 'var(--map-limited)',
  lane: 'var(--map-lane)',
  none: 'var(--map-land)',
};

function idleBucket(lookupIso: string): IdleBucket {
  const blocs = _byCountry?.get(lookupIso) ?? [];
  // full/closed = durable settlement/citizenship systems; the rest (partial,
  // hub_spoke, one_way, proto) are weaker frameworks that shouldn't outrank them.
  if (blocs.some(b => b.category === 'full' || b.category === 'closed')) return 'strong';
  if (blocs.length) return 'limited';
  if (_laneByCountry.has(lookupIso)) return 'lane';
  return 'none';
}

let _classIsos: { cit: Set<string>; pr: Set<string>; tr: Set<string> } | null = null;

/** Route-class browse paint sets (#129); owned by render(), read by colorForIso. */
export function setRouteClassIsos(
  isos: { cit: Set<string>; pr: Set<string>; tr: Set<string> } | null,
): void {
  _classIsos = isos;
}

function colorForIso(iso: string, state: AppState, data: BlocsData): string {
  const lookupIso = mobilityIso(iso);
  const dark = isDarkTheme();
  if (state.routeClass && _classIsos) {
    // Three tiers, two colours: CIT solid strong, PR strong with a 45-degree
    // hatch (texture as the secondary channel — the palette cannot carry a
    // third lightness step), TR light solid.
    if (_classIsos.cit.has(lookupIso)) return 'var(--map-strong)';
    if (_classIsos.pr.has(lookupIso)) return 'url(#pr-hatch)';
    if (_classIsos.tr.has(lookupIso)) return 'var(--map-limited)';
    return 'var(--map-land)';
  }
  if (state.lane) {
    const lane = data.bilateral_lanes.find(l => l.id === state.lane);
    if (!lane) return 'var(--map-land)';
    const laneColor = displayColor(lane.color, dark);
    if (lane.destination.iso_n3 === lookupIso) return laneColor;
    if (lane.beneficiaries.some(m => m.iso_n3 === lookupIso)) {
      const c = d3.color(laneColor) as d3.RGBColor | null;
      if (!c) return laneColor;
      c.opacity = 0.65;
      return c.formatRgb();
    }
    return 'var(--map-land)';
  }
  if (state.blocs.length) {
    const selected = data.blocs.filter(b => state.blocs.includes(b.id));
    const containing = selected.filter(b => b.members.some(m => m.iso_n3 === lookupIso));

    if (containing.length >= 2) {
      // Overlap country: Lab-blend of every containing bloc's color
      return blendColors(containing.map(b => displayColor(b.color, dark)));
    }
    if (containing.length === 1) {
      const ab = containing[0];
      const blocColor = displayColor(ab.color, dark);
      if (ab.sub_bloc?.members_iso.includes(lookupIso)) {
        const c = d3.color(blocColor);
        return (dark ? c?.brighter(0.7) : c?.brighter(0.4))?.formatHex() ?? blocColor;
      }
      return blocColor;
    }
    // Former members only render in single-bloc focus (avoids ambiguity in compare mode)
    if (selected.length === 1) {
      const ab = selected[0];
      if (ab.former_members?.some(m => m.iso_n3 === lookupIso)) {
        const c = d3.color(displayColor(ab.color, dark));
        return (dark ? c?.darker(1.6) : c?.brighter(1.1))?.formatHex() ?? '#888';
      }
    }
    return 'var(--map-land)';
  }
  return IDLE_FILL[idleBucket(lookupIso)];
}

/** ISOs the current selection highlights (mobility-mapped), or null when idle. */
function selectionIsos(state: AppState, data: BlocsData): Set<string> | null {
  if (state.routeClass && _classIsos) {
    return new Set([..._classIsos.cit, ..._classIsos.pr, ..._classIsos.tr]);
  }
  if (state.lane) {
    const lane = data.bilateral_lanes.find(l => l.id === state.lane);
    if (!lane) return new Set();
    return new Set([lane.destination.iso_n3, ...lane.beneficiaries.map(m => m.iso_n3)]);
  }
  if (state.blocs.length) {
    const isos = new Set<string>();
    for (const bloc of data.blocs) {
      if (state.blocs.includes(bloc.id)) bloc.members.forEach(m => isos.add(m.iso_n3));
    }
    return isos;
  }
  return null;
}

function paintAll(state: AppState, data: BlocsData): void {
  _lastPaint = { state, data };
  // A hidden container (display:none view, background window) projects every
  // feature to ~0 px² — deriving smallness there would dot the whole selection.
  // Skip the paint; the ResizeObserver re-runs it when real dimensions return.
  if (!document.getElementById('map-wrap')?.clientWidth) return;
  // Members of the active selection show a pointer cursor — they read as
  // results, and the pointer says "this one is part of the answer". Idle land
  // keeps the grab cursor so panning stays advertised.
  const selected = selectionIsos(state, data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _gMap.selectAll<SVGPathElement, any>('.country')
    .attr('fill', d => colorForIso(String(d.id).padStart(3, '0'), state, data))
    .style('cursor', d =>
      selected?.has(mobilityIso(String(d.id).padStart(3, '0'))) ? 'pointer' : null);

  // Dots get an accent ring only when they belong to the active selection — a
  // legitimate highlight, unlike using an outline to encode an idle category.
  _gDots.selectAll<SVGCircleElement, MicroState>('.micro-dot')
    .attr('fill', d => colorForIso(d.iso, state, data))
    .attr('stroke', d => (selected?.has(mobilityIso(d.iso)) ? 'var(--map-accent)' : 'none'));

  // Small-area members of the active selection get a ringed dot: their polygon
  // is too small to show its paint (Singapore, Vanuatu, São Tomé…). Smallness
  // is derived from projected area — no hand list — and micro-states are
  // excluded because they already carry a permanent dot.
  const microIsos = new Set(MICRO_STATES.map(m => m.iso));
  // Iterate the FEATURES (not the selection set) so territories that inherit a
  // parent's paint via MOBILITY_PARENT_ISO also earn a dot (Guam under a US
  // selection has no own entry in `selected`).
  const smallSelected = selected
    ? [..._featureAreas.keys()].filter(iso =>
        selected.has(mobilityIso(iso))
        && !microIsos.has(iso)
        && (_featureAreas.get(iso) ?? Infinity) < SMALL_AREA_PX
        && _featureCentroids.has(iso))
    : [];
  _gDots.selectAll<SVGCircleElement, string>('circle.selection-dot')
    .data(smallSelected, iso => String(iso))
    .join(
      enter => {
        const dots = enter.append('circle')
          .attr('class', 'selection-dot')
          .attr('r', 5 / _currentK)
          .attr('stroke-width', 1.5 / _currentK)
          .on('click', (_e, iso) => _onSelect?.(iso, _featureNames.get(iso) ?? iso));
        if (_canHover) {
          dots
            .on('mouseenter', (_e, iso) => {
              const [x, y] = _featureCentroids.get(iso) ?? [0, 0];
              showDotLeaderAt(x, y, _featureNames.get(iso) ?? iso);
            })
            .on('mousemove', (e, iso) => {
              showTooltip(e as MouseEvent, _featureNames.get(iso) ?? iso, iso);
            })
            .on('mouseleave', () => {
              hideTooltip();
              _gDots.selectAll('.dot-leader').remove();
            });
        }
        return dots;
      },
      update => update,
      exit => exit.remove(),
    )
    .attr('cx', iso => _featureCentroids.get(iso)![0])
    .attr('cy', iso => _featureCentroids.get(iso)![1])
    .attr('fill', iso => colorForIso(iso, state, data))
    .attr('stroke', 'var(--map-accent)');
}

export function render(state: AppState, data: BlocsData, profile: Profile = EMPTY_PROFILE): void {
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
      drawFlags(profile);
      frameSelection(state, data);
    };
  } else {
    paintAll(state, data);
    drawFlags(profile);
    frameSelection(state, data);
  }
}

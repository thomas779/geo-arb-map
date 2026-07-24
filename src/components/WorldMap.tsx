import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AppState, BlocsData } from '../types';
import type { Profile } from '../lib/planner';
import { init as initMap, render as renderMap } from '../map';
import { cn } from '../lib/utils';
import { Card, CardFooter } from '@/components/ui/card';

interface Props {
  data: BlocsData | null;
  state: AppState;
  /** Included so a theme flip repaints the D3 layer's computed fills. */
  theme: string;
  profile: Profile;
  onSelect: (iso: string, name: string) => void;
  /** Last-verified date, shown in the map key footer (consolidates the old pill). */
  dataUpdatedAt?: string;
  /** Opens the methodology / trust panel from the map key footer. */
  onOpenInfo?: () => void;
}

/*
 * The idle map is painted CATEGORICALLY by the strongest right a country has
 * (see src/map.ts). These rows decode that paint; swatch colors come from the
 * same --map-* tokens the map fills use, so light/dark track automatically.
 * Order mirrors the visual ramp: strongest → weakest → unknown.
 */
const LEGEND_ROWS = [
  { key: 'strong', label: 'Strong settlement bloc', hint: 'Full free movement or citizenship union (EU/EEA, Mercosur, EAEU…).' },
  { key: 'limited', label: 'Limited framework only', hint: 'Partial, one-way, or still-emerging arrangements.' },
  { key: 'lane', label: 'Reachable via a lane', hint: 'A bilateral, ancestry, or heritage route leads here.' },
  { key: 'none', label: 'No cross-border framework', hint: 'Ordinary nationality routes may still exist — click to check.' },
] as const;

// The status hierarchy (less → more) referenced across bloc rights ladders.
// Lives collapsed inside the map key as a glossary rather than a header button.
const ACCESS_LEVELS = [
  { tier: 'TR', title: 'Temporary residence', detail: 'Time-limited residence and attached work rights.' },
  { tier: 'PR', title: 'Permanent residence', detail: 'Durable settlement rights without citizenship.' },
  { tier: 'CIT', title: 'Citizenship', detail: 'Nationality, passport, and political rights.' },
] as const;

/**
 * Thin React wrapper around the imperative D3 layer in src/map.ts.
 * D3 owns everything inside the <svg>; React only mounts the elements
 * (by the ids map.ts expects), forwards state changes to its render(),
 * and renders the map legend (driven by AppState, not by the D3 layer).
 */
export function WorldMap({ data, state, theme, profile, onSelect, dataUpdatedAt, onOpenInfo }: Props) {
  const inited = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [legendOpen, setLegendOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  );

  useEffect(() => {
    if (!data || inited.current) return;
    inited.current = true;
    const cleanup = initMap(data, (iso, name) => onSelectRef.current(iso, name));
    renderMap(state, data, profile);
    return () => {
      cleanup();
      inited.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!data || !inited.current) return;
    renderMap(state, data, profile);
  }, [state, data, theme, profile]);

  // Legend is idle-first: full key when nothing is selected, a one-line caption
  // once a selection is active (the panels already explain it), hidden off-map.
  const legendMode = state.view !== 'map'
    ? 'hidden'
    : state.lane || state.blocs.length > 0 || state.country
      ? 'select'
      : 'idle';

  return (
    <>
      <svg id="map" />
      <div id="hint">scroll to zoom · drag to pan · click a country</div>
      <div id="tooltip" />
      {legendMode !== 'hidden' && (
        <Card
          size="sm"
          className="absolute right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[6] w-60 gap-0 py-0 shadow-lg"
        >
          <button
            type="button"
            aria-expanded={legendOpen}
            aria-controls="map-legend-body"
            onClick={() => setLegendOpen(open => !open)}
            className="flex w-full items-center justify-between px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            {legendMode === 'idle' ? 'Map key' : 'On the map'}
            <ChevronDown className={cn('size-3.5 transition-transform', legendOpen && 'rotate-180')} aria-hidden />
          </button>
          {legendOpen && (
            <div id="map-legend-body" className="px-3 pb-2.5">
              {legendMode === 'idle' ? (
                <ul className="flex flex-col gap-1.5">
                  {LEGEND_ROWS.map(row => (
                    <li key={row.key} title={row.hint} className="flex items-center gap-2 text-[11.5px] leading-tight text-foreground">
                      <span className={`legend-sw sw-${row.key}`} aria-hidden />
                      <span>{row.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11.5px] leading-snug text-muted-foreground">Selection highlighted on the map.</p>
              )}
              <details className="group mt-2.5 border-t pt-2.5">
                <summary className="flex cursor-pointer list-none items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <span>Access levels</span>
                  <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {ACCESS_LEVELS.map((level, index) => (
                    <div key={level.tier} className="grid grid-cols-[30px_1fr] gap-2">
                      <span className="pt-0.5 font-mono text-[10px] font-semibold text-foreground">{level.tier}</span>
                      <span className="min-w-0">
                        <span className="mb-1 flex gap-0.5" aria-label={`Level ${index + 1} of 3`}>
                          {[0, 1, 2].map(step => (
                            <span
                              key={step}
                              aria-hidden
                              className={cn('h-1 w-2.5 rounded-full', step <= index ? 'bg-primary' : 'bg-muted')}
                            />
                          ))}
                        </span>
                        <span className="block text-[11px] font-medium text-foreground">{level.title}</span>
                        <span className="block text-[10px] leading-snug text-muted-foreground">{level.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
          {dataUpdatedAt && (
            <CardFooter className="px-3 py-2">
              <button
                type="button"
                onClick={onOpenInfo}
                aria-label={`Data updated ${dataUpdatedAt}. Open methodology.`}
                className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              >
                <span className="relative flex size-1.5" aria-hidden>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-verified/55 motion-reduce:hidden" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-verified" />
                </span>
                updated&nbsp;·&nbsp;{dataUpdatedAt}
              </button>
            </CardFooter>
          )}
        </Card>
      )}
    </>
  );
}

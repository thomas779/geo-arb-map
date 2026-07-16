import { useEffect, useRef } from 'react';
import type { AppState, BlocsData } from '../types';
import type { Profile } from '../lib/planner';
import { init as initMap, render as renderMap } from '../map';

interface Props {
  data: BlocsData | null;
  state: AppState;
  /** Included so a theme flip repaints the D3 layer's computed fills. */
  theme: string;
  profile: Profile;
  onSelect: (iso: string, name: string) => void;
}

/**
 * Thin React wrapper around the imperative D3 layer in src/map.ts.
 * D3 owns everything inside the <svg>; React only mounts the elements
 * (by the ids map.ts expects) and forwards state changes to its render().
 */
export function WorldMap({ data, state, theme, profile, onSelect }: Props) {
  const inited = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!data || inited.current) return;
    inited.current = true;
    initMap(data, (iso, name) => onSelectRef.current(iso, name));
    renderMap(state, data, profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!data || !inited.current) return;
    renderMap(state, data, profile);
  }, [state, data, theme, profile]);

  return (
    <>
      <svg id="map" />
      <div id="hint">scroll to zoom · drag to pan · click a country</div>
      <div id="tooltip" />
    </>
  );
}

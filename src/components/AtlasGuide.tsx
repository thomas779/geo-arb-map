import { useState } from 'react';
import {
  CircleHelp,
  ExternalLink,
  MapPin,
  Route,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dataCorrectionUrl, productFeedbackUrl } from '@/lib/trust';

const GUIDE_STORAGE_KEY = 'flag-paths:atlas-guide-seen';

const STARTING_POINTS = [
  {
    icon: Search,
    title: 'Know the country?',
    detail: 'Search it or click it on the map.',
  },
  {
    icon: Route,
    title: 'Know the route?',
    detail: 'Choose family, investment, work, or another path.',
  },
  {
    icon: MapPin,
    title: 'Just exploring?',
    detail: 'Use the colors to spot shared and country-specific access.',
  },
] as const;

function firstVisit(autoOpen: boolean): boolean {
  if (!autoOpen || typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(GUIDE_STORAGE_KEY) !== 'true';
  } catch {
    return false;
  }
}

interface Props {
  autoOpen: boolean;
  onExplore: () => void;
}

export function AtlasGuide({ autoOpen, onExplore }: Props) {
  const [open, setOpen] = useState(() => firstVisit(autoOpen));

  const markSeen = () => {
    try {
      localStorage.setItem(GUIDE_STORAGE_KEY, 'true');
    } catch {
      // Storage can be unavailable in hardened browsing modes. The guide still works.
    }
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) markSeen();
  };

  const explore = () => {
    markSeen();
    setOpen(false);
    onExplore();
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="size-9 gap-1.5 p-0 text-xs text-muted-foreground sm:h-8 sm:w-[68px] sm:px-2"
          aria-label="Open Atlas help"
        >
          <CircleHelp className="size-3" aria-hidden />
          <span className="hidden sm:inline">Help</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={8}
        onOpenAutoFocus={event => event.preventDefault()}
        className="w-[min(22rem,calc(100vw-1rem))] overflow-hidden p-0"
      >
        <div className="px-4 pb-3 pt-4">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">
            Quick guide
          </p>
          <h2 className="mt-1 font-heading text-xl font-semibold tracking-[-0.02em] text-foreground">
            Start with what you know.
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            A country, a route, or neither—each is a valid starting point.
          </p>
        </div>

        <div className="border-y px-2 py-1">
          {STARTING_POINTS.map(point => {
            const Icon = point.icon;
            return (
              <div key={point.title} className="flex items-center gap-3 rounded-md px-2 py-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-foreground">{point.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{point.detail}</span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 px-3 py-3">
          <Button type="button" onClick={explore}>Explore routes</Button>
          <Button type="button" variant="ghost" onClick={() => changeOpen(false)}>Got it</Button>
        </div>

        <div className="grid grid-cols-2 gap-px border-t bg-border">
          <a
            href={productFeedbackUrl()}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center justify-between gap-2 bg-popover px-3 py-2.5 text-[11px] font-medium hover:bg-accent"
          >
            Ask or give feedback
            <ExternalLink className="size-3 text-muted-foreground group-hover:text-foreground" aria-hidden />
          </a>
          <a
            href={dataCorrectionUrl()}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center justify-between gap-2 bg-popover px-3 py-2.5 text-[11px] font-medium hover:bg-accent"
          >
            Report data issue
            <ExternalLink className="size-3 text-muted-foreground group-hover:text-foreground" aria-hidden />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { useState } from 'react';
import {
  ChevronRight,
  CircleHelp,
  Compass,
  ExternalLink,
  Network,
  Route,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dataCorrectionUrl, productFeedbackUrl } from '@/lib/trust';

const GUIDE_STORAGE_KEY = 'flag-paths:atlas-guide-seen';

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
  onSearchCountry: () => void;
  onStartTour: () => void;
}

export function AtlasGuide({ autoOpen, onSearchCountry, onStartTour }: Props) {
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

  const chooseCountry = () => {
    markSeen();
    setOpen(false);
    onSearchCountry();
  };

  const followLink = () => markSeen();

  const startTour = () => {
    markSeen();
    setOpen(false);
    onStartTour();
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
            What would you like to find?
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Choose a starting point. You can change direction at any time.
          </p>
        </div>

        <div className="px-3 pb-3">
          <Button type="button" className="w-full justify-between" onClick={startTour}>
            <span className="inline-flex items-center gap-2">
              <Compass className="size-4" aria-hidden />
              Show me around
            </span>
            <span className="font-mono text-[9px] font-medium uppercase tracking-wider opacity-75">3 steps</span>
          </Button>
        </div>

        <div className="border-y bg-border">
          <button
            type="button"
            onClick={chooseCountry}
            className="group flex w-full items-center gap-3 bg-popover px-4 py-3 text-left hover:bg-accent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Search className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-foreground">Search a country</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">See citizenship rules and available paths.</span>
            </span>
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
          <a
            href="/routes/"
            onClick={followLink}
            className="group mt-px flex items-center gap-3 bg-popover px-4 py-3 hover:bg-accent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Route className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-foreground">Browse ways to move</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Compare ancestry, investment, work, and other routes.</span>
            </span>
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </a>
          <a
            href="/rights/"
            onClick={followLink}
            className="group mt-px flex items-center gap-3 bg-popover px-4 py-3 hover:bg-accent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Network className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-foreground">Compare regional rights</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">See where one status can open several countries.</span>
            </span>
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </a>
        </div>

        <div className="px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => changeOpen(false)}>
            I’ll explore the map
          </Button>
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

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type NavKey = 'atlas' | 'planner' | 'countries';

/** The Flag Paths route-mark. Shared by the app header and prerendered pages. */
export function BrandMark() {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className="size-8 shrink-0" fill="none">
      <path
        d="M5.5 24.5c0-7.2 4.1-9.8 9.1-9.8 5.8 0 6.1-7.2 11.9-7.2"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="5.5" cy="24.5" r="3" className="fill-card stroke-foreground" strokeWidth="1.5" />
      <circle cx="26.5" cy="7.5" r="3" className="fill-primary stroke-card" strokeWidth="1.5" />
    </svg>
  );
}

type View = 'map' | 'stacking' | 'countries';

const NAV_ITEMS: { key: NavKey; label: string; href: string; view: View }[] = [
  { key: 'atlas', label: 'Atlas', href: '/', view: 'map' },
  { key: 'planner', label: 'Planner', href: '/planner', view: 'stacking' },
  { key: 'countries', label: 'Countries', href: '/country', view: 'countries' },
];

interface Props {
  /** Which nav item is current. */
  active: NavKey;
  /**
   * When provided (the interactive app), Atlas/Planner render as in-app
   * view-switch buttons. When omitted (prerendered static pages), every item
   * renders as a plain link so navigation just works without the SPA.
   */
  onSelectView?: (view: View) => void;
  /** App-specific controls (Rights / Trust / Updates / theme) rendered on the right. */
  right?: ReactNode;
}

/**
 * The one true site header. Used by the interactive atlas (App.tsx) and by the
 * prerendered per-country SEO pages, so the navbar can never drift between them.
 */
export function SiteHeader({ active, onSelectView, right }: Props) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b bg-card/90 px-2.5 backdrop-blur-sm sm:h-16 sm:gap-4 sm:px-5">
      <a href="/" className="flex min-w-0 items-center gap-2.5" aria-label="Flag Paths home">
        <BrandMark />
        <span className="hidden min-w-0 sm:block">
          <span className="block whitespace-nowrap font-heading text-xl font-bold tracking-[-0.035em] text-foreground sm:text-[1.45rem]">
            Flag Paths
          </span>
          <span className="hidden font-mono text-[8px] font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:block">
            Mobility atlas
          </span>
        </span>
      </a>
      <nav aria-label="Primary" className="flex shrink-0 items-center gap-4 sm:gap-6">
        {NAV_ITEMS.map(item => {
          const isActive = item.key === active;
          const className = cn(
            'relative flex h-9 items-center justify-center text-xs font-semibold outline-none transition-colors focus-visible:text-primary',
            isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          );
          const underline = isActive
            ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
            : null;
          if (onSelectView && item.view) {
            return (
              <button
                key={item.key}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                className={className}
                onClick={() => onSelectView(item.view!)}
              >
                {item.label}
                {underline}
              </button>
            );
          }
          return (
            <a
              key={item.key}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={className}
            >
              {item.label}
              {underline}
            </a>
          );
        })}
      </nav>
      {right && <div className="ml-auto flex shrink-0 items-center gap-0.5">{right}</div>}
    </header>
  );
}

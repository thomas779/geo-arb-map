import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, FlagTriangleRight, Globe2, Network, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavKey = 'atlas' | 'planner' | 'countries' | 'rights' | 'routes' | 'none';

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

type View = 'map' | 'stacking' | 'countries' | 'rights';

const ATLAS = { key: 'atlas' as const, label: 'Atlas', href: '/', view: 'map' as View };
const PLANNER = { key: 'planner' as const, label: 'Planner', href: '/planner/', view: 'stacking' as View };
// Read-first pages live together here; each description answers why the page
// differs from the interactive atlas before the user leaves the map.
const BROWSE_ITEMS: { key: NavKey; label: string; description: string; icon: LucideIcon; href: string; view?: View }[] = [
  { key: 'countries', label: 'Country guides', description: 'Domestic citizenship and residence rules', icon: Globe2, href: '/country/', view: 'countries' },
  { key: 'rights', label: 'Regional systems', description: 'Shared rights across member countries', icon: Network, href: '/rights/', view: 'rights' },
  { key: 'routes', label: 'Routes', description: 'Browse countries by citizenship or residence path', icon: FlagTriangleRight, href: '/routes/' },
];
const BROWSE_KEYS: NavKey[] = ['countries', 'rights', 'routes'];

interface Props {
  /** Which nav item is current. 'none' highlights nothing. */
  active: NavKey;
  /**
   * When provided (the interactive app), items render as in-app view-switch
   * buttons. When omitted (prerendered static pages), every item renders as a
   * plain link so navigation works without the SPA.
   */
  onSelectView?: (view: View) => void;
  /** App-specific controls (Rights / Trust / Updates / theme) rendered on the right. */
  right?: ReactNode;
}

const itemClass = (isActive: boolean) => cn(
  'relative flex h-9 items-center justify-center gap-1 text-xs font-semibold outline-none transition-colors focus-visible:text-primary',
  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
);

function Underline({ show }: { show: boolean }) {
  return show ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" /> : null;
}

/**
 * The one true site header. Used by the interactive atlas (App.tsx) and by the
 * prerendered SEO pages, so the navbar can never drift between them.
 */
export function SiteHeader({ active, onSelectView, right }: Props) {
  // Native <details> stays open on outside click — close it on an outside
  // pointer or Escape (app only; static pages don't hydrate this effect).
  const browseRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = browseRef.current;
    if (!details) return;
    const onPointer = (e: PointerEvent) => {
      if (details.open && !details.contains(e.target as Node)) details.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && details.open) details.open = false;
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const item = (
    def: { key: NavKey; label: string; href: string; view: View },
  ) => {
    const isActive = def.key === active;
    if (onSelectView) {
      return (
        <button
          key={def.key}
          type="button"
          aria-current={isActive ? 'page' : undefined}
          className={itemClass(isActive)}
          onClick={() => onSelectView(def.view)}
        >
          {def.label}
          <Underline show={isActive} />
        </button>
      );
    }
    return (
      <a key={def.key} href={def.href} aria-current={isActive ? 'page' : undefined} className={itemClass(isActive)}>
        {def.label}
        <Underline show={isActive} />
      </a>
    );
  };

  const browseActive = BROWSE_KEYS.includes(active);
  const browseItem = (def: { label: string; description: string; icon: LucideIcon; href: string; view?: View }) => {
    const Icon = def.icon;
    const cls = 'group/item grid w-full grid-cols-[28px_1fr] gap-2.5 rounded-md px-2.5 py-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
    const content = (
      <>
        <span className="flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground group-hover/item:border-primary/40 group-hover/item:text-primary">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-foreground">{def.label}</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{def.description}</span>
        </span>
      </>
    );
    // Close the <details> after selecting so the menu doesn't linger.
    const close = (e: { currentTarget: HTMLElement }) =>
      (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
    if (onSelectView && def.view) {
      const view = def.view;
      return (
        <button key={def.href} type="button" className={cls} onClick={e => { close(e); onSelectView(view); }}>
          {content}
        </button>
      );
    }
    return <a key={def.href} href={def.href} className={cls}>{content}</a>;
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-1.5 border-b bg-card/90 px-2.5 backdrop-blur-sm sm:h-16 sm:gap-4 sm:px-5">
      {/* No aria-label: the visible text ("Flag Paths · Mobility atlas") IS the
          accessible name — an override that omits it fails WCAG 2.5.3. */}
      <a href="/" className="flex min-w-0 items-center gap-2.5">
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
        {item(ATLAS)}
        <details ref={browseRef} className="group relative">
          <summary
            className={cn(itemClass(browseActive), 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}
            aria-current={browseActive ? 'page' : undefined}
          >
            Browse
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" aria-hidden />
            <Underline show={browseActive} />
          </summary>
          <div className="absolute left-0 top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-1rem)] rounded-lg border bg-card p-1.5 shadow-xl">
            <p className="px-2.5 pb-1.5 pt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Browse the research</p>
            {BROWSE_ITEMS.map(browseItem)}
          </div>
        </details>
        {item(PLANNER)}
      </nav>
      {right && <div className="ml-auto flex shrink-0 items-center gap-0.5">{right}</div>}
    </header>
  );
}

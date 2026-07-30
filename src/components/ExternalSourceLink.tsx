import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Anchor for source citations. Sources always leave the site, so they open in a
 * new tab and wear the external-link glyph — a reader scanning a route card can
 * tell a government source from internal navigation before clicking.
 */
export function ExternalSourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow noreferrer noopener"
      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
    >
      {children}
      <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
    </a>
  );
}

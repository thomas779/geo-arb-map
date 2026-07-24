import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Delay the slide-up so the map's zoom-to-selection reads first (the
// "purposeful latency"). Drag the handle down past the threshold to dismiss.
const REVEAL_DELAY_MS = 150;
const DISMISS_THRESHOLD_PX = 110;

/**
 * Mobile-only bottom sheet: the map (zoomed to the selection) peeks above a
 * light scrim, and this slides up from the bottom. Draggable by the grab
 * handle — release past the threshold to dismiss, otherwise it snaps back.
 */
export function MobileDetailSheet({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const endDrag = (dismiss: boolean) => {
    startY.current = null;
    setDragging(false);
    setDrag(0);
    if (dismiss) onDismiss();
  };

  return (
    <div className="absolute inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close details"
        onClick={onDismiss}
        className={cn(
          'absolute inset-0 bg-background/30 transition-opacity duration-300 motion-reduce:transition-none',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        className="absolute inset-x-0 bottom-0 top-[36%] flex flex-col overflow-hidden rounded-t-2xl border-t bg-background shadow-2xl will-change-transform"
        style={{
          transform: open ? `translateY(${drag}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : 'transform 0.3s ease-out',
        }}
      >
        <div
          role="button"
          aria-label="Drag down to close"
          className="flex shrink-0 cursor-grab touch-none justify-center py-2.5 active:cursor-grabbing"
          onPointerDown={event => {
            startY.current = event.clientY;
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (startY.current !== null) setDrag(Math.max(0, event.clientY - startY.current));
          }}
          onPointerUp={() => endDrag(drag > DISMISS_THRESHOLD_PX)}
          onPointerCancel={() => endDrag(false)}
        >
          <span className="h-1 w-9 rounded-full bg-border" aria-hidden />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STEPS = [
  {
    target: '[data-tour="country-search"]',
    eyebrow: 'Start with a place',
    title: 'Find a country',
    body: 'Search by name, then open its citizenship, residence, and regional rights.',
  },
  {
    target: '[data-tour="route-start"]',
    eyebrow: 'Start with an outcome',
    title: 'Choose how you want to move',
    body: 'Pick a route and the atlas will highlight countries worth opening next.',
  },
  {
    target: '[data-tour="map"]',
    eyebrow: 'Read the result',
    title: 'Open any country',
    body: 'Click a country to open its guide. After you choose a route, the map highlights the countries that match.',
  },
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStepChange: (step: number) => void;
}

interface Placement {
  focus: { left: number; top: number; width: number; height: number };
  card: { left: number; top: number; width: number };
}

const CARD_WIDTH = 320;
const EDGE = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function visibleTarget(selector: string): Element | null {
  return Array.from(document.querySelectorAll(selector))
    .find(element => element.getClientRects().length > 0) ?? null;
}

function measure(target: Element, step: number): Placement {
  const rect = target.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(CARD_WIDTH, viewportWidth - EDGE * 2);

  const focus = step === 2
    ? {
        left: clamp(rect.left + rect.width * 0.2, EDGE, viewportWidth - EDGE - Math.min(420, rect.width * 0.58)),
        top: clamp(rect.top + rect.height * 0.15, EDGE, viewportHeight - EDGE - Math.min(260, rect.height * 0.55)),
        width: Math.min(420, rect.width * 0.58),
        height: Math.min(260, rect.height * 0.55),
      }
    : {
        left: rect.left - 5,
        top: rect.top - 5,
        width: rect.width + 10,
        height: rect.height + 10,
      };

  let left = focus.left + focus.width + 14;
  let top = focus.top;
  if (left + width > viewportWidth - EDGE) {
    left = clamp(focus.left, EDGE, viewportWidth - width - EDGE);
    top = focus.top + focus.height + 14;
  }
  if (top + 220 > viewportHeight - EDGE) {
    top = focus.top - 220 - 14;
  }

  return {
    focus,
    card: {
      left: clamp(left, EDGE, viewportWidth - width - EDGE),
      top: clamp(top, EDGE, viewportHeight - 220 - EDGE),
      width,
    },
  };
}

export function AtlasTour({ open, onOpenChange, onStepChange }: Props) {
  const [step, setStep] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    onStepChange(0);
  }, [open, onStepChange]);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = visibleTarget(STEPS[step].target);
        if (target) setPlacement(measure(target, step));
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = new ResizeObserver(update);
    const target = visibleTarget(STEPS[step].target);
    if (target) observer.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    requestAnimationFrame(() => cardRef.current?.focus());
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, onOpenChange, step]);

  if (!open || !placement) return null;

  const current = STEPS[step];
  const move = (next: number) => {
    setPlacement(null);
    setStep(next);
    onStepChange(next);
  };

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Atlas tour">
      <button
        type="button"
        aria-label="Exit Atlas tour"
        className="absolute inset-0 cursor-default"
        onClick={() => onOpenChange(false)}
      />
      <div
        className="pointer-events-none fixed rounded-lg border-2 border-primary bg-transparent transition-[left,top,width,height] duration-200 motion-reduce:transition-none"
        style={{
          ...placement.focus,
          boxShadow: '0 0 0 9999px color-mix(in srgb, var(--background) 72%, transparent), 0 0 0 5px color-mix(in srgb, var(--primary) 16%, transparent)',
        }}
        aria-hidden
      />
      <div
        ref={cardRef}
        tabIndex={-1}
        className="fixed overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl outline-none"
        style={placement.card}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((item, index) => (
              <span key={item.title} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'size-2 rounded-full border transition-colors',
                    index <= step ? 'border-primary bg-primary' : 'border-muted-foreground/50 bg-background',
                  )}
                />
                {index < STEPS.length - 1 && (
                  <span className={cn('h-px w-5', index < step ? 'bg-primary' : 'bg-border')} />
                )}
              </span>
            ))}
          </div>
          <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            {step + 1} / {STEPS.length}
          </span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label="Close tour">
            <X aria-hidden />
          </Button>
        </div>
        <div className="px-4 py-4">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">{current.eyebrow}</p>
          <h2 className="mt-1 font-heading text-xl font-semibold tracking-[-0.02em]">{current.title}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{current.body}</p>
        </div>
        <div className="flex items-center gap-2 border-t px-3 py-3">
          {step > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => move(step - 1)}>
              <ArrowLeft aria-hidden /> Back
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            onClick={() => step === STEPS.length - 1 ? onOpenChange(false) : move(step + 1)}
          >
            {step === STEPS.length - 1 ? 'Start exploring' : 'Next'}
            {step < STEPS.length - 1 && <ArrowRight aria-hidden />}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

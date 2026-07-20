import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RouteField } from '@/components/RouteField';

interface Props {
  onBackToAtlas: () => void;
}

const futureCapabilities = [
  {
    title: 'Your context',
    body: 'Citizenship, residence, family, education, work, and the other facts you choose to add.',
  },
  {
    title: 'Reviewed pathways',
    body: 'Suggestions connected to monitored rules, primary sources, and visible confidence.',
  },
  {
    title: 'Relevant updates',
    body: 'Changes filtered to the countries and routes that actually affect your plans.',
  },
];

export function PlannerPreview({ onBackToAtlas }: Props) {
  return (
    <div className="cartographic-surface absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col justify-center px-4 py-10 sm:px-8 sm:py-16 lg:px-12">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] lg:gap-14">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Planner · later release
            </p>
            <h2 className="mt-4 max-w-[760px] text-balance text-4xl font-bold leading-[1.03] tracking-[-0.035em] sm:text-5xl lg:text-6xl">
              The atlas comes first.
              <span className="block text-muted-foreground">Personal routes come next.</span>
            </h2>
            <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Flag Paths is a public map of citizenship, residence, and mobility
              rules. A later planner release will turn the facts you choose to share
              into source-backed routes worth investigating.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="min-h-11 gap-2">
                <a
                  href="https://t.me/flagpaths"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Send aria-hidden />
                  Get country updates
                </a>
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="min-h-11 bg-card/70 text-foreground hover:bg-accent"
                onClick={onBackToAtlas}
              >
                Explore the atlas
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              No account is needed to use the atlas today.
            </p>
          </div>

          <RouteField />
        </div>

        <div className="mt-12 grid border-y border-border/80 sm:grid-cols-3 lg:mt-16">
          {futureCapabilities.map((item, index) => (
            <div
              key={item.title}
              className={
                index === 0
                  ? 'py-6 sm:pr-6'
                  : 'border-t py-6 sm:border-t-0 sm:border-l sm:px-6'
              }
            >
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

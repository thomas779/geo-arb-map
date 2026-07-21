import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RouteField } from '@/components/RouteField';
import type { BlocsData } from '@/types';

interface Props {
  data: BlocsData;
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

const CARTOGRAPHIC_BLOCS = new Set(['eu_eea', 'mercosur', 'asean']);

export function PlannerPreview({ data, onBackToAtlas }: Props) {
  const regions = data.blocs
    .filter(bloc => CARTOGRAPHIC_BLOCS.has(bloc.id))
    .map(bloc => ({
      id: bloc.id,
      isos: bloc.members.map(member => member.iso_n3),
    }));

  return (
    <div className="planner-preview cartographic-surface absolute inset-0 overflow-x-hidden overflow-y-auto lg:overflow-y-hidden">
      <RouteField
        regions={regions}
        className="pointer-events-none absolute inset-0 hidden h-full !aspect-auto lg:block"
        cover
      />
      <RouteField
        regions={regions}
        compact
        className="planner-preview-compact-routes pointer-events-none absolute z-0 !aspect-auto lg:hidden"
      />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] hidden w-[64%] bg-gradient-to-r from-background/95 via-background/75 to-transparent lg:block" />

      <div className="planner-preview-layout relative z-10 mx-auto flex min-h-full w-full max-w-[1120px] flex-col justify-center px-4 py-10 sm:px-8 sm:py-12 lg:h-full lg:min-h-0 lg:justify-start lg:px-12 lg:py-6">
        <div className="planner-preview-hero relative lg:flex lg:min-h-0 lg:flex-1 lg:items-center">

          <div className="planner-preview-copy relative z-10 max-w-[680px]">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Planner · later release
            </p>
            <h2 className="planner-preview-title mt-4 max-w-[760px] text-balance text-4xl font-bold leading-[1.03] tracking-[-0.035em] sm:text-5xl lg:text-6xl">
              The atlas comes first.
              <span className="block text-muted-foreground">Personal routes come next.</span>
            </h2>
            <p className="planner-preview-body mt-6 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Flag Paths is a public map of citizenship, residence, and mobility
              rules. A later planner release will turn the facts you choose to share
              into source-backed routes worth investigating.
            </p>
            <div className="planner-preview-actions mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="min-h-11 gap-2">
                <a
                  href="https://t.me/flagpaths"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Send aria-hidden />
                  Join for updates
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
            <p className="planner-preview-note mt-3 text-xs text-muted-foreground">
              No account is needed to use the atlas today.
            </p>
          </div>

        </div>

        <div className="planner-preview-capabilities relative z-10 mt-12 grid shrink-0 border-y border-border/80 bg-background/55 backdrop-blur-[2px] sm:grid-cols-3 lg:mt-4">
          {futureCapabilities.map((item, index) => (
            <div
              key={item.title}
              className={
                index === 0
                  ? 'planner-preview-capability py-6 sm:pr-6 lg:py-4'
                  : 'planner-preview-capability border-t py-6 sm:border-t-0 sm:border-l sm:px-6 lg:py-4'
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

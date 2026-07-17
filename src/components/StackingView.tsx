import type { BlocsData } from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { displayColor } from '@/lib/color';
import { useTheme } from '@/components/theme-provider';
import { MyFlags } from '@/components/MyFlags';
import type { Profile } from '@/lib/planner';

interface Props {
  data: BlocsData;
  /** null = plain back-to-map; a bloc id = back to map with that bloc selected */
  onBlocSelect: (blocId: string | null) => void;
  profile: Profile;
  onProfileChange: (profile: Profile) => void;
}

export function StackingView({ data, onBlocSelect, profile, onProfileChange }: Props) {
  const dark = useTheme().theme === 'dark';
  const blocById = new Map(data.blocs.map(b => [b.id, b]));

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background px-7 py-6">
      <h2 className="mb-6 text-xl font-bold">Planner</h2>

      <MyFlags data={data} profile={profile} onChange={onProfileChange} />

      <div className="mt-10 mb-3 flex items-baseline gap-3 border-t pt-6">
        <h3 className="text-base font-bold">Example paths</h3>
        <span className="text-xs text-muted-foreground">curated stacking plays for inspiration</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {data.stacking_plays.map(play => (
          <Card key={`${play.passport}-${play.timeline}`} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-[17px]">{play.passport}</CardTitle>
              <Badge variant="outline" className="h-auto max-w-full whitespace-normal text-[11px] leading-snug tabular-nums text-primary">
                {play.timeline}
              </Badge>
            </CardHeader>
            <CardContent className="px-4">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {play.blocs.map(blocId => {
                  const b = blocById.get(blocId);
                  if (!b) return null;
                  return (
                    <button
                      key={blocId}
                      className="cursor-pointer rounded-[5px] px-2 py-0.5 text-[11px] font-medium text-white opacity-90 transition-[opacity,transform] hover:-translate-y-px hover:opacity-100"
                      style={{ background: displayColor(b.color, dark) }}
                      onClick={() => onBlocSelect(blocId)}
                    >
                      {b.name}
                    </button>
                  );
                })}
              </div>
              <div className="border-t pt-2.5 text-xs leading-snug text-muted-foreground">
                {play.footprint}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 max-w-[720px] border-t pt-5">
        <Accordion type="multiple">
          {data.meta.excluded && data.meta.excluded.length > 0 && (
            <AccordionItem value="excluded">
              <AccordionTrigger className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Evaluated &amp; excluded ({data.meta.excluded.length})
              </AccordionTrigger>
              <AccordionContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  Arrangements checked against the same criteria and deliberately left off the map:
                </p>
                <div className="flex flex-col gap-2">
                  {data.meta.excluded.map(x => (
                    <div key={x.name} className="text-xs leading-relaxed text-muted-foreground">
                      <b className="font-semibold text-foreground">{x.name}</b> — {x.reason}
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
          {data.pending_verification && data.pending_verification.length > 0 && (
            <AccordionItem value="pending">
              <AccordionTrigger className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Pending verification ({data.pending_verification.length})
              </AccordionTrigger>
              <AccordionContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  Researched arrangements below the confidence bar — stored but not shown on the map:
                </p>
                <div className="flex flex-col gap-2">
                  {data.pending_verification.map(p => (
                    <div key={p.id} className="text-xs leading-relaxed text-muted-foreground">
                      <b className="font-semibold text-foreground">{p.name}</b>{' '}
                      <Badge variant="outline" className="mx-1 text-[9.5px]">
                        {p.confidence}
                      </Badge>
                      — {p.reason}
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </div>
    </div>
  );
}

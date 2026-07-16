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

interface Props {
  data: BlocsData;
  /** null = plain back-to-map; a bloc id = back to map with that bloc selected */
  onBlocSelect: (blocId: string | null) => void;
}

export function StackingView({ data, onBlocSelect }: Props) {
  const blocById = new Map(data.blocs.map(b => [b.id, b]));

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background px-7 py-6">
      <div className="mb-6 flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => onBlocSelect(null)}>
          ← Back to Map
        </Button>
        <h2 className="text-xl font-bold">Stacking Plays</h2>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {data.stacking_plays.map(play => (
          <Card key={`${play.passport}-${play.timeline}`} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-[17px]">{play.passport}</CardTitle>
              <Badge variant="outline" className="w-fit text-[11px] tabular-nums text-primary">
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
                      style={{ background: b.color }}
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

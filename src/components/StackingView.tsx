import { FlaskConical } from 'lucide-react';
import type { AtlasIndexData, BlocsData } from '../types';
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
import type { GraphEdge } from '@/lib/pathfinder';

interface Props {
  data: BlocsData;
  /** null = plain back-to-map; a bloc id = back to map with that bloc selected */
  onBlocSelect: (blocId: string | null) => void;
  profile: Profile;
  onProfileChange: (profile: Profile) => void;
  onOpenPrivacy: () => void;
  /** The status graph. null = still loading, or the fetch failed (see graphFailed). */
  edges: GraphEdge[] | null;
  /** The graph fetch failed. Distinguished from loading so the empty state is honest. */
  graphFailed?: boolean;
  citizenshipRoutes: AtlasIndexData | null;
  /** Return to the preview page. An opt-in the reader cannot leave is a trap. */
  onLeaveBeta: () => void;
}

export function StackingView({
  data,
  onBlocSelect,
  profile,
  onProfileChange,
  onOpenPrivacy,
  edges,
  graphFailed = false,
  citizenshipRoutes,
  onLeaveBeta,
}: Props) {
  const dark = useTheme().theme === 'dark';
  const blocById = new Map(data.blocs.map(b => [b.id, b]));

  return (
    <div className="cartographic-surface absolute inset-0 overflow-y-auto px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-7 sm:py-6">
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">Mobility planner</h2>
          <Badge variant="outline" className="gap-1 text-xs font-semibold uppercase tracking-wide">
            <FlaskConical className="size-2.5" aria-hidden />
            Prototype
          </Badge>
          <Button variant="ghost" size="xs" className="ml-auto text-xs text-muted-foreground" onClick={onLeaveBeta}>
            Leave the prototype
          </Button>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Build a private profile, find a path, and watch the rules that affect it. Routes are
          solved over the mapped graph, so the answer is only as complete as the map: every step
          says whether the grant is automatic, whose status unlocked it, and which facts came from
          you rather than from a source. Not legal advice.
        </p>
      </div>

      {/* An empty planner has two very different causes and must not present them
          as one. A graph that failed to load produces the same silence as a
          profile with no mapped route, and only one of those is about the user. */}
      {edges === null && (
        <div
          role={graphFailed ? 'alert' : undefined}
          className="mb-4 rounded-lg border border-dashed px-3 py-2.5 text-xs leading-relaxed text-muted-foreground sm:mb-6"
        >
          {graphFailed
            ? 'The route graph failed to load, so multi-step plans are unavailable. Single-hop suggestions below still work; reload to try again.'
            : 'Loading the route graph — multi-step plans appear once it arrives.'}
        </div>
      )}

      <MyFlags
        data={data}
        edges={edges}
        citizenshipRoutes={citizenshipRoutes}
        profile={profile}
        onChange={onProfileChange}
        onOpenPrivacy={onOpenPrivacy}
      />

      <div className="mt-6 max-w-[1200px]">
        <Accordion type="multiple">
          {data.stacking_plays.length > 0 && (
            <AccordionItem value="examples">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline">
                Research examples ({data.stacking_plays.length})
              </AccordionTrigger>
              <AccordionContent>
                <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  Editorial examples for comparison. They are not recommendations and do not use your profile.
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 sm:gap-4">
                  {data.stacking_plays.map(play => (
                    <Card key={`${play.passport}-${play.timeline}`} className="gap-2 py-4">
                      <CardHeader className="px-4">
                        <CardTitle className="flex items-center gap-2 font-sans text-base">
                          {play.passport}
                          {profile.flags.some(f => play.passport.toLowerCase().includes(f.name.toLowerCase())) && (
                            <Badge variant="verified" className="text-xs font-semibold uppercase">In your profile</Badge>
                          )}
                        </CardTitle>
                        <Badge variant="outline" className="h-auto max-w-full whitespace-normal text-xs leading-snug tabular-nums">
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
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs font-medium hover:bg-accent"
                                onClick={() => onBlocSelect(blocId)}
                              >
                                <span className="size-2 rounded-full" style={{ background: displayColor(b.color, dark) }} aria-hidden />
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
              </AccordionContent>
            </AccordionItem>
          )}
          {data.meta.excluded && data.meta.excluded.length > 0 && (
            <AccordionItem value="excluded">
              <AccordionTrigger className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
              <AccordionTrigger className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                      <Badge variant="outline" className="mx-1 text-xs">
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

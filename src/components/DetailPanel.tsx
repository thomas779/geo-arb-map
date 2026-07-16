import type { AppState, BilateralLane, Bloc, BlocsData } from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  data: BlocsData;
  state: AppState;
  onClose: () => void;
}

function Rung({ tier, text }: { tier: string; text: string }) {
  return (
    <div className="rung">
      <span className="tier">{tier}</span>
      <p>{text}</p>
    </div>
  );
}

function BlocCard({ bloc, iso, former }: { bloc: Bloc; iso: string; former: boolean }) {
  const inSubBloc = !former && bloc.sub_bloc?.members_iso.includes(iso);
  return (
    <Card className="mb-3 gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 font-sans text-sm">
          <span className="chip" style={{ background: bloc.color }} />
          <span className="min-w-0 flex-1">{bloc.name}</span>
          {former && (
            <Badge variant="outline" className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
              former member
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {inSubBloc && (
          <div className="mb-2 rounded-md bg-primary/10 px-2 py-1.5 text-[11px] text-primary">
            ✦ {bloc.sub_bloc!.name}: full free movement among these members
          </div>
        )}
        <Rung tier="TR" text={bloc.rights.TR} />
        <Rung tier="PR" text={bloc.rights.PR} />
        <Rung tier="CIT" text={bloc.rights.CIT} />
        <div className="mt-2 border-t pt-2 text-[11.5px] leading-snug text-muted-foreground">
          <b className="font-semibold text-foreground">Fastest entry:</b> {bloc.fastest_entry}
        </div>
        {bloc.notes && (
          <div className="mt-2 border-t border-dashed pt-2 text-[11px] italic leading-snug text-muted-foreground">
            {bloc.notes}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LaneCard({ lane, inbound, countryName }: { lane: BilateralLane; inbound: boolean; countryName: string }) {
  return (
    <Card className="mb-3 gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 font-sans text-sm">
          <span className="chip" style={{ background: lane.color }} />
          <span className="min-w-0 flex-1">{lane.name}</span>
          <Badge variant={lane.leads_to_settlement ? 'default' : 'secondary'} className="font-mono text-[9.5px] uppercase">
            {lane.leads_to_settlement ? '→ settlement path' : 'work access only'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="mb-2 font-mono text-[10.5px] text-muted-foreground">
          {inbound
            ? `Inbound lane — privileged access into ${countryName}`
            : `Outbound lane — access to ${lane.destination.name}`}
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {lane.allocation && lane.allocation !== 'right' && (
            <Badge variant="outline" className="font-mono text-[10px] text-primary">
              ⚄ not guaranteed — {lane.allocation.replace('_', ' ')}
            </Badge>
          )}
          {lane.renounces_previous && (
            <Badge variant="destructive" className="font-mono text-[10px]">
              ⚠ requires renouncing prior citizenship
            </Badge>
          )}
        </div>
        <Rung tier="GET" text={lane.grants} />
        <Rung tier="BUT" text={lane.limits} />
        {lane.beneficiaries_note && (
          <div className="mt-2 border-t border-dashed pt-2 text-[11px] italic leading-snug text-muted-foreground">
            {lane.beneficiaries_note}
          </div>
        )}
        {(lane.confidence || lane.volatility) && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-dashed pt-2">
            {lane.confidence && (
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                confidence: {lane.confidence}
              </Badge>
            )}
            {lane.volatility && (
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                volatility: {lane.volatility}
              </Badge>
            )}
          </div>
        )}
        {lane.sources && lane.sources.length > 0 && (
          <div className="mt-1.5 text-[10px] leading-snug text-muted-foreground/80">
            Sources: {lane.sources.join('; ')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DetailPanel({ data, state, onClose }: Props) {
  const iso = state.country!;
  const blocs = data.blocs.filter(b => b.members.some(m => m.iso_n3 === iso));
  const formerBlocs = data.blocs.filter(b => b.former_members?.some(m => m.iso_n3 === iso));
  const lanesIn = data.bilateral_lanes.filter(l => l.destination.iso_n3 === iso);
  const lanesOut = data.bilateral_lanes.filter(l => l.beneficiaries.some(m => m.iso_n3 === iso));

  const nameFromData = data.blocs
    .flatMap(b => [...b.members, ...(b.former_members ?? [])])
    .find(m => m.iso_n3 === iso)?.name;
  const countryName = state.countryName ?? nameFromData ?? iso;

  const laneCount = lanesIn.length + lanesOut.length;
  const total = blocs.length + formerBlocs.length + laneCount;
  const subtitle = total
    ? [
        blocs.length ? `${blocs.length} bloc membership${blocs.length !== 1 ? 's' : ''}` : '',
        formerBlocs.length ? `${formerBlocs.length} former` : '',
        laneCount ? `${laneCount} fast lane${laneCount !== 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(' · ')
    : 'No mapped bloc membership';

  return (
    <section className="w-[330px] shrink-0 overflow-y-auto border-l px-4 pt-4 pb-8">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-xl font-semibold">{countryName}</h2>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onClose}>
          ×
        </Button>
      </div>
      <div className="mb-3 text-xs text-muted-foreground">{subtitle}</div>

      {!total && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          This country isn't part of any mapped settlement bloc. Its citizens rely on
          bilateral visa arrangements only.
        </p>
      )}

      {blocs.map(b => <BlocCard key={b.id} bloc={b} iso={iso} former={false} />)}
      {formerBlocs.map(b => <BlocCard key={b.id} bloc={b} iso={iso} former={true} />)}

      {lanesIn.length > 0 && (
        <div className="mt-4 mb-2 font-mono text-[10.5px] uppercase tracking-[1.4px] text-muted-foreground">
          Fast lanes into {countryName}
        </div>
      )}
      {lanesIn.map(l => <LaneCard key={l.id} lane={l} inbound={true} countryName={countryName} />)}

      {lanesOut.length > 0 && (
        <div className="mt-4 mb-2 font-mono text-[10.5px] uppercase tracking-[1.4px] text-muted-foreground">
          Fast-lane access elsewhere
        </div>
      )}
      {lanesOut.map(l => <LaneCard key={l.id} lane={l} inbound={false} countryName={countryName} />)}
    </section>
  );
}

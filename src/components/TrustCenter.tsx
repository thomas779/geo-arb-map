import { useEffect, useState } from 'react';
import {
  BookOpen, Database, ExternalLink, FileCheck2, GitPullRequest,
  Landmark, LockKeyhole, MessageSquare, ScanSearch, Server, ShieldCheck,
  Monitor, Trash2, TriangleAlert, UserRoundCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  dataCorrectionUrl, METHODOLOGY_URL, productFeedbackUrl,
} from '@/lib/trust';
import type { TrustSection } from '@/url';

interface Props {
  open: boolean;
  section: TrustSection;
  dataStatus: DataStatus;
  hasProfile: boolean;
  onOpenChange: (open: boolean) => void;
  onSectionChange: (section: TrustSection) => void;
  onClearProfile: () => void;
}

interface DataStatus {
  updatedAt: string;
  jurisdictions: number;
  applicableJurisdictions: number;
  reviewedJurisdictions: number;
  reviewedModes: number;
  totalModes: number;
  countryRules: number;
}

const sections: Array<{
  id: TrustSection;
  label: string;
  detail: string;
  icon: typeof BookOpen;
}> = [
  { id: 'methodology', label: 'Methodology', detail: 'How data is checked', icon: BookOpen },
  { id: 'privacy', label: 'Privacy', detail: 'What stays private', icon: LockKeyhole },
  { id: 'limitations', label: 'Limitations', detail: 'Where to verify', icon: TriangleAlert },
];

const evidenceSteps = [
  { label: 'Sources', icon: Database },
  { label: 'Review', icon: ScanSearch },
  { label: 'Release', icon: FileCheck2 },
];

function Methodology({ dataStatus }: { dataStatus: DataStatus }) {
  const coveragePercent = dataStatus.applicableJurisdictions > 0
    ? Math.round((dataStatus.reviewedJurisdictions / dataStatus.applicableJurisdictions) * 100)
    : 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Data passport</p>
        <h3 className="mt-1 font-heading text-xl font-semibold">What is live, and how much has been checked.</h3>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        {[
          ['Updated', dataStatus.updatedAt, 'Latest published activity'],
          ['Tracked', dataStatus.jurisdictions.toLocaleString(), 'Jurisdictions'],
          ['Reviewed', dataStatus.reviewedJurisdictions.toLocaleString(), 'Complete countries'],
          ['Rules', dataStatus.countryRules.toLocaleString(), 'Country records'],
        ].map(([label, value, detail]) => (
          <div key={label} className="bg-card px-3 py-3.5">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground">{detail}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-background/45 p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold">Reviewed coverage</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {dataStatus.reviewedJurisdictions} of {dataStatus.applicableJurisdictions} countries and territories fully reviewed
            </p>
          </div>
          <span className="font-mono text-sm font-semibold text-primary">{coveragePercent}%</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${coveragePercent}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-3 rounded-lg border bg-background/50 px-2 py-3">
        {evidenceSteps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={step.label} className="relative flex min-w-0 flex-col items-center gap-1.5 text-center">
              {index < evidenceSteps.length - 1 && (
                <span className="absolute top-3.5 left-[calc(50%+16px)] h-px w-[calc(100%-32px)] bg-primary/40" />
              )}
              <span className="relative grid size-7 place-items-center rounded-full border bg-card text-muted-foreground">
                <Icon className="size-3.5" aria-hidden />
              </span>
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          ['Scope', 'Citizenship, residence, and privileged mobility.'],
          ['Evidence', 'Official sources first; uncertain claims stay unpublished.'],
          ['Meaning', 'Updated is release activity. Reviewed is explicit coverage.'],
        ].map(([title, text]) => (
          <div key={title} className="rounded-md border border-dashed p-3">
            <h4 className="text-xs font-semibold">{title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>

      <a
        href={METHODOLOGY_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        Read the technical data workflow <ExternalLink className="size-3" aria-hidden />
      </a>
    </div>
  );
}

function Privacy({
  hasProfile,
  onClearProfile,
}: {
  hasProfile: boolean;
  onClearProfile: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!hasProfile) setConfirming(false);
  }, [hasProfile]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Local by default
        </p>
        <h3 className="mt-1 font-heading text-xl font-semibold">Your mobility profile stays in this browser.</h3>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center overflow-hidden rounded-lg border bg-background/45 p-4 text-center">
        <div className="grid justify-items-center gap-2">
          <span className="grid size-10 place-items-center rounded-full border bg-card"><Monitor className="size-4" /></span>
          <span className="text-xs font-semibold">This browser</span>
          <span className="text-[10px] text-muted-foreground">Profile facts stay here</span>
        </div>
        <div className="mx-3 flex items-center" aria-hidden>
          <span className="h-px w-5 bg-border sm:w-10" />
          <LockKeyhole className="mx-1 size-3.5 text-verified" />
          <span className="h-px w-5 bg-border sm:w-10" />
        </div>
        <div className="grid justify-items-center gap-2 opacity-55">
          <span className="grid size-10 place-items-center rounded-full border bg-card"><Server className="size-4" /></span>
          <span className="text-xs font-semibold">No profile server</span>
          <span className="text-[10px] text-muted-foreground">Public data downloads only</span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          ['Local profile', 'Citizenship, family facts, and goals remain in local storage.', Monitor],
          ['Normal hosting', 'Cloudflare may receive standard request logs such as IP and browser.', Server],
          ['External links', 'GitHub and source links use those sites’ own privacy policies.', ExternalLink],
        ].map(([title, text, Icon]) => (
          <div key={title as string} className="rounded-md border p-3">
            <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            <h4 className="mt-2 text-xs font-semibold">{title as string}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text as string}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-destructive/30 bg-destructive/[0.035] p-4">
        <div className="flex items-start gap-3">
          <Trash2 className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <h4 className="font-sans text-sm font-semibold">Clear this browser’s profile</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Removes profile facts, goals, watched routes, and the saved Telegram
              preference from this browser. Theme preference is kept.
            </p>
            {!confirming ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={!hasProfile}
                onClick={() => setConfirming(true)}
              >
                <Trash2 /> {hasProfile ? 'Clear my profile' : 'No saved profile'}
              </Button>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="destructive" size="sm" onClick={onClearProfile}>
                  Clear profile now
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Limitations() {
  const limits = [
    ['Rules move', 'Policy and implementation can change before a source is updated.', ScanSearch],
    ['Gaps are visible', 'Missing data means unreviewed—not that no route exists.', Database],
    ['People differ', 'Documents, history, and discretion change eligibility.', UserRoundCheck],
    ['Verify before acting', 'The atlas is research, not legal or tax advice.', Landmark],
  ];
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Read before acting
        </p>
        <h3 className="mt-1 font-heading text-xl font-semibold">A route is a research lead, not a legal conclusion.</h3>
      </div>
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
        {limits.map(([title, text, Icon]) => (
          <div key={title as string} className="bg-card p-4">
            <span className="grid size-8 place-items-center rounded-md border bg-background text-muted-foreground">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <h4 className="mt-3 font-sans text-xs font-semibold text-foreground">{title as string}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text as string}</p>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-verified" aria-hidden />
        <p>Use country cards to inspect sources and review state. Confirm a promising route with the responsible authority or a qualified professional.</p>
      </div>
    </div>
  );
}

export function TrustCenter({
  open,
  section,
  dataStatus,
  hasProfile,
  onOpenChange,
  onSectionChange,
  onClearProfile,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[680px]">
        <SheetHeader className="border-b px-5 py-4 pr-14">
          <SheetTitle className="text-lg">Trust &amp; data</SheetTitle>
          <SheetDescription className="text-xs">
            How the atlas is built, what stays private, and where its conclusions stop.
          </SheetDescription>
        </SheetHeader>

        <nav aria-label="Trust center sections" className="grid grid-cols-3 border-b bg-background/45 px-2">
          {sections.map(item => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                aria-current={active ? 'page' : undefined}
                onClick={() => onSectionChange(item.id)}
                className={cn(
                  'relative flex min-w-0 items-center justify-center gap-2 px-2 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">{item.label}</span>
                  <span className="hidden truncate text-xs sm:block">{item.detail}</span>
                </span>
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" />}
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          {section === 'methodology' && <Methodology dataStatus={dataStatus} />}
          {section === 'privacy' && <Privacy hasProfile={hasProfile} onClearProfile={onClearProfile} />}
          {section === 'limitations' && <Limitations />}
        </div>

        <div className="grid gap-px border-t bg-border sm:grid-cols-2">
          <a
            href={dataCorrectionUrl()}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3 bg-popover px-5 py-4 hover:bg-accent"
          >
            <GitPullRequest className="size-4 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-semibold">Correct the data</span>
              <span className="block text-xs text-muted-foreground">Submit a claim and supporting source</span>
            </span>
            <ExternalLink className="ml-auto size-3 text-muted-foreground group-hover:text-foreground" aria-hidden />
          </a>
          <a
            href={productFeedbackUrl()}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3 bg-popover px-5 py-4 hover:bg-accent"
          >
            <MessageSquare className="size-4 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-semibold">Give product feedback</span>
              <span className="block text-xs text-muted-foreground">Tell us what worked or blocked you</span>
            </span>
            <ExternalLink className="ml-auto size-3 text-muted-foreground group-hover:text-foreground" aria-hidden />
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

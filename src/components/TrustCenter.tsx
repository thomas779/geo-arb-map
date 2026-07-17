import { useEffect, useState } from 'react';
import {
  BookOpen, Check, Database, ExternalLink, GitPullRequest, LockKeyhole,
  MessageSquare, Network, Route, ScanSearch, Trash2, TriangleAlert,
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
  lastReviewed: string;
  hasProfile: boolean;
  onOpenChange: (open: boolean) => void;
  onSectionChange: (section: TrustSection) => void;
  onClearProfile: () => void;
}

const sections: Array<{
  id: TrustSection;
  label: string;
  detail: string;
  icon: typeof BookOpen;
}> = [
  { id: 'methodology', label: 'Methodology', detail: 'How routes are made', icon: BookOpen },
  { id: 'privacy', label: 'Privacy', detail: 'What stays private', icon: LockKeyhole },
  { id: 'limitations', label: 'Limitations', detail: 'Where to verify', icon: TriangleAlert },
];

const evidenceSteps = [
  { label: 'Sources', icon: Database },
  { label: 'Review', icon: ScanSearch },
  { label: 'Graph', icon: Network },
  { label: 'Route', icon: Route },
];

function Methodology({ lastReviewed }: { lastReviewed: string }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Evidence trail
        </p>
        <h3 className="mt-1 font-heading text-xl font-semibold">From a legal claim to a route you can inspect.</h3>
      </div>

      <div className="grid grid-cols-4 rounded-lg border bg-background/50 px-2 py-3">
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

      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        <div>
          <h4 className="font-sans text-sm font-semibold text-foreground">What qualifies for the map</h4>
          <p className="mt-1">
            Flag Paths covers citizenship, immigration residence, privileged
            settlement arrangements, and family facts that can unlock those paths.
            Ordinary travel visas, tax residence, companies, banking, and investments
            are outside the current model.
          </p>
        </div>
        <div>
          <h4 className="font-sans text-sm font-semibold text-foreground">How claims enter the product</h4>
          <p className="mt-1">
            External research is normalized, classified, and reviewed. High-confidence
            settlement claims can enter the live dataset; uncertain records stay visible
            to maintainers as pending verification and do not create deterministic paths.
            Hand-audited exceptions include their reason and sources.
          </p>
        </div>
        <div>
          <h4 className="font-sans text-sm font-semibold text-foreground">How routes are calculated</h4>
          <p className="mt-1">
            The pathfinder treats legal statuses as a graph. It carries acquired and
            retained citizenships through each step, keeps work-only routes terminal,
            and separates rights from ballots, quotas, and discretionary programs.
            Known corrections are protected by tests.
          </p>
        </div>
        <div className="rounded-md border border-dashed px-3 py-3">
          <p className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-verified" aria-hidden />
            <span>
              <b className="font-semibold text-foreground">Dataset reviewed through {lastReviewed}.</b>{' '}
              This is the dataset release date, not a claim that every law changed or was
              individually rechecked that day.
            </span>
          </p>
        </div>
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
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Local by default
        </p>
        <h3 className="mt-1 font-heading text-xl font-semibold">Your mobility profile stays in this browser.</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          There is currently no Flag Paths account or profile backend. Your held
          statuses, birthplace, ancestry, heritage, partner citizenships, goals,
          watchlist, and alert preference are stored in this browser’s local storage.
        </p>
      </div>

      <div className="space-y-3 text-sm leading-relaxed">
        {[
          ['What leaves the browser', 'The app downloads its public datasets. It does not upload your profile. Opening GitHub feedback or source links sends you to that external site under its own privacy practices.'],
          ['Hosting information', 'The hosting provider may receive ordinary request information such as your IP address, browser details, requested page, and time of access.'],
          ['Links and sharing', 'Map and route links should contain public route identifiers only. Profile-shaped demo parameters work only in development, are removed from the address, and are not a public sharing format.'],
          ['Future sync', 'If optional account sync is added, it will require a separate explanation and an explicit choice before any profile facts are stored remotely.'],
        ].map(([title, text]) => (
          <div key={title} className="border-l-2 border-border pl-3">
            <h4 className="font-sans text-sm font-semibold">{title}</h4>
            <p className="mt-0.5 text-muted-foreground">{text}</p>
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
    ['Rules change', 'Immigration and nationality rules can change without warning, and sources may lag implementation.'],
    ['Coverage varies', 'A blank country or missing route can mean it has not been researched to the live-data threshold—not that no route exists.'],
    ['Eligibility is individual', 'Documents, residence history, criminal records, language, income, family circumstances, and administrative discretion can change an outcome.'],
    ['Timelines are estimates', 'Processing and naturalization years are rough planning inputs, not approval or completion dates.'],
    ['Confidence is editorial', 'A confidence label describes the research record; it is not a probability that an application will succeed.'],
    ['Routes simplify reality', 'A graph step identifies a legal mechanism worth investigating. It does not complete prerequisite visas, residence maintenance, filings, or professional review.'],
    ['No tax model', 'The planner does not determine tax residence, domicile, treaty position, company obligations, or investment consequences.'],
    ['No legal advice', 'Use the atlas to discover and compare questions. Verify a promising path with current official sources and a qualified professional before acting.'],
  ];
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Read before acting
        </p>
        <h3 className="mt-1 font-heading text-xl font-semibold">A route is a research lead, not a legal conclusion.</h3>
      </div>
      <div className="divide-y rounded-lg border">
        {limits.map(([title, text]) => (
          <div key={title} className="grid gap-1 px-4 py-3 sm:grid-cols-[130px_1fr] sm:gap-4">
            <h4 className="font-sans text-xs font-semibold text-foreground">{title}</h4>
            <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrustCenter({
  open,
  section,
  lastReviewed,
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
          {section === 'methodology' && <Methodology lastReviewed={lastReviewed} />}
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

# Flag Paths — Public v1 GTM Brief

Status: active launch brief
Date: 2026-07-20
Launch shape: focused public beta presented as v1

## Positioning

**Category:** Global mobility atlas.

**One-line promise:** See how citizenship, residence, and mobility rights connect
across countries.

**Expanded promise:** Explore regional rights, country pathways, and
nationality-specific access in one visual atlas, with sources, uncertainty, and
coverage gaps kept visible.

**Primary audience:** An active mover or global option-builder who wants to understand
how country rules and cross-border arrangements connect.

**Why this wins attention:** Passport rankings flatten mobility into a score. Visa
directories isolate one destination. Flag Paths makes the relationships visible and
lets someone inspect the underlying rules.

**Trust position:** A transparent research and route-discovery tool, not legal advice
and not a promise of eligibility.

## What public v1 must do

A first-time visitor should be able to:

1. Understand the promise without knowing “geo-arbitrage” or Flag Theory.
2. Explore the map without an account.
3. Select a country, region, or route and understand what the highlighting means.
4. Inspect sources, confidence, limitations, and explicit coverage gaps.
5. Join the public Telegram channel for reviewed country and mobility updates.
6. Understand that personalized profiles and planning are a later release.
7. Report an error or give concise feedback without searching for the right channel.

Public v1 does not collect profile facts, offer account sync, or promise personalized
recommendations. The Planner tab is an honest preview and Telegram funnel until the
data coverage, monitoring loop, and profile model are ready.

## The product loop

| Stage | User behavior | Product response | Initial measure |
|---|---|---|---|
| Acquisition | Arrives through a country update, map, or recommendation | Immediately sees a distinctive, explorable atlas | Qualified atlas visits |
| Activation | Selects a country or route and opens its evidence | Explains the mapped rights, limits, and coverage | Country/route inspections; source opens |
| Retention | Joins Telegram for reviewed updates | Publishes concise updates that link back to the atlas | Telegram joins; return visits from updates |
| Referral | Shares a country or route URL | Recipient opens the same public atlas context | Route shares and referred visits |
| Contribution | Flags an error or supplies a source/field note | Acknowledges, reviews, credits, and closes the loop | Useful contributions reaching the product |

Revenue is not a public v1 objective. Do not add pricing or a paid waitlist merely to
make the project resemble SaaS.

## Launch sequence

### Phase 1 — Founder QA

- Complete the critical map, route, and country-detail journeys on desktop and mobile.
- Review the most visible route claims and every homepage example.
- Add privacy, data-method, limitations, feedback, and correction paths.
- Instrument atlas engagement without collecting personal facts in analytics.
- Add error monitoring and a visible deployment/version identifier.

**Exit gate:** No known critical route error or navigation bug; the core atlas journey
works from a fresh browser.

### Phase 2 — Controlled alpha

Invite 10–20 active movers, ancestry seekers, globally minded readers, and rigorous
researchers.

Ask each person to:

- Explore one country or route relevant to them.
- Explain what they expected to see.
- Identify the first confusing or untrusted claim.
- Decide whether the Telegram updates are worth following.

Conduct short conversations rather than relying only on surveys.

**Exit gate:** At least 8 complete the core journey; failures are understood; several
find a rule or cross-border relationship they did not already know.

### Phase 3 — Public beta / v1

Release publicly with honest beta language around data coverage and monitoring.

- Publish a short founder story and one product demo.
- Use three to five concrete route examples, not a giant feature inventory.
- Personally recruit the first wave from relevant communities and creators.
- Ship a weekly public changelog during the launch window.
- Reply quickly to every credible correction and visible trust question.

**Exit gate:** Atlas engagement, Telegram joins, return visits, and useful corrections
grow beyond the founder's direct network; the planner roadmap can be informed by
observed demand.

## Channel plan

### Owned

- The product and its route-specific URLs.
- GitHub for the code, data, correction trail, and technical contributors.
- A concise project changelog.
- Telegram broadcast only when there are real reviewed changes to publish.
- Email only if account sync or a deliberately requested digest exists.

### Borrowed

- Small geo-arbitrage, digital-nomad, ancestry, expat, and international-family
  newsletters, podcasts, creators, and communities.
- The best ask is a real route demonstration for their audience, not a generic product
  mention.
- Give the host a specific, source-backed example and a redacted route link.

### Rented

- Reddit and specialist forums where a route genuinely answers an existing question.
- X/LinkedIn founder posts showing how one non-obvious path works.
- Hacker News, Product Hunt, or similar launch sites only after the core journey and
  correction workflow are ready for concentrated scrutiny.

Use the public Telegram channel as the reviewed-update feed. Do not open an empty
Discord or discussion group merely to claim a community exists. The separate
[`community-strategy.md`](community-strategy.md) describes how discussion can follow
once the broadcast has a useful rhythm.

## Launch narrative and assets

Lead with the problem and one surprising route:

1. Important geographic options are often hidden across citizenship, ancestry,
   partnership, and treaty rules.
2. Existing tools rank passports or isolate one destination rather than showing how
   the systems connect.
3. Flag Paths makes those relationships explorable and links them to evidence.
4. The data and uncertainty are open; the result is a research starting point, not
   legal advice.

Minimum launch assets:

- A 30–60 second screen recording of map → country → route → source.
- Three source-backed route examples covering different input types.
- One desktop and one mobile screenshot.
- A public “how the data works” link.
- A privacy summary and a prominent correction link.
- A simple founder post that asks people to explore a relevant country or route, not
  merely upvote.

## Metrics for the first 30 days

Use directional evidence, not vanity targets. Establish a baseline for:

- Country and route inspections per qualified visit.
- Time to first country or route detail.
- Telegram joins attributable to the atlas.
- Percentage of visitors who open sources or limitations.
- Public route shares and referred visits.
- Feedback and corrections, separated into usability, coverage, and factual accuracy.
- Return visits attributable to Telegram updates.

Analytics events must describe public product actions and must not collect personal
mobility facts.

## Identity decision for v1

Public v1 has no account requirement and no profile storage. Identity work resumes with
the personalized planner release, after the profile model and monitoring value are
validated. That release should still use progressive identity: demonstrate value
locally first, then offer optional save and sync.

## Release checklist

### Product and trust

- [ ] Core desktop and mobile journey passes from a fresh browser.
- [ ] Deterministic, chance-based, unsupported, and low-confidence claims are visibly
      distinct.
- [ ] Source, confidence, verification date, and data limitations are reachable.
- [ ] Feedback and factual-correction paths work.
- [ ] “Not legal advice” is prominent without overwhelming the value proposition.
- [ ] No dead-end buttons imply that alerts, accounts, or community features are live.

### Privacy and operations

- [ ] Plain-language privacy summary states that public v1 collects no profile facts.
- [ ] Analytics contain no personal mobility facts.
- [ ] Error monitoring and deployment rollback are ready.
- [ ] If accounts ship: export, deletion, sign-out, access policies, and auth callback
      failures are tested.
- [ ] If Apple ships: web secret rotation has an owner and reminder.
- [ ] A correction-response and urgent-data-removal process has an owner.

### Launch

- [ ] Controlled-alpha feedback is synthesized.
- [ ] Demo, screenshots, route examples, and founder post are prepared.
- [ ] The first ten relevant people or communities are identified individually.
- [ ] A public changelog and launch-week response schedule exist.
- [ ] The one metric that determines the next build is named: qualified Telegram joins
      per engaged atlas visitor.

## Immediate build order

1. Establish D1 as the reviewed authoring source and compile immutable public
   release assets from it.
2. Fill the most useful country coverage in evidence-backed review batches so
   the Atlas has a credible baseline.
3. Complete the reviewed-change → website → Telegram publication loop.
4. Add privacy-safe atlas and Telegram-conversion analytics.
5. Run the controlled alpha and fix the dominant exploration failure.
6. Revisit profiles, account sync, and personalized planning only after the atlas and
   monitoring loop show demand.

# Flag Paths — Public v1 GTM Brief

Status: working launch brief  
Date: 2026-07-17  
Launch shape: focused public beta presented as v1

## Positioning

**Category:** Global mobility pathfinder.

**One-line promise:** Find the citizenship and residence paths hidden in your profile.

**Expanded promise:** Add what you hold, the family facts that matter, and where you
want to go. Flag Paths maps the rights and multi-step routes worth investigating,
with sources and uncertainty kept visible.

**Primary audience:** An active mover or global option-builder who has a destination
or a family fact in mind but cannot turn fragmented immigration information into a
clear sequence.

**Why this wins attention:** Passport rankings show the result. Visa directories start
with a destination. Flag Paths starts with the person and computes what their
combined facts may unlock.

**Trust position:** A transparent research and route-discovery tool, not legal advice
and not a promise of eligibility.

## What public v1 must do

A first-time visitor should be able to:

1. Understand the promise without knowing “geo-arbitrage” or Flag Theory.
2. Explore the map without an account.
3. Add one held status, one relevant fact if applicable, and one destination goal.
4. See a personalized route with its assumptions, allocation type, and sources.
5. Watch a route locally.
6. Understand that monitoring is being built and that alerts are reviewed, not live
   legal advice.
7. Report an error or give concise feedback without searching for the right channel.

Optional account sync is valuable, but it should not delay v1 unless the monitoring
loop is ready to use it. The local profile already satisfies the promise that users can
create a profile.

## The product loop

| Stage | User behavior | Product response | Initial measure |
|---|---|---|---|
| Acquisition | Arrives through a route, map, or recommendation | Immediately sees a concrete, explorable opportunity | Qualified landing visits |
| Activation | Adds a held status and goal, then views a route | Explains why that route appeared and what to verify | Activated profiles / profile starters |
| Retention | Watches a personally relevant route | Remembers the watch and later explains reviewed changes | Route watch rate; return after change |
| Referral | Shares a deliberately redacted route | Recipient opens the same route without seeing private facts | Route shares and referred activations |
| Contribution | Flags an error or supplies a source/field note | Acknowledges, reviews, credits, and closes the loop | Useful contributions reaching the product |

Revenue is not a public v1 objective. Do not add pricing or a paid waitlist merely to
make the project resemble SaaS.

## Launch sequence

### Phase 1 — Founder QA

- Complete the critical route and profile journeys on desktop and mobile.
- Review the most visible route claims and every homepage example.
- Add privacy, data-method, limitations, feedback, and correction paths.
- Instrument the activation funnel without collecting profile facts in analytics.
- Add error monitoring and a visible deployment/version identifier.

**Exit gate:** No known critical route error or profile data-loss bug; the core journey
works from a fresh browser.

### Phase 2 — Controlled alpha

Invite 10–20 people across active movers, ancestry seekers, internationally distributed
households, and rigorous researchers.

Ask each person to:

- Find one route for their real situation.
- Explain what they expected to see.
- Identify the first confusing or untrusted claim.
- Decide whether any route is worth watching.

Conduct short conversations rather than relying only on surveys.

**Exit gate:** At least 8 complete the core journey; failures are understood; several
find a route they did not already know or get a clearer sequence for one they did.

### Phase 3 — Public beta / v1

Release publicly with honest beta language around data coverage and monitoring.

- Publish a short founder story and one product demo.
- Use three to five concrete route examples, not a giant feature inventory.
- Personally recruit the first wave from relevant communities and creators.
- Ship a weekly public changelog during the launch window.
- Reply quickly to every credible correction and visible trust question.

**Exit gate:** Activated profiles, watched routes, and useful corrections grow beyond
the founder's direct network; the next roadmap choice can be made from observed usage.

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

Do not open an empty Discord or broad public Telegram group as a launch tactic. The
separate [`community-strategy.md`](community-strategy.md) defines a small Telegram
pilot around real routes and field knowledge.

## Launch narrative and assets

Lead with the problem and one surprising route:

1. Important geographic options are often hidden across citizenship, ancestry,
   partnership, and treaty rules.
2. Existing tools rank passports or list visas but do not reason from a household's
   combined facts.
3. Flag Paths turns those facts into routes to investigate.
4. The data and uncertainty are open; the result is a research starting point, not
   legal advice.

Minimum launch assets:

- A 30–60 second screen recording of facts → goal → route → watch.
- Three source-backed route examples covering different input types.
- One desktop and one mobile screenshot.
- A public “how the data works” link.
- A privacy summary and a prominent correction link.
- A simple founder post that asks people to try a real profile, not merely upvote.

## Metrics for the first 30 days

Use directional evidence, not vanity targets. Establish a baseline for:

- Profile starts.
- Activated profiles: one held status + goal + viewed route.
- Time to first personalized route.
- Percentage of activated profiles that watch a route.
- Percentage of visitors who open sources or limitations.
- Redacted route shares and referred activations, once sharing exists.
- Feedback and corrections, separated into usability, coverage, and factual accuracy.
- Return visits attributable to a watched route, once monitoring exists.

Analytics events must describe product actions, not contain citizenships, ancestry,
partner facts, destinations, or route contents.

## Identity decision for v1

Use progressive identity:

1. Anonymous exploration.
2. Local private profile.
3. Optional **Save and sync** after the first useful route or watch.
4. Google and email magic link first.
5. Apple once its operational setup is owned.
6. Ethereum under “More sign-in options” after demand is observed.

Choose Supabase if account sync is included. It keeps authentication, storage, and
row-level profile access in one service while preserving a path to social and Ethereum
identity. Keep the provider behind an adapter and keep all route computation independent
of the user's login method.

## Release checklist

### Product and trust

- [ ] Core desktop and mobile journey passes from a fresh browser.
- [ ] Profile migration and local persistence have regression coverage.
- [ ] Deterministic, chance-based, unsupported, and low-confidence claims are visibly
      distinct.
- [ ] Source, confidence, verification date, and data limitations are reachable.
- [ ] Feedback and factual-correction paths work.
- [ ] “Not legal advice” is prominent without overwhelming the value proposition.
- [ ] No dead-end buttons imply that alerts, accounts, or community features are live.

### Privacy and operations

- [ ] Plain-language privacy summary describes local storage and any cloud sync.
- [ ] Analytics contain no profile facts.
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
- [ ] The one metric that determines the next build is named: watched routes per
      activated profile.

## Immediate build order

1. Finish the public trust surface: methodology, privacy, limitations, correction, and
   feedback links.
2. Add privacy-safe activation and route-watch analytics.
3. Add a redacted route share artifact.
4. Run the controlled alpha and fix the dominant activation failure.
5. Decide whether optional Supabase sync is required before public v1 or belongs in
   v1.1.
6. Build reviewed change monitoring before promising live alerts.

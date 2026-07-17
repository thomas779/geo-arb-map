# Product Marketing Context

**Document version:** v3  
**Last updated:** 2026-07-17  
**Status:** Working draft derived from the codebase and founder direction. Items marked
`Validate` need user research or a founder decision.

## Product Overview

**One-liner:** Find the citizenship and residence paths hidden in your profile.

**What it does:** Users enter the statuses and relevant facts they already have,
optionally add a partner and a destination goal, and receive personalized unlocks and
multi-step routes. The product combines an explorable map with a rules-based pathfinder
over source-cited, confidence-labelled, test-protected data.

**Product category:** Global mobility pathfinder. Flag Theory is the long-term
worldview, not the public v1 category claim.

**Product type:** Free, open-source web application. The product remains the focus;
accounts, syncing, and notification infrastructure are supporting capabilities rather
than a reason to force a conventional SaaS model.

**Business model:** Free and open source today. Future pricing is undecided and is not
the current milestone. `Validate:` whether monitoring, collaborative household plans,
or professional-grade research ever create paid value without weakening the public
product.

**Public v1 scope:** Citizenship and immigration-residence discovery, a private local
profile, destination-led paths, and local route watches. Personalized tax residence,
company, banking, asset, investment, filing, and professional-marketplace features are
explicitly out of scope.

## Target Audience

**Target users:** Globally mobile individuals and households who want more geographic
optionality but are not immigration experts. Likely early adopters include
geo-arbitrageurs, digital nomads, internationally distributed families, ancestry-route
seekers, and people actively planning a move.

**Primary use case:** Turn “what I have” and “what I want” into an understandable,
optimized mobility plan.

**Jobs to be done:**

- Discover rights and routes already unlocked by citizenship, residency, ancestry,
  birthplace, heritage, a partner, or other relevant facts.
- Compare plausible next moves and understand how one status can unlock another.
- Plan toward a declared goal such as living or working in a specific country.
- Verify a promising route before spending money or making a life-changing move.

**Use cases:**

- Explore regional settlement blocs and bilateral fast lanes.
- Find a multi-step path to a target work, residence, or citizenship outcome.
- Understand a household footprint that includes a partner’s citizenships.
- Compare deterministic routes with ballot, quota, or discretionary possibilities.
- Watch a personally relevant route and receive reviewed changes through Telegram.
- Contribute a correction or help verify a changing legal rule.

## Personas

This is currently a consumer product rather than a B2B buying process. Early audience
segments are hypotheses, not validated personas:

| Segment | Cares about | Challenge | Value we promise |
|---|---|---|---|
| Active mover | A workable route to a specific destination | Advice is fragmented and eligibility is hard to reason about | A personalized path from current facts to the stated goal |
| Option builder | Expanding future choices for self and family | Cannot see which status creates the most downstream leverage | Ranked next moves and household footprint |
| Ancestry or family-route seeker | Rights hidden in family history or partnership | Does not know which facts matter or how routes connect | A structured profile that reveals relevant routes |
| Research contributor | Accurate, current public mobility knowledge | Corrections disappear into posts and private notes | Source-cited data, public attribution, and regression tests |

## Problems & Pain Points

**Core problem:** Global mobility rules are fragmented across countries, treaty
arrangements, professional advice, and community anecdotes. People struggle to turn
their exact facts into a coherent sequence of actions.

**Why alternatives fall short:**

- Passport rankings show outcomes, not the legal path to obtain them.
- Generic visa sites organize by destination, not by the user’s combined facts.
- Forums contain useful experience but mix current law, old information, and anecdotes.
- Consulting firms can be expensive, gated, and limited to the routes they sell.
- Personal spreadsheets do not model multi-step unlocks or changing rules reliably.

**What it costs users:** Missed routes, wasted research time, unnecessary professional
fees, poor sequencing, and potentially consequential legal or financial mistakes.

**Emotional tension:** “There may be an opportunity hidden in my situation, but I do
not know what I am missing or which claims I can trust.”

## Competitive Landscape

These categories are directional and require a dedicated competitor review before
external positioning is finalized.

**Direct:** Personalized citizenship/residency planning tools and global-mobility
consultancies — often opaque, sales-led, or focused on a limited catalog.

**Secondary:** Visa databases, passport indexes, relocation sites, and country-by-country
immigration guides — useful for lookup, but weak at personalized multi-step planning.

**Indirect:** Lawyers, private spreadsheets, search engines, Reddit, Facebook groups,
Discord servers, and word of mouth — either costly or difficult to verify and maintain.

## Differentiation

**Key differentiators:**

- A multi-source pathfinder that carries retained and lost citizenships through a route.
- A private mobility profile that combines present statuses, family facts, partner
  citizenships, declared goals, and watched routes.
- Explicit separation between deterministic rights and ballot, quota, or discretionary
  possibilities.
- Open data, open code, source metadata, confidence labels, coverage states, and tests
  that prevent known corrections from silently regressing.
- Map exploration and practical route planning in one product.

**How we do it differently:** Model legal mobility as a graph of statuses and
entitlements, while keeping editorial claims auditable and conservative.

**Why that is better:** Users can discover non-obvious sequences without mistaking a
work permit for permanent residence, a chance-based program for a right, or a
low-confidence claim for settled law.

**Why users choose us:** To get an understandable first map of their options before
paying for case-specific professional advice.

## Objections

| Objection | Response |
|---|---|
| “Immigration law changes too often to trust this.” | Show verification dates, confidence, sources, coverage gaps, and visible change history; tell users to verify before acting. |
| “My situation is too specific for an algorithm.” | Use the planner for route discovery, not legal conclusions, and make unsupported facts or edge cases explicit. |
| “I do not want to upload sensitive identity data.” | The current app has no backend; profile data remains local to the browser. Future cloud sync will be optional and offered only after the user reaches value. |
| “A lawyer can just tell me what to do.” | The product helps users discover and compare routes, prepare better questions, and decide where professional advice is worth buying. |

**Anti-persona:** Someone seeking a guaranteed legal opinion, an application filing
service, evasion of immigration rules, or a promise of approval.

## Switching Dynamics

**Push:** Endless tabs, conflicting advice, generic country lists, expensive gated
consultations, and uncertainty about the best sequence.

**Pull:** A visual, personalized, transparent plan that can expose routes the user did
not know to investigate.

**Habit:** Searching one destination at a time, asking in forums, keeping private notes,
or postponing the decision because research feels too large.

**Anxiety:** Incorrect data, oversimplified eligibility, privacy, and the fear that a
recommended path will fail after substantial time or money.

## Customer Language

There are no customer interviews yet. Preserve these useful phrases from the founder
handoff, but do not present them externally as customer quotes:

**Early problem language:**

- “What I have vs what I want.”
- “I have these citizenships; I could get this.”
- “People already have goals but don’t know the optimized path.”
- “Get people invested.”
- “A community with likeminded people.”

**Words to use:** path, next move, unlock, goal, household, route, verified, source,
confidence, options, footprint.

**Words to avoid:** guaranteed, loophole, hack, automatic, authoritative, best passport,
legal advice.

**Glossary:**

| Term | Meaning |
|---|---|
| Flag | A citizenship, permanent residence, or temporary residence held by the user |
| Settlement bloc | A regional arrangement that grants settlement or mobility rights |
| Lane | A bilateral or identity-based route into work, residence, or citizenship |
| Footprint | The deduplicated set of jurisdictions a profile can access |
| Next move | A computed, profile-specific route that expands options |
| Chance-based route | A ballot, quota, queue, or discretionary route that is not guaranteed |

## Brand Voice

**Tone:** Clear-eyed, curious, empowering, and cautious.

**Style:** Direct and conversational, with precise distinctions where the law matters.
Explain complexity without sounding like a consultancy or making legal promises.

**Personality:** Independent, transparent, ambitious, evidence-minded, globally curious.

## Proof Points

**Current product proof:**

- 24 settlement blocs, 35 bilateral or identity lanes, and 1,944 generated graph edges
  in the current local dataset.
- Personalized live/work/citizenship goals and partner-aware household planning.
- A progressive facts → direction → watch activation path, stored locally by default.
- Multi-hop route finding with renunciation and allocation handling.
- An open contribution workflow with automated data invariants and regression tests.
- Dataset verification date displayed in the product.

**Customers:** None claimed.

**Testimonials:** None yet.

**Value themes:**

| Theme | Proof |
|---|---|
| Discover non-obvious paths | The pathfinder can combine statuses and lanes into multi-step routes |
| Trust through transparency | Sources, confidence, coverage states, open data, and tests |
| Plan as a household | Partner citizenships and destination goals are first-class profile inputs |
| Improve through community | Contributions can become reviewed data and permanent regression checks |

## Goals

**Primary business goal:** Turn a useful open atlas into a trusted, profile-led global
mobility product with a repeat reason to return.

**Current product goal:** Make the private mobility profile the activation surface,
then make reviewed route-change monitoring the retention loop. Use Telegram as the
optional delivery and discussion layer.

**Identity principle:** Value before identity. Anonymous exploration and local profiles
remain first-class. If cloud sync ships, offer “Save and sync” after a useful route or
watch. Prefer one Supabase backend for Google/email first, Apple once its operational
setup is owned, and optional Ethereum sign-in later. Wallet ownership is never evidence
of legal identity or eligibility.

**Activation action:** Add one held status and one destination goal, then view a
personalized route.

**Retention action:** Watch a route and return when a reviewed change affects it.

**Community action:** Discuss a redacted route or contribute one meaningful field note,
source, or correction.

**Current metrics:** No acquisition, activation, retention, community, or revenue
baseline has been supplied. Instrumentation and a small founding cohort should precede
optimization.

## Changelog

*Newest first. One line per revision: what changed and why.*

- v3 (2026-07-17) — Narrowed the public category to a citizenship and immigration-residence pathfinder; made Flag Theory the staged long-term worldview, defined explicit v1 exclusions, and adopted value-before-identity with optional low-bloat profile sync.
- v2 (2026-07-17) — Made the mobility profile the product activation surface; defined reviewed route alerts as the retention loop and Telegram as an optional delivery/community layer rather than pursuing SaaS mechanics first.
- v1 (2026-07-17) — Initial context auto-drafted from the codebase and founder handoff; marked unvalidated positioning and business-model decisions explicitly.

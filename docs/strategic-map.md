# Flag Paths — Long-term Strategic Map

Status: active direction
Date: 2026-07-20
Decision horizon: public v1 first; expand only after observed demand

## The strategic choice

Flag Paths uses **Flag Theory as its worldview, not as its initial product
surface**.

The public v1 is a citizenship and immigration-residence atlas. It helps someone see
how country rules, regional rights, and nationality-specific pathways connect, then
follow reviewed changes through Telegram.

That is a narrow enough promise to understand and a deep enough problem to build a
valuable product around. Tax residence, companies, banking, assets, and digital
presence remain part of the long-term map, but they do not belong in public v1.
Each has different laws, data, risk, and professional boundaries. Adding all five now
would make the product harder to trust before the core mobility loop is proven.

The personalized planner remains a later product horizon. It will require a broader
profile, optional identity, strong country coverage, monitored rule dependencies, and
clear professional boundaries. Public v1 keeps the Planner tab as an honest preview
rather than shipping a partial recommendation product.

## North star

**Help people deliberately build geographic options for themselves and their
households.**

The long-term product could become a private, living map of a person's international
position: what they hold, what those facts unlock, what they are working toward, what
changed, and which next move creates the most useful optionality.

The near-term product should be described more simply:

> Explore how citizenship, residence, and mobility rights connect across countries.

## The Flag Theory map

| Flag Theory domain | Product interpretation | Current decision |
|---|---|---|
| Citizenship | Nationality, ancestry, family and naturalization routes | **Core v1** |
| Residence | Immigration residence and settlement rights | **Core v1** |
| Tax residence | Presence tests, tax domicile and treaty interactions | Education and referrals only; no personalized engine |
| Business | Company formation and operating jurisdiction | Out of scope until a mobility-led need is proven |
| Assets and banking | Custody, banking, investment and property jurisdictions | Out of scope |
| Digital/community presence | Account identity, wallet ownership, alerts and peer knowledge | Supporting layer, not a separate “flag” recommendation |

“Five Flag Theory” is useful internal language and may work in founder-led content.
It should not be the main category claim for v1 because many users do not know the term
and it implies tax, business, and wealth guidance the product does not yet provide.

## Product expansion map

### Horizon 1 — Explore the public atlas

**Promise:** Show me how countries, regional rights, and mobility pathways connect.

- Explore blocs, bilateral lanes, ancestry routes, and event-driven routes.
- See sources, confidence, verification dates, and explicit coverage gaps.
- Share stable public country and route contexts.
- Join Telegram for reviewed country and mobility updates.
- Keep speculative “acquire and hold” accession watches separate from current
  rights. Candidate-country citizenship can create future optionality, but the
  atlas must not present target-bloc rights as current until accession occurs.

**Gate to proceed:** New users can understand a relevant country or route without
founder help, and a meaningful share join the update channel or return.

### Horizon 2 — Publish and monitor

**Promise:** Keep the atlas current and explain meaningful rule changes.

- Stable identities for legal rules and route dependencies.
- Reviewed change detection rather than raw automated legal alerts.
- A concise website update and Telegram brief linked to the changed source and rule.
- Consistent country coverage and visible correction history.
- See [`monitoring-architecture.md`](monitoring-architecture.md) for the proposed
  ingestion, review, impact-matching, account, and delivery system.

**Gate to proceed:** People return from country updates, and reviewed changes can be
published accurately with a sustainable editorial workflow.

### Horizon 3 — Personalize routes

**Promise:** Use the facts I choose to share to suggest routes worth investigating.

- A substantially expanded private profile covering held statuses, family,
  education, work, goals, and other legally relevant facts.
- Suggestions whose dependencies resolve to reviewed, monitored rules.
- Optional account-based save and sync after the user sees value.
- Route watches and relevant updates through in-product, Telegram, or email delivery.
- Clear escalation from automated discovery to personalized professional guidance
  where judgment is required.

**Gate to proceed:** Country coverage and monitoring are strong enough to support
useful suggestions, and real users demonstrate demand for saved personal planning.

### Horizon 4 — Add tax-residence awareness

**Promise:** Reveal when a mobility plan creates a tax question that needs separate
research or professional advice.

Start with boundaries and education, not tax optimization:

- Presence-day tracking and jurisdiction-specific question prompts.
- Clear distinctions between immigration residence, tax residence, domicile, and
  citizenship.
- Curated primary sources and introductions to qualified professionals.
- No personalized tax conclusions until the data, liability model, and jurisdictional
  coverage justify them.

**Gate to proceed:** Mobility users repeatedly ask for the same adjacent tax job, a
qualified review process exists, and the feature can be framed without implying advice.

### Horizon 5 — A wider flag stack

Business jurisdiction, banking, assets, property, insurance, and digital identity may
eventually join the profile. Each domain must earn its place through observed user
demand and a credible data/review model. They should be separate modules sharing a
profile—not one giant form or one universal “optimization score.”

## Identity and profile architecture

### Principle: value before identity

Public atlas exploration works without an account. When the later planner can produce
a useful personalized route or watch, offer:

> Save and sync this profile

Signing in is a persistence feature, not the activation event. A provider outage or
OAuth decision should never prevent someone from discovering value.

### Recommended planner identity path

Use **Supabase** as the single optional backend for authentication and profile sync:

- Start with Google and email magic link.
- Add Apple when its developer configuration and six-month web secret rotation have a
  clear owner; do not make it a launch blocker.
- Keep Sign in with Ethereum behind “More sign-in options” until users ask for it.
- Use linked identities so a wallet can later attach to an existing account rather
  than creating a fragmented second profile.
- Put provider-specific code behind a small identity adapter so the route engine and
  profile model do not depend on Supabase.

Supabase's current documentation covers
[Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple), and
[Ethereum wallet sign-in](https://supabase.com/docs/guides/auth/auth-web3), while its
database integration supports
[row-level access controls](https://supabase.com/docs/guides/auth).

Privy remains a reasonable alternative if embedded wallets or onchain actions become a
core product behavior. Today that would pull the product toward a crypto identity
experience before the mobility use case requires it.

### Data boundaries

- A wallet signature proves control of an address, not a person's legal identity,
  citizenship, residence, wealth, or eligibility.
- Never request seed phrases, private keys, passport scans, or government identifiers.
- Sync the minimum structured facts required for the product; retain a local-only mode.
- Separate private profile facts from derived, deliberately redacted share cards.
- Make cloud deletion, export, and sign-out behavior understandable before enabling
  account sync.
- Treat partner facts as data supplied with another person's knowledge and provide a
  way to omit or delete them.

## Durable product principles

1. **Narrow promise, broad worldview.** Win the public atlas and reviewed-update loop
   before personalized planning or wider Flag Theory.
2. **Profile after utility, not signup before utility.** Anonymous atlas exploration
   remains first-class; profiles arrive with a product that can use them well.
3. **Reviewed change, not notification noise.** Legal changes are checked before they
   become public updates or later profile alerts.
4. **Facts and inferences stay distinct.** Show which input unlocked a route and which
   assumptions still need verification.
5. **Open evidence builds trust.** Sources, confidence, coverage, tests, and correction
   history are part of the product.
6. **No false precision.** Do not collapse life-changing tradeoffs into a single score.
7. **Community improves the map.** Chat can surface knowledge; durable claims must move
   into reviewed data or documentation.
8. **Professional boundaries are visible.** The product discovers and explains routes;
   lawyers and tax professionals advise on individual cases.

## Explicit non-goals for public v1

- A tax optimizer or tax-residence calculator.
- Company incorporation, banking, asset, or investment recommendations.
- A visa application filing service.
- A professional marketplace.
- A crypto wallet, token, NFT, or onchain reputation system.
- A public social network or user-profile directory.
- Paid plans, team workspaces, or enterprise administration.

## Decisions to revisit after public v1

- Whether “global option-builders” is language users adopt themselves.
- Whether account sync improves retention enough to justify storing profile facts.
- Whether users prefer email, Telegram, or in-product monitoring.
- Whether a public share card creates useful referrals without privacy confusion.
- Which adjacent Flag Theory question appears frequently enough to earn the next module.

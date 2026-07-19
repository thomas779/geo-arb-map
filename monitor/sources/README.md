# Monitoring source registry

`manifest.json` is the canonical machine-readable watchlist. This page records
onboarding state and prioritization without exposing intake aliases, tokens, or
private mailbox data.

## Live now

| Source | Transport | Role | State |
| --- | --- | --- | --- |
| GLOBALCIT | RSS | Worldwide nationality-law discovery | Active |
| IMI Daily | RSS | CBI/RBI trade-press discovery | Active |
| The Wandering Investor blog | RSS | Independent field discovery | Active |
| The Wandering Investor Telegram | Public channel preview | Fast field discovery | Active |
| Nomad Capitalist podcast | RSS | Broad programme discovery | Active |
| IRCC newsroom | Atom | Official Canadian verification lead | Active |
| Nomad Capitalist Weekly Rundown | Email Worker | Newsletter discovery | Subscribed through the shared intake address on 2026-07-19; awaiting first delivery |
| The Wandering Investor Notes from the Road | Email Worker | Private-list and early discovery | Intake active; publisher form returned a subscription error on 2026-07-18 |

The Wandering Investor is intentionally collected through both its publisher
feed and its public Telegram preview. Those transports are deduplicated later;
Telegram remains discovery-only and can never verify a product change.

## Email onboarding queue

| Priority | Source | State | Next action |
| --- | --- | --- | --- |
| P0 | Fragomen Insights | Needs user details | Supply the publisher's required name, job title, function, company, city, and country; then confirm the opt-in email |
| P0 | Investment Migration Council | Publisher blocked | Public `/newsletter/` page rendered a broken `[newsletter]` shortcode on 2026-07-18; retry monthly or ask IMC for a working public form |
| P0 | The Wandering Investor Notes from the Road | Publisher blocked | The public form returned “Subscription Error” on 2026-07-18; RSS and Telegram remain healthy, and the shared intake address is ready for a future retry |
| P1 | BAL Immigration Alerts | Ready to assess | Create a dedicated route, inspect required form fields, subscribe, then verify the sender domain |
| P1 | Foster Global Updates | Ready to assess | Create a dedicated route and select only global immigration updates |

Use the shared newsletter intake address for publishers whose envelope sender
domains are distinguishable. Confirm the real envelope sender from the first
message before expanding `SOURCE_ROUTES`; newsletter platforms often send
through a domain different from the publisher's website. Reserve a dedicated
address only for genuinely ambiguous senders.

## Adapter queue

1. **P0 — official sources already relevant to the product graph:** Spain BOE,
   Portugal DRE, France Légifrance, Argentina Boletín Oficial, UK legislation,
   and the IRCC feed.
2. **P1 — high-value country coverage gaps:** Malta Community Agency, Greek
   migration legislation, Colombia's normative repository, Türkiye citizenship
   guidance plus Resmî Gazete, Brazil's Diário Oficial, and USCIS alerts.
3. **P1 — European framework changes:** a focused EUR-Lex RSS query for
   nationality, migration, residence, free movement, and accession.
4. **P2 — commercial discovery:** Latitude and Henley index adapters. Treat
   their reports as leads, discard promotional copy, and resolve every accepted
   signal to an official source.

## Admission rules

- Prefer RSS, Atom, APIs, gazettes, and stable document indexes over scraping.
- Add email only when the public archive exposes canonical article URLs.
- Use commercial publishers and social channels for discovery, never
  verification.
- Monitor the countries and edges users actually watch before pursuing nominal
  worldwide coverage.
- Record a source failure as health data; never silently convert it into “no
  change.”

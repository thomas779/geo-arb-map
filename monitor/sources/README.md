# Monitoring source registry

`manifest.json` is the canonical machine-readable watchlist. This page records
onboarding state and prioritization without exposing intake aliases, tokens, or
private mailbox data.

Run `bun run monitor:audit` after `bun run data:db` to generate the complete
country-by-country review and monitoring gap report at
`.generated/monitor/source-coverage.json`. The report derives its country scope
from `data/registry.json`; do not maintain a second manual country checklist.
The legal-review handoff for another model or reviewer is
[`../../docs/fact-check-handoff.md`](../../docs/fact-check-handoff.md).

One source can contain a `pages` array when the same authority publishes birth,
descent, naturalization, programme, or amendment guidance separately. Gazette
sources use `kind: "gazette_search"` plus local-language `keywords`; the audit
rejects a gazette configuration with no terms. Matching creates a lead, never a
legal conclusion.

## Live now

| Source | Transport | Role | State |
| --- | --- | --- | --- |
| GLOBALCIT | RSS | Worldwide nationality-law discovery | Active |
| IMI Daily | RSS | CBI/RBI trade-press discovery | Active |
| Settled Nomad visa index | HTML content hash | Missing-visa and claimed PR/CIT-transition discovery | Active; commercial discovery only |
| The Wandering Investor blog | RSS | Independent field discovery | Active |
| The Wandering Investor Telegram | Public channel preview | Fast field discovery | Active |
| Nomad Capitalist podcast | RSS | Broad programme discovery | Active |
| IRCC newsroom | Atom | Official Canadian verification lead | Active |
| Italy Foreign Ministry citizenship | HTML content hash | Official verification lead | Active; live fetch verified 2026-07-21 |
| Netherlands IND citizenship | HTML content hash | Official verification lead | Active; live fetch verified 2026-07-21 |
| Singapore ICA citizenship | HTML content hash | Official verification lead | Active; live fetch verified 2026-07-21 |
| Switzerland SEM citizenship | HTML content hash | Official verification lead | Active; live fetch verified 2026-07-21 |
| Malta Community Agency citizenship | HTML content hash | Official verification lead | Active; live fetch verified 2026-07-21 |
| Cyprus investment-programme registry | HTML content hash | Official negative-CBI verification | Active; live fetch verified 2026-07-21 |
| Türkiye NVI citizenship | HTML content hash | Official verification lead | Active; live fetch verified 2026-07-21 |
| Invest in Türkiye citizenship thresholds | HTML content hash | Official CBI verification | Active; live fetch verified 2026-07-21 |
| Uruguay IMPO nationality law | HTML content hash | Official legal verification lead | Active; live fetch verified 2026-07-21 |
| Uruguay Electoral Court citizenship | HTML content hash | Official naturalization verification | Active; live fetch verified 2026-07-21 |
| Uruguay DGI tax residence | HTML content hash | Official classification safeguard | Active; live fetch verified 2026-07-21 |
| Spain Civil Code | HTML content hash | Official nationality-law verification | Active; live fetch verified 2026-07-21 |
| UK citizenship guidance | HTML content hash, four pages | Official descent, birth, naturalization, and status verification | Active; live fetch verified 2026-07-21 |
| France Service Public nationality | HTML content hash, two pages | Official birth and naturalization verification | Active; live fetch verified 2026-07-21 |
| Portugal Justice nationality | HTML content hash, three pages | Official nationality profiles and application verification | Active; live fetch verified 2026-07-21 |
| Germany Nationality Act | HTML content hash | Official consolidated-law verification | Active; live fetch verified 2026-07-21 |
| Ireland DFA, ISD, and Statute Book | HTML content hash, four pages | Official descent, naturalization, and birth-law verification | Active; live fetch verified 2026-07-21 |
| Australia citizenship guidance | HTML content hash, four pages | Official descent, conferral, birth, and evidence verification | Active; live fetch verified 2026-07-21 |
| New Zealand citizenship guidance | HTML content hash, four pages | Official descent, grant, birth, and presence verification | Active; live fetch verified 2026-07-21 |
| USCIS citizenship and alerts | HTML content hash, four pages | Official naturalization, investment-residence, and change discovery | Active; live fetch verified 2026-07-21 |
| Greece citizenship and Golden Visa | HTML content hash, two pages | Official citizenship-law and investor-residence verification | Active; Golden Visa fetch healthy, citizenship page returns 403 and is recorded as failed health data |
| Bulgaria Citizenship Act | HTML content hash, two pages | Official nationality-law and service verification | Active; service page healthy, Act endpoint has a TLS-chain failure and is recorded as failed health data |
| Serbia citizenship guidance | HTML content hash, two pages | Official nationality-law and procedure verification | Active; live fetch verified 2026-07-21 |
| UAE nationality and Golden Visa | HTML content hash, three pages | Official nationality nomination and investor-residence verification | Active; government guidance and Golden Visa pages healthy, e-laws endpoint is monitored for recovery |
| Brazil Justice and Federal Police guidance | HTML content hash, four pages | Official nationality, reduced naturalization, and family-reunification verification | Active; parent/ascendant pages added 2026-07-21 |
| Mexico Foreign Ministry naturalization | HTML content hash, three pages | Official ordinary, origin-preference, and Mexican-child parent-route verification | Active; parent route added 2026-07-21 |
| Egypt Cabinet CBI and GAFI unit | HTML content hash, three pages | Official investment citizenship and nationality-law text verification | Active; live fetch verified 2026-07-22 |
| Jordan Invest and Petra investor criteria | HTML content hash, two pages | Official Cabinet investor-citizenship criteria verification | Active; live fetch verified 2026-07-22 |
| Nauru Program Office and citizenship acts | HTML content hash, four pages | Official ECRCP and ordinary Citizenship Act verification | Active; live fetch verified 2026-07-22 |
| São Tomé nationality law and CBI regulation | HTML content hash, three pages | Official nationality statute, RNID decree text, and consular programme verification | Active; live fetch verified 2026-07-22 |
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

Cyprus Ministry of Interior citizenship guidance is a P0 gap: the official hub
returned HTTP 403 to the bounded collector on 2026-07-21. Its official pages
remain canonical evidence, but the source is correctly marked `planned` until a
permitted feed/API or resilient browser-backed adapter is available.

1. **P0 — gazettes supplementing active guidance monitors:** Spain BOE,
   Portugal DRE, France Légifrance, Argentina Boletín Oficial, UK legislation,
   and the IRCC feed.
2. **P1 — high-value country coverage gaps:** Colombia's normative repository,
   Brazil's Diário Oficial, Mexico's Diario Oficial, Israel's official
   nationality guidance, and Poland and Hungary's consolidated nationality law.
3. **P1 — European framework changes:** a focused EUR-Lex RSS query for
   nationality, migration, residence, free movement, and accession.
4. **P2 — commercial discovery:** Latitude and Henley index adapters. Treat
   their reports as leads, discard promotional copy, and resolve every accepted
   signal to an official source.

## Admission rules

- Prefer RSS, Atom, APIs, gazettes, and stable document indexes over scraping.
- Where no webhook, feed, or API exists, use the `html_index` adapter to poll a
  stable official page by normalized content hash. It detects change; it does
  not determine the legal meaning of that change.
- Add email only when the public archive exposes canonical article URLs.
- Use commercial publishers and social channels for discovery, never
  verification.
- Monitor the countries and edges users actually watch before pursuing nominal
  worldwide coverage.
- Record a source failure as health data; never silently convert it into “no
  change.”

## Adding a source

Add a manifest entry only when the publisher regularly covers nationality,
residence, cross-border work or settlement, dual-citizenship restrictions,
quotas, costs, or programme openings and closures. Prefer narrow official or
specialist publishers over general mobility blogs.

Required shape:

```json
{
  "id": "stable-lowercase-id",
  "tier": "discovery",
  "adapter": "rss",
  "status": "active",
  "url": "https://example.org/feed/",
  "jurisdictions": ["250"],
  "max_items": 25,
  "notes": "What it catches and why it is useful."
}
```

Use `planned` when an adapter or credential is missing. Before merging, run
`bun run monitor:test` and a bounded real collection for the new source.

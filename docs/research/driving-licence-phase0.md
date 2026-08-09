# Driving licence layer — Phase 0

**Branch:** `data/driving-licence-layer`  
**Issue:** #171  
**Date:** 2026-08-09  

## Go / no-go

**Verdict: build as an exchange reference product, not as “cheap licence tourism.”**

A lawful path that ignores normal residence does **not** survive primary sources. The useful product is:

1. **Where will destination D exchange a licence issued by origin O, and with which tests?**  
2. **What residence gate does the destination (or EU law) impose?**

Someone who never normally lived in O cannot treat an O licence as a portable asset into DE/UK/etc. without risking void recognition. That is the product story the UI must open with.

---

## Instrument 1 — Directive 2006/126/EC

Source: [EUR-Lex CELEX 32006L0126](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32006L0126) (fetched 2026-08-09).

| Article | Quote / effect |
|---|---|
| **Art. 2(1)** | “Driving licences issued by Member States shall be mutually recognised.” |
| **Art. 7(1)(e)** | Licences issued only to applicants who “have their **normal residence** in the territory of the Member State issuing the licence, or can produce evidence that they have been studying there for at least six months.” |
| **Art. 11(6)** | Third-country exchange onto a Community-model licence must be recorded; if the holder later moves, the new MS **need not** apply Art. 2 mutual recognition to that exchanged licence. |
| **Art. 12** | “For the purpose of this Directive, ‘**normal residence**’ means the place where a person usually lives, that is for at least **185 days in each calendar year**, because of personal and occupational ties…” |

**Implication:** EU issue and recognition are built around normal residence. This is the backbone of the layer.

---

## Instrument 2 — Germany Anlage 11 FeV

Source: [gesetze-im-internet.de/fev_2010/anlage_11.html](https://www.gesetze-im-internet.de/fev_2010/anlage_11.html) (fetched 2026-08-09).

Harvest: `docs/research/anlage11-fev.json` and `public/licence_exchange.json`.

| Stat (this harvest) | Value |
|---|---:|
| Entry rows | 84 |
| Sub-national rows (US / CA / AU) | majority of US/CA/AU blocks |
| National-level **no theory and no practical** (sample) | Albania, Andorra, Japan, Switzerland, UK, Singapore, South Africa, New Zealand, South Korea, … |

Examples that match #171:

- **Switzerland** — classes `alle`, theory nein, practical nein  
- **Connecticut** — classes `D, 1, 2`, theory **ja**, practical nein  
- **Japan** — `alle` / nein / nein  

**Caveat for product:** Anlage 11 is the **origin list for German special rules** under FeV §31. Exchange still requires the applicant to satisfy German residence / application conditions. The annex is not a fly-in tariff.

**Granularity:** US states, Canadian provinces, Australian territories are separate rows → `varies_by_subnational: true` for parent countries 840 / 124 / 036.

---

## Instrument 3 — 1968 Vienna Convention on Road Traffic

Source seeds: [UN Treaty Collection XI-B-19](https://treaties.un.org/pages/ViewDetailsIII.aspx?src=TREATY&mtdsg_no=XI-B-19&chapter=11); UNECE convention text.

Operative idea (to re-quote from official PDF when modelling IDP rows): contracting parties recognise conforming **domestic licences** and **International Driving Permits** for **international traffic**, typically **until the holder’s normal residence moves** to the visited state. That is **temporary recognition for driving**, not permanent exchange into a local licence.

**1949 Geneva** remains a parallel IDP regime; treat IDP as a separate category later, not as exchange.

---

## Instrument 4 — UK designated / exchangeable licences

gov.uk interactive questionnaire is **not** usable as a static annex (#171).

**Located primary alternatives (2026-08-09 search):**

- [Driving Licences (Exchangeable Licences) Order 1999](https://www.legislation.gov.uk/uksi/1999/1641) and amending orders (e.g. 2002, 2013, 2016, **2021 SI 537** adding Cayman, North Macedonia, Taiwan, Ukraine, UAE, etc.)
- Path: Road Traffic Act 1988 s.108(2)(b) designations  

**Phase 0 status:** instrument family **found**; full consolidated designated list not transcribed into seed yet → UK is the **next destination annex** after DE.

---

## Instrument 4 (completed) — UK Exchangeable Licences Orders

Primary:

- [SI 1999/1641 Schedule (revised)](https://www.legislation.gov.uk/uksi/1999/1641/schedule) — other countries/territories list  
- [SI 1999/1641 art. 3](https://www.legislation.gov.uk/uksi/1999/1641/article/3) — South Africa  
- [SI 1999/1641 art. 4](https://www.legislation.gov.uk/uksi/1999/1641/article/4) — Canadian provinces and territories  
- [SI 2021/537](https://www.legislation.gov.uk/uksi/2021/537/contents/made) — Cayman Islands, North Macedonia, Taiwan, Ukraine, UAE  

Harvest: `docs/research/uk-exchangeable-licences.json` (26 designated origins).  
**Note:** Great Britain only; Northern Ireland is a separate regime. Designation = exchange without driving test when resident in GB; class maps not invented.

## Additional annexes (continuation)

| Destination | Source | Rows |
|---|---|---:|
| **Netherlands** | [RDW](https://www.rdw.nl/en/driving-licence/foreign-driving-licence/exchanging-a-foreign-driving-licence) | 16 third-country (+ explicit 185-day residence rule) |
| **Ireland** | [NDLS](https://www.ndls.ie/licensed-driver/exchange-my-foreign-driving-licence.html) / RSA / citizensinformation | 16 recognised non-EU states |
| **France** | [Sécurité routière PDF 1 May 2026](https://www.securite-routiere.gouv.fr/sites/default/files/2026-04/liste_reciprocite_hors_ue_et_eee_au_1er_mai_2026.pdf) | ~109 (national + US/CA subnational) |

Research dumps: `nl-rdw-exchange.json`, `ie-recognised-states.json`, `fr-reciprocite-mai-2026.json`.

## Product decision for UI v1

| Choice | Decision |
|---|---|
| Primary UX | Origin → destinations that list it (exchange lookup) |
| Seed destinations | **DE, GB, NL, IE, FR** (five annexes) |
| Framing | Reference / convertibility tool + residence disclaimer |
| Pathfinder | No multi-hop |
| Rights index | Out of scope |
| Country pages | Licence section when iso appears in seed (as dest and/or origin) |

## Destination annex inventory (current seed)

| ISO | Destination | Primary source family |
|---|---|---|
| 276 | Germany | Anlage 11 FeV |
| 826 | Great Britain | SI 1999/1641 + 2021/537 |
| 528 | Netherlands | RDW agreement list |
| 372 | Ireland | NDLS / RSA recognised states |
| 250 | France | Sécurité routière reciprocity PDF (1 May 2026) |
| 724 | Spain | DGT convenios de canje |
| 040 | Austria | oesterreich.gv.at FSG conversion |
| 554 | New Zealand | NZTA exempt countries |
| 036 | Australia | Austroads recognised jurisdictions |
| 208 | Denmark | Danish Road Traffic Authority Group 1/2 |
| 620 | Portugal | IMT / gov.pt OECD–CPLP & bilateral track |

## Next after this branch

1. Belgium SPF Mobilité interactive tables; Switzerland ASTRA full third-country list; Sweden Trafikverket; Singapore / Japan / Korea as destinations  
2. Optional formal `licence_routes` in canonical pilot  
3. Origin acquisition ranked by annex frequency  
4. Tighten France class columns where PDF left null  




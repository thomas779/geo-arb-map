# Citizenship and mobility data architecture

The public files are becoming large because three different concepts currently
share one document:

1. **Jurisdiction law** — how one country grants, retains, or removes nationality.
2. **Cross-border arrangements** — blocs, treaties, bilateral visas, quotas, and
   one-way rights involving several jurisdictions.
3. **UI indexes** — the compact lists and graph edges the application needs to
   render quickly.

These should be authored separately and compiled together. The UI taxonomy
should be derived from what a route does, not from which source file contains it.

## Proposed source layout

```text
data/
  jurisdictions/
    250-france.json
    170-colombia.json
    ...
  arrangements/
    eu-eea.json
    daft.json
    tn-usmca.json
    ...
  research/
    inbox/
    reviewed/
  registry.json
public/
  jurisdiction-index.json    # generated compact country summaries
  arrangement-index.json     # generated compact regional/bilateral list
  edges.json                 # generated pathfinding graph
  coverage.json              # generated research-state matrix
```

`public/` remains generated and optimized for the browser. It should never be
the place where a legal fact is edited by hand.

## Jurisdiction files

One file per nationality law keeps a country's internal rules together and
makes review ownership clear.

```json
{
  "jurisdiction": { "iso_n3": "250", "name": "France" },
  "nationality_law_page": {
    "url": "https://en.wikipedia.org/wiki/French_nationality_law",
    "role": "discovery"
  },
  "acquisition": {
    "ancestry": [],
    "naturalization": [],
    "birth": [],
    "investment": []
  },
  "loss_and_retention": [],
  "dual_citizenship": {},
  "last_reviewed": "YYYY-MM-DD"
}
```

Each route should carry structured milestones rather than burying the path in
prose:

```json
{
  "id": "france-higher-education-naturalization",
  "outcome": "citizenship",
  "allocation": "discretionary",
  "eligibility": [],
  "milestones": [
    { "status": "lawful_residence", "minimum_months": 24 },
    { "status": "citizenship_application", "minimum_months": 0 }
  ],
  "timeline": {
    "minimum_months": 24,
    "typical_months": null,
    "confidence": "high",
    "note": "Application eligibility, not a processing-time promise."
  },
  "sources": []
}
```

Unknown time must be `null`, never a guessed default. The interface can then say
“time not verified” consistently.

## Arrangement files

Regional and bilateral rights do not belong inside either participating
country's nationality-law file. Store each arrangement once:

```json
{
  "id": "daft",
  "kind": "bilateral",
  "beneficiaries": ["840"],
  "destinations": ["528"],
  "outcome": "residence",
  "settlement": true,
  "allocation": "right",
  "milestones": [],
  "sources": []
}
```

The generator can derive the user-facing shelves:

- **Regional access** — multi-country residence or citizenship rights.
- **Country paths** — residence, citizenship, work, ballots, and capped routes.
- **Heritage paths** — ancestry, diaspora, restoration, and cultural-connection
  routes.

Terms such as `partial`, `hub_spoke`, and `one_way` remain useful legal
qualifiers, but should not be the main navigation.

## Accession-watch scenarios

“Acquire and hold” strategies—obtaining a candidate country's citizenship in
the hope that it later joins a larger free-movement area—are worth monitoring,
but they are not current mobility rights. They need a separate scenario layer:

```json
{
  "id": "serbia-eu-accession-watch",
  "jurisdiction": "688",
  "target_arrangement": "eu",
  "status": "candidate_negotiating",
  "official_accession_date": null,
  "counts_as_current_right": false,
  "monitor_sources": [
    "https://enlargement.ec.europa.eu/countries/serbia_en"
  ]
}
```

Serbia is an EU candidate with accession negotiations open, but candidate
status does not automatically confer EU membership or EU-citizen free-movement
rights. A nationality acquired today becomes an EU nationality only if and when
the country accedes. The interface should therefore:

- show accession watches as explicitly speculative;
- never add the target bloc's edges to current pathfinding;
- store no assumed accession date;
- monitor official enlargement status and accession-treaty milestones;
- explain political, timing, nationality-law, and dual-citizenship risk.

This creates useful upside awareness without turning a political possibility
into a deterministic citizenship recommendation.

## Source policy

Wikipedia nationality-law pages are useful as:

- a worldwide coverage checklist;
- a discovery index for statutes, government guidance, and historical changes;
- a secondary explanation when no clearer official summary exists.

They are not sufficient as the sole source for a live recommendation. Follow
their citations to the primary statute or government service, record both URLs,
and mark the route pending until the primary source is checked.

Recommended evidence order:

1. legislation, treaty, court decision, or official gazette;
2. immigration or nationality authority guidance;
3. official embassy or consular guidance;
4. reputable secondary legal research;
5. Wikipedia as discovery/context only.

Every source record should include `title`, `url`, `source_type`,
`supports_fields`, `last_checked`, and optional monitoring metadata. This lets a
future monitor alert reviewers to a changed source without silently changing a
user's route.

## Incremental migration

1. Keep `public/blocs_data.json` working.
2. Extract one jurisdiction or arrangement at a time into the new source
   directories.
3. Generate the existing public shape from the new records.
4. Add parity tests so an extraction cannot drop a route or source.
5. Switch the frontend to the compact generated indexes only after coverage and
   pathfinding tests match.

This avoids a high-risk rewrite while making the research corpus reviewable,
diffable, and suitable for source monitoring.

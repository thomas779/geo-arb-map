import type { Lead } from './triage';

export interface IssueDraft {
  signal_id: string;
  title: string;
  body: string;
}

function quoteExcerpt(value: string): string {
  return String(value ?? '')
    .trim()
    .slice(0, 500)
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

export function buildIssueDraft(lead: Lead): IssueDraft {
  const source = lead.signal;
  const title = `[Monitor lead] ${lead.jurisdiction}: ${lead.summary}`.slice(0, 200);
  const excerpt = quoteExcerpt(source.excerpt);
  const body = `## Possible change

${lead.summary}

| Field | Triage result |
| --- | --- |
| Jurisdiction | ${lead.jurisdiction} |
| Impact | ${lead.impact_type} |
| Confidence | ${lead.confidence} |
| Primary source needed | ${lead.needs_primary_source ? 'Yes' : 'No'} |
| Discovery tier | ${source.tier} |

## Discovery source

[${source.title}](${source.url})

${excerpt || '> No excerpt was supplied.'}

## Reviewer checklist

- [ ] Locate and cite the current primary legal or government source.
- [ ] Confirm the effective date and any transition rules.
- [ ] Identify the exact dataset entities and fields affected.
- [ ] Add or update a regression invariant with any data correction.
- [ ] Cross-check every sentence in the public brief against the evidence below.

## Verified evidence

<!-- Add the primary source URL, effective date, and the relevant passage. -->

## Public brief

<!-- Replace this with the exact concise text that may be published to Telegram. -->

This issue is an unverified monitoring lead. It must not be copied into the public
dataset until the reviewer checklist is satisfied. See
\`monitor/README.md\`.

<!-- signal:${lead.signal_id} -->`;
  return { signal_id: lead.signal_id, title, body };
}

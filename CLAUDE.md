# Flag Paths — working rules

An open atlas of citizenship and residence law. Every claim traces to a primary
instrument, and the rules below are the ones that were learned by breaking something.

## The master dataset lives in a private repo

`scripts/lib/canonical-pilot.ts` and `data/citizenship_routes.json` are gitignored
here and tracked in `flag-paths-data` under `source/`. They are **copies**, not links
— a symlink breaks Bun's relative imports, and a hard link silently splits the moment
an editor writes via temp-file-and-rename.

```sh
bun run data:source check    # do the copies agree with the repo?
bun run data:source pull     # take the repo version
bun run data:source push     # stage yours into the repo, then commit there
```

`data:publish` runs `check` first and refuses to publish while they disagree. Pull
before you edit. A stale master is invisible: the file is always there, it is just old.

## The pipeline, in order

```
data:db → data:build → diff built JSON against published for DROPS
        → promote --allow-draft → verify → data:publish → push code → data:sync sync
```

Three things about that order are load-bearing:

- **Verify AFTER promote, not before.** `data/compiled/` only refreshes on promote, so
  a green run beforehand proves nothing about what CI will fetch. This broke CI once.
- **Publish data BEFORE pushing code that asserts on it.** CI fetches the corpus from
  `flag-paths-data`; the reverse order goes red twice out of two.
- **Diff for drops before promoting.** Check `residence_routes` as well as `routes` —
  Gibraltar lives in the former, and an id check against `routes` alone misses it.

## Recording rules

**No negatives.** The atlas stores active programmes and real programmes that ended.
It never stores a "no X exists" row or an absence footnote. Silence is how it says a
thing does not exist. `verified_negative` is removed from the schema so this is
unrepresentable, not merely discouraged. An absence goes in a research file's `notes`.

**Positive-only on depth.** `unlimited` only where the instrument STATES no
generational cutoff; `maximum_degree` only from a STATED ceiling. Never inferred from
silence. "The law says it keeps going" and "nobody wrote down where it stops" are
different facts and only the first is recordable.

**Null means NOT RECORDED**, never "not required" and never zero. This governs
`work_rights`, `max_age`, the licence test flags and every field like them.

**An origin test asks what you ARE.** A preference for holders of another country's
nationality is not one — "citizens of the Nordic countries get faster naturalisation"
and "Ibero-American nationals naturalise in two years" are passport tests. Membership
of a people is an origin test. Getting this wrong inflates the ancestry facet with
fast tracks for other countries' citizens.

## Sourcing rules

**Official sources only.** Wikipedia, constituteproject, refworld, natlex,
legislationline and law-firm pages are not authority. Use them to find an article
number, then cite the instrument and say so in `notes`.

**A 200 proves nothing.** Known traps, all real: Fedlex returns an identical SPA shell
for every path, and its filestore returns a plausible 9KB page for the wrong
consolidation date; the Serbian gazette returns the same 13KB Vue shell for fabricated
paths; law.go.kr and e-Gov serve iframe or SPA stubs; viewer wrappers hide the real
PDF. Only the quoted text appearing in the fetched body proves a read.

**Everything is quote-gated.** `bun run research:verify` and
`bun run research:verify:quotes` re-fetch every URL and match every quote
character-for-character. Rows that fail are not authored — they are named in the
report. Never blend "quote verified" and "cannot_determine with a reason" into one
number; report them apart.

**`cannot_determine` is a good answer.** Say precisely what is ambiguous.

## Editing the pilot

1.5MB, gitignored, and not recoverable from this repo's history. Uniquely-anchored
edits only. **Never a regex across the file** — that destroyed ~4,600 characters once.
Snapshot before a batch, and afterwards confirm `grep -c
'principalCitizenshipRoute\|reviewedCountryRecord'` is unchanged and no route id was
lost.

## Git

Never `git add -A` — name paths, then `git status --short`. Work in a worktree off
`origin/main`. Don't delete a branch before confirming its content landed. Short
commit subjects.

## Numbers

`bun run index:audit` is the authority on coverage. Regenerate it, never hand-type it
— the spec and issue #160 both drifted from reality by quoting stale figures.

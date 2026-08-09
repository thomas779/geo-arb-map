import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderReferenceDataSql, splitStatements } from '../scripts/sync_canonical_d1';

const root = join(import.meta.dir, '..');
const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));

const blocsData = read('public/blocs_data.json');
const registry = read('data/registry.json');
const manifest = read('monitor/sources/manifest.json');

/**
 * Build the reference tables in memory exactly as D1 will see them: the migration's
 * own DDL, then the rendered inserts. Foreign keys ON, because D1 enforces them and
 * a projection that only stands up with them off is not the projection we ship.
 */
function build(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const ddl = readFileSync(join(root, 'data/d1/migrations/0008_reference_data.sql'), 'utf8');
  for (const statement of splitStatements(ddl)) db.exec(statement);
  for (const statement of renderReferenceDataSql()) db.exec(statement);
  return db;
}

const db = build();
const count = (table: string): number =>
  (db.query(`SELECT COUNT(*) AS n FROM ${table};`).get() as { n: number }).n;

describe('reference data mirrors into D1 without dropping rows', () => {
  // A row count below the source is a SILENT DROP, not a rounding error. The same
  // check on 0007 caught a real key defect: Germany lists Albania twice, once for
  // A1/A2/A/B/BE/C/D and once for AM alone, and a natural key without `classes`
  // discarded the moped row. Every count below is asserted against the file, so a
  // future key or shape change fails here instead of quietly shrinking the mirror.
  test('every list arrives at full length', () => {
    expect(count('bloc_index')).toBe(blocsData.blocs.length);
    expect(count('bilateral_lane_index')).toBe(blocsData.bilateral_lanes.length);
    expect(count('dual_nationality_policy'))
      .toBe(Object.keys(blocsData.dual_citizenship.countries).length);
    expect(count('dual_nationality_treaty_exception'))
      .toBe(blocsData.dual_citizenship.treaty_exceptions.length);
    expect(count('jurisdiction_registry'))
      .toBe(registry.sovereigns.length + registry.territories.length + registry.special.length);
    expect(count('monitor_source_manifest')).toBe(manifest.sources.length);
    expect(count('stacking_play_index')).toBe(blocsData.stacking_plays.length);
    expect(count('generational_event_index')).toBe(blocsData.generational_events.length);
    expect(count('pending_verification_index')).toBe(blocsData.pending_verification.length);
  });

  test('the counts are the ones the layer was built against', () => {
    // Pinned separately from the file-derived assertions above. Those two together
    // catch the case the first alone cannot: a source file that itself loses rows
    // still satisfies "matches the file".
    expect(count('bloc_index')).toBe(24);
    expect(count('bilateral_lane_index')).toBe(22);
    expect(count('dual_nationality_policy')).toBe(25);
    expect(count('dual_nationality_treaty_exception')).toBe(3);
    expect(count('jurisdiction_registry')).toBe(240);
    expect(count('monitor_source_manifest')).toBe(289);
    expect(count('stacking_play_index')).toBe(6);
    expect(count('generational_event_index')).toBe(3);
    expect(count('pending_verification_index')).toBe(6);
  });

  test('child tables keep every member, beneficiary, party and jurisdiction', () => {
    const members = blocsData.blocs.reduce(
      (total: number, bloc: any) =>
        total + bloc.members.length + (bloc.former_members?.length ?? 0), 0);
    expect(count('bloc_members')).toBe(members);
    expect(count('bloc_rights')).toBe(blocsData.blocs.length * 3);
    expect(count('bilateral_lane_beneficiaries')).toBe(
      blocsData.bilateral_lanes.reduce((t: number, l: any) => t + l.beneficiaries.length, 0));
    expect(count('dual_nationality_treaty_parties')).toBe(
      blocsData.dual_citizenship.treaty_exceptions
        .reduce((t: number, e: any) => t + e.parties.length, 0));
    expect(count('monitor_source_jurisdictions')).toBe(
      manifest.sources.reduce((t: number, s: any) => t + (s.jurisdictions?.length ?? 0), 0));
  });
});

describe('the divergence this table exists to record (#144)', () => {
  test("blocs_data.json says 'banned' and the mirror keeps saying 'banned'", () => {
    // The canonical corpus says 'prohibited' for the same concept
    // (scripts/lib/canonical-schema.ts), and src/types.ts carries BOTH enums — one
    // per model. They are rival vocabularies over the same question, and #144 is
    // where the reconciliation gets decided. Harmonising them here would silently
    // pick a winner and destroy the evidence that the divergence is real, so this
    // test exists to make a tidy-up fail loudly rather than pass quietly.
    const banned = db.query(
      "SELECT COUNT(*) AS n FROM dual_nationality_policy WHERE status = 'banned';",
    ).get() as { n: number };
    expect(banned.n).toBeGreaterThan(0);
    expect(db.query(
      "SELECT COUNT(*) AS n FROM dual_nationality_policy WHERE status = 'prohibited';",
    ).get()).toEqual({ n: 0 });

    // China (156) is the unambiguous case: the PRC Nationality Law art. 3 does not
    // recognise dual nationality at all.
    const china = db.query(
      "SELECT status FROM dual_nationality_policy WHERE iso_n3 = '156';",
    ).get() as { status: string };
    expect(china.status).toBe('banned');

    // And the CHECK constraint must reject the canonical word outright, so the
    // schema cannot drift into accepting both spellings.
    expect(() => db.exec(
      "INSERT INTO dual_nationality_policy (iso_n3, status) VALUES ('999', 'prohibited');",
    )).toThrow();
  });
});

describe('the distinctions the schema is there to preserve', () => {
  test('ECOWAS withdrawals are not readmitted by flattening two arrays', () => {
    // Mali, Burkina Faso and Niger left. The file keeps them in `former_members`,
    // disjoint from `members`; without the `former` flag the mirror would show a
    // 15-member bloc that does not exist.
    const former = db.query(
      "SELECT iso_n3 FROM bloc_members WHERE bloc_id = 'ecowas' AND former = 1 ORDER BY iso_n3;",
    ).all() as Array<{ iso_n3: string }>;
    expect(former.map(row => row.iso_n3)).toEqual(['466', '562', '854']);
    const current = db.query(
      "SELECT COUNT(*) AS n FROM bloc_members WHERE bloc_id = 'ecowas' AND former = 0;",
    ).get() as { n: number };
    expect(current.n).toBe(12);
  });

  test('Kosovo survives a registry keyed on iso_n3', () => {
    // M49 assigns Kosovo no numeric code, so the file keys the `special` entries on
    // `id` instead. Reading iso_n3 blindly drops both special rows.
    const kosovo = db.query(
      "SELECT name, class, note FROM jurisdiction_registry WHERE iso_n3 = 'XKX';",
    ).get() as { name: string; class: string; note: string };
    expect(kosovo.name).toBe('Kosovo');
    expect(kosovo.class).toBe('special');
    expect(kosovo.note).toContain('No M49 numeric code');
    expect(count('jurisdiction_registry')).toBe(240);
  });

  test('NULL means not recorded, and is never coerced to a value', () => {
    // Only 7 of 22 lanes record an allocation. The other 15 must read as NULL, not
    // as an unrationed 'right' — a lane you might lose a ballot for every year is
    // not one you can claim.
    const withAllocation = blocsData.bilateral_lanes.filter((l: any) => l.allocation).length;
    const nulls = db.query(
      'SELECT COUNT(*) AS n FROM bilateral_lane_index WHERE allocation IS NULL;',
    ).get() as { n: number };
    expect(nulls.n).toBe(blocsData.bilateral_lanes.length - withAllocation);

    // Likewise renounces_previous: recorded on 2 lanes, NULL (not 0) on the rest.
    const renounceNulls = db.query(
      'SELECT COUNT(*) AS n FROM bilateral_lane_index WHERE renounces_previous IS NULL;',
    ).get() as { n: number };
    expect(renounceNulls.n).toBe(
      blocsData.bilateral_lanes.filter((l: any) => l.renounces_previous === undefined).length);

    // And URLs the manifest does not carry stay NULL rather than ''.
    const noUrl = db.query(
      'SELECT COUNT(*) AS n FROM monitor_source_manifest WHERE url IS NULL;',
    ).get() as { n: number };
    expect(noUrl.n).toBe(manifest.sources.filter((s: any) => s.url === undefined).length);
    expect(noUrl.n).toBeGreaterThan(0);
  });

  test("CSME's inner group is held whole, not double-counted as members", () => {
    // The Enhanced Cooperation Four are already full CSME members. Promoting them to
    // bloc_members rows would count them twice, so the subgroup is kept as the file's
    // own object on bloc_index.
    const row = db.query("SELECT sub_bloc FROM bloc_index WHERE id = 'csme';")
      .get() as { sub_bloc: string };
    const subBloc = JSON.parse(row.sub_bloc);
    expect(subBloc.members_iso).toEqual(['052', '084', '212', '670']);
    for (const iso of subBloc.members_iso) {
      const member = db.query(
        'SELECT COUNT(*) AS n FROM bloc_members WHERE bloc_id = ? AND iso_n3 = ?;',
      ).get('csme', iso) as { n: number };
      expect(member.n).toBe(1);
    }
    // Every other bloc has no inner group, and says so with NULL.
    const set = db.query('SELECT COUNT(*) AS n FROM bloc_index WHERE sub_bloc IS NOT NULL;')
      .get() as { n: number };
    expect(set.n).toBe(1);
  });

  test('discovery and verification tiers stay separate', () => {
    // A discovery hit is a lead, not evidence. Collapsing the tiers would let an
    // unverified feed source a claim.
    const tiers = db.query(
      'SELECT tier, COUNT(*) AS n FROM monitor_source_manifest GROUP BY tier ORDER BY tier;',
    ).all() as Array<{ tier: string; n: number }>;
    expect(tiers.map(t => t.tier)).toEqual(['discovery', 'verification']);
    for (const { tier, n } of tiers) {
      expect(n).toBe(manifest.sources.filter((s: any) => s.tier === tier).length);
    }
    // 'multi' is a real jurisdiction label for cross-border aggregators, which is why
    // the child table is not constrained to the registry.
    const multi = db.query(
      "SELECT COUNT(*) AS n FROM monitor_source_jurisdictions WHERE jurisdiction = 'multi';",
    ).get() as { n: number };
    expect(multi.n).toBeGreaterThan(0);
  });

  test('single quotes in prose survive the SQL literal escaping', () => {
    // Russia's lane says "via a 'patent'". An unescaped quote would either truncate
    // the row or fail the statement, so assert the text arrives whole.
    const lane = db.query("SELECT grants FROM bilateral_lane_index WHERE id = 'russia_cis_patent';")
      .get() as { grants: string };
    expect(lane.grants).toContain("via a 'patent'");
    expect(lane.grants).toBe(
      blocsData.bilateral_lanes.find((l: any) => l.id === 'russia_cis_patent').grants);
  });
});

describe('these tables are standalone, by design', () => {
  test('nothing references the canonical entity/revision model', () => {
    // 0008 must not repeat arrangement_index, which is keyed on a revision_id and
    // carries a trigger requiring a canonical entity. Referencing that model would
    // put a bloc membership list behind gates built for nationality-law claims.
    // Comments stripped: the file's header explains WHY arrangement_index and its
    // revision_id are the wrong model, and that prose must not trip the check.
    const ddl = splitStatements(
      readFileSync(join(root, 'data/d1/migrations/0008_reference_data.sql'), 'utf8'),
    ).join('\n');
    for (const forbidden of ['canonical_entities', 'canonical_revisions', 'revision_id', 'TRIGGER']) {
      expect(ddl).not.toContain(forbidden);
    }
    // Every foreign key it does declare points inside 0008 itself.
    const targets = [...ddl.matchAll(/REFERENCES\s+(\w+)/g)].map(match => match[1]);
    expect(targets.length).toBeGreaterThan(0);
    const own = new Set([...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]));
    for (const target of targets) expect(own).toContain(target);
  });
});

import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agreementById,
  agreementGrantsLabel,
  agreementKindLabel,
  buildAgreementsFile,
  buildLicenceIndex,
  buildOriginSlices,
  isosForAgreement,
  listAgreements,
  countryHasLicenceData,
  exchangeWindowLabels,
  listOrigins,
  matchesForOrigin,
  nationalityGateLabel,
  originSlicePath,
  resolveExchangeWindow,
  summariseCountry,
  testLabel,
  type LicenceExchangeData,
} from '../src/lib/licence-exchange';
import { renderLicenceSql, splitStatements } from '../scripts/sync_canonical_d1';

const root = join(import.meta.dir, '..');

// A BUILD INPUT since #210, not a served file. The four regional research batches
// take this layer to 45 destinations and 909 entries; what ships is the index plus
// one slice per origin, both built from here.
const seed = JSON.parse(
  readFileSync(join(root, 'data/compiled/licence_exchange.json'), 'utf8'),
) as LicenceExchangeData;

/** The eleven originally seeded annexes, before the bilateral families were added. */
const ANNEX_ISOS = [
  '036', '040', '208', '250', '276', '372', '528', '554', '620', '724', '826',
];
/** Every destination now: the eleven annexes, Switzerland, South Korea and Dubai. */
const DEST_ISOS = [...ANNEX_ISOS, '410', '756', '784'];

describe('licence exchange seed (#171)', () => {
  test('every seeded list survives the regional batches, and every list is sourced', () => {
    expect(seed.schema_version).toBe(1);
    expect(seed.disclaimer.normal_residence).toMatch(/185 days/i);
    expect(seed.disclaimer.scope).toMatch(/not a guide to licence tourism/i);
    // The fourteen seeded lists are a floor, not the set: the four regional research
    // batches add 31 destinations on top. Asserted as a subset so a batch can land
    // without rewriting this test, and so a DROPPED seed list still fails it.
    const isos = new Set(seed.destinations.map(d => d.iso_n3));
    for (const iso of DEST_ISOS) expect(isos, `seeded list ${iso} is missing`).toContain(iso);
    for (const d of seed.destinations) {
      expect(d.entries.length).toBeGreaterThan(0);
      expect(d.source_url).toMatch(/^https?:\/\//);
      // A destination either has an ISO or names the sub-unit it is. Nothing may be
      // anonymous, because a null ISO is what keeps a province out of the paint.
      expect(d.iso_n3 ?? d.subnational_label, `${d.name} is neither a country nor a sub-unit`)
        .toBeTruthy();
    }
  });

  test('core instruments remain wired', () => {
    const de = seed.destinations.find(d => d.iso_n3 === '276')!;
    const uk = seed.destinations.find(d => d.iso_n3 === '826')!;
    const es = seed.destinations.find(d => d.iso_n3 === '724')!;
    const at = seed.destinations.find(d => d.iso_n3 === '040')!;
    const au = seed.destinations.find(d => d.iso_n3 === '036')!;
    expect(de.source_url).toContain('fev_2010/anlage_11');
    expect(uk.source_url).toContain('legislation.gov.uk');
    expect(es.source_url).toContain('dgt.es');
    expect(at.source_url).toContain('oesterreich.gv.at');
    expect(au.source_url).toContain('austroads.gov.au');
  });

  test('Switzerland is no retest in Germany; Connecticut requires theory', () => {
    const entries = seed.destinations.find(d => d.iso_n3 === '276')!.entries;
    const ch = entries.find(e => e.origin_label_en === 'Switzerland' || e.origin_label === 'Schweiz');
    expect(ch).toBeTruthy();
    expect(ch!.no_retest).toBe(true);
    // Looked up the way every reader now resolves a sub-national row — label first,
    // subnational_label only where the authority's wording differs from the English.
    const ct = entries.find(e => (e.subnational_label ?? e.origin_label_en) === 'Connecticut');
    expect(ct!.subnational).toBe(true);
    expect(ct!.theory_test_required).toBe(true);
    expect(ct!.practical_test_required).toBe(false);
  });

  test('Spain lists Paraguay with car/moto no tests; truck/bus caveat survives', () => {
    const es = seed.destinations.find(d => d.iso_n3 === '724')!;
    const py = es.entries.find(e => e.origin_iso_n3 === '600');
    expect(py).toBeTruthy();
    expect(py!.no_retest).toBe(true);
    // The caveat used to be stamped on all 33 rows identically, which is a destination
    // fact wearing a row's clothes — and ~2.8KB of a capped public surface. It moved to
    // dest.notes verbatim, so the guarantee is that it is still SAID, not where.
    expect(py!.note ?? '').toBe('');
    expect((es.notes ?? []).join(' ')).toMatch(/Truck|C\/D|bus/i);
  });

  test('Japan matches every seeded annex without practical retest', () => {
    const matches = matchesForOrigin(seed, 'nat:392');
    const matched = new Set(matches.map(m => m.destination.iso_n3));
    // The eleven annexes plus Dubai, not every destination: neither the Swiss
    // SR 0.741.531 series nor the Korean MOFA register contains a Japanese instrument,
    // and a country-shaped list must not be assumed to cover a country it omits. RTA
    // does list Japan, on its widest gate ("All countries"), so it belongs here.
    for (const iso of [...ANNEX_ISOS, '784']) {
      expect(matched, `Japan should match ${iso}`).toContain(iso);
    }
    expect(matched).not.toContain('756'); // Switzerland
    expect(matched).not.toContain('410'); // South Korea
    expect(matches.every(m => !m.any_practical)).toBe(true);
  });

  test('lookup groups US under parent with subnational variance (DE)', () => {
    const matches = matchesForOrigin(seed, 'nat:840');
    const de = matches.find(m => m.destination.iso_n3 === '276');
    expect(de).toBeTruthy();
    expect(de!.varies_by_subnational).toBe(true);
  });

  test('country summary for Paraguay and Japan', () => {
    const py = summariseCountry(seed, '600');
    expect(countryHasLicenceData(py)).toBe(true);
    // France and Spain from the seed; Finland's Traficom list is the batch that added
    // the third. A Paraguayan licence has no other mapped destination.
    expect(py.as_origin_destinations.map(d => d.iso_n3).sort()).toEqual(['246', '250', '724']);

    const jp = summariseCountry(seed, '392');
    expect(jp.as_origin_destinations.length).toBeGreaterThanOrEqual(12);
  });

  test('listOrigins is non-empty and sorted', () => {
    const origins = listOrigins(seed);
    expect(origins.length).toBeGreaterThan(40);
    const labels = origins.map(o => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  test('testLabel wording', () => {
    expect(testLabel(false, false)).toBe('No tests required');
    expect(testLabel(true, false)).toBe('Theory test required');
  });
});

describe('agreement layer: three legally different things, no longer one list', () => {
  // The defect this fixes. Spain's source is titled "Paises con convenio de canjes"
  // — countries with a negotiated exchange agreement — while Germany's Anlage 11 FeV
  // is a domestic annex Germany maintains alone. Both rendered as an identical list
  // of country names, hiding the difference that actually matters to a reader: a
  // treaty binds a counterparty, an annex can be amended by one ministry.

  test('Spain is a negotiated agreement and carries its Latin American members', () => {
    const spain = agreementById(seed, 'licence-spain')!;
    expect(spain.kind).toBe('bilateral_agreement');
    expect(spain.kind_verified).toBe(true);
    // The bloc the owner described: most of Latin America swaps into Spain.
    for (const iso of ['600', '032', '170', '604', '858']) { // Paraguay, Argentina, Colombia, Peru, Uruguay
      expect(spain.beneficiaries, `Spain should cover ${iso}`).toContain(iso);
    }
  });

  test('Germany is a unilateral annex, not an agreement', () => {
    const germany = agreementById(seed, 'licence-germany')!;
    expect(germany.kind).toBe('unilateral_recognition');
    expect(germany.directionality).toBe('asymmetric');
  });

  test('an unproven basis says so instead of guessing', () => {
    // Typing an arrangement from the title of the page that publishes it is a
    // hypothesis. Anything not yet read against its instrument stays `unknown` and
    // renders as "Basis not established" rather than borrowing a friendlier word.
    for (const agreement of listAgreements(seed)) {
      if (agreement.kind === 'unknown') expect(agreement.kind_verified).toBeFalsy();
      else expect(agreement.kind_verified).toBe(true);
    }
    expect(agreementKindLabel('unknown')).toBe('Basis not established');
  });

  test('map ISOs keep direction separate', () => {
    // Under a unilateral annex the destination grants and the beneficiaries receive.
    // Merging them into one painted blob would imply a reciprocity that does not
    // exist, which is the whole reason `kind` was added.
    const germany = agreementById(seed, 'licence-germany')!;
    const isos = isosForAgreement(germany);
    expect([...isos.destinations]).toEqual(['276']);
    expect(isos.beneficiaries.has('276')).toBe(false);
    expect(isos.all.size).toBe(isos.destinations.size + isos.beneficiaries.size);
  });

  test('every entry resolves to an agreement, and every agreement to a destination', () => {
    const ids = new Set(listAgreements(seed).map(a => a.id));
    const destIsos = new Set(seed.destinations.map(d => d.iso_n3));
    for (const dest of seed.destinations) {
      expect(ids, `${dest.name} has no agreement`).toContain(dest.agreement_id!);
    }
    // Deliberately NOT asserting the converse. A multilateral instrument covers
    // states we hold no annex for — Directive 2006/126/EC binds 30, of which we
    // have seeded lists for six. Requiring every agreement destination to be a
    // seeded destination would forbid exactly the bloc-shaped data this layer
    // exists to hold.
    // What makes an instrument multilateral is that it binds a GROUP, not that the
    // group is larger than our seed set. The Nordic 1985 agreement has four parties,
    // fewer than our eleven seeded destination lists, and is unambiguously
    // multilateral — the earlier "bigger than destIsos" proxy was wrong.
    const multilateral = listAgreements(seed).filter(a => a.kind === 'multilateral_instrument');
    expect(multilateral.length).toBeGreaterThan(0);
    for (const agreement of multilateral) {
      expect(agreement.destinations.length, `${agreement.id} binds a group`).toBeGreaterThan(1);
      // Symmetric means both sides are the same set: everyone grants and receives.
      if (agreement.directionality === 'symmetric') {
        expect([...agreement.destinations].sort()).toEqual([...agreement.beneficiaries].sort());
      }
    }
  });
});

describe('the EU/EEA instrument, and the arbitrage it forecloses', () => {
  const eea = () => agreementById(seed, 'licence-eea-directive')!;

  test('scope is 30 states, and Switzerland is not one of them', () => {
    // Our eu_eea bloc has 32 members. Directive 2006/126/EC binds the EU-27 plus
    // Iceland, Liechtenstein and Norway. Switzerland is not a party to the EEA
    // Agreement (art. 126(1) lists three EFTA states; art. 128 still records
    // Switzerland as one that may apply), so its licences travel on national
    // third-country law — Germany files it in Anlage 11, the list of states
    // OUTSIDE the EEA. Deriving the set from the bloc unchecked over-claims.
    expect(eea().destinations).toHaveLength(30);
    expect(eea().destinations).not.toContain('756'); // Switzerland
    expect(eea().destinations).not.toContain('826'); // United Kingdom, third country since 2020
  });

  test('it grants recognition, which is not exchange', () => {
    // Art. 2(1) is mutual RECOGNITION — you may drive on the licence you hold.
    // Exchange is art. 11(1) and is a right to REQUEST. Treating them as one
    // would overstate every EU row in the atlas.
    expect(eea().grants).toBe('recognition');
    expect(eea().exchange_article).toContain('11(1)');
    expect(eea().exchange_article).toContain('request');
  });

  test('a third-country licence cannot be laundered into bloc-wide validity', () => {
    // The finding that answers the arbitrage question. Under art. 11(6) a
    // third-country exchange is recorded on the new licence, the original is
    // surrendered, and a later member state "need not apply the principle of
    // mutual recognition". So Paraguay -> Spain does not yield an EEA-wide licence,
    // and the atlas must not imply that it does.
    expect(eea().third_country_carve_out).toContain('11(6)');
    expect(eea().third_country_carve_out).toContain('need not apply the principle of mutual recognition');
  });

  test('the successor directive is dated, not silently assumed away', () => {
    expect(eea().superseded_from).toBe('2029-11-26');
    expect(eea().superseded_note).toContain('2025/2205');
  });
});

describe('a licence is a residence artefact, and the data says so', () => {
  // The owner's reframe, and it is the right one: exclusivity is the POINT of this
  // layer, not a limitation of it. You cannot accumulate licences, so the one you
  // hold evidences where you actually live — which is why it is widely accepted as
  // proof of address. The layer maps which residence histories convert into which
  // documents, not how to collect them.
  test('the exclusivity chain is recorded, not just the exchange rows', () => {
    const eea = agreementById(seed, 'licence-eea-directive')!;
    expect(eea.exclusivity).toContain('No person may hold more than one driving licence');
    // Enforced and cross-checked between states, not merely asserted.
    expect(eea.exclusivity).toContain('shall refuse to issue');
  });

  test('the framing leads with what a licence evidences', () => {
    const said = seed.disclaimer.what_a_licence_evidences ?? '';
    expect(said).toContain('RESIDENCE ARTEFACT');
    // The three provisions that make the claim true must be cited, so the framing
    // is traceable rather than a slogan.
    for (const article of ['7(1)(e)', '7(5)(a)', '11(6)']) {
      expect(said, `should cite art. ${article}`).toContain(article);
    }
  });

  test('scope says there is nothing to stack', () => {
    expect(seed.disclaimer.scope).toContain('one-licence rule');
  });
});

describe('typing each list against its own instrument (#171)', () => {
  const kind = (id: string) => agreementById(seed, id)!.kind;

  test('the Netherlands is not an agreement, despite how we described it', () => {
    // Our record said "countries outside EU/EFTA WITH AGREEMENT". There is no
    // negotiated arrangement anywhere in the chain: the Regeling designates a list,
    // and its art. 2 lets RDW exchange any licence "om redenen, aan het algemeen
    // belang ontleend" — a discretionary domestic power with no counterparty.
    expect(kind('licence-netherlands')).toBe('unilateral_recognition');
    expect(agreementById(seed, 'licence-netherlands')!.basis).toContain('CORRECTION');
  });

  test('Denmark looks bilateral and is not', () => {
    // The sharpest case for why `kind` earns its place. The foreign state APPLIES
    // to join the scheme, so a counterparty initiates — but no agreement is
    // concluded, Faerdselsstyrelsen decides alone, and the decision is unappealable.
    // Initiation by a counterparty is not reciprocity.
    expect(kind('licence-denmark')).toBe('unilateral_recognition');
    expect(agreementById(seed, 'licence-denmark')!.basis).toContain('ansøgning fra det pågældende land');
  });

  test('Ireland is bilateral in substance even though the instrument is unilateral', () => {
    // Two-layered: a negotiated reciprocal MoU creates the entry, and a ministerial
    // order delivers it. Recorded by what creates the entry, with the mechanism
    // noted, because forcing either single label would lose the point.
    expect(kind('licence-ireland')).toBe('bilateral_agreement');
    expect(agreementById(seed, 'licence-ireland')!.basis).toContain('unilateral');
  });

  test('Austria is not pulled to multilateral by the treaties in its enabling act', () => {
    // FSG s.23(1) and (5) cite Paris 1930, Geneva 1955 and Vienna 1982 — but those
    // govern DRIVING ON a foreign licence as a visitor, not exchange. Exchange runs
    // solely through s.23(3) Z 5 and the FSG-DV s.9 list.
    expect(kind('licence-austria')).toBe('unilateral_recognition');
  });

  test('local-language labels survive the deduplication', () => {
    // origin_label is dropped where it duplicated the English name, but the
    // authority's own wording must not be lost where it differs.
    const germany = seed.destinations.find(d => d.iso_n3 === '276')!;
    const local = germany.entries.filter(e => e.origin_label && e.origin_label !== e.origin_label_en);
    expect(local.length).toBeGreaterThan(0);
    expect(local.some(e => e.origin_label === 'Albanien')).toBe(true);
  });
});

describe('the Nordic instrument, and the membership trap it sets', () => {
  const nordic = () => agreementById(seed, 'licence-nordic-1985')!;

  test('it is the only true multilateral EXCHANGE bloc outside the EU', () => {
    // Art. 1 gives recognition; art. 3 gives exchange WITHOUT a new driving test.
    // Every other non-EU arrangement found grants recognition only, or is a
    // unilateral domestic list.
    expect(nordic().kind).toBe('multilateral_instrument');
    expect(nordic().grants).toBe('recognition_and_exchange');
    expect(nordic().basis).toContain('uten å avlegge ny førerprøve');
  });

  test('Iceland is NOT a party, though it is in every other Nordic arrangement', () => {
    // Verified by absence in the Lovdata text, not assumed. Iceland IS in the Nordic
    // Passport Union and the common labour market, so a Nordic member list assembled
    // for movement is wrong here — the fourth time this session a list built for one
    // purpose proved wrong for another. Iceland reaches the same place via the EEA.
    expect(nordic().destinations.sort()).toEqual(['208', '246', '578', '752']);
    expect(nordic().destinations).not.toContain('352'); // Iceland
    expect(nordic().membership_note).toContain('NOT A PARTY');
  });
});

describe('every arrangement is now typed against its instrument', () => {
  test('nothing is left as an unproven guess', () => {
    for (const agreement of listAgreements(seed)) {
      expect(agreement.kind, `${agreement.id} is still unknown`).not.toBe('unknown');
      expect(agreement.kind_verified, `${agreement.id} is unverified`).toBe(true);
    }
  });

  test('Australia and New Zealand are unilateral, because no instrument binds them', () => {
    // The TTMRA does not cover driver licensing, and there is no Commonwealth
    // driver-licence instrument at all. The proof is the asymmetry: Queensland gives
    // NZ a bespoke statutory category, WA lists it in a departmental list, Victoria
    // has no list in legislation. Three architectures for one relationship.
    for (const id of ['licence-australia', 'licence-new-zealand']) {
      expect(agreementById(seed, id)!.kind).toBe('unilateral_recognition');
      expect(agreementById(seed, id)!.basis).toContain('Trans-Tasman Mutual');
    }
  });
});

describe('the atlas fold-in: agreements paint like blocs (#171)', () => {
  test('a shareable URL param round-trips', async () => {
    // The point of folding this into the atlas rather than leaving it on a
    // standalone page is a selection you can send someone.
    const { paramsForState } = await import('../src/url');
    const base: Record<string, unknown> = {
      view: 'map', blocs: [], lane: null, routeClass: null,
      licenceAgreement: 'licence-nordic-1985', country: null, countryName: null,
    };
    const params = paramsForState(new URLSearchParams(), base as never);
    expect(params.get('licence')).toBe('licence-nordic-1985');
  });

  test('direction survives into the paint sets', async () => {
    const { isosForAgreement } = await import('../src/lib/licence-exchange');
    // Symmetric instrument: both sides identical, so the map reads as one bloc.
    const nordic = isosForAgreement(agreementById(seed, 'licence-nordic-1985')!);
    expect([...nordic.destinations].sort()).toEqual([...nordic.beneficiaries].sort());

    // Unilateral annex: Germany grants, the others receive. Painting these the
    // same colour would show a reciprocity that does not exist, which is exactly
    // what the flat pre-agreement data did.
    const germany = isosForAgreement(agreementById(seed, 'licence-germany')!);
    expect([...germany.destinations]).toEqual(['276']);
    expect(germany.beneficiaries.has('276')).toBe(false);
    expect(germany.beneficiaries.size).toBeGreaterThan(20);
  });

  test('Spain paints Latin America, which is the case that started this', () => {
    const spain = isosForAgreement(agreementById(seed, 'licence-spain')!);
    for (const iso of ['600', '032', '170', '604', '858', '218']) {
      expect(spain.beneficiaries, `Spain should paint ${iso}`).toContain(iso);
    }
    expect([...spain.destinations]).toEqual(['724']);
  });
});

describe('Switzerland: a partner that is not a country (#171)', () => {
  const ch = () => agreementById(seed, 'licence-switzerland-bilaterals')!;
  const dest = () => seed.destinations.find(d => d.iso_n3 === '756')!;

  test('fifteen instruments, read one at a time, not one list', () => {
    expect(ch().kind).toBe('bilateral_agreement');
    expect(ch().kind_verified).toBe(true);
    expect([...isosForAgreement(ch()).destinations]).toEqual(['756']);
    expect(dest().entries).toHaveLength(15);
    // Each row cites its own SR number, because each row IS its own treaty. A single
    // source_url on the destination would have implied a Swiss list that does not exist.
    for (const e of dest().entries) {
      expect(e.note ?? '', `${e.origin_label_en} should cite its instrument`)
        .toMatch(/SR 0\.741\.531\./);
    }
    expect(dest().source_urls).toHaveLength(15);
  });

  test('EIGHT of the fifteen partners are sub-national, and none of them paints a country', () => {
    // The finding this whole agreement turns on. Seven Canadian provinces and one US
    // state concluded these instruments themselves; there is no Swiss treaty with
    // Canada or the United States anywhere in the SR 0.741.531 series. Painting either
    // federation would invent a federal arrangement out of eight sub-units.
    const subs = dest().entries.filter(e => e.subnational);
    expect(subs.map(e => e.origin_label_en).sort()).toEqual([
      'Alberta', 'Louisiana', 'Manitoba', 'Newfoundland and Labrador', 'Ontario',
      'Prince Edward Island', 'Quebec', 'Saskatchewan',
    ]);

    const painted = isosForAgreement(ch());
    for (const e of subs) {
      // No origin ISO, and no PARENT ISO either: the parent is the exact field that
      // would carry Quebec up into Canada, on the country page and in the origin picker.
      expect(e.origin_iso_n3, `${e.origin_label_en} must not carry a country ISO`).toBeNull();
      expect(e.parent_iso_n3, `${e.origin_label_en} must not carry a parent ISO`).toBeNull();
      // A null origin can never enter an ISO set, which is why nothing paints. Asserted
      // rather than left to luck: isosForAgreement reads the agreement's ISO lists, and
      // the guarantee is that no sub-national partner has smuggled one in.
      expect(painted.all.has(String(e.origin_iso_n3))).toBe(false);
    }
    expect(painted.all.has('124'), 'Canada must not be painted').toBe(false);
    expect(painted.all.has('840'), 'the USA must not be painted').toBe(false);
    expect([...painted.beneficiaries].sort())
      .toEqual(['056', '300', '348', '380', '438', '442', '724']);
  });

  test('not painting them is a decision, and the copy says so', () => {
    // The map drops a null ISO silently — colorForIso only ever reads the two ISO sets.
    // Silence is the wrong answer on its own: a reader who sees Canada uncoloured must
    // be able to learn that seven of its provinces are in fact parties. So the choice
    // is disclosed in the rendered coverage copy, not just in a comment.
    expect(seed.disclaimer.coverage).toMatch(/sub-national/i);
    expect(seed.disclaimer.coverage).toMatch(/NOT PAINTED/);
    expect(seed.disclaimer.coverage).toContain('Louisiana');
    expect(ch().basis).toMatch(/EIGHT PARTNERS ARE SUB-NATIONAL/);
    expect((dest().notes ?? []).join(' ')).toMatch(/neither federation is painted/);
  });

  test('grants records the floor of a family that varies, not its maximum', () => {
    // grants sits on the agreement, and fifteen instruments do not agree: all fifteen
    // grant exchange, fourteen also grant recognition. Recording the widest value would
    // overstate Italy's 2021 accord, which recognises licences only «aux fins de
    // l'échange». The floor is true of every member; the upgrades live on the rows.
    expect(ch().grants).toBe('exchange');
    expect(ch().basis).toContain('FLOOR');
    expect(ch().basis).toContain("aux fins de l'échange");
  });

  test('a waiver of the driving test is not a waiver of the theory test', () => {
    // Luxembourg and Spain waive the «examen de conduite» and say nothing about theory.
    // Recording that as no_retest would turn silence into a right.
    for (const label of ['Luxembourg', 'Spain']) {
      const e = dest().entries.find(x => x.origin_label_en === label)!;
      expect(e.practical_test_required, `${label} practical`).toBe(false);
      expect(e.theory_test_required, `${label} theory`).toBeNull();
      expect(e.no_retest, `${label} no_retest`).toBe(false);
    }
    // Where the instrument says «sans avoir à subir un examen», unqualified, both go.
    const be = dest().entries.find(x => x.origin_label_en === 'Belgium')!;
    expect(be.no_retest).toBe(true);
    expect(be.classes).toMatch(/light motor cars/);
  });
});

describe('South Korea: nineteen titles, and what a title can prove (#171)', () => {
  const kr = () => agreementById(seed, 'licence-korea-treaties')!;
  const dest = () => seed.destinations.find(d => d.iso_n3 === '410')!;

  test('the kind is established even though the operative text was not read', () => {
    // Not a hedge. The register proves these are published instruments concluded in
    // simplified form, which is what `kind` asks. 도로교통법 s.84(2) calls the thing an
    // 약정 rather than a 조약, and that is drafting breadth, not a downgrade.
    expect(kr().kind).toBe('bilateral_agreement');
    expect(kr().kind_verified).toBe(true);
    expect(kr().basis).toContain('약정');
    expect([...isosForAgreement(kr()).destinations]).toEqual(['410']);
  });

  test('grants is read from the title, and the data admits it', () => {
    // All nineteen rows cite the SAME register page. That page proves each instrument
    // exists and what it is called; it carries none of the articles. So the floor of
    // the nineteen titles is what gets recorded, and the basis says why in as many words.
    expect(kr().grants).toBe('recognition');
    expect(kr().basis).toContain('GRANTS IS READ FROM THE TITLE, NOT THE OPERATIVE TEXT');
    const urls = new Set(dest().source_urls ?? []);
    expect(urls.size).toBe(1);
    for (const e of dest().entries) expect(e.note ?? '').toMatch(/고시 \d+ — title:/);
  });

  test('class matching only where KoRoad says so — sixteen rows stay unrecorded', () => {
    const matched = dest().entries.filter(e => e.classes);
    expect(matched.map(e => e.origin_label_en).sort()).toEqual(['Belgium', 'Italy', 'Poland']);
    expect(dest().entries).toHaveLength(19);
    // The other sixteen are null, and null means NOT RECORDED. Sixteen of the nineteen
    // instruments are titled recognition AND exchange, so the temptation to infer class
    // matching from the title is exactly the one being refused here.
    for (const e of dest().entries) {
      if (matched.includes(e)) continue;
      expect(e.classes ?? null, `${e.origin_label_en} class`).toBeNull();
    }
  });

  test('no test requirement is asserted anywhere in the Korean list', () => {
    for (const e of dest().entries) {
      expect(e.theory_test_required, `${e.origin_label_en} theory`).toBeNull();
      expect(e.practical_test_required, `${e.origin_label_en} practical`).toBeNull();
      expect(e.no_retest, `${e.origin_label_en} no_retest`).toBe(false);
    }
    expect((dest().notes ?? []).join(' ')).toContain('NOT RECORDED');
  });

  test('Chile is carried and suspended: neither dropped nor painted', () => {
    // 고시 630 suspended the agreement in 2007 and no resumption instrument exists in
    // the category. Painting Chile would show a live treaty that is not one; dropping
    // the row would assert an absence the register does not support. It is a row that
    // is not a beneficiary — the only shape that says both true things at once.
    const cl = dest().entries.find(e => e.origin_iso_n3 === '152')!;
    expect(cl).toBeTruthy();
    expect(cl.note ?? '').toContain('SUSPENDED');
    expect(cl.note ?? '').toContain('고시 630');
    expect(isosForAgreement(kr()).all.has('152'), 'Chile must not be painted').toBe(false);
    expect(kr().beneficiaries).not.toContain('152');
    expect(kr().beneficiaries).toHaveLength(18);
    // And the suspension does not reach the separate administrative list, which is a
    // different route and must not be quietly folded into the treaty one.
    expect((dest().notes ?? []).join(' ')).toContain('133');
  });

  test('IDP-only instruments were excluded, and the exclusion is on the record', () => {
    // Vietnam and Sweden appear in the same register category but grant international
    // driving permits, not domestic licence recognition. Left out of the rows, named in
    // the basis, so a later reader does not "find" them and add them back.
    const labels = dest().entries.map(e => e.origin_label_en);
    expect(labels).not.toContain('Vietnam');
    expect(labels).not.toContain('Sweden');
    expect(kr().beneficiaries).not.toContain('704'); // Vietnam
    expect(kr().beneficiaries).not.toContain('752'); // Sweden
    expect(kr().basis).toContain('Vietnam and Sweden are excluded');
  });
});

describe('the invariants that keep a missing field from reading as a permission', () => {
  const NEW_DESTS = ['756', '410'];

  test('no_retest is derived from the two test fields, never asserted alone', () => {
    // The rule the whole layer turns on: null means NOT RECORDED, never "not required".
    // A row may only claim no retest where BOTH fields are recorded false, so an unknown
    // can never be laundered into a right by setting one flag.
    for (const iso of NEW_DESTS) {
      const dest = seed.destinations.find(d => d.iso_n3 === iso)!;
      for (const e of dest.entries) {
        const earned = e.theory_test_required === false && e.practical_test_required === false;
        expect(e.no_retest, `${dest.name}/${e.origin_label_en}`).toBe(earned);
      }
    }
  });

  test('every destination still resolves to an agreement, including the new two', () => {
    const ids = new Set(listAgreements(seed).map(a => a.id));
    for (const dest of seed.destinations) {
      expect(ids, `${dest.name} has no agreement`).toContain(dest.agreement_id!);
    }
    expect(ids).toContain('licence-switzerland-bilaterals');
    expect(ids).toContain('licence-korea-treaties');
  });

  test('the two deduplicated fields are omitted only where they restate a neighbour', () => {
    // Both cuts were made to fit 34 verified rows under the 200KB cap without dropping
    // any of them. They are safe because every reader already falls back, and they must
    // stay safe: a national row must never carry a parent that is not itself, and a
    // sub-national row must never lose its label.
    for (const dest of seed.destinations) {
      for (const e of dest.entries) {
        if (!e.subnational) {
          expect(e.parent_iso_n3 ?? e.origin_iso_n3, `${dest.name}/${e.origin_label_en}`)
            .toBe(e.origin_iso_n3);
        }
        expect(e.subnational_label ?? e.origin_label_en).toBeTruthy();
        if (e.subnational_label) expect(e.subnational_label).not.toBe(e.origin_label_en);
      }
    }
  });

  test('a sub-national origin is offered as itself, not as its federation', () => {
    // listOrigins groups sub-national rows under a parent when there is one (US states
    // under Germany's annex). With no parent there is nothing to group under, so Quebec
    // is offered as Quebec and carries no ISO for anything downstream to paint.
    const origins = listOrigins(seed);
    const quebec = origins.find(o => o.label === 'Quebec')!;
    expect(quebec).toBeTruthy();
    expect(quebec.iso_n3).toBeNull();
    expect(matchesForOrigin(seed, quebec.key).map(m => m.destination.iso_n3)).toEqual(['756']);
    // And Canada, which does appear as an origin elsewhere, has not gained Switzerland.
    expect(summariseCountry(seed, '124').as_origin_destinations.map(d => d.iso_n3))
      .not.toContain('756');
    expect(summariseCountry(seed, '840').as_origin_destinations.map(d => d.iso_n3))
      .not.toContain('756');
  });
});

describe('the nationality gate: who may use a listing, not only which licence (#210)', () => {
  const dubai = () => seed.destinations.find(d => d.iso_n3 === '784')!;
  const gateOf = (label: string) =>
    dubai().entries.find(e => e.origin_label_en === label)!.nationality_gate ?? null;

  test('RTA Dubai carries all sixty rows and all three gate values', () => {
    const entries = dubai().entries;
    expect(entries).toHaveLength(60);
    const counts = entries.reduce<Record<string, number>>((acc, e) => {
      const gate = e.nationality_gate ?? 'null';
      acc[gate] = (acc[gate] ?? 0) + 1;
      return acc;
    }, {});
    // The split the annex actually has, transcribed row by row. Pinned because the
    // destination's own prose states 17/38 — a figure that does not match its table,
    // and the rows are what the atlas serves.
    expect(counts).toEqual({ all: 20, nationals_only: 35, gcc: 5 });
  });

  test('the case that made the field necessary', () => {
    // A German licence held by an Indian national exchanges in Dubai. A Portuguese
    // one held by the same person does not. Same holder, same emirate, same service
    // — and before this field the difference survived only in free-text prose.
    expect(gateOf('Germany')).toBe('all');
    expect(gateOf('Portugal')).toBe('nationals_only');
    expect(gateOf('Saudi Arabia')).toBe('gcc');
  });

  test('null NEVER renders as open to all', () => {
    // The whole point of the field. Silence in a source is not a permission, so the
    // label says "not recorded" and nothing downstream may improve on that.
    expect(nationalityGateLabel(null)).toBe('Nationality rule not recorded');
    expect(nationalityGateLabel(undefined)).toBe('Nationality rule not recorded');
    expect(nationalityGateLabel(null)).not.toBe(nationalityGateLabel('all'));
    expect(nationalityGateLabel(null)).not.toMatch(/any|all/i);
    expect(nationalityGateLabel('all')).toBe('Any nationality');
    expect(nationalityGateLabel('nationals_only')).toMatch(/only/i);
    expect(nationalityGateLabel('gcc')).toMatch(/exception countries/i);
  });

  test('the thirteen other destinations record no gate, and record it as null', () => {
    // Not "all". None of them publishes a nationality rule, and inventing one from
    // that silence would mint a right for thirteen annexes at once.
    for (const dest of seed.destinations) {
      if (dest.iso_n3 === '784') continue;
      for (const e of dest.entries) {
        expect(e.nationality_gate ?? null, `${dest.name}/${e.origin_label_en}`).toBeNull();
      }
    }
  });

  test('a match surfaces every distinct gate, so a mixed list cannot read as open', () => {
    // RTA lists the USA "with the exception of the State of Texas" on the open gate
    // and Texas separately on the narrow one. Collapsing the two into one answer
    // would be wrong for whichever half of the readers it was not chosen for.
    const usa = matchesForOrigin(seed, 'nat:840').find(m => m.destination.iso_n3 === '784')!;
    expect(usa.entries.map(e => e.origin_label_en).sort()).toEqual([
      'Texas (United States of America)',
      'United States of America (with the exception of the State of Texas)',
    ]);
    expect([...usa.nationality_gates].sort()).toEqual(['all', 'nationals_only']);
    expect(usa.nationality_restricted).toBe(true);

    // And a destination that records nothing is not "restricted" — it is unrecorded,
    // which the match reports as a single null gate rather than as a permission.
    const germany = matchesForOrigin(seed, 'nat:392').find(m => m.destination.iso_n3 === '276')!;
    expect(germany.nationality_gates).toEqual([null]);
    expect(germany.nationality_restricted).toBe(false);
  });

  test('the gate reaches the prerendered page, and the null rows print no badge', () => {
    const { DrivingLicencesPage } = require('../src/components/DrivingLicencesPage');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { createElement } = require('react');
    const html = renderToStaticMarkup(createElement(DrivingLicencesPage, { data: seed }));
    const text = html.replace(/\s+/g, ' ');
    expect(html).toContain('data-nationality-gate="nationals_only"');
    expect(html).toContain('Nationals of the issuing country only');
    // The no-JS path must not be where a reader learns a gate exists only for Dubai.
    expect(text).toMatch(/gate listed origins on the holder’s nationality/);
    expect(text).toMatch(/silence, not permission/);
    // No row anywhere is labelled as open on the strength of an absent field.
    expect(html).not.toContain('data-nationality-gate="null"');
    expect(html).not.toContain('data-nationality-gate="undefined"');
  });
});

describe('two clocks, and neither can be read as the other (#210)', () => {
  test('a deadline to claim and a grace period before compulsion are different fields', () => {
    // Türkiye's m.88(b) six months runs from ENTRY and ends in an obligation; every
    // other window in this layer runs from residence and ends in a lapse. One
    // `exchange_window_months` carrying both is a number that cannot be read without
    // reading its prose, so there is no such field.
    const lapses = resolveExchangeWindow({ exchange_deadline_months: 6 });
    const compels = resolveExchangeWindow({ foreign_licence_grace_months: 6 });
    expect(lapses).not.toEqual(compels);
    expect(exchangeWindowLabels(lapses)[0]).toMatch(/lapses/);
    expect(exchangeWindowLabels(compels)[0]).toMatch(/compulsory/);
    expect(exchangeWindowLabels(lapses)[0]).not.toMatch(/compulsory/);
    expect(exchangeWindowLabels(compels)[0]).not.toMatch(/lapses/);
  });

  test('an entry window overrides its destination, which is how Italy varies by origin', () => {
    expect(resolveExchangeWindow(
      { exchange_deadline_months: 72 },
      { exchange_deadline_months: 48 },
    ).deadline_months).toBe(48);
    expect(resolveExchangeWindow({ exchange_deadline_months: 72 }, {}).deadline_months).toBe(72);
  });

  test('nothing recorded says nothing at all', () => {
    const nothing = resolveExchangeWindow({});
    expect(nothing).toEqual({ deadline_months: null, grace_months: null });
    expect(exchangeWindowLabels(nothing)).toEqual([]);
  });
});

describe('grants can decline to assert (#210)', () => {
  test('not_established is a value, not an absence dressed as recognition', () => {
    // Six destinations came back cannot_determine — the authority's own list could
    // not be read at all. With three affirmative values the row had to pick one and
    // then contradict it in a note; the label now says the true thing.
    expect(agreementGrantsLabel('not_established')).toBe('Not established');
    expect(agreementGrantsLabel(null)).toBe('Not recorded');
    expect(agreementGrantsLabel('recognition')).not.toBe(agreementGrantsLabel('not_established'));
  });

  test('a destination that declines to assert is never rendered as granting anything', () => {
    // The failure mode this replaces: a cannot_determine row carried `grants:
    // 'exchange'` and a note saying nothing was asserted, so every reader of the
    // structured field saw a right that had not been established. Neither label may
    // name a right.
    for (const grants of ['not_established', null, undefined] as const) {
      expect(agreementGrantsLabel(grants), String(grants))
        .not.toMatch(/recognition|exchange/i);
    }
    // And the two that DO name a right still do.
    expect(agreementGrantsLabel('exchange')).toMatch(/exchange/i);
    expect(agreementGrantsLabel('recognition_and_exchange')).toMatch(/recognition and exchange/i);
  });

  test('nothing currently in the corpus is hiding behind an affirmative value', () => {
    for (const agreement of listAgreements(seed)) {
      expect(['recognition', 'exchange', 'recognition_and_exchange', 'not_established', undefined])
        .toContain(agreement.grants);
    }
  });
});

describe('the corpus is a build input; the index and the slices are the surface (#210)', () => {
  const index = buildLicenceIndex(seed);
  const slices = buildOriginSlices(seed);
  const bytes = (value: unknown) => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);

  test('the corpus is no longer served, the way the citizenship corpus is not', () => {
    expect(existsSync(join(root, 'public/licence_exchange.json'))).toBe(false);
    expect(existsSync(join(root, 'data/compiled/licence_exchange.json'))).toBe(true);
    // And it is already past the cap that forced the split, which is the point: the
    // fix cannot be "trim it again".
    expect(bytes(seed)).toBeGreaterThan(200_000);
  });

  test('the index carries the map facet and the picker, not the rows', () => {
    expect(index.shape).toBe('licence-exchange-index');
    expect(index.agreements).toHaveLength(seed.agreements!.length);
    expect(index.destinations).toHaveLength(seed.destinations.length);
    expect(index.origins.length).toBe(listOrigins(seed).length);
    // No entries anywhere in it — that is what keeps it small as destinations land.
    expect(JSON.stringify(index)).not.toContain('theory_test_required');
    expect(bytes(index), `index is ${Math.round(bytes(index) / 1024)}KB`).toBeLessThan(200_000);
  });

  test('every origin is reachable, and every row in the corpus lands in exactly one slice', () => {
    const totalRows = seed.destinations.reduce((n, d) => n + d.entries.length, 0);
    const sliced = [...slices.values()].reduce(
      (n, slice) => n + slice.matches.reduce((m, match) => m + match.entries.length, 0), 0,
    );
    // Sub-national rows are answered under their parent AND under themselves where
    // there is no parent, so the slice total is bounded below by the corpus: the
    // guarantee that matters is that nothing is missing.
    expect(sliced).toBeGreaterThanOrEqual(totalRows);
    for (const origin of index.origins) {
      expect(slices.has(origin.slice), `${origin.label} has no slice`).toBe(true);
      expect(origin.destination_count).toBeGreaterThan(0);
    }
    // …and nothing is emitted that the index cannot reach. An orphan slice is a
    // published file no reader can arrive at, and a leading indicator that the two
    // halves of the split have drifted apart.
    const reachable = new Set(index.origins.map(o => o.slice));
    for (const path of slices.keys()) {
      expect(reachable.has(path), `${path} is orphaned: no index origin points at it`).toBe(true);
    }
    expect(reachable.size).toBe(slices.size);
  });

  test('index plus one slice says exactly what the monolith said', () => {
    // The equivalence the split has to preserve. For every origin, the slice's
    // answer must be the same answer matchesForOrigin gives over the whole corpus —
    // same destinations, same rows, same derived flags. Anything less and the served
    // surface has quietly become a different dataset from the one under test.
    for (const origin of listOrigins(seed)) {
      const fromCorpus = matchesForOrigin(seed, origin.key);
      const fromSlice = slices.get(originSlicePath(origin.key))!.matches;
      expect(fromSlice.map(m => m.destination.iso_n3), origin.label)
        .toEqual(fromCorpus.map(m => m.destination.iso_n3));
      fromSlice.forEach((match, i) => {
        const corpusMatch = fromCorpus[i];
        expect(match.entries, `${origin.label} → ${match.destination.name}`)
          .toEqual(corpusMatch.entries);
        expect(match.any_no_retest).toBe(corpusMatch.any_no_retest);
        expect(match.any_theory).toBe(corpusMatch.any_theory);
        expect(match.any_practical).toBe(corpusMatch.any_practical);
        expect(match.varies_by_subnational).toBe(corpusMatch.varies_by_subnational);
        expect(match.nationality_gates).toEqual(corpusMatch.nationality_gates);
        expect(match.nationality_restricted).toBe(corpusMatch.nationality_restricted);
      });
    }
  });

  test('what a reader downloads for one lookup stays under the cap', () => {
    // The cap the split exists to satisfy: tests/seo.test.ts holds every served JSON
    // under 200,000 bytes, and the corpus is 231KB before the other 31 destinations
    // land. The worst case a reader ever pays is the index plus the largest single
    // slice, so that is what is asserted — not just the average.
    const largest = Math.max(...[...slices.values()].map(bytes));
    expect(bytes(index)).toBeLessThan(200_000);
    expect(largest).toBeLessThan(200_000);
    expect(bytes(index) + largest,
      `worst-case lookup is ${Math.round((bytes(index) + largest) / 1024)}KB`)
      .toBeLessThan(200_000);
  });

  test('no slice is anywhere near the cap, and the biggest is the one to watch', () => {
    const biggest = [...slices.entries()]
      .map(([path, slice]) => ({ path, size: bytes(slice) }))
      .sort((a, b) => b.size - a.size)[0];
    expect(biggest.size, `${biggest.path} is ${Math.round(biggest.size / 1024)}KB`)
      .toBeLessThan(200_000);
  });

  test('slice paths are stable, URL-safe and unique', () => {
    expect(originSlicePath('nat:840')).toBe('/licence-exchange/nat-840.json');
    for (const path of slices.keys()) {
      expect(path).toMatch(/^\/licence-exchange\/[a-z0-9-]+\.json$/);
    }
    expect(new Set(slices.keys()).size).toBe(slices.size);
  });

  test('a slice answers the whole question for one origin', () => {
    const slice = slices.get(originSlicePath('nat:620'))!; // Portugal
    expect(slice.shape).toBe('licence-origin-slice');
    expect(slice.origin.label).toBe('Portugal');
    const dubai = slice.matches.find(m => m.destination.iso_n3 === '784')!;
    expect(dubai.entries[0].nationality_gate).toBe('nationals_only');
    expect(dubai.nationality_restricted).toBe(true);
    // The destination's caveats travel with the rows they qualify.
    expect((dubai.destination.notes ?? []).join(' ')).toMatch(/EMIRATE-LEVEL/);
    expect(dubai.destination.source_url).toContain('rta.ae');
  });
});

describe('the D1 projection carries the gate, not a note about it (#210)', () => {
  /**
   * Built in memory exactly as D1 will see it: 0007's DDL, then 0010's ALTER path,
   * then 0011's rebuild for sub-national destinations, then the rendered inserts.
   * 0010 and 0011 are the migrations that have to exist because ensureLicenceSchema's
   * CREATE IF NOT EXISTS cannot touch a table that already exists — the same reason
   * 0006 exists for arrangement_index. Order matters: 0011 rebuilds the table 0010
   * altered, so running them the other way round drops the columns 0010 added.
   */
  const db = (() => {
    const database = new Database(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    for (const file of [
      '0007_licence_exchange.sql',
      '0010_licence_nationality_gate.sql',
      '0011_licence_subnational_destination.sql',
    ]) {
      const ddl = readFileSync(join(root, 'data/d1/migrations', file), 'utf8');
      for (const statement of splitStatements(ddl)) database.exec(statement);
    }
    for (const statement of renderLicenceSql()) database.exec(statement);
    return database;
  })();

  const one = (sql: string): number => (db.query(sql).get() as { n: number }).n;

  test('every corpus row arrives; nothing is dropped by the natural key', () => {
    const rows = seed.destinations.reduce((n, d) => n + d.entries.length, 0);
    expect(one('SELECT COUNT(*) AS n FROM licence_exchange_index;')).toBe(rows);
    expect(one('SELECT COUNT(*) AS n FROM licence_agreement_index;'))
      .toBe(seed.agreements!.length);
  });

  test('the gate is queryable, which is what holding it structurally buys', () => {
    const gates = db.query(
      `SELECT nationality_gate AS gate, COUNT(*) AS n FROM licence_exchange_index
       WHERE destination_iso_n3 = '784' GROUP BY nationality_gate;`,
    ).all() as Array<{ gate: string | null; n: number }>;
    expect(Object.fromEntries(gates.map(g => [g.gate ?? 'null', g.n])))
      .toEqual({ all: 20, nationals_only: 35, gcc: 5 });
  });

  test('every other destination stores NULL, and NULL is not a value the CHECK invented', () => {
    expect(one(
      "SELECT COUNT(*) AS n FROM licence_exchange_index WHERE destination_iso_n3 != '784' AND nationality_gate IS NOT NULL;",
    )).toBe(0);
    // The column rejects anything outside the three published values, so a future
    // import cannot smuggle in a fourth meaning (least of all an empty string, which
    // is the classic way a NULL becomes an "all").
    expect(() => db.exec(
      "INSERT INTO licence_exchange_index (destination_iso_n3, origin_label_en, nationality_gate) VALUES ('999', 'Nowhere', '');",
    )).toThrow();
  });

  test('grants accepts not_established after the rebuild, and still rejects nonsense', () => {
    db.exec(
      "INSERT INTO licence_agreement_index (agreement_id, name, kind, directionality, instrument, source_url, grants)"
      + " VALUES ('t', 't', 'unknown', 'unknown', 't', 't', 'not_established');",
    );
    expect(one("SELECT COUNT(*) AS n FROM licence_agreement_index WHERE grants = 'not_established';"))
      .toBe(1);
    expect(() => db.exec(
      "INSERT INTO licence_agreement_index (agreement_id, name, kind, directionality, instrument, source_url, grants)"
      + " VALUES ('u', 'u', 'unknown', 'unknown', 'u', 'u', 'probably');",
    )).toThrow();
  });
});

describe('the four regional batches, and the distinctions that had to survive authoring', () => {
  const byName = (name: string) => seed.destinations.find(d => d.name === name)!;
  const byIso = (iso: string) => seed.destinations.find(d => d.iso_n3 === iso)!;
  const rowsOf = (dest: ReturnType<typeof byIso>) => new Map(
    dest.entries.map(e => [e.origin_label_en, e] as const),
  );

  test('the corpus is complete: 45 destinations, 909 rows, 47 agreements', () => {
    // Pinned, not derived. These are the four research files fully authored — 19
    // confirmed Americas destinations, 7 European, 4 Asian and Türkiye, on top of the
    // fourteen seeded. A number that moves without a batch landing is a silent edit.
    expect(seed.destinations).toHaveLength(45);
    expect(seed.destinations.reduce((n, d) => n + d.entries.length, 0)).toBe(909);
    expect(seed.agreements).toHaveLength(47);
    // Nothing was authored from a cannot_determine row: the six destinations whose
    // authority could not be read assert nothing, so they have no list here.
    for (const absent of ['Belgium', 'Saudi Arabia', 'Qatar', 'Malaysia', 'Thailand', 'Mexico']) {
      expect(seed.destinations.map(d => d.name)).not.toContain(absent);
    }
  });

  test('there is NO Canada row and NO United States row, at destination or in the paint', () => {
    // Driver licensing is provincial in Canada and state-level in the US: thirteen of
    // these destinations are sub-units running their own lists, and a federal row
    // would be an arrangement nobody concluded. The null ISO is what enforces it —
    // a null can never enter a painted set.
    for (const d of seed.destinations) {
      expect(d.iso_n3, `${d.name} must not be a federation`).not.toBe('124');
      expect(d.iso_n3, `${d.name} must not be a federation`).not.toBe('840');
    }
    for (const agreement of listAgreements(seed)) {
      const painted = isosForAgreement(agreement);
      expect(painted.destinations.has('124'), `${agreement.id} paints Canada`).toBe(false);
      expect(painted.destinations.has('840'), `${agreement.id} paints the USA`).toBe(false);
    }
    const subs = seed.destinations.filter(d => d.iso_n3 === null);
    expect(subs.map(d => d.subnational_label).sort()).toEqual([
      'Alberta', 'British Columbia', 'Connecticut', 'Delaware', 'Georgia', 'Indiana',
      'Kentucky', 'Louisiana', 'Ontario', 'Oregon', 'Vermont', 'Virginia', 'Wisconsin',
    ]);
    for (const d of subs) {
      // Their agreements grant, but paint no destination at all: there is no ISO to
      // paint, and borrowing the parent's would claim the federal list.
      expect(agreementById(seed, d.agreement_id)!.destinations, d.name).toEqual([]);
    }
  });

  test("Türkiye's clock is the opposite of everyone else's", () => {
    const tr = byIso('792');
    // m.88(b): six months FROM ENTRY during which the foreign licence may still be
    // driven on, at the end of which exchange becomes COMPULSORY. Nothing lapses.
    expect(tr.foreign_licence_grace_months).toBe(6);
    expect(tr.exchange_deadline_months ?? null).toBeNull();
    const labels = exchangeWindowLabels(resolveExchangeWindow(tr));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/compulsory/);
    expect(labels[0]).not.toMatch(/lapses/);
    // And no row claims a test-free exchange: neither m.88 nor the NVİ checklist
    // addresses examinations, and a checklist that omits a step is not a waiver.
    for (const e of tr.entries) {
      expect(e.theory_test_required, e.origin_label_en).toBeNull();
      expect(e.practical_test_required, e.origin_label_en).toBeNull();
      expect(e.no_retest).toBe(false);
    }
  });

  test('Italy varies BY ORIGIN, so the window sits on the entry and not on the list', () => {
    const it = byIso('380');
    expect(it.exchange_deadline_months ?? null).toBeNull();
    const rows = rowsOf(it);
    // Four years, refused outright after: Albania, Argentina, Switzerland, Ukraine.
    for (const label of ['Albania', 'Argentina', 'Switzerland', 'Ukraine']) {
      expect(rows.get(label)!.exchange_deadline_months, label).toBe(48);
    }
    // Six years on the same refused-outright terms for the named group.
    expect(rows.get('United Kingdom')!.exchange_deadline_months).toBe(72);
    expect(rows.get('Morocco')!.exchange_deadline_months).toBe(72);
    // And no deadline at all for the rest: after six years Italy still issues the
    // licence, subject to a revisione under art. 128. Recording 72 here would tell a
    // reader the right lapses when the ministry says it does not.
    expect(rows.get('Japan')!.exchange_deadline_months ?? null).toBeNull();
    expect(resolveExchangeWindow(it, rows.get('Albania')!).deadline_months).toBe(48);
    expect(resolveExchangeWindow(it, rows.get('Japan')!).deadline_months).toBeNull();
    expect((it.notes ?? []).join(' ')).toMatch(/three regimes/);
  });

  test('Italy\'s four restricted rows say so in the label, and are not painted', () => {
    const it = byIso('380');
    const restricted = it.entries.filter(e => (e.note ?? '').startsWith('RESTRICTED CATEGORY'));
    expect(restricted.map(e => e.origin_iso_n3).sort()).toEqual(['124', '152', '840', '894']);
    for (const e of restricted) {
      // The restriction must survive in a label, because a country page renders labels
      // and not notes — otherwise "United States → Italy, no tests required".
      expect(e.origin_label_en, e.origin_iso_n3 ?? '').toMatch(/diplomatic|government mission/);
    }
    const painted = isosForAgreement(agreementById(seed, 'licence-italy')!);
    for (const iso of ['124', '152', '840', '894']) {
      expect(painted.beneficiaries.has(iso), `Italy must not paint ${iso}`).toBe(false);
    }
  });

  test('Norway: the same list, opposite outcomes, which only per-row flags can say', () => {
    const rows = rowsOf(byIso('578'));
    for (const label of ['Australia', 'Canada', 'Israel', 'Monaco', 'New Zealand',
      'San Marino', 'South Korea', 'United States']) {
      const e = rows.get(label)!;
      expect(e.theory_test_required, label).toBe(true);
      expect(e.practical_test_required, label).toBe(true);
      expect(e.no_retest, label).toBe(false);
    }
    for (const label of ['United Kingdom', 'Switzerland']) {
      const e = rows.get(label)!;
      expect(e.theory_test_required, label).toBe(false);
      expect(e.practical_test_required, label).toBe(false);
    }
    // Japan converts class B only, with no test, and is the ONLY Norwegian route with
    // a deadline — which is why the deadline is on the row.
    expect(rows.get('Japan')!.exchange_deadline_months).toBe(12);
    expect(byIso('578').exchange_deadline_months ?? null).toBeNull();
    // Greenland: a practical test is stated, a theory test is not mentioned at all.
    expect(rows.get('Greenland')!.theory_test_required).toBeNull();
    expect(rows.get('Greenland')!.practical_test_required).toBe(true);
  });

  test('Sweden and Greece are null, not false — and only the Swiss Greek row escapes', () => {
    for (const e of byIso('752').entries) {
      // Transportstyrelsen enumerates a procedure with no examination step and never
      // says a test is not required. false would be a waiver nobody granted.
      expect(e.theory_test_required, `SE/${e.origin_label_en}`).toBeNull();
      expect(e.practical_test_required, `SE/${e.origin_label_en}`).toBeNull();
      expect(e.no_retest).toBe(false);
    }
    const greece = byIso('300');
    for (const e of greece.entries) {
      if (e.origin_iso_n3 === '756') continue;
      expect(e.theory_test_required, `GR/${e.origin_label_en}`).toBeNull();
      expect(e.practical_test_required, `GR/${e.origin_label_en}`).toBeNull();
    }
    // Only procedure 02.11's title carries «ΧΩΡΙΣ ΘΕΩΡΗΤΙΚΗ ΕΞΕΤΑΣΗ».
    const swiss = greece.entries.find(e => e.origin_iso_n3 === '756')!;
    expect(swiss.no_retest).toBe(true);
    expect(swiss.note ?? '').toContain('ΧΩΡΙΣ ΘΕΩΡΗΤΙΚΗ ΕΞΕΤΑΣΗ');
    // Sweden's one-year clock binds two of the four; the UK and the Faroes are carved
    // out on the page itself, so it cannot sit on the destination.
    const sweden = rowsOf(byIso('752'));
    expect(sweden.get('Switzerland')!.foreign_licence_grace_months).toBe(12);
    expect(sweden.get('Japan')!.foreign_licence_grace_months).toBe(12);
    expect(sweden.get('United Kingdom')!.foreign_licence_grace_months ?? null).toBeNull();
  });

  test('Singapore sits EVERY origin on the Basic Theory Test', () => {
    const sg = byIso('702');
    for (const e of sg.entries) {
      expect(e.theory_test_required, e.origin_label_en).toBe(true);
      // Recorded false, not inferred: the Traffic Police state the criteria
      // exhaustively and add a practical test only for the work-pass class upgrade.
      expect(e.practical_test_required, e.origin_label_en).toBe(false);
      expect(e.no_retest).toBe(false);
    }
    // The gate is the applicant, not the issuing state: one open row plus three
    // origins that merely owe an extra document.
    expect(sg.entries.some(e => e.origin_iso_n3 === null)).toBe(true);
    expect(sg.foreign_licence_grace_months).toBe(3);
  });

  test('Japan exchanges from everywhere; the 29-country list is only the confirmations', () => {
    const jp = byIso('392');
    const open = jp.entries.find(e => e.origin_label_en.startsWith('Any other country'))!;
    // 施行令 art. 34-4(2) waives the STATUTORY tests for any foreign Class 1 licence;
    // what an unlisted origin still sits is the administrative 知識確認 and 技能確認.
    // So the open row is "both confirmations required", not "no route".
    expect(open.theory_test_required).toBe(true);
    expect(open.practical_test_required).toBe(true);
    expect((jp.notes ?? []).join(' ')).toMatch(/NOT THE LIST OF COUNTRIES IT EXCHANGES FROM/);

    // Seven named states plus Indiana, carried as rows under the US so a US lookup
    // answers — and the United States deliberately NOT painted, because forty-three
    // states are outside the exemption.
    const states = jp.entries.filter(e => e.parent_iso_n3 === '840');
    expect(states.map(e => e.subnational_label).sort()).toEqual([
      'Colorado', 'Hawaii', 'Indiana', 'Maryland', 'Ohio', 'Oregon', 'Virginia', 'Washington',
    ]);
    for (const e of states) expect(e.origin_iso_n3, e.origin_label_en).toBeNull();
    expect(states.find(e => e.subnational_label === 'Indiana')!.theory_test_required).toBe(true);
    expect(isosForAgreement(agreementById(seed, 'licence-japan')!).all.has('840')).toBe(false);
    expect(matchesForOrigin(seed, 'nat:840').some(m => m.destination.iso_n3 === '392')).toBe(true);

    // Hong Kong is the contrast, and the two patterns must not be normalised: Cap.
    // 374B Schedule 4 lists the United States and Canada whole.
    const hk = rowsOf(byIso('344'));
    expect(hk.get('United States of America')!.subnational).toBe(false);
    expect(hk.get('Canada')!.origin_iso_n3).toBe('124');
    expect(isosForAgreement(agreementById(seed, 'licence-hong-kong')!).beneficiaries.has('840'))
      .toBe(true);
  });

  test('Latin America is modelled as the open arrangement it is, not as an invented list', () => {
    // Brazil, Chile, Costa Rica and Panama's main route accept any foreign licence on
    // residence and documentation. The honest shape is a row with no ISO and an
    // agreement with no beneficiaries — not a country list nobody published.
    for (const [id, iso] of [['licence-brazil', '076'], ['licence-chile', '152'],
      ['licence-costa-rica', '188']] as const) {
      expect(agreementById(seed, id)!.beneficiaries, id).toEqual([]);
      expect(byIso(iso).entries.every(e => e.origin_iso_n3 === null), iso).toBe(true);
    }
    // Panama has both: a universal homologación and a Spain-only canje.
    expect(agreementById(seed, 'licence-panama')!.beneficiaries).toEqual(['724']);
    // Uruguay carries the treaty that is in force and refuses to carry the one that
    // expired in 2019, which would have painted a live instrument that is not one.
    expect(agreementById(seed, 'licence-uruguay')!.beneficiaries).toEqual(['724']);
    expect(byIso('858').entries.map(e => e.origin_label_en)).not.toContain('Italy');
    // Brazil's 180 days is the recognition period art. 2 §4 turns into an obligation,
    // so it is the grace clock and it sits on the row that article governs.
    const recognised = byIso('076').entries.find(e => e.origin_label_en.includes('IS recognised'))!;
    expect(recognised.foreign_licence_grace_months).toBe(6);
    expect(recognised.practical_test_required).toBe(false);
    expect(byIso('076').entries.find(e => e.origin_label_en.includes('NOT recognised'))!
      .practical_test_required).toBe(true);
  });

  test('Kentucky is null because its page contradicts itself; B.C. carries its caveat', () => {
    const ky = byName('Kentucky (United States)');
    for (const e of ky.entries) {
      expect(e.theory_test_required, e.origin_label_en).toBeNull();
      expect(e.practical_test_required, e.origin_label_en).toBeNull();
    }
    expect((ky.notes ?? []).join(' ')).toMatch(/CONTRADICTS ITSELF/);
    // The B.C. list ships inside an RSC payload the quote gate strips, so the verified
    // quote proves the regime and not the membership. That has to be said in the row.
    const bc = byName('British Columbia (Canada)');
    expect((bc.notes ?? []).join(' ')).toMatch(/PROVENANCE WARNING/);
    expect((bc.notes ?? []).join(' ')).toMatch(/THE QUOTE PROVES THE REGIME, NOT THE LIST/);
    // ICBC waives KNOWLEDGE testing only for the foreign origins; false on the road
    // test would be inferred rather than sourced.
    const japan = bc.entries.find(e => e.origin_iso_n3 === '392')!;
    expect(japan.theory_test_required).toBe(false);
    expect(japan.practical_test_required).toBeNull();
    expect(japan.no_retest).toBe(false);
  });

  test('null survives authoring: 84 rows unrecorded on theory, 94 on practical', () => {
    // The count is pinned because the failure mode is silent and one-directional: a
    // later pass that "tidies" a null into a false turns a silence into a waiver, and
    // nothing else in this file would notice.
    const all = seed.destinations.flatMap(d => d.entries);
    expect(all.filter(e => (e.theory_test_required ?? null) === null)).toHaveLength(84);
    expect(all.filter(e => (e.practical_test_required ?? null) === null)).toHaveLength(94);
    // And no_retest stays derived from both fields everywhere, so an unknown can never
    // be laundered into a right.
    for (const d of seed.destinations) {
      for (const e of d.entries) {
        expect(e.no_retest, `${d.name}/${e.origin_label_en}`)
          .toBe(e.theory_test_required === false && e.practical_test_required === false);
      }
    }
  });

  test('the nationality gate is still Dubai\'s alone, across all 45 lists', () => {
    const gated = seed.destinations.flatMap(d => d.entries)
      .filter(e => (e.nationality_gate ?? null) !== null);
    expect(gated).toHaveLength(60);
    for (const d of seed.destinations) {
      if (d.iso_n3 === '784') continue;
      for (const e of d.entries) {
        expect(e.nationality_gate ?? null, `${d.name}/${e.origin_label_en}`).toBeNull();
      }
    }
  });

  test('the two typings that were changed from the research, and why', () => {
    // Poland and Czechia arrived typed multilateral_instrument because their annexes
    // are defined by the Geneva 1949 / Vienna 1968 conventions. Austria settled this:
    // the conventions govern DRIVING ON a foreign licence, and here they only define
    // which DOCUMENT escapes an extra examination — the exchange is domestic law.
    for (const id of ['licence-poland', 'licence-czechia']) {
      const agreement = agreementById(seed, id)!;
      expect(agreement.kind).toBe('unilateral_recognition');
      expect(agreement.basis).toContain('AUSTRIA PRECEDENT');
    }
    // Greece arrived typed bilateral_agreement; a KYA is a domestic ministerial
    // decision with no counterparty, which is the Dutch shape.
    expect(agreementById(seed, 'licence-greece')!.kind).toBe('unilateral_recognition');
    expect(agreementById(seed, 'licence-greece')!.basis).toContain('deliberate re-typing');
  });
});

describe('the served surface after the batches: prose moved, nothing dropped (#210)', () => {
  const index = buildLicenceIndex(seed);
  const slices = buildOriginSlices(seed);
  const bytes = (value: unknown) => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);

  test('the index paints from ISO lists; the reasoning ships beside it', () => {
    // 47 agreements' worth of `basis` and `residence_condition` is 79KB that every
    // first paint of the atlas was downloading to colour a map from two ISO arrays.
    // It is not trimmed — it is moved to the file a reader who asked for it fetches.
    expect(index.agreements).toHaveLength(seed.agreements!.length);
    expect(JSON.stringify(index)).not.toContain('"basis"');
    expect(JSON.stringify(index)).not.toContain('residence_condition');
    expect(index.agreements_detail).toBe('/licence-exchange/agreements.json');
    const detail = buildAgreementsFile(seed);
    expect(detail.agreements).toHaveLength(seed.agreements!.length);
    expect(detail.agreements.every(a => Boolean(a.basis))).toBe(true);
    expect(detail.agreements.every(a => Boolean(a.instrument && a.source_url))).toBe(true);
    expect(bytes(detail), `agreements file is ${Math.round(bytes(detail) / 1024)}KB`)
      .toBeLessThan(200_000);
    // The map facet still has everything it paints from.
    for (const summary of index.agreements) {
      const full = agreementById(seed, summary.id)!;
      expect(summary.destinations).toEqual(full.destinations);
      expect(summary.beneficiaries).toEqual(full.beneficiaries);
      expect(summary.kind).toBe(full.kind);
    }
  });

  test('every index origin still resolves to a shard, and there are 208 of them', () => {
    expect(index.origins).toHaveLength(208);
    expect(slices.size).toBe(208);
    for (const origin of index.origins) {
      expect(slices.has(origin.slice), `${origin.label} has no slice`).toBe(true);
    }
  });

  test('the worst-case lookup, and how little room is left', () => {
    // 111KB of index plus an 81KB slice for a South Korean licence — 192KB of a
    // 200KB budget, with the corpus now fully authored. The next thing to move out is
    // the destination `notes`, which are per-list caveats duplicated into every slice
    // that matches the list (45KB of that same 81KB). Recorded here so the next batch
    // reads the number before it adds to it.
    const largest = Math.max(...[...slices.values()].map(bytes));
    expect(bytes(index) + largest).toBeLessThan(200_000);
    expect(bytes(index) + largest).toBeGreaterThan(180_000);
  });
});

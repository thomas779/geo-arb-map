import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  agreementById,
  agreementKindLabel,
  isosForAgreement,
  listAgreements,
  countryHasLicenceData,
  listOrigins,
  matchesForOrigin,
  summariseCountry,
  testLabel,
  type LicenceExchangeData,
} from '../src/lib/licence-exchange';

const seed = JSON.parse(
  readFileSync(join(import.meta.dir, '../public/licence_exchange.json'), 'utf8'),
) as LicenceExchangeData;

/** The eleven originally seeded annexes, before the bilateral families were added. */
const ANNEX_ISOS = [
  '036', '040', '208', '250', '276', '372', '528', '554', '620', '724', '826',
];
/** Every destination now: the eleven annexes plus Switzerland and South Korea. */
const DEST_ISOS = [...ANNEX_ISOS, '410', '756'];

describe('licence exchange seed (#171)', () => {
  test('seed has thirteen destination lists plus disclaimer', () => {
    expect(seed.schema_version).toBe(1);
    expect(seed.disclaimer.normal_residence).toMatch(/185 days/i);
    expect(seed.disclaimer.scope).toMatch(/not a guide to licence tourism/i);
    expect(seed.destinations.map(d => d.iso_n3).sort()).toEqual([...DEST_ISOS].sort());
    expect(seed.destinations.length).toBe(13);
    for (const d of seed.destinations) {
      expect(d.entries.length).toBeGreaterThan(0);
      expect(d.source_url).toMatch(/^https?:\/\//);
    }
  });

  test('the served file stays under the 200KB public-surface cap', () => {
    // Enforced generically over public/*.json by tests/seo.test.ts; asserted here too
    // because this is the file that grows, and the failure it guards against is a
    // silent one — the atlas fetches the whole thing on first paint. When it next runs
    // out of room, reduce redundancy before dropping rows: three passes already have
    // (duplicate origin_label, a note repeated on every row of a list, subnational_label
    // and parent_iso_n3 restating the fields beside them) and there is more of it.
    const bytes = statSync(join(import.meta.dir, '../public/licence_exchange.json')).size;
    expect(bytes, `licence_exchange.json is ${Math.round(bytes / 1024)}KB`).toBeLessThan(200_000);
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
    // The eleven annexes, not the thirteen destinations: neither the Swiss SR
    // 0.741.531 series nor the Korean MOFA register contains a Japanese instrument,
    // and a country-shaped list must not be assumed to cover a country it omits.
    expect(matches.map(m => m.destination.iso_n3).sort()).toEqual([...ANNEX_ISOS].sort());
    expect(matches.every(m => m.any_no_retest || !m.any_practical)).toBe(true);
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
    expect(py.as_origin_destinations.map(d => d.iso_n3).sort()).toEqual(['250', '724']);

    const jp = summariseCountry(seed, '392');
    expect(jp.as_origin_destinations).toHaveLength(11);
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

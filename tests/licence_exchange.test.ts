import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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

const DEST_ISOS = [
  '036', '040', '208', '250', '276', '372', '528', '554', '620', '724', '826',
];

describe('licence exchange seed (#171)', () => {
  test('seed has eleven destination annexes plus disclaimer', () => {
    expect(seed.schema_version).toBe(1);
    expect(seed.disclaimer.normal_residence).toMatch(/185 days/i);
    expect(seed.disclaimer.scope).toMatch(/not a guide to licence tourism/i);
    expect(seed.destinations.map(d => d.iso_n3).sort()).toEqual([...DEST_ISOS].sort());
    expect(seed.destinations.length).toBe(11);
    for (const d of seed.destinations) {
      expect(d.entries.length).toBeGreaterThan(0);
      expect(d.source_url).toMatch(/^https?:\/\//);
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
    const ct = entries.find(e => e.subnational_label === 'Connecticut');
    expect(ct!.theory_test_required).toBe(true);
    expect(ct!.practical_test_required).toBe(false);
  });

  test('Spain lists Paraguay with car/moto no tests; truck/bus note', () => {
    const es = seed.destinations.find(d => d.iso_n3 === '724')!;
    const py = es.entries.find(e => e.origin_iso_n3 === '600');
    expect(py).toBeTruthy();
    expect(py!.no_retest).toBe(true);
    expect(py!.note ?? '').toMatch(/Truck|C\/D|bus/i);
  });

  test('Japan matches every seeded destination without practical retest', () => {
    const matches = matchesForOrigin(seed, 'nat:392');
    expect(matches.map(m => m.destination.iso_n3).sort()).toEqual([...DEST_ISOS].sort());
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
    expect(testLabel(false, false)).toBe('No retest');
    expect(testLabel(true, false)).toBe('Theory only');
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
    const multilateral = listAgreements(seed).filter(a => a.kind === 'multilateral_instrument');
    for (const agreement of multilateral) {
      expect(agreement.destinations.length, `${agreement.id} should span a bloc`).toBeGreaterThan(destIsos.size);
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

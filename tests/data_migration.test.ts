import { describe, expect, test } from 'bun:test';
import { buildDataShadow } from '../scripts/lib/data-shadow';

const shadow = buildDataShadow();

describe('data migration shadow', () => {
  test('reassembles the current public and curated shapes without drift', async () => {
    const mobility = await Bun.file(
      new URL('../public/blocs_data.json', import.meta.url),
    ).json();
    const citizenship = await Bun.file(
      new URL('../data/citizenship_routes.json', import.meta.url),
    ).json();
    expect(shadow.compatibility.mobility).toEqual(mobility);
    expect(shadow.compatibility.citizenship).toEqual(citizenship);
  });

  test('extracts the complete pilot set with stable entity identities', () => {
    expect(shadow.jurisdictions.map(item => item.jurisdiction.iso_n3)).toEqual([
      '012',
      '020',
      '024',
      '028',
      '032',
      '036',
      '040',
      '044',
      '052',
      '056',
      '068',
      '072',
      '076',
      '090',
      '096',
      '100',
      '116',
      '120',
      '124',
      '132',
      '136',
      '152',
      '156',
      '158',
      '170',
      '188',
      '191',
      '196',
      '203',
      '208',
      '212',
      '214',
      '218',
      '222',
      '231',
      '233',
      '242',
      '246',
      '250',
      '268',
      '276',
      '288',
      '296',
      '300',
      '308',
      '320',
      '340',
      '348',
      '352',
      '356',
      '360',
      '372',
      '376',
      '380',
      '384',
      '392',
      '400',
      '404',
      '410',
      '428',
      '438',
      '440',
      '442',
      '458',
      '470',
      '480',
      '484',
      '492',
      '504',
      '508',
      '516',
      '520',
      '528',
      '548',
      '554',
      '558',
      '566',
      '578',
      '583',
      '584',
      '585',
      '591',
      '598',
      '600',
      '604',
      '608',
      '616',
      '620',
      '626',
      '642',
      '646',
      '659',
      '662',
      '678',
      '686',
      '688',
      '690',
      '702',
      '703',
      '704',
      '710',
      '716',
      '724',
      '752',
      '756',
      '764',
      '776',
      '784',
      '788',
      '792',
      '798',
      '800',
      '818',
      '826',
      '834',
      '840',
      '858',
      '862',
      '882',
      '894',
    ])
    expect(shadow.arrangements.map(item => item.record.id)).toEqual([
      'eu_eea',
      'mercosur',
      'spain_iberoamerican',
    ]);
    expect(shadow.manifest.counts).toEqual({
      jurisdictions: 120,
      arrangements: 3,
      citizenship_routes: 25,
    });
  });

  test('uses content-addressed releases and records compatibility hashes', () => {
    expect(shadow.manifest.release_id).toMatch(/^[a-f0-9]{16}$/);
    expect(shadow.manifest.compatibility_hashes.mobility).toBe(
      shadow.manifest.source_hashes['public/blocs_data.json'],
    );
    expect(shadow.manifest.compatibility_hashes.citizenship).toBe(
      shadow.manifest.source_hashes['data/citizenship_routes.json'],
    );
  });
});

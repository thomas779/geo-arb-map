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
      '020',
      '028',
      '032',
      '036',
      '040',
      '044',
      '052',
      '056',
      '068',
      '076',
      '100',
      '116',
      '124',
      '136',
      '152',
      '158',
      '170',
      '196',
      '203',
      '208',
      '212',
      '218',
      '250',
      '268',
      '276',
      '288',
      '300',
      '308',
      '348',
      '356',
      '360',
      '372',
      '376',
      '380',
      '392',
      '400',
      '404',
      '410',
      '458',
      '470',
      '480',
      '484',
      '504',
      '520',
      '528',
      '548',
      '554',
      '566',
      '578',
      '591',
      '600',
      '604',
      '608',
      '616',
      '620',
      '642',
      '659',
      '662',
      '678',
      '688',
      '702',
      '704',
      '710',
      '724',
      '752',
      '756',
      '764',
      '784',
      '792',
      '818',
      '826',
      '840',
      '858',
      '882',
    ]);
    expect(shadow.arrangements.map(item => item.record.id)).toEqual([
      'eu_eea',
      'mercosur',
      'spain_iberoamerican',
    ]);
    expect(shadow.manifest.counts).toEqual({
      jurisdictions: 74,
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

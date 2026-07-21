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
      '032',
      '036',
      '076',
      '100',
      '124',
      '136',
      '170',
      '196',
      '212',
      '250',
      '268',
      '276',
      '300',
      '372',
      '380',
      '470',
      '484',
      '528',
      '554',
      '620',
      '659',
      '688',
      '702',
      '724',
      '756',
      '784',
      '792',
      '826',
      '840',
      '858',
    ]);
    expect(shadow.arrangements.map(item => item.record.id)).toEqual([
      'eu_eea',
      'mercosur',
      'spain_iberoamerican',
    ]);
    expect(shadow.manifest.counts).toEqual({
      jurisdictions: 30,
      arrangements: 3,
      citizenship_routes: 15,
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

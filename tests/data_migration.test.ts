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
      '250',
      '276',
      '372',
      '620',
      '724',
      '826',
    ]);
    expect(shadow.arrangements.map(item => item.record.id)).toEqual([
      'eu_eea',
      'mercosur',
      'spain_iberoamerican',
    ]);
    expect(shadow.manifest.counts).toEqual({
      jurisdictions: 6,
      arrangements: 3,
      citizenship_routes: 3,
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

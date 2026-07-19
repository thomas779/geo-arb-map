import { describe, expect, test } from 'bun:test';
import {
  CANONICAL_SCHEMAS,
  ChangeProposalSchema,
  jsonSchemaArtifacts,
} from '../scripts/lib/canonical-schema';
import { buildCanonicalPilot } from '../scripts/lib/canonical-pilot';

const pilot = buildCanonicalPilot();

describe('canonical v1 data schemas', () => {
  test('all pilot candidates validate against executable schemas', () => {
    for (const source of pilot.sources) {
      expect(CANONICAL_SCHEMAS.source.safeParse(source).success).toBe(true);
    }
    for (const jurisdiction of pilot.jurisdictions) {
      expect(CANONICAL_SCHEMAS.jurisdiction.safeParse(jurisdiction).success).toBe(true);
    }
    for (const arrangement of pilot.arrangements) {
      expect(CANONICAL_SCHEMAS.arrangement.safeParse(arrangement).success).toBe(true);
    }
  });

  test('keeps one jurisdiction identity and preserves existing route IDs', () => {
    const routeIds = pilot.jurisdictions.flatMap(item => item.routes.map(route => route.id));
    expect(routeIds).toEqual([
      'france-study-naturalization-residence',
      'portugal-ordinary-naturalization-2026',
      'portugal-birth-parent-residence-2026',
    ]);
    for (const jurisdiction of pilot.jurisdictions) {
      for (const route of jurisdiction.routes) {
        expect(route).not.toHaveProperty('country');
      }
    }
  });

  test('models eligibility time separately from processing time', () => {
    const france = pilot.jurisdictions.find(item => item.jurisdiction.iso_n3 === '250')!;
    const education = france.routes[0]!.variants.find(
      variant => variant.id === 'higher_education',
    )!;
    expect(education.timeline.eligibility_minimum_months).toBe(24);
    expect(education.timeline.processing_typical_months).toBeNull();
  });

  test('resolves every field-level source reference', () => {
    const sourceIds = new Set(pilot.sources.map(source => source.id));
    const references = [
      ...pilot.jurisdictions.flatMap(jurisdiction =>
        jurisdiction.routes.flatMap(route =>
          route.variants.flatMap(variant => variant.source_refs))),
      ...pilot.arrangements.flatMap(arrangement =>
        arrangement.pathways.flatMap(pathway => pathway.source_refs)),
    ];
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(sourceIds.has(reference.source_id), reference.source_id).toBe(true);
      expect(reference.supports_fields.every(field => field.startsWith('/'))).toBe(true);
    }
  });

  test('accepts typed evidence-backed proposals and rejects source-free ones', () => {
    const proposal = {
      schema_version: 1,
      entity_type: 'change_proposal',
      id: 'proposal:france:2026_07',
      signal_ids: ['signal:abc123'],
      target_entity_id: 'jurisdiction:250',
      action: 'update',
      effective_from: '2026-07-01',
      operations: [{
        op: 'replace',
        path: '/routes/france-study-naturalization-residence/variants/higher_education/timeline/eligibility_minimum_months',
        value: 24,
      }],
      source_refs: [{
        source_id: pilot.sources[0]!.id,
        supports_fields: ['/operations/0/value'],
      }],
      rationale: 'Primary-source review confirmed the structured timeline field.',
      review_status: 'draft',
      created_at: '2026-07-19T12:00:00.000Z',
    };
    expect(ChangeProposalSchema.safeParse(proposal).success).toBe(true);
    expect(ChangeProposalSchema.safeParse({ ...proposal, source_refs: [] }).success).toBe(false);
  });

  test('checked-in JSON Schemas are current', async () => {
    for (const [filename, schema] of Object.entries(jsonSchemaArtifacts())) {
      const checkedIn = await Bun.file(
        new URL(`../data/schemas/${filename}`, import.meta.url),
      ).json();
      expect(checkedIn).toEqual(schema);
    }
  });
});

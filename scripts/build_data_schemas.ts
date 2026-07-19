#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonSchemaArtifacts } from './lib/canonical-schema';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'data/schemas');

fs.mkdirSync(output, { recursive: true });
for (const [filename, schema] of Object.entries(jsonSchemaArtifacts())) {
  fs.writeFileSync(path.join(output, filename), `${JSON.stringify(schema, null, 2)}\n`);
}

console.log(`${Object.keys(jsonSchemaArtifacts()).length} canonical schemas → data/schemas`);

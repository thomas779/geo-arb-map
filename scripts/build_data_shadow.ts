#!/usr/bin/env bun
import { buildDataShadow, writeDataShadow } from './lib/data-shadow';

const shadow = buildDataShadow();
const output = writeDataShadow(shadow);

console.log(
  `data shadow ${shadow.manifest.release_id}: `
  + `${shadow.manifest.counts.jurisdictions} jurisdictions, `
  + `${shadow.manifest.counts.arrangements} arrangements, `
  + `${shadow.manifest.counts.citizenship_routes} citizenship routes`,
);
console.log(output);

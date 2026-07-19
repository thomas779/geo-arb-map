#!/usr/bin/env bun
import { buildCanonicalPilot, writeCanonicalPilot } from './lib/canonical-pilot';

const pilot = buildCanonicalPilot();
const output = writeCanonicalPilot(pilot);

console.log(
  `canonical candidate ${pilot.release_id}: `
  + `${pilot.manifest.counts.sources} sources, `
  + `${pilot.manifest.counts.jurisdictions} jurisdictions, `
  + `${pilot.manifest.counts.arrangements} arrangements, `
  + `${pilot.manifest.counts.routes} routes`,
);
console.log(output);

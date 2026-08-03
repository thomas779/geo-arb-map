import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderMonitorSummary } from '../scripts/render_monitor_summary';

describe('monitor workflow summary', () => {
  test('makes silent publication outcomes visible in the Actions summary', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-summary-'));
    fs.writeFileSync(path.join(directory, 'collection-report.json'), JSON.stringify({
      sources_attempted: 8,
      sources_failed: 1,
      signal_count: 3,
    }));
    fs.writeFileSync(path.join(directory, 'sweep-report.json'), JSON.stringify({
      mode: 'grounded',
      model: 'model-name',
      jurisdictions_selected: 12,
      calls_made: 12,
      findings: 2,
      by_status: { confirmed: 1, proposed: 1 },
      affects_dataset: 1,
    }));
    fs.writeFileSync(path.join(directory, 'news-report.json'), JSON.stringify({
      published: 0,
      skipped: 1,
      blocked: 1,
      dispositions: [{
        jurisdiction: 'Portugal',
        headline: 'Portugal changes a nationality rule',
        outcome: 'blocked',
        reason: 'primary_source: quote not found',
      }],
    }));

    const summary = renderMonitorSummary(directory);
    expect(summary).toContain('3 signals from 8 sources; 1 failures');
    expect(summary).toContain('2 findings across 12 jurisdictions (12 calls)');
    expect(summary).toContain('0 published; 1 blocked; 1 skipped');
    expect(summary).toContain('| Portugal | blocked | primary_source: quote not found |');
  });
});

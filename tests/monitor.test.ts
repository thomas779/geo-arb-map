import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSignal, dedupeSignals, makeSignal, signalId } from '../monitor/schema/signal';
import { parseRss, type RssSource } from '../monitor/collectors/rss';
import { parseNewsletterMessages } from '../monitor/collectors/email';
import { signalFromNewsletterDispatch } from '../monitor/collectors/github-dispatch';
import { parseTelegramPreview } from '../monitor/collectors/telegram';
import { collectHtmlPage, diffNormalizedText, parseHtmlSnapshot } from '../monitor/collectors/html';
import { expandHtmlPages, signalMatchesKeywords } from '../monitor/collectors/run';
import { MonitorStateStore, type MonitorPageState } from '../monitor/state';
import {
  canonicalArticleUrl,
  parseNewsletterRoutes,
  routeForMessage,
  routesForRecipient,
  routesFromRows,
  senderAllowed,
} from '../monitor/cloudflare/intake';
import { generateGroundedText } from '../monitor/llm/client';
import {
  buildSweepPrompt,
  findingToLead,
  loadRegistry,
  normalizeFindings,
  type Finding,
} from '../monitor/sweep/run';
import { datasetContextForJurisdiction } from '../monitor/triage/context';
import { buildNewsPost, fingerprint, synthesizeIssue } from '../monitor/publish/news';
import { inferJurisdictions } from '../monitor/triage/context';
import { normalizeRulings, parseJsonArray, seenSignalIds } from '../monitor/triage/triage';
import { buildIssueDraft } from '../monitor/triage/issues';

const retrievedAt = '2026-07-17T12:00:00.000Z';
const rssSource: RssSource = {
  id: 'test-rss',
  tier: 'discovery',
  adapter: 'rss',
  url: 'https://example.test/feed',
  jurisdictions: ['multi'],
};

describe('monitor Signal contract', () => {
  test('creates stable IDs and removes duplicates', () => {
    const signal = makeSignal({
      sourceId: 'source-a',
      tier: 'discovery',
      jurisdiction: 'multi',
      externalId: 'item-1',
      url: 'https://example.test/item-1',
      title: 'A possible rule change',
      retrievedAt,
    });
    expect(signal.id).toBe(signalId('source-a', 'item-1'));
    expect(dedupeSignals([signal, signal])).toEqual([signal]);
    expect(assertSignal(signal)).toBe(signal);
  });

  test('rejects incomplete signals', () => {
    expect(() => makeSignal({
      sourceId: 'source-a',
      tier: 'discovery',
      jurisdiction: 'multi',
      externalId: 'item-2',
      url: '',
      title: 'Missing URL',
      retrievedAt,
    })).toThrow('url');
  });
});

describe('monitor feed collector', () => {
  test('turns visible official-page changes into stable content-hash signals', () => {
    const source = {
      id: 'official-nationality-page',
      tier: 'verification' as const,
      adapter: 'html_index' as const,
      url: 'https://government.example.test/nationality',
      jurisdictions: ['380'],
    };
    const first = parseHtmlSnapshot(`
      <html><head><title>Nationality rules</title><script>window.build = 1</script></head>
      <body><h1>Nationality rules</h1><p>Five years of residence.</p></body></html>
    `, source, { retrievedAt })[0];
    const dynamicOnly = parseHtmlSnapshot(`
      <html><head><title>Nationality rules</title><script>window.build = 2</script></head>
      <body><h1>Nationality rules</h1> <p>Five years of residence.</p></body></html>
    `, source, { retrievedAt })[0];
    const changed = parseHtmlSnapshot(`
      <html><head><title>Nationality rules</title></head>
      <body><h1>Nationality rules</h1><p>Six years of residence.</p></body></html>
    `, source, { retrievedAt })[0];

    expect(first.id).toBe(dynamicOnly.id);
    expect(changed.id).not.toBe(first.id);
    expect(first.jurisdiction).toBe('380');
    expect(first.excerpt).toContain('Five years of residence.');
  });

  test('uses conditional requests and emits an actual diff only after the baseline changes', async () => {
    const source = {
      id: 'official-law', tier: 'verification' as const, adapter: 'html_index' as const,
      url: 'https://government.example.test/law', jurisdictions: ['470'],
    };
    const prior = {
      page_id: 'official-law:abc', source_id: source.id, url: source.url,
      jurisdiction: '470', state: 'healthy' as const, last_success_hash: 'old-hash',
      previous_text: null, current_text: 'Citizenship requires five years of residence.',
      etag: '"version-1"', last_modified: 'Mon, 20 Jul 2026 10:00:00 GMT',
      final_url: source.url, last_http_status: 200, last_attempted_at: retrievedAt,
      last_success_retrieved_at: retrievedAt, consecutive_failures: 0,
      last_error: null, updated_at: retrievedAt,
    } satisfies MonitorPageState;
    let requestHeaders: Headers | null = null;
    const result = await collectHtmlPage(source, prior, {
      retrievedAt,
      fetchImpl: (async (_url, init) => {
        requestHeaders = new Headers(init?.headers);
        return new Response('<html><title>Nationality law</title><body>Citizenship requires six years of residence.</body></html>', {
          status: 200,
          headers: { etag: '"version-2"', 'last-modified': 'Tue, 21 Jul 2026 10:00:00 GMT' },
        });
      }) as typeof fetch,
    });
    expect(requestHeaders!.get('if-none-match')).toBe('"version-1"');
    expect(requestHeaders!.get('if-modified-since')).toContain('20 Jul 2026');
    expect(result.observation.change_kind).toBe('page_changed');
    expect(result.observation.text_diff).toContain('- Citizenship requires five years');
    expect(result.observation.text_diff).toContain('+ Nationality law Citizenship requires six years');
    expect(result.signals[0]?.event_type).toBe('page_changed');
  });

  test('recognizes unchanged, deleted, and bot-protection responses', async () => {
    const source = {
      id: 'official-law', tier: 'verification' as const, adapter: 'html_index' as const,
      url: 'https://government.example.test/law', jurisdictions: ['470'],
    };
    const prior = {
      page_id: 'official-law:abc', source_id: source.id, url: source.url,
      jurisdiction: '470', state: 'healthy' as const, last_success_hash: 'old-hash',
      previous_text: null, current_text: 'Current law', etag: '"v1"', last_modified: null,
      final_url: source.url, last_http_status: 200, last_attempted_at: retrievedAt,
      last_success_retrieved_at: retrievedAt, consecutive_failures: 0,
      last_error: null, updated_at: retrievedAt,
    } satisfies MonitorPageState;
    const unchanged = await collectHtmlPage(source, prior, {
      retrievedAt, fetchImpl: (async () => new Response(null, { status: 304 })) as unknown as typeof fetch,
    });
    expect(unchanged.observation.change_kind).toBe('unchanged');
    const missing = await collectHtmlPage(source, prior, {
      retrievedAt, fetchImpl: (async () => new Response('gone', { status: 410 })) as unknown as typeof fetch,
    });
    expect(missing.observation.state).toBe('missing');
    expect(missing.observation.change_kind).toBe('access_changed');
    const blocked = await collectHtmlPage(source, prior, {
      retrievedAt,
      fetchImpl: (async () => new Response('<title>Just a moment...</title>Verify you are human', { status: 200 })) as unknown as typeof fetch,
    });
    expect(blocked.observation.state).toBe('blocked');
  });

  test('hashes official PDFs without storing binary bytes as SQLite text', async () => {
    const source = {
      id: 'official-pdf', tier: 'verification' as const, adapter: 'html_index' as const,
      url: 'https://government.example.test/nationality.pdf', jurisdictions: ['028'],
    };
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 255]);
    const baseline = await collectHtmlPage(source, null, {
      retrievedAt,
      fetchImpl: (async () => new Response(bytes, {
        status: 200, headers: { 'content-type': 'application/pdf', etag: '"pdf-v1"' },
      })) as unknown as typeof fetch,
    });
    expect(baseline.observation.change_kind).toBe('baseline');
    expect(baseline.observation.current_text).toMatch(/^PDF document · 10 bytes · SHA-256 /);
    expect(baseline.signals).toHaveLength(0);

    const prior = {
      page_id: baseline.observation.page_id, source_id: source.id, url: source.url,
      jurisdiction: '028', state: 'healthy' as const,
      last_success_hash: baseline.observation.current_hash,
      previous_text: null, current_text: baseline.observation.current_text,
      etag: '"pdf-v1"', last_modified: null, final_url: source.url,
      last_http_status: 200, last_attempted_at: retrievedAt,
      last_success_retrieved_at: retrievedAt, consecutive_failures: 0,
      last_error: null, updated_at: retrievedAt,
    } satisfies MonitorPageState;
    const changed = await collectHtmlPage(source, prior, {
      retrievedAt,
      fetchImpl: (async () => new Response(new Uint8Array([...bytes, 1]), {
        status: 200, headers: { 'content-type': 'application/pdf', etag: '"pdf-v2"' },
      })) as unknown as typeof fetch,
    });
    expect(changed.observation.change_kind).toBe('page_changed');
    expect(changed.signals).toHaveLength(1);
    expect(changed.signals[0]?.title).toContain('Official PDF changed');
  });

  test('expands several pages under one source and applies local-language filters', () => {
    const source = {
      id: 'official-gazette', tier: 'verification' as const, adapter: 'html_index' as const,
      status: 'active' as const, jurisdictions: ['724'],
      url: 'https://boe.example.test/civil-code',
      pages: [
        { id: 'civil-code', url: 'https://boe.example.test/civil-code' },
        { id: 'daily-gazette', url: 'https://boe.example.test/daily' },
      ],
      keywords: ['nacionalidad', 'naturalización'],
    };
    expect(expandHtmlPages(source)).toHaveLength(2);
    const signal = makeSignal({
      sourceId: source.id, tier: source.tier, externalId: 'notice-1',
      url: source.pages[1]!.url, title: 'Reforma de nacionalidad', retrievedAt,
    });
    expect(signalMatchesKeywords(signal, source)).toBe(true);
  });

  test('persists last-good text, metadata, failures, and observation history', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-state-test-'));
    const dbPath = path.join(directory, 'state.sqlite');
    const store = new MonitorStateStore(process.cwd(), dbPath);
    store.record({
      page_id: 'source:page', source_id: 'source', jurisdiction: '470',
      attempted_at: retrievedAt, state: 'healthy', change_kind: 'baseline', http_status: 200,
      requested_url: 'https://example.test/page', final_url: 'https://example.test/page',
      previous_hash: null, current_hash: 'hash-1', previous_text: null,
      current_text: 'Five years', text_diff: null, etag: '"v1"', last_modified: null, error: null,
    });
    store.record({
      page_id: 'source:page', source_id: 'source', jurisdiction: '470',
      attempted_at: '2026-07-18T12:00:00.000Z', state: 'blocked',
      change_kind: 'access_changed', http_status: 403,
      requested_url: 'https://example.test/page', final_url: 'https://example.test/page',
      previous_hash: 'hash-1', current_hash: null, previous_text: 'Five years',
      current_text: null, text_diff: null, etag: null, last_modified: null,
      error: 'blocked',
    });
    const page = store.getPage('source:page')!;
    expect(page.last_success_hash).toBe('hash-1');
    expect(page.current_text).toBe('Five years');
    expect(page.consecutive_failures).toBe(1);
    expect(store.database.query('SELECT COUNT(*) AS count FROM monitor_observations').get())
      .toEqual({ count: 2 });
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('chunks large snapshots into D1-portable SQL without losing text', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-state-sql-test-'));
    const sourceDb = path.join(directory, 'source.sqlite');
    const targetDb = path.join(directory, 'target.sqlite');
    const sqlPath = path.join(directory, 'mutations.sql');
    const largeText = `Citizenship law ${"'quoted provision' ".repeat(8_000)}`;
    const sourceStore = new MonitorStateStore(process.cwd(), sourceDb);
    sourceStore.record({
      page_id: 'large:page', source_id: 'large', jurisdiction: '300',
      attempted_at: retrievedAt, state: 'healthy', change_kind: 'baseline', http_status: 200,
      requested_url: 'https://example.test/large', final_url: 'https://example.test/large',
      previous_hash: null, current_hash: 'large-hash', previous_text: null,
      current_text: largeText, text_diff: null, etag: null, last_modified: null, error: null,
    });
    sourceStore.writeMutations(sqlPath);
    sourceStore.close();

    const rendered = fs.readFileSync(sqlPath, 'utf8');
    expect(Math.max(...rendered.split('\n').map(line => line.length))).toBeLessThan(50_000);
    const targetStore = new MonitorStateStore(process.cwd(), targetDb);
    targetStore.database.exec(rendered);
    expect(targetStore.getPage('large:page')?.current_text).toBe(largeText);
    expect(targetStore.database.query(
      'SELECT current_text FROM monitor_observations WHERE page_id = ?1',
    ).get('large:page')).toEqual({ current_text: largeText });
    targetStore.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('renders a bounded normalized textual diff', () => {
    expect(diffNormalizedText('five years residence', 'six years residence'))
      .toBe('- five years residence\n+ six years residence');
  });

  test('parses RSS and Atom into the same contract', () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel><item>
        <title><![CDATA[France &amp; its new rule]]></title>
        <link>https://example.test/rss</link>
        <guid>rss-1</guid>
        <description><![CDATA[<p>Residence changed.</p>]]></description>
        <pubDate>Fri, 17 Jul 2026 10:00:00 GMT</pubDate>
      </item></channel></rss>
      <feed><entry>
        <id>atom-1</id>
        <title>Portugal update</title>
        <link rel="alternate" href="https://example.test/atom" />
        <summary>Nationality timeline changed.</summary>
        <updated>2026-07-17T11:00:00Z</updated>
      </entry></feed>`;
    const signals = parseRss(xml, rssSource, { retrievedAt });
    expect(signals).toHaveLength(2);
    expect(signals[0].title).toBe('France & its new rule');
    expect(signals[0].excerpt).toBe('Residence changed.');
    expect(signals[1].url).toBe('https://example.test/atom');
  });

  test('normalizes agency newsletter messages only when they retain a canonical article URL', () => {
    const signals = parseNewsletterMessages([{
      message_id: 'fragomen-1',
      from: 'alerts@example.test',
      subject: 'Portugal: Nationality processing rule updated',
      text: 'A client alert describing the possible change.',
      received_at: '2026-07-17T10:00:00Z',
      canonical_url: 'https://example.test/portugal-update',
    }, {
      message_id: 'tracking-only',
      from: 'alerts@example.test',
      subject: 'No auditable source',
      text: 'This message has no public article.',
      received_at: '2026-07-17T10:00:00Z',
      canonical_url: 'mailto:private@example.test',
    }], {
      id: 'fragomen-client-alerts',
      tier: 'discovery',
      adapter: 'email',
      jurisdictions: ['multi'],
    }, { retrievedAt });
    expect(signals).toHaveLength(1);
    expect(signals[0].url).toBe('https://example.test/portugal-update');
  });

  test('attributes a shared Cloudflare intake address by allow-listed sender domain', () => {
    const routes = parseNewsletterRoutes(JSON.stringify([{
      source_id: 'fragomen-client-alerts',
      recipient: 'newsletters@monitor.example.test',
      allowed_sender_domains: ['fragomen.com'],
      canonical_hosts: ['fragomen.com'],
    }, {
      source_id: 'nomad-capitalist-newsletter',
      recipient: 'newsletters@monitor.example.test',
      allowed_sender_domains: ['nomadcapitalist.com'],
      canonical_hosts: ['nomadcapitalist.com'],
    }]));
    expect(routesForRecipient(routes, 'NEWSLETTERS@monitor.example.test')).toHaveLength(2);
    const route = routeForMessage(
      routes,
      'NEWSLETTERS@monitor.example.test',
      'alerts@news.fragomen.com',
    );
    expect(route?.source_id).toBe('fragomen-client-alerts');
    expect(senderAllowed(route!, 'alerts@news.fragomen.com')).toBe(true);
    expect(senderAllowed(route!, 'alerts@fragomen.example')).toBe(false);
    expect(routeForMessage(
      routes,
      'newsletters@monitor.example.test',
      'unknown@example.test',
    )).toBeNull();
    expect(canonicalArticleUrl({
      html: `
        <a href="https://mailer.example.test/click?url=https%3A%2F%2Fwww.fragomen.com%2Finsights%2Fportugal-update.html%3Futm_source%3Demail">Read</a>
        <a href="https://www.fragomen.com/unsubscribe">Unsubscribe</a>
      `,
    }, route!.canonical_hosts)).toBe(
      'https://www.fragomen.com/insights/portugal-update.html',
    );
  });

  test('rejects ambiguous sender mappings on a shared intake address', () => {
    expect(() => parseNewsletterRoutes(JSON.stringify([{
      source_id: 'source-a',
      recipient: 'newsletters@monitor.example.test',
      allowed_sender_domains: ['mailer.example.test'],
      canonical_hosts: ['example.test'],
    }, {
      source_id: 'source-b',
      recipient: 'newsletters@monitor.example.test',
      allowed_sender_domains: ['news.mailer.example.test'],
      canonical_hosts: ['example.test'],
    }]))).toThrow('Ambiguous SOURCE_ROUTES sender mapping');
  });

  test('builds validated routes from monitor_routes D1 rows', () => {
    const routes = routesFromRows([{
      source_id: 'expathub-georgia-newsletter',
      recipient: 'newsletters@atlas.example.test',
      allowed_sender_domains: '["expathub.ge"]',
      canonical_hosts: '["expathub.ge"]',
    }]);
    expect(routes).toHaveLength(1);
    expect(routes[0].allowed_sender_domains).toEqual(['expathub.ge']);
    const route = routeForMessage(routes, 'newsletters@atlas.example.test', 'news@expathub.ge');
    expect(route?.source_id).toBe('expathub-georgia-newsletter');
  });

  test('applies the same overlap invariant to D1 rows as to the secret', () => {
    expect(() => routesFromRows([{
      source_id: 'source-a',
      recipient: 'newsletters@atlas.example.test',
      allowed_sender_domains: '["mailer.example.test"]',
      canonical_hosts: '["example.test"]',
    }, {
      source_id: 'source-b',
      recipient: 'newsletters@atlas.example.test',
      allowed_sender_domains: '["news.mailer.example.test"]',
      canonical_hosts: '["example.test"]',
    }])).toThrow('Ambiguous SOURCE_ROUTES sender mapping');
  });

  test('rejects a monitor_routes row whose list column is not a JSON array', () => {
    expect(() => routesFromRows([{
      source_id: 'source-a',
      recipient: 'newsletters@atlas.example.test',
      allowed_sender_domains: 'expathub.ge',
      canonical_hosts: '["example.test"]',
    }])).toThrow('must be a non-empty string array');
  });

  test('normalizes a repository dispatch from a registered email source', async () => {
    const event = await Bun.file(
      new URL('./fixtures/monitor/newsletter-dispatch.json', import.meta.url),
    ).json();
    const signal = signalFromNewsletterDispatch(event, {
      sources: [{
        id: 'fragomen-client-alerts',
        tier: 'discovery',
        adapter: 'email',
        status: 'planned',
        jurisdictions: ['multi'],
      }],
    }, retrievedAt);
    expect(signal.source_id).toBe('fragomen-client-alerts');
    expect(signal.url).toContain('fragomen.com/insights/');
    expect(signal.published_at).toBe('2026-07-17T10:00:00.000Z');
  });

  test('parses allow-listed Telegram previews and ignores service messages', async () => {
    const html = await Bun.file(
      new URL('./fixtures/monitor/wandering-investor-telegram.html', import.meta.url),
    ).text();
    const signals = parseTelegramPreview(html, {
      id: 'wandering-investor-telegram',
      tier: 'discovery',
      adapter: 'telegram_html',
      url: 'https://t.me/s/thewanderinginvestor',
      channel: 'thewanderinginvestor',
      jurisdictions: ['multi'],
    }, { retrievedAt });
    expect(signals).toHaveLength(1);
    expect(signals[0].url).toBe('https://t.me/thewanderinginvestor/2500');
    expect(signals[0].title).toBe('Portugal nationality update');
  });
});

describe('monitor triage', () => {
  const signal = makeSignal({
    sourceId: 'globalcit-rss',
    tier: 'discovery',
    jurisdiction: 'multi',
    externalId: 'france-1',
    url: 'https://example.test/france',
    title: 'France changes student naturalization residence credit',
    excerpt: 'Colombia is not affected.',
    publishedAt: '2026-07-17T10:00:00Z',
    retrievedAt,
  });

  test('infers jurisdictions mentioned by multi-country sources', () => {
    expect(inferJurisdictions(signal, [
      { iso_n3: '250', name: 'France' },
      { iso_n3: '170', name: 'Colombia' },
      { iso_n3: '840', name: 'United States of America' },
    ])).toEqual(['250', '170']);
  });

  test('validates rulings and forces discovery leads to need a primary source', () => {
    const leads = normalizeRulings([{
      signal_id: signal.id,
      jurisdiction: '250',
      impact_type: 'physical_presence_requirement',
      summary: 'France may have changed which student residence counts.',
      needs_primary_source: false,
      confidence: 'medium',
    }], [signal], { [signal.id]: ['250'] });
    expect(leads).toHaveLength(1);
    expect(leads[0].needs_primary_source).toBe(true);
  });

  test('parses fenced model output and deduplicates issue markers', () => {
    expect(parseJsonArray('```json\n[]\n```')).toEqual([]);
    expect(parseJsonArray('Here is the result: [{"summary":"contains ] safely"}]\nDone.'))
      .toEqual([{ summary: 'contains ] safely' }]);
    expect(seenSignalIds([{ body: `lead\n<!-- signal:${signal.id} -->` }]).has(signal.id)).toBe(true);
  });

  test('renders review-first issue drafts with stable markers', () => {
    const lead = normalizeRulings([{
      signal_id: signal.id,
      jurisdiction: '250',
      impact_type: 'eligibility',
      summary: 'France may have changed eligibility.',
      needs_primary_source: true,
      confidence: 'low',
    }], [signal], { [signal.id]: ['250'] })[0];
    const draft = buildIssueDraft(lead);
    expect(draft.title).toContain('[Monitor lead]');
    expect(draft.body).toContain('Locate and cite the current primary');
    expect(draft.body).toContain(`<!-- signal:${signal.id} -->`);
  });
});

describe('AI sweep + grounded verify', () => {
  const groundedBody = {
    candidates: [{
      content: { parts: [{ text: '[{"iso_n3":"470","claim":"x"}]' }] },
      groundingMetadata: {
        groundingChunks: [{ web: { uri: 'https://redirect.example/abc', title: 'Gov MT' } }],
        webSearchQueries: ['malta citizenship 2026'],
      },
    }],
  };

  test('generateGroundedText sends the google_search tool, no JSON schema, and extracts citations', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(groundedBody), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const result = await generateGroundedText('find changes', {
      provider: 'openai-compatible', apiKey: 'secret-key', model: 'gemini-flash-latest',
      googleApiBaseUrl: 'https://gen.example/v1beta', timeoutMs: 1000,
    }, { fetcher });

    expect(result.text).toContain('"iso_n3":"470"');
    expect(result.citations).toEqual([{ uri: 'https://redirect.example/abc', title: 'Gov MT' }]);
    expect(result.searchQueries).toEqual(['malta citizenship 2026']);
    expect(calls[0].url).toBe('https://gen.example/v1beta/models/gemini-flash-latest:generateContent');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.tools).toEqual([{ google_search: {} }]);
    expect(sent.generationConfig.responseSchema).toBeUndefined();
    expect(sent.generationConfig.responseMimeType).toBeUndefined();
  });

  const entry = { iso_n3: '470', name: 'Malta' };
  const searched = { citations: [{ uri: 'https://x', title: 'x' }], searchQueries: ['q'] };

  test('normalizeFindings keeps sourced changes, drops not_found and sourceless confirmed', () => {
    const findings = normalizeFindings([
      { iso_n3: '470', claim: 'CBI closed', status: 'confirmed', primary_urls: ['https://gov.mt/x'], effective_date: '2025-07-23', affects_dataset: true, category: 'investment', brief: 'b' },
      { iso_n3: '470', claim: 'confirmed but no source', status: 'confirmed', primary_urls: [], brief: 'b' },
      { iso_n3: '470', claim: 'nothing', status: 'not_found', primary_urls: [], brief: 'b' },
      { iso_n3: '470', claim: 'a rumour', status: 'rumour', primary_urls: [], brief: 'b' },
    ], entry, searched);
    expect(findings.map(f => f.status)).toEqual(['confirmed', 'rumour']);
    expect(findings[0].effective_date).toBe('2025-07-23');
  });

  test('normalizeFindings drops everything when the model did not actually search', () => {
    const findings = normalizeFindings(
      [{ iso_n3: '470', claim: 'CBI closed', status: 'confirmed', primary_urls: ['https://gov.mt/x'], brief: 'b' }],
      entry,
      { citations: [], searchQueries: [] },
    );
    expect(findings).toEqual([]);
  });

  test('findingToLead maps a dataset-affecting finding to a Lead with a sourced signal', () => {
    const finding: Finding = {
      iso_n3: '470', jurisdiction: 'Malta', claim: 'CBI closed', status: 'confirmed',
      primary_urls: ['https://komunita.gov.mt/x'], effective_date: '2025-07-23', affects_dataset: true,
      category: 'investment', brief: 'Malta ended CBI.', citations: [], search_queries: ['q'],
    };
    const lead = findingToLead(finding);
    expect(lead?.impact_type).toBe('cost_or_investment_threshold');
    expect(lead?.confidence).toBe('high');
    expect(lead?.signal.url).toBe('https://komunita.gov.mt/x');
    expect(lead?.signal.excerpt).toContain('Sources: https://komunita.gov.mt/x');
    expect(findingToLead({ ...finding, primary_urls: [] })).toBeNull();
  });

  test('loadRegistry flattens all three arrays and maps special.id to iso_n3', () => {
    const entries = loadRegistry({
      sovereigns: [{ iso_n3: '004', name: 'Afghanistan' }],
      territories: [{ iso_n3: '660', name: 'Anguilla' }],
      special: [{ id: 'XKX', name: 'Kosovo' }],
    });
    expect(entries).toHaveLength(3);
    expect(entries[2]).toEqual({ iso_n3: 'XKX', name: 'Kosovo' });
  });

  test('buildSweepPrompt is delta-scoped and asks for a JSON array', () => {
    const context = datasetContextForJurisdiction('470', {
      jurisdictions: [{ iso_n3: '470', name: 'Malta', coverage: { ancestry: 'reviewed', naturalization: 'reviewed', birth: 'reviewed', investment: 'reviewed' } }],
      routes: [{ id: 'r1', country: { iso_n3: '470', name: 'Malta' }, mode: 'investment', status: 'inactive', title: 't', summary: 's', last_checked: '2026-01-01' }],
    }, { blocs: [], bilateral_lanes: [] });
    expect(context.signal_jurisdictions).toEqual({});
    expect(context.citizenship_routes).toHaveLength(1);
    const prompt = buildSweepPrompt(entry, context, ['ExpatHub: residence permit change']);
    expect(prompt).toContain('Malta');
    expect(prompt).toContain('JSON array');
    expect(prompt).toContain('residence permit change');
  });

  test('buildNewsPost + fingerprint + synthesizeIssue', () => {
    const finding: Finding = {
      iso_n3: '470', jurisdiction: 'Malta', claim: 'CBI closed', status: 'confirmed',
      primary_urls: ['https://komunita.gov.mt/x'], effective_date: '2025-07-23', affects_dataset: true,
      category: 'investment', brief: 'Malta ended CBI.', citations: [], search_queries: [],
    };
    const post = buildNewsPost(finding);
    expect(post.text).toContain('Malta: CBI closed');
    expect(post.text).toContain('https://komunita.gov.mt/x');
    expect(post.text).toContain('Information only');
    expect(() => buildNewsPost({ ...finding, primary_urls: [] })).toThrow('primary source');

    expect(fingerprint(finding)).toBe(fingerprint(finding));
    expect(fingerprint(finding)).not.toBe(fingerprint({ ...finding, effective_date: '2026-01-01' }));
    expect(synthesizeIssue(finding).body).toContain('## Verified evidence');
  });
});

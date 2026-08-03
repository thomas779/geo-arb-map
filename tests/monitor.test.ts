import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSignal, dedupeSignals, makeSignal, signalId } from '../monitor/schema/signal';
import { parseRss, type RssSource } from '../monitor/collectors/rss';
import { parseNewsletterMessages } from '../monitor/collectors/email';
import { signalFromNewsletterDispatch } from '../monitor/collectors/github-dispatch';
import { parseTelegramPreview } from '../monitor/collectors/telegram';
import { signalMatchesKeywords, runCollectors } from '../monitor/collectors/run';
import {
  buildUserPrompt,
  loadWatchlist,
  parseXSearchResponse,
  resolveIso,
  xSearchConfigFromEnv,
  type XSearchConfig,
} from '../monitor/collectors/x_search';
import {
  blueskyEndpoint,
  collectBluesky,
  handleFromProfileUrl,
  parseBlueskyPosts,
  postUrl,
  type BlueskySource,
} from '../monitor/collectors/bluesky';
import {
  buildDirectoryPrompt,
  buildReversePrompt,
  parseSeedCandidates,
} from '../monitor/discovery/x_seed';
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
  changeKey,
  findingToLead,
  loadRegistry,
  normalizeCategory,
  normalizeFindings,
  normalizeInstrument,
  officialSourcesByJurisdiction,
  selectJurisdictions,
  type Finding,
} from '../monitor/sweep/run';
import { datasetContextForJurisdiction } from '../monitor/triage/context';
import { buildNewsPost, fingerprint, synthesizeIssue, proseDateFromIso, verifySourceUrl, verifyPrimarySource, detectTopicGraft, quoteOnPage, normalizeText, corroboratedByCitations, NewsPostStore, runNews } from '../monitor/publish/news';
import {
  CitationStore,
  discoverFeed,
  feedCandidateUrls,
  hostFromUrl,
  isGovish,
  isSocialHost,
  manifestHosts,
  sourceKeyFromUrl,
} from '../monitor/discovery/citations';
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
  test('matches keyword filters case-insensitively', () => {
    const source = {
      id: 'gazette', tier: 'verification' as const, adapter: 'rss' as const,
      status: 'active' as const, jurisdictions: ['724'],
      url: 'https://gazette.example.test/feed',
      keywords: ['nacionalidad', 'naturalización'],
    };
    const hit = makeSignal({
      sourceId: source.id, tier: source.tier, externalId: 'notice-1',
      url: 'https://gazette.example.test/1', title: 'Reforma de NACIONALIDAD', retrievedAt,
    });
    const miss = makeSignal({
      sourceId: source.id, tier: source.tier, externalId: 'notice-2',
      url: 'https://gazette.example.test/2', title: 'Weather update', retrievedAt,
    });
    expect(signalMatchesKeywords(hit, source)).toBe(true);
    expect(signalMatchesKeywords(miss, source)).toBe(false);
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

  test('resolves numeric jurisdictions to names before creating issue titles', () => {
    const leads = normalizeRulings([{
      signal_id: signal.id,
      jurisdiction: '840',
      impact_type: 'eligibility',
      summary: 'The United States may have changed eligibility.',
      needs_primary_source: true,
      confidence: 'medium',
    }], [signal], { [signal.id]: ['840'] }, { '840': 'United States of America' });
    expect(leads[0].jurisdiction).toBe('United States of America');
    expect(buildIssueDraft(leads[0]).title).toContain('United States of America');
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
    steps: [
      { type: 'google_search_call', arguments: { queries: ['malta citizenship 2026'] } },
      {
        type: 'message',
        content: [{
          type: 'output_text',
          text: '[{"iso_n3":"470","claim":"x"}]',
          annotations: [{ url_citation: { url: 'https://gov.mt/x', title: 'Gov MT' } }],
        }],
      },
    ],
  };

  test('generateGroundedText calls the Interactions API with the search tool and extracts citations', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(groundedBody), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const result = await generateGroundedText('find changes', {
      provider: 'openai-compatible', apiKey: 'secret-key', model: 'gemini-3.5-flash',
      googleApiBaseUrl: 'https://gen.example/v1beta', timeoutMs: 1000,
    }, { fetcher });

    expect(result.text).toContain('"iso_n3":"470"');
    expect(result.citations).toEqual([{ uri: 'https://gov.mt/x', title: 'Gov MT' }]);
    expect(result.searchQueries).toEqual(['malta citizenship 2026']);
    expect(calls[0].url).toBe('https://gen.example/v1beta/interactions');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.tools).toEqual([{ type: 'google_search' }]);
    expect(sent.input).toBe('find changes');
    expect(sent.model).toBe('gemini-3.5-flash');
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
      iso_n3: '470', jurisdiction: 'Malta', claim: 'CBI closed', headline: 'Malta ends golden passports', status: 'confirmed',
      primary_urls: ['https://komunita.gov.mt/x'], effective_date: '2025-07-23', affects_dataset: true,
      category: 'investment', brief: 'Malta ended CBI.', evidence_quote: 'Malta ended its CBI programme.', original_quote: 'Malta ended its CBI programme.', legal_instrument: '', citations: [], search_queries: ['q'],
    };
    const lead = findingToLead(finding);
    expect(lead?.impact_type).toBe('cost_or_investment_threshold');
    expect(lead?.confidence).toBe('high');
    expect(lead?.signal.url).toBe('https://komunita.gov.mt/x');
    expect(lead?.signal.excerpt).toContain('Sources: https://komunita.gov.mt/x');
    expect(findingToLead({ ...finding, primary_urls: [] })).toBeNull();
  });

  test('selectJurisdictions rotates full coverage across runs and always includes RSS-flagged', () => {
    const registry = Array.from({ length: 10 }, (_, i) => ({ iso_n3: String(100 + i), name: `J${i}` }));
    const empty = new Set<string>();
    // budget 4, 10 jurisdictions → 3 slices cover everything within 3 runs.
    const seen = new Set<string>();
    for (let run = 0; run < 3; run += 1) {
      const picked = selectJurisdictions(registry, { only: null, rssFlagged: empty, maxCalls: 4, rotationIndex: run });
      expect(picked.length).toBeLessThanOrEqual(4);
      for (const entry of picked) seen.add(entry.iso_n3);
    }
    expect(seen.size).toBe(10);

    // RSS-flagged jurisdictions are always included regardless of rotation slice.
    const flaggedPick = selectJurisdictions(registry, { only: null, rssFlagged: new Set(['109']), maxCalls: 4, rotationIndex: 0 });
    expect(flaggedPick.some(entry => entry.iso_n3 === '109')).toBe(true);

    // --only bypasses rotation.
    const onlyPick = selectJurisdictions(registry, { only: ['105', '107'], rssFlagged: empty, maxCalls: 4, rotationIndex: 5 });
    expect(onlyPick.map(entry => entry.iso_n3).sort()).toEqual(['105', '107']);

    // discovery mode: only RSS-flagged jurisdictions are swept (no rotation fill).
    const discovery = selectJurisdictions(registry, { only: null, rssFlagged: new Set(['103', '105']), maxCalls: 4, rotationIndex: 0, mode: 'discovery' });
    expect(discovery.map(entry => entry.iso_n3).sort()).toEqual(['103', '105']);
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
    const prompt = buildSweepPrompt(entry, context, ['ExpatHub: residence permit change'],
      [{ title: 'Malta Community Agency citizenship', url: 'https://komunita.gov.mt/en/citizenship' }]);
    expect(prompt).toContain('Malta');
    expect(prompt).toContain('JSON array');
    expect(prompt).toContain('residence permit change');
    expect(prompt).toContain('Known authoritative source');
    expect(prompt).toContain('https://komunita.gov.mt/en/citizenship');
    // untrusted discovery excerpts are fenced + labelled, not presented as evidence
    expect(prompt).toContain('UNTRUSTED');
    // no official source → no hint block
    expect(buildSweepPrompt(entry, context, [])).not.toContain('Known authoritative source');
  });

  test('normalizeCategory canonicalises free-text categories to the enum (fixes dedup wobble)', () => {
    expect(normalizeCategory('Naturalization')).toBe('naturalization');
    expect(normalizeCategory('citizenship')).toBe('naturalization');
    expect(normalizeCategory('Citizenship by Investment')).toBe('cbi');
    expect(normalizeCategory('golden visa')).toBe('investment');
    expect(normalizeCategory('permanent residence')).toBe('residency');
    expect(normalizeCategory('tax residence')).toBe('tax');
    expect(normalizeCategory('weather report')).toBe('residency');
  });

  test('officialSourcesByJurisdiction maps active verification sources per iso (excludes multi)', () => {
    const map = officialSourcesByJurisdiction(path.resolve(import.meta.dir, '..', 'monitor'));
    expect((map.get('858') ?? []).length).toBeGreaterThan(0); // Uruguay has an active verification source
    expect((map.get('858') ?? [])[0].url).toMatch(/^https?:\/\//);
    expect(map.has('multi')).toBe(false);
    expect((map.get('674') ?? []).map(source => source.url)).toContain(
      'https://www.consigliograndeegenerale.sm/on-line/home/archivio-leggi-decreti-e-regolamenti/documento17157139.html',
    );
    expect((map.get('222') ?? []).map(source => source.url)).toContain(
      'https://www.asamblea.gob.sv/sites/default/files/documents/decretos/1A94F7E5-FC00-4CB9-9DDA-AC13CF555359.pdf',
    );
    expect((map.get('012') ?? []).map(source => source.url)).toContain(
      'https://www.joradp.dz/FTP/jo-francais/2026/F2026014.pdf',
    );
  });

  test('proseDateFromIso and synthesizeIssue surface equivalent date forms', () => {
    expect(proseDateFromIso('2026-06-06')).toBe('6 June 2026');
    expect(proseDateFromIso('2026-01-01')).toBe('1 January 2026');
    expect(proseDateFromIso('not-a-date')).toBe('');
    const finding: Finding = {
      iso_n3: '752', jurisdiction: 'Sweden', claim: 'Sweden raised habitual residence to eight years',
      headline: 'Sweden eight year residence', status: 'confirmed',
      primary_urls: ['https://www.migrationsverket.se/'], effective_date: '2026-06-06',
      affects_dataset: true, category: 'naturalization', brief: 'Adults need eight years.',
      evidence_quote: 'eight years (previously five years)', original_quote: 'åtta år (tidigare fem år)',
      legal_instrument: '', citations: [], search_queries: [],
    };
    const body = synthesizeIssue(finding).body;
    // Both ISO and prose so the auditor cannot invent a year-missing mismatch.
    expect(body).toContain('Effective date: 2026-06-06 (6 June 2026).');
    expect(body).toContain('Source passage (English)');
    expect(body).toContain('Source passage (original language)');
  });

  test('buildNewsPost + fingerprint + synthesizeIssue', () => {
    const finding: Finding = {
      iso_n3: '470', jurisdiction: 'Malta', claim: 'CBI closed', headline: 'Malta ends golden passports', status: 'confirmed',
      primary_urls: ['https://komunita.gov.mt/x'], effective_date: '2025-07-23', affects_dataset: true,
      category: 'investment', brief: 'Malta ended CBI.', evidence_quote: 'Malta ended its CBI programme.', original_quote: 'Malta ended its CBI programme.', legal_instrument: '', citations: [], search_queries: [],
    };
    const post = buildNewsPost(finding);
    expect(post.text).toContain('🇲🇹 <b>Malta ends golden passports</b>');
    expect(post.text).not.toContain('Malta — Malta');
    expect(post.text).toContain('<a href="https://komunita.gov.mt/x">Source</a>');
    expect(post.text).not.toContain('Information only');
    expect(post.text).not.toContain('📌');
    expect(() => buildNewsPost({ ...finding, primary_urls: [] })).toThrow('primary source');

    expect(fingerprint(finding)).toBe(fingerprint(finding));
    // Re-phrasings of the same change collapse (claim is not part of the key)...
    const reworded: Finding = { ...finding, claim: 'Malta scrapped its golden-passport programme entirely' };
    expect(fingerprint(finding)).toBe(fingerprint(reworded));
    // ...but a different date or category is treated as a different change.
    expect(fingerprint(finding)).not.toBe(fingerprint({ ...finding, effective_date: '2026-01-01' }));
    expect(fingerprint(finding)).not.toBe(fingerprint({ ...finding, category: 'naturalization' }));
    expect(synthesizeIssue(finding).body).toContain('## Verified evidence');
  });

  test('fingerprint keys on the legal instrument when present', () => {
    const base: Finding = {
      iso_n3: '620', jurisdiction: 'Portugal', claim: 'Portugal raised naturalization to 10 years',
      headline: 'h', status: 'confirmed', primary_urls: ['https://dre.pt'], effective_date: '2026-05-19',
      affects_dataset: true, category: 'naturalization', brief: 'b', evidence_quote: 'e',
      original_quote: 'e', legal_instrument: 'Lei Orgânica 1/2026', citations: [], search_queries: [],
    };
    expect(changeKey(base)).toBe('620|1/2026');
    // Same law, different outlet wording AND a wobbled date/category → same fingerprint.
    const otherOutlet: Finding = { ...base, claim: 'Portugal doubles residency requirement', effective_date: '2026-05-18', category: 'residency', legal_instrument: 'Organic Law No. 1/2026' };
    expect(fingerprint(base)).toBe(fingerprint(otherOutlet));
    // A genuinely different law for the same country → different fingerprint.
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, legal_instrument: '2/2027' }));
    // Extracts the stable number/year or letter-number core; '' falls back to iso+category+date.
    expect(normalizeInstrument('Lei Orgânica n.º 1/2026')).toBe('1/2026');
    expect(normalizeInstrument('Presidential Decree PF-67')).toBe('pf-67');
    expect(normalizeInstrument('Law No. 20.446')).toBe('20.446');
    expect(normalizeInstrument('')).toBe('');
  });

  test('hasRecentChange dedups the same jurisdiction+category within the window', () => {
    const store = new NewsPostStore(path.resolve(import.meta.dir, '..'), null);
    const f: Finding = {
      iso_n3: '620', jurisdiction: 'Portugal', claim: 'Portugal raised naturalization to 10 years', headline: 'h',
      status: 'confirmed', primary_urls: ['https://dre.pt'], effective_date: '2026-05-19', affects_dataset: true,
      category: 'naturalization', brief: 'b', evidence_quote: 'e', original_quote: 'e', legal_instrument: '', citations: [], search_queries: [],
    };
    const now = new Date('2026-07-25T00:00:00Z');
    store.record(fingerprint(f), f, 17, '2026-07-24T00:00:00Z');
    expect(store.hasRecentChange('620', 'naturalization', 120, now)).toBe(true);  // same change, reworded, within window
    expect(store.hasRecentChange('620', 'investment', 120, now)).toBe(false);      // different category
    expect(store.hasRecentChange('124', 'naturalization', 120, now)).toBe(false);  // different jurisdiction
    expect(store.hasRecentChange('620', 'naturalization', 0, now)).toBe(false);     // outside the window
    store.close();
  });

  // publish_manual.ts uses this same store after a successful Telegram send so
  // auto-news cannot re-post a hand-reviewed item. Lock the mutation shape.
  test('NewsPostStore mutations are portable INSERT OR IGNORE rows for D1', () => {
    const store = new NewsPostStore(path.resolve(import.meta.dir, '..'), null);
    const f: Finding = {
      iso_n3: '752', jurisdiction: 'Sweden', claim: 'Sweden raised habitual residence to eight years',
      headline: 'Sweden eight year residence', status: 'confirmed',
      primary_urls: ['https://www.migrationsverket.se/'], effective_date: '2026-06-06',
      affects_dataset: true, category: 'naturalization', brief: 'b', evidence_quote: 'e',
      original_quote: 'e', legal_instrument: '', citations: [], search_queries: [],
    };
    const fp = fingerprint(f);
    store.record(fp, f, 25, '2026-07-30T09:00:00Z');
    expect(store.has(fp)).toBe(true);
    expect(store.mutations).toHaveLength(1);
    expect(store.mutations[0]).toContain('INSERT OR IGNORE INTO monitor_posts');
    expect(store.mutations[0]).toContain(fp);
    expect(store.mutations[0]).toContain("'752'");
    expect(store.mutations[0]).toContain('25');
    store.close();
  });

  test('detectTopicGraft catches Saint Lucia-style CBI→constitution grafts', () => {
    // Real constitution language about Commonwealth ordinary residence — not CBI.
    const constitutionPage = normalizeText(`
      Chapter VII Citizenship. Section 102 registration. Any person who being a
      Commonwealth citizen is and for 7 years previous to his or her application
      has been ordinarily resident in Saint Lucia may apply for registration.
    `);
    const graft = detectTopicGraft({
      category: 'cbi',
      claim: 'Saint Lucia introduced mandatory residency and genuine link requirements for citizenship by investment',
      headline: 'Saint Lucia CBI genuine link from January 2026',
      pageNorm: constitutionPage,
      quoteNorm: normalizeText('Commonwealth citizen is and for 7 years previous to his or her application has been ordinarily resident'),
    });
    expect(graft).toMatch(/topic mismatch/i);
    expect(graft).toMatch(/investment|CBI|ordinary/i);

    // Real CBI page with investment language — no graft.
    const cbiPage = normalizeText(`
      Citizenship by Investment Act. Qualifying investment in the National Economic Fund.
      Applicants and dependants shall comply with prescribed residency and genuine link.
    `);
    expect(detectTopicGraft({
      category: 'cbi',
      claim: 'Saint Lucia CBI genuine link requirements effective 2026',
      headline: 'Saint Lucia CBI genuine link',
      pageNorm: cbiPage,
      quoteNorm: normalizeText('prescribed residency and genuine link'),
    })).toBeNull();
  });

  test('verifyPrimarySource returns a tri-state verdict (verified / refuted / inconclusive)', async () => {
    const allowed = new Set(['dre.pt']);
    const quote = 'prazo de dez anos de residência legal';
    // A realistic, text-rich gov page (>1500 readable chars) so a MISSING quote is
    // genuine negative evidence (refuted) rather than an unscannable shell.
    const filler = 'A presente lei orgânica procede à alteração do regime jurídico da nacionalidade portuguesa e estabelece novas regras aplicáveis aos processos de naturalização. '.repeat(12);
    const page = `<html><body><h1>Lei Orgânica 1/2026</h1><p>${filler}</p><p>fixa um prazo de dez anos de residência legal para a naturalização.</p></body></html>`;
    const respond = (body: string, init?: ResponseInit) => (async () => new Response(body, init)) as unknown as typeof fetch;
    const ok = respond(page, { status: 200 });

    // authoritative (allowlisted) host + quote present → verified
    expect((await verifyPrimarySource('https://dre.pt/lei/1-2026', quote, allowed, ok)).verdict).toBe('verified');
    // gov-ish host verifies without an explicit allowlist entry
    expect((await verifyPrimarySource('https://presidencia.gob.py/x', quote, new Set(), ok)).verdict).toBe('verified');
    // entity-encoded accent on the page still matches a plain-text quote (the
    // #90/#96 silence bug: punctuation/entity/accent differences must not block)
    const entityPage = `<html><body><p>${filler}</p><p>fixa um prazo de dez anos de resid&#234;ncia legal para todos.</p></body></html>`;
    expect((await verifyPrimarySource('https://dre.pt/x', quote, allowed, respond(entityPage, { status: 200 }))).verdict).toBe('verified');
    // non-authoritative host → refuted
    expect((await verifyPrimarySource('https://randomblog.com/x', quote, allowed, ok)).verdict).toBe('refuted');
    // readable page that lacks the quote → refuted (real negative evidence)
    expect((await verifyPrimarySource('https://dre.pt/x', 'uma passagem fabricada que nao existe em lado nenhum desta pagina legivel', allowed, ok)).verdict).toBe('refuted');
    // unreachable / 404 → INCONCLUSIVE (absence of access is not refutation)
    expect((await verifyPrimarySource('https://dre.pt/x', quote, allowed, respond('nope', { status: 404 }))).verdict).toBe('inconclusive');
    // PDF source → inconclusive (text not machine-checkable here)
    expect((await verifyPrimarySource('https://dre.pt/x.pdf', quote, allowed, respond('%PDF-1.7 …', { status: 200, headers: { 'content-type': 'application/pdf' } }))).verdict).toBe('inconclusive');
    // JS-only shell (quote absent, little readable text) → inconclusive
    expect((await verifyPrimarySource('https://dre.pt/x', quote, allowed, respond('<html><body><div id="root"></div></body></html>', { status: 200 }))).verdict).toBe('inconclusive');
  });

  test('quoteOnPage matches robustly and handles CJK (unsegmented script)', () => {
    const page = normalizeText('<p>Lei Orgânica n.º 1/2026 fixa um prazo de dez anos de residência legal.</p>');
    expect(quoteOnPage(page, normalizeText('prazo de dez anos de residência legal'))).toBe(true);
    expect(quoteOnPage(page, normalizeText('prazo de cinco anos de residência temporária concedido'))).toBe(false);
    // CJK: no word spaces → character-substring fallback
    const cjkPage = normalizeText('<p>国务院决定将投资移民最低金额提高到二百万美元自二零二六年七月起施行。</p>');
    expect(quoteOnPage(cjkPage, normalizeText('投资移民最低金额提高到二百万美元'))).toBe(true);
    expect(quoteOnPage(cjkPage, normalizeText('投资移民最低金额降低到十万美元人民币'))).toBe(false);
  });

  test('corroboratedByCitations confirms host present among resolved grounding citations', async () => {
    const fetcher = (async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    const citations = [{ uri: 'https://www.dre.pt/artigo/123' }, { uri: 'https://noticias.example/x' }];
    expect(await corroboratedByCitations('dre.pt', citations, fetcher)).toBe(true);   // suffix match www.dre.pt
    expect(await corroboratedByCitations('boe.es', citations, fetcher)).toBe(false);
    expect(await corroboratedByCitations('', citations, fetcher)).toBe(false);
  });

  test('runNews refuses --apply without a dedup ledger (would otherwise repost every run)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-apply-'));
    const findingsPath = path.join(dir, 'findings.json');
    fs.writeFileSync(findingsPath, '[]');
    await expect(runNews({ findings: findingsPath, apply: true, stateDb: null, stateSql: path.join(dir, 'out.sql'), max: 20 }))
      .rejects.toThrow('--apply requires');
  });

  test('verifySourceUrl keeps resolving links, falls back to domain root otherwise', async () => {
    const deep = 'https://dre.pt/pesquisa/-/search/257321289/details/maximized';
    const ok = ((_url: string) => Promise.resolve({ ok: true, url: deep } as Response)) as typeof fetch;
    expect(await verifySourceUrl(deep, ok)).toBe(deep);

    const notFound = ((_url: string) => Promise.resolve({ ok: false, url: deep } as Response)) as typeof fetch;
    expect(await verifySourceUrl(deep, notFound)).toBe('https://dre.pt');

    const boom = (() => Promise.reject(new Error('blocked'))) as unknown as typeof fetch;
    expect(await verifySourceUrl('https://lex.uz/deep/404', boom)).toBe('https://lex.uz');
  });
});

describe('discovery citation mining', () => {
  const root = path.resolve(import.meta.dir, '..');
  const cite = (uri: string, title = '') => ({ uri, title });
  const finding = (iso: string, status: string, uris: string[]): Finding => ({
    iso_n3: iso, jurisdiction: 'X', claim: 'c', headline: 'h', status: status as Finding['status'],
    primary_urls: uris, effective_date: null, affects_dataset: false, category: 'residency',
    brief: 'b', evidence_quote: 'e', original_quote: 'e', legal_instrument: '', citations: uris.map(u => cite(u, 'sample')), search_queries: [],
  });

  test('url helpers classify host, social account, and government sources', () => {
    expect(hostFromUrl('https://www.Publico.pt/a/b')).toBe('publico.pt');
    expect(hostFromUrl('not a url')).toBeNull();
    expect(sourceKeyFromUrl('https://publico.pt/a')).toBe('publico.pt');
    expect(sourceKeyFromUrl('https://mastodon.social/@ImmLawyer/123')).toBe('mastodon.social/@immlawyer');
    expect(isSocialHost('mastodon.social')).toBe(true);
    expect(isSocialHost('bsky.app')).toBe(true);
    expect(isSocialHost('publico.pt')).toBe(false);
    expect(isGovish('gov.uk')).toBe(true);
    expect(isGovish('sre.gob.mx')).toBe(true);
    expect(isGovish('ircc.gc.ca')).toBe(true);
    expect(isGovish('publico.pt')).toBe(false);
  });

  test('feedCandidateUrls is deterministic for Mastodon and pathful for sites', () => {
    expect(feedCandidateUrls('https://mastodon.social/@lawyer/123')).toEqual(['https://mastodon.social/@lawyer.rss']);
    expect(feedCandidateUrls('https://publico.pt/a')).toContain('https://publico.pt/feed/');
    expect(feedCandidateUrls('https://bsky.app/profile/x')).toEqual([]);
  });

  test('CitationStore ranks cited outlets and excludes manifest hosts', () => {
    const store = new CitationStore(root, null);
    store.recordFindings([
      finding('620', 'confirmed', ['https://publico.pt/a', 'https://schengenvisainfo.com/x']),
      finding('620', 'confirmed', ['https://publico.pt/b']),
      finding('250', 'proposed', ['https://mastodon.social/@lawyer/1']),
    ], '2026-07-25T00:00:00Z');
    const ranked = store.topCandidates({ excludeHosts: manifestHosts(root) });
    store.close();

    // schengenvisainfo.com is already in the manifest → never proposed.
    expect(ranked.some(c => c.domain === 'schengenvisainfo.com')).toBe(false);
    // publico.pt surfaced two confirmed changes → top candidate.
    expect(ranked[0].source_key).toBe('publico.pt');
    expect(ranked[0].confirmed).toBe(2);
    expect(ranked[0].jurisdictions).toBe(1);
    // the Mastodon account is grouped per-account and flagged social.
    const mastodon = ranked.find(c => c.source_key === 'mastodon.social/@lawyer');
    expect(mastodon?.social).toBe(true);
    expect(mastodon?.confirmed).toBe(0);
  });

  test('discoverFeed prefers deterministic Mastodon, then autodiscovery', async () => {
    const noFetch = (() => { throw new Error('should not fetch'); }) as unknown as typeof fetch;
    expect(await discoverFeed('https://mastodon.social/@lawyer/1', noFetch)).toBe('https://mastodon.social/@lawyer.rss');

    const fakeFetch = (async (input: unknown) => {
      const url = String(input);
      if (url === 'https://publico.pt') {
        return new Response('<html><head><link rel="alternate" type="application/rss+xml" href="/rss"></head></html>', { status: 200 });
      }
      if (url === 'https://publico.pt/rss') {
        return new Response('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>', { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    expect(await discoverFeed('https://publico.pt/a', fakeFetch)).toBe('https://publico.pt/rss');
  });
});

describe('X (Twitter) discovery via xAI', () => {
  const root = path.resolve(import.meta.dir, '..');
  const xConfig: XSearchConfig = {
    apiKey: 'k', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.3',
    maxResults: 15, lookbackHours: 6, timeoutMs: 180000, watchlist: [], sourceId: 'x-search', tier: 'discovery',
  };

  test('loadWatchlist parses handles (strips @/case) and the shipped list loads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'));
    const file = path.join(dir, 'x-watchlist.json');
    fs.writeFileSync(file, JSON.stringify({ handles: ['@NomadCapitalist', 'imidaily', '  '] }));
    expect(loadWatchlist(file)).toEqual(['nomadcapitalist', 'imidaily']);
    expect(loadWatchlist('/no/such/file.json')).toEqual([]);
    expect(loadWatchlist()).toContain('nomadcapitalist'); // the shipped watchlist
  });

  test('buildUserPrompt scopes to the watchlist when present, broad when empty', () => {
    const scoped = buildUserPrompt(24, ['nomadcapitalist', 'imidaily']);
    expect(scoped).toContain('from:nomadcapitalist OR from:imidaily');
    expect(scoped).toContain('Also include any other qualifying official change');
    const broad = buildUserPrompt(24, []);
    expect(broad).not.toContain('from:');
    expect(broad).toContain('last 24 hours');
  });

  test('resolveIso maps M49, alpha-2/3, and country names to M49', () => {
    expect(resolveIso('620')).toBe('620');
    expect(resolveIso('PT')).toBe('620');
    expect(resolveIso('PRT')).toBe('620');
    expect(resolveIso('Portugal')).toBe('620');
    expect(resolveIso('Nowhereland')).toBe('');
    expect(resolveIso('')).toBe('');
  });

  test('parseXSearchResponse builds discovery signals, dedupes, and drops url-less items', () => {
    const body = { output_text: JSON.stringify([
      { iso_n3: '620', jurisdiction: 'Portugal', headline: 'Portugal raises naturalization to 10 years', summary: 's', url: 'https://x.com/immlawyer/status/1' },
      { iso_n3: '', jurisdiction: 'Spain', headline: 'Spain reforms nationality law', summary: 's', url: 'https://x.com/reporter/status/2' },
      { jurisdiction: 'France', headline: 'no url — dropped', summary: 's' },
      { iso_n3: '620', jurisdiction: 'Portugal', headline: 'duplicate url — dropped', summary: 's', url: 'https://x.com/immlawyer/status/1' },
    ]) };
    const signals = parseXSearchResponse(body, xConfig, { retrievedAt });
    expect(signals).toHaveLength(2);
    expect(signals[0].source_id).toBe('x-search');
    expect(signals[0].tier).toBe('discovery');
    expect(signals[0].jurisdiction).toBe('620');
    expect(signals[1].jurisdiction).toBe('724'); // resolved from the name "Spain"
    expect(parseXSearchResponse({ output_text: 'not json' }, xConfig)).toEqual([]);
    expect(parseXSearchResponse({ output: [{ content: [{ text: '[]' }] }] }, xConfig)).toEqual([]);
  });

  test('xSearchConfigFromEnv is null without a key and defaults grok-4.5 with one', () => {
    const saved = process.env.MONITOR_XAI_API_KEY;
    delete process.env.MONITOR_XAI_API_KEY;
    expect(xSearchConfigFromEnv()).toBeNull();
    process.env.MONITOR_XAI_API_KEY = 'test-key';
    const config = xSearchConfigFromEnv();
    expect(config?.model).toBe('grok-4.5');
    expect(config?.tier).toBe('discovery');
    if (saved === undefined) delete process.env.MONITOR_XAI_API_KEY;
    else process.env.MONITOR_XAI_API_KEY = saved;
  });

  test('the x-search source skips cleanly (no network) when no key is set', async () => {
    const saved = process.env.MONITOR_XAI_API_KEY;
    delete process.env.MONITOR_XAI_API_KEY;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xrun-'));
    const { signals, report } = await runCollectors({
      fixtureDir: null, sourceId: 'x-search', adapters: null, strict: false,
      output: path.join(tmp, 's.json'), report: path.join(tmp, 'r.json'), lookbackDays: 1,
    });
    expect(signals).toHaveLength(0);
    expect(report.sources_attempted).toBe(1);
    expect(report.sources_failed).toBe(0);
    if (saved !== undefined) process.env.MONITOR_XAI_API_KEY = saved;
  });

  test('recordCitation lands an X post as a rankable, social candidate', () => {
    const store = new CitationStore(root, null);
    expect(store.recordCitation('not-a-url', '620', 'signal', 't', 'now')).toBe(false);
    expect(store.recordCitation('https://x.com/immlawyer/status/9', '620', 'signal', 'PT change', '2026-07-25T00:00:00Z')).toBe(true);
    const ranked = store.topCandidates({});
    store.close();
    expect(ranked.find(c => c.source_key === 'x.com/immlawyer')?.social).toBe(true);
  });
});

describe('Bluesky discovery via AT Protocol', () => {
  const authorSource: BlueskySource = {
    id: 'bsky-immlawyer', tier: 'discovery', adapter: 'bluesky',
    url: 'https://bsky.app/profile/immlawyer.bsky.social', jurisdictions: ['620'],
  };

  test('handleFromProfileUrl and postUrl derive handles and public URLs', () => {
    expect(handleFromProfileUrl('https://bsky.app/profile/immlawyer.bsky.social')).toBe('immlawyer.bsky.social');
    expect(handleFromProfileUrl('immlawyer.bsky.social')).toBe('immlawyer.bsky.social');
    expect(handleFromProfileUrl('not a handle!')).toBeNull();
    expect(postUrl('at://did:plc:abc/app.bsky.feed.post/3xyz', 'immlawyer.bsky.social'))
      .toBe('https://bsky.app/profile/immlawyer.bsky.social/post/3xyz');
  });

  test('parseBlueskyPosts handles author-feed and search shapes, dedupes, drops empties', () => {
    const authorFeed = { feed: [
      { post: { uri: 'at://did:plc:abc/app.bsky.feed.post/3xyz', author: { handle: 'immlawyer.bsky.social' }, record: { text: 'Portugal raised naturalization residency to 10 years under Lei Orgânica 1/2026.', createdAt: '2026-07-25T09:00:00Z' } } },
      { post: { uri: 'at://did:plc:abc/app.bsky.feed.post/3xyz', author: { handle: 'immlawyer.bsky.social' }, record: { text: 'duplicate uri' } } },
      { post: { uri: 'at://did:plc:abc/app.bsky.feed.post/3nop', author: { handle: 'immlawyer.bsky.social' }, record: { text: '' } } },
    ] };
    const signals = parseBlueskyPosts(authorFeed, authorSource, { retrievedAt });
    expect(signals).toHaveLength(1);
    expect(signals[0].url).toBe('https://bsky.app/profile/immlawyer.bsky.social/post/3xyz');
    expect(signals[0].jurisdiction).toBe('620');
    expect(signals[0].source_id).toBe('bsky-immlawyer');
    expect(signals[0].published_at).toBe('2026-07-25T09:00:00.000Z');

    const search = { posts: [{ uri: 'at://did:plc:def/app.bsky.feed.post/3aaa', author: { handle: 'reporter.bsky.social' }, record: { text: 'Spain reforms nationality law' } }] };
    const searchSignals = parseBlueskyPosts(search, { id: 'bsky-search', tier: 'discovery', adapter: 'bluesky_search', keywords: ['nationality'] }, { retrievedAt });
    expect(searchSignals).toHaveLength(1);
    expect(searchSignals[0].url).toContain('/profile/reporter.bsky.social/post/3aaa');
  });

  test('blueskyEndpoint builds author-feed and search endpoints', () => {
    expect(blueskyEndpoint(authorSource)).toBe(
      'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=immlawyer.bsky.social&limit=25&filter=posts_no_replies',
    );
    expect(blueskyEndpoint({ id: 's', tier: 'discovery', adapter: 'bluesky_search', query: 'visa OR citizenship' }))
      .toBe('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=visa%20OR%20citizenship&limit=25&sort=latest');
    expect(blueskyEndpoint({ id: 's2', tier: 'discovery', adapter: 'bluesky_search', keywords: ['visa', 'permit'] }))
      .toContain('q=visa%20permit');
    expect(() => blueskyEndpoint({ id: 'bad', tier: 'discovery', adapter: 'bluesky' })).toThrow('no handle');
  });

  test('collectBluesky fetches and parses a feed', async () => {
    const fake = (async () => new Response(
      JSON.stringify({ feed: [{ post: { uri: 'at://x/app.bsky.feed.post/1', author: { handle: 'a.bsky.social' }, record: { text: 'Change in Portugal citizenship' } } }] }),
      { status: 200 },
    )) as unknown as typeof fetch;
    const signals = await collectBluesky(authorSource, { fetchImpl: fake, retrievedAt });
    expect(signals).toHaveLength(1);
    expect(signals[0].url).toContain('a.bsky.social/post/1');
  });
});

describe('X watchlist reverse-discovery seed', () => {
  test('buildDirectoryPrompt excludes the watchlist and demands evidence', () => {
    const prompt = buildDirectoryPrompt(['nomadcapitalist']);
    expect(prompt).toContain('x_search');
    expect(prompt).toContain('@nomadcapitalist');       // exclude clause
    expect(prompt).toContain('at least 2 relevant');
    expect(prompt).toContain('evidence_url');
  });

  test('buildReversePrompt lists the changes and demands evidence', () => {
    const prompt = buildReversePrompt([{ jurisdiction: 'Portugal', category: 'naturalization', url: 'https://dre.pt/x' }], []);
    expect(prompt).toContain('Portugal — naturalization — https://dre.pt/x');
    expect(prompt).toContain('evidence_url');
  });

  test('parseSeedCandidates enforces the guardrails (real handle + x.com evidence, dedupe, exclude watchlist)', () => {
    const body = { output_text: JSON.stringify([
      { handle: '@GoodLawyer', jurisdiction: 'Portugal', evidence_url: 'https://x.com/goodlawyer/status/1', why: 'covers PT nationality' },
      { handle: 'nomadcapitalist', evidence_url: 'https://x.com/nomadcapitalist/status/2', why: 'already on the list' },
      { handle: 'noevidence', jurisdiction: '', evidence_url: '', why: 'no url — dropped' },
      { handle: 'bad handle!', evidence_url: 'https://x.com/x/status/3', why: 'invalid handle — dropped' },
      { handle: 'blogonly', evidence_url: 'https://someblog.com/post', why: 'evidence not on x.com — dropped' },
      { handle: 'GoodLawyer', evidence_url: 'https://twitter.com/goodlawyer/status/9', why: 'duplicate — dropped' },
    ]) };
    const candidates = parseSeedCandidates(body, ['nomadcapitalist']);
    expect(candidates.map(c => c.handle)).toEqual(['goodlawyer']);
    expect(candidates[0].evidence_url).toBe('https://x.com/goodlawyer/status/1');
    expect(parseSeedCandidates({ output_text: 'not json' })).toEqual([]);
  });
});

describe('IMC map discovery watcher', () => {
  const { extractMapData, parsePlaceContent, diffSnapshots } = require('../monitor/discovery/imc_map') as
    typeof import('../monitor/discovery/imc_map');

  test('extracts and parses the base64 wpgmp blob into fact fields', () => {
    const blob = Buffer.from(JSON.stringify({
      places: [{
        title: 'Turkey',
        content: '<strong>B. Citizenship by Investment: </strong>The Program<br/><strong>Minimum Investment: </strong>From USD 250,000 <br/><strong>Further information: </strong>www.invest.gov.tr/en <br/>',
      }],
    })).toString('base64');
    const data = extractMapData(`<script>window.wpgmp.mapdata1 = "${blob}";</script>`);
    const parsed = parsePlaceContent((data as { places: Array<{ content: string }> }).places[0].content);
    expect(parsed.fields['Citizenship by Investment']).toEqual(['The Program']);
    expect(parsed.fields['Minimum Investment']).toEqual(['From USD 250,000']);
    expect(parsed.urls).toContain('www.invest.gov.tr/en');
  });

  test('diffSnapshots reports adds, removals, and field changes only', () => {
    const before = {
      Turkey: { country: 'Turkey', fields: { 'Minimum Investment': ['USD 250,000'] }, urls: ['a'] },
      Montenegro: { country: 'Montenegro', fields: {}, urls: [] },
    };
    const after = {
      Turkey: { country: 'Turkey', fields: { 'Minimum Investment': ['USD 400,000'] }, urls: ['a'] },
      Fiji: { country: 'Fiji', fields: {}, urls: [] },
    };
    const diff = diffSnapshots(before, after);
    expect(diff).toContain('+ Fiji: country ADDED to the IMC map');
    expect(diff).toContain('- Montenegro: country REMOVED from the IMC map');
    expect(diff.some(l => l.includes('Turkey') && l.includes('USD 400,000'))).toBe(true);
    expect(diffSnapshots(after, after)).toEqual([]);
  });
});

describe('Reddit hand-raiser radar', () => {
  const { parseRedditAtom, scorePost, buildDigest } = require('../monitor/discovery/reddit_intent') as
    typeof import('../monitor/discovery/reddit_intent');

  const atom = `<?xml version="1.0"?><feed>
    <entry><id>t3_abc123</id><title>Is the Portugal golden visa still open in 2026?</title>
      <link href="https://www.reddit.com/r/IWantOut/comments/abc123/x/"/>
      <published>2026-07-27T01:00:00+00:00</published>
      <content type="html">&lt;p&gt;Looking for a residency by investment option, budget 500k&lt;/p&gt;</content>
    </entry>
    <entry><id>t3_def456</id><title>Best beaches thread</title>
      <link href="https://www.reddit.com/r/expats/comments/def456/y/"/>
      <published>2026-07-27T02:00:00+00:00</published>
      <content type="html">&lt;p&gt;vacation photos&lt;/p&gt;</content>
    </entry></feed>`;

  test('parses Atom entries into posts', () => {
    const posts = parseRedditAtom(atom, 'IWantOut');
    expect(posts).toHaveLength(2);
    expect(posts[0].id).toBe('abc123');
    expect(posts[0].title).toContain('golden visa');
    expect(posts[0].selftext).toContain('residency by investment');
    expect(posts[0].permalink).toBe('/r/IWantOut/comments/abc123/x/');
  });

  test('scores intent+topic posts and rejects off-topic ones', () => {
    const config = {
      intent_phrases: ['is it still open', 'looking for a'],
      topic_keywords: ['golden visa', 'residency by investment'],
    };
    const posts = parseRedditAtom(atom, 'IWantOut');
    // title has "golden visa" + "?"; body has "looking for a" + "residency by investment"
    const hit = scorePost({ title: posts[0].title, selftext: posts[0].selftext }, config);
    expect(hit.score).toBeGreaterThan(0);
    expect(hit.topics).toContain('golden visa');
    const miss = scorePost({ title: posts[1].title, selftext: posts[1].selftext }, config);
    expect(miss.score).toBe(0);
    expect(buildDigest([])).toContain('no hand-raisers');
  });
});

describe('reddit oauth', () => {
  const {
    parseTokenResponse, redditCredentialsFromEnv, RedditClient,
  } = require('../monitor/discovery/reddit_auth') as
    typeof import('../monitor/discovery/reddit_auth');
  const { postFromListing } = require('../monitor/discovery/reddit_intent') as
    typeof import('../monitor/discovery/reddit_intent');

  test('credentials require all four env vars', () => {
    expect(redditCredentialsFromEnv({})).toBeNull();
    expect(redditCredentialsFromEnv({
      MONITOR_REDDIT_CLIENT_ID: 'a',
      MONITOR_REDDIT_CLIENT_SECRET: 'b',
      MONITOR_REDDIT_USERNAME: 'c',
    })).toBeNull();
    expect(redditCredentialsFromEnv({
      MONITOR_REDDIT_CLIENT_ID: 'a',
      MONITOR_REDDIT_CLIENT_SECRET: 'b',
      MONITOR_REDDIT_USERNAME: 'c',
      MONITOR_REDDIT_PASSWORD: 'd',
    })).toEqual({ clientId: 'a', clientSecret: 'b', username: 'c', password: 'd' });
  });

  test('token parse refreshes early and rejects Reddit error bodies', () => {
    const parsed = parseTokenResponse({ access_token: 'tok', expires_in: 3600, token_type: 'bearer', scope: '*' });
    expect(parsed.token).toBe('tok');
    // 3600s minus the 60s safety margin
    expect(parsed.expiresAt).toBeLessThanOrEqual(Date.now() + 3540_000);
    expect(parsed.expiresAt).toBeGreaterThan(Date.now() + 3500_000);
    // Reddit answers bad credentials with HTTP 200 and an error body, so status is not enough
    expect(() => parseTokenResponse({ error: 'invalid_grant' })).toThrow(/invalid_grant/);
    expect(() => parseTokenResponse({ token_type: 'bearer' })).toThrow(/no access_token/);
    expect(() => parseTokenResponse(null)).toThrow(/not an object/);
  });

  test('listing records map onto the scorer shape and drop incomplete ones', () => {
    expect(postFromListing({
      id: 'abc', title: 'How do I get residency in Georgia?', selftext: 'budget is 30k',
      permalink: '/r/IWantOut/comments/abc/x/', created_utc: 1_770_000_000, subreddit: 'IWantOut',
    }, 'IWantOut')).toEqual({
      id: 'abc', subreddit: 'IWantOut', title: 'How do I get residency in Georgia?',
      selftext: 'budget is 30k', permalink: '/r/IWantOut/comments/abc/x/', created_utc: 1_770_000_000,
    });
    expect(postFromListing({ id: 'abc', title: 'x', permalink: '/r/a/b/' }, 'a')).toBeNull();
    expect(postFromListing({}, 'a')).toBeNull();
  });

  test('comment refuses anything that is not a t1_/t3_ fullname or is empty', async () => {
    const client = new RedditClient(
      { clientId: 'a', clientSecret: 'b', username: 'c', password: 'd' },
      (async () => { throw new Error('must not reach the network'); }) as unknown as typeof fetch,
    );
    await expect(client.comment('abc123', 'hi')).rejects.toThrow(/t3_/);
    await expect(client.comment('t3_abc123', '   ')).rejects.toThrow(/empty body/);
  });
});

describe('news dedup window scope', () => {
  const { NewsPostStore, runNews } = require('../monitor/publish/news') as
    typeof import('../monitor/publish/news');
  const base = {
    jurisdiction: 'Portugal', status: 'confirmed' as const, affects_dataset: false,
    primary_urls: ['https://diariodarepublica.pt/x'], evidence_quote: 'q', original_quote: 'q',
    citations: [], search_queries: [], claim: 'c', headline: 'h', brief: 'b',
  };

  test('a NEW legal instrument is not suppressed by an earlier same-category post', async () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const os = require('node:os') as typeof import('node:os');
    const path = require('node:path') as typeof import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newswin-'));
    const findingsPath = path.join(dir, 'findings.json');
    const statePath = path.join(dir, 'state.sqlite');
    // Seed the ledger with a naturalization post for 620 from 10 days ago…
    const seed = new NewsPostStore(path.resolve(__dirname, '..'), statePath);
    seed.record('aaaaaaaaaaaaaaaa',
      { ...base, iso_n3: '620', category: 'naturalization', effective_date: '2026-05-01', legal_instrument: '23/2020' } as never,
      1, new Date(Date.now() - 10 * 86_400_000).toISOString());
    seed.close();
    // …the window check must not block a finding citing a DIFFERENT instrument,
    // and must still block an instrument-less one.
    const withInstrument = { ...base, iso_n3: '620', category: 'naturalization', effective_date: '2026-05-18', legal_instrument: '1/2026' };
    const withoutInstrument = { ...base, iso_n3: '620', category: 'naturalization', effective_date: '2026-06-30', legal_instrument: '' };
    fs.writeFileSync(findingsPath, JSON.stringify([withInstrument, withoutInstrument]));
    // Dry-run (apply:false) walks the dedup gates without posting.
    const noNetwork = (async () => {
      throw new Error('network access is forbidden in this test');
    }) as unknown as typeof fetch;
    const result = await runNews({
      findings: findingsPath,
      apply: false,
      stateDb: statePath,
      stateSql: path.join(dir, 'out.sql'),
      max: 20,
      fetcher: noNetwork,
    });
    expect(result.skipped).toBe(1); // only the instrument-less finding hits the window
  });
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSitemapUrls, RESIDENCE_FILTER_JS, ROUTE_TYPE_DIRS, ROUTE_TYPES_ENABLED, TABLE_SORT_JS, THEME_BOOT_JS } from '../scripts/build_country_pages';
import type { BlocsData, CitizenshipRoutesData } from '../src/types';

const canonicalUrl = 'https://flagpaths.com/';
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('public SEO contract', () => {
  test('keeps title, description, canonical, and sharing URLs aligned', () => {
    expect(index).toContain('<title>Citizenship &amp; Residency Paths Atlas | Flag Paths</title>');
    expect(index).toContain('<meta name="description"');
    expect(index).toContain(`<link rel="canonical" href="${canonicalUrl}">`);
    expect(index).toContain(`<meta property="og:url" content="${canonicalUrl}">`);
    expect(index).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  test('publishes parseable WebSite, WebApplication, and Organization structured data', () => {
    const match = index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const schema = JSON.parse(match![1]) as {
      '@graph': Array<{ '@type': string; url: string; license?: string; sameAs?: string[] }>;
    };
    expect(schema['@graph'].map(node => node['@type'])).toEqual(['WebSite', 'WebApplication', 'Organization']);
    expect(schema['@graph'].every(node => node.url === canonicalUrl)).toBe(true);
    // The declared license must match the repo's actual LICENSE (AGPL-3.0).
    const app = schema['@graph'].find(node => node['@type'] === 'WebApplication');
    expect(app?.license).toBe('https://www.gnu.org/licenses/agpl-3.0.html');
    const org = schema['@graph'].find(node => node['@type'] === 'Organization');
    expect(org?.sameAs).toContain('https://t.me/flagpaths');
  });

  test('exposes stable crawl and app-discovery files', () => {
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
    const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
    const manifest = JSON.parse(
      readFileSync(new URL('../public/site.webmanifest', import.meta.url), 'utf8'),
    ) as { start_url: string; icons: Array<{ src: string }> };

    expect(robots).toContain(`Sitemap: ${canonicalUrl}sitemap.xml`);
    expect(sitemap).toContain(`<loc>${canonicalUrl}</loc>`);
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.some(icon => icon.src === '/favicon.svg')).toBe(true);
  });

  test('CSP allows the no-flash theme boot script by hash, everywhere it is inlined', () => {
    // script-src 'self' blocks inline scripts; a silently-blocked theme boot
    // left every prerendered page stuck in light mode regardless of the app
    // theme. The exact script must be hash-allowed and byte-identical in the
    // SPA shell and the prerendered pages (THEME_BOOT_JS is the source).
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    const hash = createHash('sha256').update(THEME_BOOT_JS).digest('base64');
    expect(headers).toContain(`'sha256-${hash}'`);
    expect(index).toContain(`<script>${THEME_BOOT_JS}</script>`);
    // Same contract for the residence filter chips: prerendered country pages
    // have no hydration, so the chips are driven by an inline script that CSP
    // must hash-allow, or every filter button silently does nothing.
    const filterHash = createHash('sha256').update(RESIDENCE_FILTER_JS).digest('base64');
    expect(headers).toContain(`'sha256-${filterHash}'`);
    // And for the route-type comparison tables' sort script.
    const sortHash = createHash('sha256').update(TABLE_SORT_JS).digest('base64');
    expect(headers).toContain(`'sha256-${sortHash}'`);
  });

  test('route-type hubs ship in the sitemap, not just as pages', () => {
    // The historical footgun: a hub added to the page loop but not the urls
    // array ships unindexed, defeating the point of an SEO page. The build
    // writes buildSitemapUrls() verbatim, so asserting against it IS asserting
    // the shipped sitemap — with no dependency on a stale dist/ artifact.
    const citizenship = JSON.parse(readFileSync(
      new URL('../public/citizenship_routes.json', import.meta.url), 'utf8')) as CitizenshipRoutesData;
    const mobility = JSON.parse(readFileSync(
      new URL('../public/blocs_data.json', import.meta.url), 'utf8')) as BlocsData;
    const urls = buildSitemapUrls(citizenship, mobility);
    // The route-type pages are gated off production (CI) until they meet the
    // publication bar; when the flag is on they must all be in the sitemap.
    for (const dir of ROUTE_TYPE_DIRS) {
      if (ROUTE_TYPES_ENABLED) expect(urls).toContain(`https://flagpaths.com/${dir}/`);
      else expect(urls).not.toContain(`https://flagpaths.com/${dir}/`);
    }
    expect(urls).toContain('https://flagpaths.com/country/');
    expect(urls).toContain('https://flagpaths.com/rights/');
    expect(urls.length).toBeGreaterThan(240);
  });

  test('keeps the workers.dev duplicate out of search indexes', () => {
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    const workerConfig = readFileSync(new URL('../wrangler.web.jsonc', import.meta.url), 'utf8');
    expect(headers).toContain('https://flag-paths-web.thomas779.workers.dev/*');
    expect(headers).toContain('X-Robots-Tag: noindex, nofollow');
    // SPA fallback so client routes (/planner, /country) resolve on direct hits;
    // the workers.dev origin stays out of the index via _headers above.
    expect(workerConfig).toContain('"not_found_handling": "single-page-application"');
  });
});

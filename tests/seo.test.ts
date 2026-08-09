import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSitemapLastmod, buildSitemapUrls, RESIDENCE_FILTER_JS, ROUTE_PATHS, ROUTES_ENABLED, THEME_BOOT_JS } from '../scripts/build_country_pages';
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
  });

  test('internal links point at canonical URLs, never at a redirect', () => {
    // Search Console, 2026-08-08: 14 URLs sat in "Page with redirect", and 11 of
    // them were non-trailing-slash forms of live pages (/country/honduras,
    // /rights/eu-eea, ...). We were generating those links ourselves — 163
    // distinct ones, /country 742 times — and the host answers them with a 307,
    // a TEMPORARY redirect, which tells Google to keep the original URL rather
    // than consolidate on the canonical.
    //
    // Every such link costs a crawler two requests and splits the signal across
    // two URLs, on a site whose main indexing problem is crawl budget. Linked
    // correctly, the redirect never happens.
    const files = ['url.ts', 'components/SiteHeader.tsx', 'components/CountriesList.tsx',
      'components/RightsProfile.tsx', 'components/CountryProfile.tsx',
      'components/DetailPanel.tsx', 'components/RouteDetailPanel.tsx',
      'components/RouteTypePages.tsx', 'components/DrivingLicencesPage.tsx'];
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      // href="/x" and href={`/x`}, ignoring query-only and fragment links.
      for (const m of src.matchAll(/href[=:]\s*\{?[`'"](\/[^`'"]*)[`'"]/g)) {
        const path = m[1]!;
        if (path === '/' || path.startsWith('/?') || path.startsWith('/#')) continue;
        const last = path.split('/').pop()!;
        if (path.endsWith('/') || path.includes('#') || last.includes('.')) continue;
        offenders.push(`${file}: ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('sitemap lastmod comes from the data, not the build clock', () => {
    // Google Search Console reported 131 pages "Discovered - currently not
    // indexed" on 2026-08-08. There is no code fix for that, but a sitemap with
    // no lastmod gives the crawler nothing to prioritise on, so we now emit one.
    //
    // It MUST come from each route's last_checked, not from Date.now(). Stamping
    // 271 URLs with today on every deploy claims the whole corpus changed daily,
    // which is false and which Google learns to discount. This test fails if
    // someone "simplifies" it to a build timestamp.
    const citizenship = JSON.parse(readFileSync(
      new URL('../data/compiled/citizenship_routes.json', import.meta.url), 'utf8')) as CitizenshipRoutesData;
    const mobility = JSON.parse(readFileSync(
      new URL('../public/blocs_data.json', import.meta.url), 'utf8')) as BlocsData;
    const urls = buildSitemapUrls(citizenship, mobility);
    const lastmod = buildSitemapLastmod(citizenship, mobility);

    // Every value is a plain date, and every key is a URL we actually ship.
    for (const [url, when] of lastmod) {
      expect(when).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(urls).toContain(url);
    }
    // Most country pages carry one, otherwise the field is decorative.
    const countryUrls = urls.filter(u => /\/country\/[^/]+\/$/.test(u));
    const covered = countryUrls.filter(u => lastmod.has(u));
    expect(covered.length).toBeGreaterThan(countryUrls.length * 0.9);
    // The corpus was sourced over many days, so a single date across everything
    // means it was stamped rather than derived.
    expect(new Set(lastmod.values()).size).toBeGreaterThan(1);
  });

  test('route pages ship in the sitemap, not just as HTML', () => {
    // The historical footgun: a hub added to the page loop but not the urls
    // array ships unindexed, defeating the point of an SEO page. The build
    // writes buildSitemapUrls() verbatim, so asserting against it IS asserting
    // the shipped sitemap — with no dependency on a stale dist/ artifact.
    const citizenship = JSON.parse(readFileSync(
      new URL('../data/compiled/citizenship_routes.json', import.meta.url), 'utf8')) as CitizenshipRoutesData;
    const mobility = JSON.parse(readFileSync(
      new URL('../public/blocs_data.json', import.meta.url), 'utf8')) as BlocsData;
    const urls = buildSitemapUrls(citizenship, mobility);
    for (const routePath of ROUTE_PATHS) {
      expect(ROUTES_ENABLED).toBe(true);
      expect(urls).toContain(`https://flagpaths.com/${routePath}/`);
    }
    expect(urls).toContain('https://flagpaths.com/country/');
    expect(urls).toContain('https://flagpaths.com/rights/');
    expect(urls.length).toBeGreaterThan(240);
  });

  test('old route discovery URLs permanently redirect to the nested hierarchy', () => {
    const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');
    expect(redirects).toContain('/route-types/ /routes/ 301');
    expect(redirects).toContain('/citizenship-by-investment/ /routes/citizenship-by-investment/ 301');
    expect(redirects).toContain('/golden-visas/ /routes/golden-visas/ 301');
    expect(redirects).toContain('/digital-nomad-visas/ /routes/digital-nomad-visas/ 301');
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

describe('public surface is index-plus-slices, not a bulk download', () => {
  test('the compiled corpus is not a served static file', () => {
    // Anything in public/ is copied to dist/ and served, so the corpus living
    // there made the whole dataset a one-request download and the atlas load all
    // 240 jurisdictions to read one. It is now a BUILD INPUT under data/compiled,
    // consumed by the prerender and the index/slice emitters. Agents and readers
    // get atlas-index.json plus /country/<slug>/data.json instead.
    expect(existsSync(new URL('../public/citizenship_routes.json', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../data/compiled/citizenship_routes.json', import.meta.url))).toBe(true);

    // Nothing else large should creep into the served directory either.
    const served = readdirSync(new URL('../public/', import.meta.url), { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'));
    for (const entry of served) {
      const bytes = statSync(new URL(`../public/${entry.name}`, import.meta.url)).size;
      expect(bytes, `public/${entry.name} is ${Math.round(bytes / 1024)}KB; bulk data belongs in data/compiled`)
        .toBeLessThan(200_000);
    }
  });

  test('llms.txt points agents at the index and the slice pattern', () => {
    const llms = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
    expect(llms).toContain('/atlas-index.json');
    expect(llms).toContain('/country/<slug>/data.json');
    expect(llms).not.toContain('/citizenship_routes.json');
  });
});

describe('every workflow that reads the private corpus fetches it', () => {
  // The failure this guards against actually happened: privatising the corpus on
  // 2026-08-04 left monitor/sweep/run.ts pointing at the retired
  // public/citizenship_routes.json, and nothing caught it until the 14:38 cron
  // died with ENOENT (run 30920031089). The daily monitor is the one pipeline
  // whose breakage is invisible for hours, so both halves of this are asserted
  // statically rather than trusted to a scheduled run.
  const workflowDir = new URL('../.github/workflows/', import.meta.url);

  test('no source file reads the retired public corpus path', () => {
    // A single grep-equivalent over the directories that ship code. If the corpus
    // ever moves again, this points at every caller that has to move with it.
    const roots = ['monitor', 'scripts', 'src'];
    const offenders: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
        if (entry.isDirectory()) walk(child);
        else if (/\.(ts|tsx|js)$/.test(entry.name)) {
          const text = readFileSync(child, 'utf8');
          // Match the path as assembled either literally or via path.resolve parts.
          if (/public['"/\s,]+citizenship_routes\.json/.test(text)
            || /'public',\s*'citizenship_routes\.json'/.test(text)) {
            offenders.push(`${entry.name}`);
          }
        }
      }
    };
    for (const root of roots) walk(new URL(`../${root}/`, import.meta.url));
    expect(offenders).toEqual([]);
  });

  test('workflows running corpus-dependent commands include the fetch step', () => {
    // Commands whose code path reads data/compiled or the legacy twin. Keep this
    // list honest: adding a corpus reader without adding it here defeats the test.
    // Deliberately NOT here: monitor:news. It imports changeKey,
    // normalizeInstrument and officialSourcesByJurisdiction from sweep/run, but
    // the corpus read lives inside runSweep, which news never calls. Listing it
    // would force a deploy key onto publish-manual.yml for a dependency it does
    // not have. If news ever calls runSweep, add it here.
    const needsCorpus = [
      'monitor:sweep',
      'monitor:triage',
      'monitor:telegram',
      'data:build',
      'bun run build',
      'bun run verify',
    ];
    const failures: string[] = [];
    for (const entry of readdirSync(workflowDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.yml')) continue;
      const text = readFileSync(new URL(entry.name, workflowDir), 'utf8');
      const uses = needsCorpus.filter(command => text.includes(command));
      if (!uses.length) continue;
      if (!text.includes('./.github/actions/fetch-data')) {
        failures.push(`${entry.name} runs ${uses.join(', ')} without fetch-data`);
      }
    }
    expect(failures).toEqual([]);
  });
});

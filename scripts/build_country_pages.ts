#!/usr/bin/env bun
/**
 * Static per-country SEO pages, prerendered from the SAME React components the
 * app uses (src/components/SiteHeader, CountryProfile, CountriesList) via
 * react-dom/server. One source of truth: the navbar and profile can't drift
 * from the app, and the pages inherit the app's compiled Tailwind CSS.
 *
 * Runs as a Vite build plugin (closeBundle -> spawns this) so `vite build`
 * alone emits them. Also runnable directly: `bun scripts/build_country_pages.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Moon, Sun } from 'lucide-react';
import { SiteHeader, type NavKey } from '../src/components/SiteHeader';
import { CountriesList } from '../src/components/CountriesList';
import {
  CountryProfile,
  deriveCountryProfile,
  RESIDENCE_CATEGORY_LABELS,
  CITIZENSHIP_MODE_LABELS,
} from '../src/components/CountryProfile';
import {
  RightsProfile,
  RightsList,
  deriveBlocProfile,
} from '../src/components/RightsProfile';
import {
  RouteTypesHub,
  CbiPage,
  DigitalIdentityPage,
  GoldenVisaPage,
  NomadVisaPage,
  RetirementVisaPage,
  TalentSkilledVisaPage,
} from '../src/components/RouteTypePages';
import { DrivingLicencesPage } from '../src/components/DrivingLicencesPage';
import { buildCountrySlugMap } from '../src/lib/slug';
import { isNonApplicableJurisdiction } from '../src/lib/country';
import type { BlocsData, CitizenshipRoutesData } from '../src/types';
import type { LicenceExchangeData } from '../src/lib/licence-exchange';
import {
  LICENCE_AGREEMENTS_PATH,
  buildAgreementsFile,
  buildLicenceIndex,
  buildOriginSlices,
  countryHasLicenceData,
  summariseCountry,
} from '../src/lib/licence-exchange';

const root = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://flagpaths.com';

const FONT_LINKS = '<link rel="preconnect" href="https://fonts.googleapis.com">'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">';

// No-flash theme boot + toggle wiring: match the app (default dark unless the
// user chose light), and let prerendered pages flip + persist the theme via the
// #theme-toggle button (the SPA has no such id — its toggle is React-managed —
// so the wiring no-ops there and the script stays byte-identical everywhere).
// Exported so tests can pin its CSP sha256 allowance in public/_headers —
// `script-src 'self'` blocks inline scripts, and a silently-blocked theme boot
// left every prerendered page stuck in light mode. If you edit this script you
// MUST update the hash in public/_headers (the seo test recomputes it).
export const THEME_BOOT_JS = "try{if(localStorage.getItem('geo-arb-theme')!=='light')"
  + "document.documentElement.classList.add('dark')}catch(e){document.documentElement.classList.add('dark')}"
  + "document.addEventListener('DOMContentLoaded',function(){"
  + "var b=document.getElementById('theme-toggle');if(!b)return;"
  + "b.addEventListener('click',function(){"
  + "var d=document.documentElement.classList.toggle('dark');"
  + "try{localStorage.setItem('geo-arb-theme',d?'dark':'light')}catch(e){}})});";
const THEME_SCRIPT = `<script>${THEME_BOOT_JS}</script>`;

// Static country pages are prerendered without hydration, so the React
// onClick on the residence filter chips is dead HTML there. This script
// drives the same chips via the data attributes CountryProfile renders.
// The A/I class strings MUST mirror ResidenceSection's chip classes.
// Its sha256 is pinned in public/_headers (CSP) — tests/seo.test.ts checks.
export const RESIDENCE_FILTER_JS = "document.addEventListener('DOMContentLoaded',function(){var A='bg-primary text-primary-foreground',I='border bg-card text-muted-foreground hover:border-primary hover:text-foreground',btns=[].slice.call(document.querySelectorAll('[data-residence-filter]')),cards=[].slice.call(document.querySelectorAll('[data-residence-category]'));if(!btns.length)return;btns.forEach(function(b){b.addEventListener('click',function(){var f=b.getAttribute('data-residence-filter');btns.forEach(function(x){var on=x===b;A.split(' ').forEach(function(c){x.classList.toggle(c,on)});I.split(' ').forEach(function(c){x.classList.toggle(c,!on)});});cards.forEach(function(c){c.style.display=(f==='all'||c.getAttribute('data-residence-category')===f)?'':'none'});})});});";
const RESIDENCE_FILTER_SCRIPT = `<script>${RESIDENCE_FILTER_JS}</script>`;

// Route-type pages are part of the public discovery layer. Keep this exported
// so the sitemap and tests share one release decision.
export const ROUTES_ENABLED = true;

// One list drives BOTH the page loop and the sitemap so a new hub can never
// ship unindexed (the exact footgun tests/seo.test.ts guards).
export const ROUTE_PATHS = [
  'routes',
  'routes/citizenship-by-investment',
  'routes/golden-visas',
  'routes/digital-nomad-visas',
  'routes/retirement-visas',
  'routes/talent-skilled-visas',
  'routes/digital-identities',
  // NOT 'routes/driving-licences'. The page still renders — it is emitted from
  // `routePages` below, not from this list — but it is deliberately kept OUT of the
  // sitemap while the agreement layer is being built. Its modal answer today is one
  // or two destinations, and Google is already declining to index 131 of our pages;
  // feeding it another thin one costs crawl budget the country pages need. It also
  // carries robots:noindex (see NOINDEX_PATHS), because a page absent from the
  // sitemap but still linked is not reliably de-indexed. Re-add when the agreement
  // research lands.
] as const;

/** Emitted and reachable, but deliberately not indexed. See ROUTE_PATHS above. */
export const NOINDEX_PATHS: readonly string[] = ['routes/driving-licences'];

/**
 * The full sitemap URL list, exported so tests assert hub coverage against the
 * SAME construction the build writes — no dependency on a (possibly stale)
 * dist/ artifact, and no second hand-maintained list to drift.
 */
export function buildSitemapUrls(
  citizenship: CitizenshipRoutesData,
  mobility: BlocsData,
): string[] {
  const slugByIso = buildCountrySlugMap(citizenship.jurisdictions);
  const isos = citizenship.jurisdictions
    .map(j => j.iso_n3)
    .filter(iso => !isNonApplicableJurisdiction(iso))
    .filter(iso => deriveCountryProfile(iso, citizenship, mobility) !== null);
  const rightsSlugs = mobility.blocs
    .map(bloc => deriveBlocProfile(bloc.id, mobility, citizenship)?.slug)
    .filter((slug): slug is string => Boolean(slug));
  return [
    `${SITE}/`,
    `${SITE}/about/`,
    `${SITE}/country/`, ...isos.map(iso => `${SITE}/country/${slugByIso.get(iso)}/`),
    `${SITE}/rights/`, ...rightsSlugs.map(slug => `${SITE}/rights/${slug}/`),
    ...(ROUTES_ENABLED ? ROUTE_PATHS.map(routePath => `${SITE}/${routePath}/`) : []),
  ];
}

/**
 * `lastmod` per URL, derived from the data rather than from the build clock.
 *
 * Stamping every URL with "now" on each deploy would be a lie that Google learns
 * to ignore: 271 pages claiming to change daily when a handful actually did. A
 * country page's real last-modified is the newest `last_checked` among the routes
 * it renders, which is exactly what our sourcing passes update.
 *
 * Omitted rather than guessed where nothing datable exists, since a sitemap with
 * no lastmod is honest and one with a wrong lastmod is worse than none.
 */
export function buildSitemapLastmod(
  citizenship: CitizenshipRoutesData,
  mobility: BlocsData,
): Map<string, string> {
  const slugByIso = buildCountrySlugMap(citizenship.jurisdictions);
  const dated = (value: unknown): string | null =>
    (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const newest = (dates: Array<string | null>): string | null => {
    const valid = dates.filter((d): d is string => d !== null).sort();
    return valid.length ? valid[valid.length - 1]! : null;
  };

  const byIso = new Map<string, string[]>();
  for (const route of citizenship.routes) {
    const iso = route.country?.iso_n3;
    const when = dated(route.last_checked);
    if (!iso || !when) continue;
    (byIso.get(iso) ?? byIso.set(iso, []).get(iso)!).push(when);
  }

  const lastmod = new Map<string, string>();
  for (const [iso, dates] of byIso) {
    const slug = slugByIso.get(iso);
    const when = newest(dates);
    if (slug && when) lastmod.set(`${SITE}/country/${slug}/`, when);
  }
  // Hubs move whenever anything beneath them moves, so they take the corpus max.
  const corpusMax = newest([...lastmod.values()]);
  if (corpusMax) {
    for (const hub of [`${SITE}/`, `${SITE}/country/`, `${SITE}/rights/`,
      ...(ROUTES_ENABLED ? ROUTE_PATHS.map(p => `${SITE}/${p}/`) : [])]) {
      lastmod.set(hub, corpusMax);
    }
    for (const bloc of mobility.blocs) {
      const slug = deriveBlocProfile(bloc.id, mobility, citizenship)?.slug;
      if (slug) lastmod.set(`${SITE}/rights/${slug}/`, corpusMax);
    }
  }
  return lastmod;
}

// Static-page theme toggle, wired by THEME_BOOT_JS above. Mirrors the app's
// header toggle (ghost icon button, Sun in dark / Moon in light via CSS).
function staticHeader(active: NavKey) {
  const toggle = createElement(
    'button',
    {
      id: 'theme-toggle',
      type: 'button',
      'aria-label': 'Toggle light/dark theme',
      className: 'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    },
    createElement(Sun, { className: 'hidden size-4 dark:block', 'aria-hidden': true }),
    createElement(Moon, { className: 'size-4 dark:hidden', 'aria-hidden': true }),
  );
  return createElement(SiteHeader, { active, right: toggle });
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function jsonLd(obj: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

/** Read the app's hashed Tailwind CSS asset from the built index.html. */
function appCssHref(distDir: string): string {
  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const match = html.match(/assets\/index-[^"']+\.css/);
  if (!match) throw new Error('Could not find the compiled CSS asset in dist/index.html');
  return `/${match[0]}`;
}

// Shared footer for every prerendered page: gives crawlers a path to /about/
// (and readers a path to corrections) from all static pages, and keeps the
// informational-only stance visible site-wide.
const FOOTER_HTML = '<footer class="mt-16 border-t">'
  + '<div class="mx-auto max-w-[1060px] px-4 py-6 sm:px-6">'
  + '<div class="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">'
  + '<span class="font-heading text-base font-bold">Flag Paths</span>'
  + '<nav class="flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-xs text-muted-foreground">'
  + '<a href="/about/" class="hover:text-foreground">About &amp; methodology</a>'
  + '<a href="/country/" class="hover:text-foreground">Countries</a>'
  + '<a href="/rights/" class="hover:text-foreground">Regional systems</a>'
  + '<a href="https://github.com/thomas779/geo-arb-map" rel="noreferrer" class="hover:text-foreground">GitHub</a>'
  + '<a href="https://t.me/flagpaths" rel="noreferrer" class="hover:text-foreground">Telegram</a>'
  + '</nav></div>'
  + '<p class="mt-4 max-w-[640px] font-mono text-[0.68rem] leading-relaxed text-muted-foreground/80">'
  + 'Informational only — not legal advice. Rules change constantly; verify with an immigration lawyer in the specific country before acting.</p>'
  + '</div></footer>';

function htmlDoc(opts: {
  title: string;
  description: string;
  canonical: string;
  cssHref: string;
  headExtra: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${opts.canonical}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#EFEDE7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#191A18" media="(prefers-color-scheme: dark)">
${THEME_SCRIPT}
${FONT_LINKS}
<link rel="stylesheet" href="${opts.cssHref}">
${opts.headExtra}
</head>
<body class="bg-background text-foreground font-sans antialiased">${opts.bodyHtml}${FOOTER_HTML}</body></html>
`;
}

/**
 * The atlas index: everything the map, sidebar, search and route-class painting
 * need, with the prose bodies left out. About 11% of the full corpus (160KB vs
 * 1.4MB), so opening one country no longer ships 240 jurisdictions of detail.
 * Per-country detail lives in the slices written beside each prerendered page,
 * which is also what makes the dataset agent-ingestible: read one small index,
 * then fetch only the jurisdictions you actually need.
 *
 * Field names stay identical to the full corpus so a consumer can move between
 * index and slice without a second mental model.
 */
export function buildAtlasIndex(citizenship: CitizenshipRoutesData, releaseId?: string) {
  return {
    meta: {
      ...citizenship.meta,
      ...(releaseId ? { release_id: releaseId } : {}),
      shape: 'atlas-index',
      detail: 'Per-country detail: /country/<slug>/data.json',
    },
    jurisdictions: citizenship.jurisdictions.map(jurisdiction => ({
      iso_n3: jurisdiction.iso_n3,
      name: jurisdiction.name,
      coverage: jurisdiction.coverage,
    })),
    // A strict PROJECTION of the corpus: identical field names and nesting,
    // fewer fields. Titles are included so the atlas panel needs no extra
    // fetch; summary, sources, facts and pathways stay slice-only, which is
    // both the payload win and the boundary that keeps bulk prose private.
    routes: citizenship.routes.map(route => ({
      id: route.id,
      country: route.country,
      mode: route.mode,
      title: route.title,
      status: route.status,
      // Not a body field: one enum the ancestry facet paints from (#191). The
      // generation it summarises lived only in `eligibility`, which never leaves
      // the build, so without this the browser cannot tell Ireland from Italy.
      descent_reach: route.descent_reach ?? null,
      confidence: route.confidence,
      last_checked: route.last_checked,
    })),
    residence_routes: (citizenship.residence_routes ?? []).map(route => ({
      id: route.id,
      country: route.country,
      category: route.category,
      title: route.title,
      status: route.status,
      outcome: route.outcome,
      counts_toward_permanent_residence: route.counts_toward_permanent_residence,
      counts_toward_naturalization: route.counts_toward_naturalization,
      work_rights: route.work_rights ?? null,
      confidence: route.confidence,
      last_checked: route.last_checked,
    })),
  };
}

/** One jurisdiction's full detail: the unit an agent or the panel actually reads. */
export function buildCountrySlice(
  iso: string,
  slug: string,
  citizenship: CitizenshipRoutesData,
  releaseId?: string,
  licence?: LicenceExchangeData | null,
) {
  const jurisdiction = citizenship.jurisdictions.find(item => item.iso_n3 === iso);
  // The licence layer arrives here as a SUMMARY, not as rows: the in-app country
  // panel needs the same card the prerendered page shows, and this slice is already
  // the one request it makes. Absent when this iso appears in no list at all.
  const licenceSummary = licence ? summariseCountry(licence, iso) : null;
  return {
    meta: {
      shape: 'country-slice',
      ...(releaseId ? { release_id: releaseId } : {}),
      last_updated: citizenship.meta.last_updated,
      canonical: `${SITE}/country/${slug}/`,
      index: `${SITE}/atlas-index.json`,
      license: 'CC BY-NC 4.0, attribution: geo-arb-map contributors',
    },
    jurisdiction: jurisdiction ?? null,
    routes: citizenship.routes.filter(route => route.country.iso_n3 === iso),
    residence_routes: (citizenship.residence_routes ?? []).filter(
      route => route.country.iso_n3 === iso),
    licence: licenceSummary && countryHasLicenceData(licenceSummary) ? licenceSummary : null,
  };
}

export function generateCountryPages(distDir: string = path.join(root, 'dist')): void {
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist/ not found at ${distDir} — run "vite build" first.`);
  }
  const citizenship = JSON.parse(
    fs.readFileSync(path.join(root, 'data/compiled/citizenship_routes.json'), 'utf8'),
  ) as CitizenshipRoutesData;
  const mobility = JSON.parse(
    fs.readFileSync(path.join(root, 'public/blocs_data.json'), 'utf8'),
  ) as BlocsData;
  const cssHref = appCssHref(distDir);
  const releaseId = (() => {
    try {
      return (JSON.parse(fs.readFileSync(
        path.join(root, 'public/data_release.json'), 'utf8')) as { release_id?: string }).release_id;
    } catch {
      return undefined;
    }
  })();
  const slugByIso = buildCountrySlugMap(citizenship.jurisdictions);
  const isos = citizenship.jurisdictions
    .map(j => j.iso_n3)
    .filter(iso => !isNonApplicableJurisdiction(iso));
  // A BUILD INPUT, not a served file (#210). The corpus is 45 destinations of annex;
  // the browser gets the index plus the one origin slice it asked for, emitted below.
  const licenceExchange = (() => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(root, 'data/compiled/licence_exchange.json'), 'utf8'),
      ) as LicenceExchangeData;
    } catch {
      return null;
    }
  })();

  for (const iso of isos) {
    const data = deriveCountryProfile(
      iso, citizenship, mobility,
      licenceExchange ? summariseCountry(licenceExchange, iso) : null,
    );
    if (!data) continue;
    const url = `${SITE}/country/${data.slug}/`;
    const bodyHtml = renderToStaticMarkup(createElement(
      Fragment, null,
      staticHeader('countries'),
      createElement(CountryProfile, { data }),
    )) + RESIDENCE_FILTER_SCRIPT;
    const presentModes = Object.entries(data.coverage)
      .filter(([, s]) => s === 'reviewed' || s === 'partial')
      .map(([m]) => CITIZENSHIP_MODE_LABELS[m] ?? m);
    const residenceCats = [...new Set(data.residence.map(r => r.category))]
      .map(c => RESIDENCE_CATEGORY_LABELS[c]);
    const headExtra = [
      `<meta property="og:type" content="article"><meta property="og:site_name" content="Flag Paths">`,
      `<meta property="og:url" content="${url}"><meta property="og:title" content="${esc(`${data.name} — Citizenship & Residence Routes`)}">`,
      `<meta property="og:description" content="${esc(data.description)}"><meta property="og:image" content="${SITE}/og-image.png">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      jsonLd({ '@context': 'https://schema.org', '@type': 'Country', name: data.name, url, description: data.description }),
      jsonLd({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Flag Paths', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Countries', item: `${SITE}/country/` },
          { '@type': 'ListItem', position: 3, name: data.name, item: url },
        ],
      }),
      jsonLd({
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: [
          { '@type': 'Question', name: `How can I get citizenship in ${data.name}?`,
            acceptedAnswer: { '@type': 'Answer', text: presentModes.length
              ? `${data.name} grants citizenship through: ${presentModes.join(', ')}.`
              : `${data.name}'s citizenship routes have not yet been reviewed at route level.` } },
          { '@type': 'Question', name: `What residence or golden-visa options does ${data.name} offer?`,
            acceptedAnswer: { '@type': 'Answer', text: data.residence.length
              ? `${data.name} offers ${data.residence.length} residence programme(s): ${residenceCats.join(', ')}.`
              : `No residence-by-investment or long-stay programme is recorded for ${data.name} yet.` } },
        ],
      }),
    ].join('\n');
    const dir = path.join(distDir, 'country', data.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), htmlDoc({
      title: `${data.name} — Citizenship & Residence Routes | Flag Paths`,
      description: data.description,
      canonical: url,
      cssHref,
      headExtra,
      bodyHtml,
    }));
    // Machine sibling of the page: the panel fetches this on selection, and an
    // agent that lands on the HTML finds the data one path away.
    fs.writeFileSync(
      path.join(dir, 'data.json'),
      `${JSON.stringify(buildCountrySlice(iso, data.slug, citizenship, releaseId, licenceExchange), null, 2)}\n`,
    );
  }

  // Hub: same SiteHeader + the shared CountriesList.
  const hubBody = renderToStaticMarkup(createElement(
    Fragment, null,
    staticHeader('countries'),
    createElement(CountriesList, { citizenshipRoutes: citizenship }),
  ));
  fs.writeFileSync(path.join(distDir, 'country', 'index.html'), htmlDoc({
    title: 'All countries — Citizenship & Residence Routes | Flag Paths',
    description: `Browse citizenship and residence routes for ${isos.length} countries and territories.`,
    canonical: `${SITE}/country/`,
    cssHref,
    headExtra: jsonLd({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Flag Paths', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Countries', item: `${SITE}/country/` },
      ],
    }),
    bodyHtml: hubBody,
  }));

  // ── Regional-system pages (/rights/<slug>) + hub ──
  const rightsUrls: string[] = [];
  for (const bloc of mobility.blocs) {
    const data = deriveBlocProfile(bloc.id, mobility, citizenship);
    if (!data) continue;
    const url = `${SITE}/rights/${data.slug}/`;
    const bodyHtml = renderToStaticMarkup(createElement(
      Fragment, null,
      staticHeader('rights'),
      createElement(RightsProfile, { data }),
    ));
    const headExtra = [
      `<meta property="og:type" content="article"><meta property="og:site_name" content="Flag Paths">`,
      `<meta property="og:url" content="${url}"><meta property="og:title" content="${esc(`${data.name} — Residence & Citizenship Rights`)}">`,
      `<meta property="og:description" content="${esc(data.description)}"><meta property="og:image" content="${SITE}/og-image.png">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      jsonLd({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Flag Paths', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Rights', item: `${SITE}/rights/` },
          { '@type': 'ListItem', position: 3, name: data.name, item: url },
        ],
      }),
    ].join('\n');
    const dir = path.join(distDir, 'rights', data.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), htmlDoc({
      title: `${data.name} — Residence & Citizenship Rights | Flag Paths`,
      description: data.description, canonical: url, cssHref, headExtra, bodyHtml,
    }));
    rightsUrls.push(url);
  }
  const rightsHub = renderToStaticMarkup(createElement(
    Fragment, null,
    staticHeader('rights'),
    createElement(RightsList, { mobility }),
  ));
  fs.writeFileSync(path.join(distDir, 'rights', 'index.html'), htmlDoc({
    title: 'Regional systems — Residence & Citizenship Blocs | Flag Paths',
    description: `Browse ${mobility.blocs.length} regional systems that grant residence or citizenship rights across their members.`,
    canonical: `${SITE}/rights/`, cssHref,
    headExtra: jsonLd({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Flag Paths', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Rights', item: `${SITE}/rights/` },
      ],
    }),
    bodyHtml: rightsHub,
  }));

  // ── Route pages (/routes/ hub + country shortlists) ──
  // Browse pages narrow the field by country and outcome. Country guides own
  // programme conditions and evidence; Planner will eventually own ranking.
  if (!licenceExchange) {
    throw new Error('data/compiled/licence_exchange.json is required to prerender driving-licence routes');
  }
  const routePages: Array<{ path: string; title: string; description: string; el: ReturnType<typeof createElement> }> = [
    {
      path: 'routes',
      title: 'Routes — Citizenship & Residence Paths | Flag Paths',
      description: 'Browse citizenship and residence route families, including investment, ancestry, naturalization, digital nomad, retirement, and talent paths.',
      el: createElement(RouteTypesHub, { data: citizenship, licenceData: licenceExchange }),
    },
    {
      path: 'routes/citizenship-by-investment',
      title: 'Citizenship by Investment Countries | Flag Paths',
      description: 'Browse countries with active citizenship-by-investment programmes, plus closed and pending programmes, linked to sourced country guides.',
      el: createElement(CbiPage, { data: citizenship }),
    },
    {
      path: 'routes/golden-visas',
      title: 'Golden Visa Countries by Outcome | Flag Paths',
      description: 'Browse residence-by-investment countries grouped by whether routes can lead to citizenship, permanent residence, or temporary stay.',
      el: createElement(GoldenVisaPage, { data: citizenship }),
    },
    {
      path: 'routes/digital-nomad-visas',
      title: 'Digital Nomad Visa Countries by Outcome | Flag Paths',
      description: 'Browse digital nomad visa countries grouped by whether routes can lead to citizenship, permanent residence, or temporary stay.',
      el: createElement(NomadVisaPage, { data: citizenship }),
    },
    {
      path: 'routes/retirement-visas',
      title: 'Retirement Visa Countries by Outcome | Flag Paths',
      description: 'Browse retirement, pension, and passive-income residence countries grouped by whether routes can lead to citizenship, permanent residence, or temporary stay.',
      el: createElement(RetirementVisaPage, { data: citizenship }),
    },
    {
      path: 'routes/talent-skilled-visas',
      title: 'Talent and Skilled Visa Countries by Outcome | Flag Paths',
      description: 'Browse countries with mapped talent and skilled routes, grouped by whether routes can lead to citizenship, permanent residence, or temporary stay.',
      el: createElement(TalentSkilledVisaPage, { data: citizenship }),
    },
    {
      path: 'routes/digital-identities',
      title: 'Digital Identity and E-Residency Countries | Flag Paths',
      description: 'Browse government digital identity and e-residency programmes for non-residents, without confusing them with residence or citizenship rights.',
      el: createElement(DigitalIdentityPage, { data: citizenship }),
    },
    {
      path: 'routes/driving-licences',
      title: 'Driving Licence Exchange Lookup | Flag Paths',
      description:
        'Look up which destinations exchange a foreign driving licence and whether theory or practical tests are required. Seeded with Germany Anlage 11 FeV; normal-residence rules apply.',
      el: createElement(DrivingLicencesPage, { data: licenceExchange }),
    },
  ];
  const routeUrls: string[] = [];
  for (const page of ROUTES_ENABLED ? routePages : []) {
    const url = `${SITE}/${page.path}/`;
    let bodyHtml = renderToStaticMarkup(createElement(
      Fragment, null,
      staticHeader('routes'),
      page.el,
    ));
    // Progressive enhancement for the licence exchange lookup (script is
    // public/licence-exchange.js, allowed by script-src 'self').
    if (page.path === 'routes/driving-licences') {
      bodyHtml += '<script src="/licence-exchange.js" defer></script>';
    }
    const headExtra = [
      ...(NOINDEX_PATHS.includes(page.path)
        ? ['<meta name="robots" content="noindex, follow">']
        : []),
      `<meta property="og:type" content="website"><meta property="og:site_name" content="Flag Paths">`,
      `<meta property="og:url" content="${url}"><meta property="og:title" content="${esc(page.title)}">`,
      `<meta property="og:description" content="${esc(page.description)}"><meta property="og:image" content="${SITE}/og-image.png">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      jsonLd({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Flag Paths', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Routes', item: `${SITE}/routes/` },
          ...(page.path === 'routes' ? [] : [{ '@type': 'ListItem', position: 3, name: page.title.split(' | ')[0], item: url }]),
        ],
      }),
    ].join('\n');
    const dir = path.join(distDir, page.path);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), htmlDoc({
      title: page.title, description: page.description, canonical: url, cssHref, headExtra, bodyHtml,
    }));
    routeUrls.push(url);
  }

  // Heritage /route pages dissolved: ancestry and diaspora programmes live on
  // country pages. Permanent redirects for old URLs are in public/_redirects
  // (copied into dist by the static build).

  // ── About & methodology (/about) ──
  // The trust page: what the Atlas is, how the data is researched and reviewed,
  // and how to correct it. Coverage/route counts are computed from the live
  // dataset at build time so they can never go stale.
  const aboutUrl = `${SITE}/about/`;
  const routeCount = citizenship.routes.length;
  const residenceCount = (citizenship.residence_routes ?? []).length;
  const fullyReviewed = citizenship.jurisdictions.filter(j =>
    Object.values(j.coverage).every(state => state === 'reviewed')).length;
  const link = (href: string, label: string) =>
    `<a href="${href}" rel="noreferrer" class="underline underline-offset-2 decoration-muted-foreground/50 hover:decoration-foreground">${label}</a>`;
  const stat = (value: string, label: string) =>
    `<div class="rounded-lg border bg-card p-4"><div class="font-heading text-3xl font-bold leading-none">${value}</div>`
    + `<div class="mt-2 font-mono text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">${label}</div></div>`;
  const step = (n: string, title: string, text: string) =>
    `<div class="rounded-lg border bg-card p-4"><div class="flex items-baseline gap-2">`
    + `<span class="font-mono text-sm font-semibold text-primary">${n}</span>`
    + `<h3 class="font-heading text-lg font-semibold leading-tight">${title}</h3></div>`
    + `<p class="mt-2 text-sm text-muted-foreground">${text}</p></div>`;
  const sectionHead = (title: string, lede: string) =>
    `<h2 class="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">${title}</h2>`
    + `<p class="mt-2 max-w-[640px] text-sm text-muted-foreground">${lede}</p>`;
  const confidenceChips =
    `<span class="rounded-full bg-verified/15 px-2 py-0.5 font-mono text-[0.66rem] text-verified">high</span>`
    + `<span class="rounded-full bg-secondary px-2 py-0.5 font-mono text-[0.66rem]">medium</span>`
    + `<span class="rounded-full border px-2 py-0.5 font-mono text-[0.66rem] text-muted-foreground">low</span>`;
  const aboutBody = renderToStaticMarkup(staticHeader('none'))
    + `<main class="mx-auto max-w-[1060px] px-4 py-10 sm:px-6">
<nav class="mb-8 font-mono text-xs text-muted-foreground"><a href="/" class="underline underline-offset-2">Flag Paths</a> › About</nav>

<div class="max-w-[720px]">
<p class="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-primary">About &amp; methodology</p>
<h1 class="mt-3 font-heading text-4xl font-bold leading-[1.1] sm:text-5xl">An open atlas of the rules that move people.</h1>
<p class="mt-4 text-base leading-relaxed text-muted-foreground">Some passports and residencies quietly unlock whole
regions: Mercosur residency opens most of South America, and an Irish grandparent is a two-year paper trail away from
the entire EU. Flag Paths maps those windows — every route with its sources and review state visible.</p>
</div>

<div class="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
${stat(String(isos.length), 'countries &amp; territories')}
${stat(String(routeCount), 'citizenship routes')}
${stat(String(residenceCount), 'residence programmes')}
${stat(String(fullyReviewed), 'fully reviewed')}
</div>

<section class="mt-12">
${sectionHead('How the data is built', 'Facts carry their own provenance. Nothing on this site asks to be trusted on authority alone.')}
<div class="mt-4 grid gap-3 sm:grid-cols-3">
<div class="rounded-lg border bg-card p-4"><h3 class="font-heading text-lg font-semibold leading-tight">Sourced</h3>
<p class="mt-2 text-sm text-muted-foreground">Every route cites the law, gazette, or official page it comes from, with a visible <em>last checked</em> date.</p></div>
<div class="rounded-lg border bg-card p-4"><h3 class="font-heading text-lg font-semibold leading-tight">Graded</h3>
<p class="mt-2 text-sm text-muted-foreground">Confidence is labeled per route, not implied:</p>
<div class="mt-2.5 flex flex-wrap gap-1.5">${confidenceChips}</div></div>
<div class="rounded-lg border bg-card p-4"><h3 class="font-heading text-lg font-semibold leading-tight">Honest about gaps</h3>
<p class="mt-2 text-sm text-muted-foreground"><span class="font-mono text-xs">reviewed</span> means checked against primary sources.
<span class="font-mono text-xs">unchecked</span> never means no route exists — a negative conclusion must itself be reviewed and sourced.</p></div>
</div>
<p class="mt-3 text-sm text-muted-foreground">${fullyReviewed} jurisdictions are fully reviewed across all four citizenship modes
(ancestry, naturalization, birth, investment) — and the number only moves forward: the test suite pins every fixed mistake so it cannot silently return.</p>
</section>

<section class="mt-12">
${sectionHead('How changes are caught', 'Nationality and immigration law changes constantly. The Atlas is wired to notice.')}
<div class="mt-4 grid gap-3 sm:grid-cols-3">
${step('01', 'Detect', 'An automated monitor sweeps official sources daily — government gazettes, ministry feeds, and primary legal databases.')}
${step('02', 'Verify', 'Every finding is cross-checked against the original source text, in its original language, before anything is published.')}
${step('03', 'Review', `Confirmed changes post to the ${link('https://t.me/flagpaths', 'Telegram channel')}. Dataset edits become review leads first — automation can propose, only human review can change a legal fact.`)}
</div>
</section>

<section class="mt-12 grid gap-3 sm:grid-cols-2">
<div class="rounded-lg border bg-card p-5">
<h2 class="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Corrections</h2>
<p class="mt-3 text-sm text-muted-foreground">The data and code are open (AGPL-3.0). If something is wrong or out of date,
open an issue — corrections ship with a test so the mistake stays fixed. Flag Paths is built in the open by
${link('https://github.com/thomas779', 'Thomas Humphreys')}.</p>
<a href="https://github.com/thomas779/geo-arb-map/issues" rel="noreferrer"
class="mt-4 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-semibold hover:bg-secondary">Open an issue on GitHub →</a>
</div>
<div class="rounded-lg border border-dashed p-5">
<h2 class="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Not legal advice</h2>
<p class="mt-3 text-sm text-muted-foreground">Everything here is informational only. Much of the dataset was researched with
AI assistance at varying, clearly-labeled confidence levels, and rules change faster than any dataset. Verify with an
immigration lawyer in the specific country before acting on anything shown here.</p>
</div>
</section>
</main>`;
  fs.mkdirSync(path.join(distDir, 'about'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'about', 'index.html'), htmlDoc({
    title: 'About & methodology | Flag Paths',
    description: `How Flag Paths researches, reviews, and monitors citizenship and residence rules: ${routeCount} sourced routes across ${isos.length} jurisdictions, explicit review states, and automated change monitoring.`,
    canonical: aboutUrl,
    cssHref,
    headExtra: [
      jsonLd({
        '@context': 'https://schema.org', '@type': 'AboutPage', url: aboutUrl,
        name: 'About & methodology — Flag Paths',
        isPartOf: { '@id': `${SITE}/#website` },
        about: { '@id': `${SITE}/#organization` },
      }),
      jsonLd({
        '@context': 'https://schema.org', '@type': 'Organization',
        '@id': `${SITE}/#organization`, name: 'Flag Paths', url: `${SITE}/`,
        logo: `${SITE}/og-image.png`,
        sameAs: ['https://github.com/thomas779/geo-arb-map', 'https://t.me/flagpaths'],
      }),
    ].join('\n'),
    bodyHtml: aboutBody,
  }));

  fs.writeFileSync(
    path.join(distDir, 'atlas-index.json'),
    `${JSON.stringify(buildAtlasIndex(citizenship, releaseId), null, 2)}\n`,
  );

  // ── Licence exchange: index + one slice per origin (#210) ──
  // The corpus stopped being a served file when the four regional research batches
  // took it past the 200KB public-surface cap. Nothing was trimmed: the whole of it
  // is reachable, one origin at a time, which is also the only shape the question
  // "where can I swap the licence I hold" actually has.
  fs.writeFileSync(
    path.join(distDir, 'licence_exchange.json'),
    `${JSON.stringify(buildLicenceIndex(licenceExchange), null, 2)}\n`,
  );
  const originSlices = buildOriginSlices(licenceExchange);
  fs.mkdirSync(path.join(distDir, 'licence-exchange'), { recursive: true });
  // The agreements in full, prose and all. Split out of the index because the map
  // facet paints from the ISO lists alone, while `basis` and `residence_condition`
  // are read once about one arrangement — 79KB that every first paint was paying for.
  fs.writeFileSync(
    path.join(distDir, LICENCE_AGREEMENTS_PATH.replace(/^\//, '')),
    `${JSON.stringify(buildAgreementsFile(licenceExchange), null, 2)}\n`,
  );
  for (const [servedPath, slice] of originSlices) {
    fs.writeFileSync(
      path.join(distDir, servedPath.replace(/^\//, '')),
      `${JSON.stringify(slice, null, 2)}\n`,
    );
  }

  const urls = buildSitemapUrls(citizenship, mobility);
  const lastmod = buildSitemapLastmod(citizenship, mobility);
  fs.writeFileSync(path.join(distDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => {
      const when = lastmod.get(u);
      return `  <url><loc>${u}</loc>${when ? `<lastmod>${when}</lastmod>` : ''}</url>`;
    }).join('\n')}\n</urlset>\n`);

  console.log(`build_country_pages: ${isos.length} country + ${rightsUrls.length} rights + ${routeUrls.length} route pages + hubs + about + sitemap + atlas-index and ${isos.length} slices + licence index and ${originSlices.size} origin slices + agreements -> ${distDir}`);
}

if (import.meta.main) {
  generateCountryPages();
}

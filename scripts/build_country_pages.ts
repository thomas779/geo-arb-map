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
import { SiteHeader } from '../src/components/SiteHeader';
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
  RouteList,
  deriveBlocProfile,
  deriveRouteProfile,
  routeLanesForPages,
} from '../src/components/RightsProfile';
import { buildCountrySlugMap } from '../src/lib/slug';
import type { BlocsData, CitizenshipRoutesData } from '../src/types';

const root = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://atlas.thomphreys.com';
// Uninhabited entries excluded from coverage (see src/App.tsx) — no pages.
const NON_APPLICABLE = new Set(['086', '239', '260', '334']);

const FONT_LINKS = '<link rel="preconnect" href="https://fonts.googleapis.com">'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">';

// No-flash theme: match the app (default dark unless the user chose light).
const THEME_SCRIPT = "<script>try{if(localStorage.getItem('geo-arb-theme')!=='light')"
  + "document.documentElement.classList.add('dark')}catch(e){document.documentElement.classList.add('dark')}</script>";

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
<body class="bg-background text-foreground font-sans antialiased">${opts.bodyHtml}</body></html>
`;
}

export function generateCountryPages(distDir: string = path.join(root, 'dist')): void {
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist/ not found at ${distDir} — run "vite build" first.`);
  }
  const citizenship = JSON.parse(
    fs.readFileSync(path.join(root, 'public/citizenship_routes.json'), 'utf8'),
  ) as CitizenshipRoutesData;
  const mobility = JSON.parse(
    fs.readFileSync(path.join(root, 'public/blocs_data.json'), 'utf8'),
  ) as BlocsData;
  const cssHref = appCssHref(distDir);
  const slugByIso = buildCountrySlugMap(citizenship.jurisdictions);
  const isos = citizenship.jurisdictions
    .map(j => j.iso_n3)
    .filter(iso => !NON_APPLICABLE.has(iso));

  for (const iso of isos) {
    const data = deriveCountryProfile(iso, citizenship, mobility);
    if (!data) continue;
    const url = `${SITE}/country/${data.slug}/`;
    const bodyHtml = renderToStaticMarkup(createElement(
      Fragment, null,
      createElement(SiteHeader, { active: 'countries' }),
      createElement(CountryProfile, { data }),
    ));
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
  }

  // Hub: same SiteHeader + the shared CountriesList.
  const hubBody = renderToStaticMarkup(createElement(
    Fragment, null,
    createElement(SiteHeader, { active: 'countries' }),
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
      createElement(SiteHeader, { active: 'rights' }),
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
    createElement(SiteHeader, { active: 'rights' }),
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

  // ── Heritage/ancestry route pages (/route/<slug>) + hub ──
  const routeUrls: string[] = [];
  for (const lane of routeLanesForPages(mobility)) {
    const data = deriveRouteProfile(lane.id, mobility, citizenship);
    if (!data) continue;
    const url = `${SITE}/route/${data.slug}/`;
    const bodyHtml = renderToStaticMarkup(createElement(
      Fragment, null,
      createElement(SiteHeader, { active: 'route' }),
      createElement(RightsProfile, { data }),
    ));
    const headExtra = [
      `<meta property="og:type" content="article"><meta property="og:site_name" content="Flag Paths">`,
      `<meta property="og:url" content="${url}"><meta property="og:title" content="${esc(`${data.name} — Citizenship by Heritage`)}">`,
      `<meta property="og:description" content="${esc(data.description)}"><meta property="og:image" content="${SITE}/og-image.png">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      jsonLd({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Flag Paths', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Routes', item: `${SITE}/route/` },
          { '@type': 'ListItem', position: 3, name: data.name, item: url },
        ],
      }),
    ].join('\n');
    const dir = path.join(distDir, 'route', data.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), htmlDoc({
      title: `${data.name} — Citizenship by Heritage | Flag Paths`,
      description: data.description, canonical: url, cssHref, headExtra, bodyHtml,
    }));
    routeUrls.push(url);
  }
  const routeHub = renderToStaticMarkup(createElement(
    Fragment, null,
    createElement(SiteHeader, { active: 'route' }),
    createElement(RouteList, { mobility }),
  ));
  fs.writeFileSync(path.join(distDir, 'route', 'index.html'), htmlDoc({
    title: 'Heritage & ancestry routes — Citizenship by Descent | Flag Paths',
    description: `Browse ${routeUrls.length} citizenship and residence routes claimable through ancestry, ethnicity, or diaspora ties.`,
    canonical: `${SITE}/route/`, cssHref,
    headExtra: jsonLd({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Flag Paths', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Routes', item: `${SITE}/route/` },
      ],
    }),
    bodyHtml: routeHub,
  }));

  const urls = [
    `${SITE}/`,
    `${SITE}/country/`, ...isos.map(iso => `${SITE}/country/${slugByIso.get(iso)}/`),
    `${SITE}/rights/`, ...rightsUrls,
    `${SITE}/route/`, ...routeUrls,
  ];
  fs.writeFileSync(path.join(distDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);

  console.log(`build_country_pages: ${isos.length} country + ${rightsUrls.length} rights + ${routeUrls.length} route pages + hubs + sitemap -> ${distDir}`);
}

if (import.meta.main) {
  generateCountryPages();
}

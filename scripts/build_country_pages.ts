#!/usr/bin/env bun
/**
 * Static per-country page generator (SEO). Runs AFTER `vite build`, writing
 * crawlable, self-contained HTML into dist/country/<slug>/index.html plus a
 * dist/country/ hub and a full dist/sitemap.xml. Each page mirrors the country
 * data the SPA shows (citizenship + residence routes, regional/treaty rights)
 * and cross-links to the interactive map at /?country=<iso>.
 *
 * Standalone pages (not the React SPA): the D3 map does not server-render, and
 * crawlers need real HTML. The SPA stays the interactive experience at /.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCountrySlugMap } from '../src/lib/slug';
import { countryFlag } from '../src/lib/country';
import type {
  BlocsData,
  CitizenshipRoutesData,
  ResidenceCategory,
} from '../src/types';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const SITE = 'https://atlas.thomphreys.com';
// Uninhabited entries excluded from coverage (see src/App.tsx) — no pages.
const NON_APPLICABLE = new Set(['086', '239', '260', '334']);

const RESIDENCE_CATEGORY_LABELS: Record<ResidenceCategory, string> = {
  investment: 'Investment (golden visa)',
  digital_nomad: 'Digital nomad',
  retirement_pension: 'Retirement',
  talent_skilled: 'Talent',
  general_permanent_residence: 'Permanent residence',
};

function readJson<T>(relative: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as T;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT_LINKS = '<link rel="preconnect" href="https://fonts.googleapis.com">'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">';

const THEME_META = '<meta name="theme-color" content="#EFEDE7" media="(prefers-color-scheme: light)">'
  + '<meta name="theme-color" content="#191A18" media="(prefers-color-scheme: dark)">';

// Flag Paths design system (mirrors src/index.css tokens + the site typography).
const PAGE_STYLE = `
:root{--bg:#EFEDE7;--fg:#222321;--card:#F9F7F1;--primary:#3552B8;--muted:#62645F;--border:#C9C9C1;--secondary:#DEDFDA;--verified:#3F755E;--radius:.5rem}
@media(prefers-color-scheme:dark){:root{--bg:#191A18;--fg:#EEEAE1;--card:#23241F;--primary:#91A4FF;--muted:#A8AAA3;--border:#3B3D36;--secondary:#2E302A;--verified:#7DB18F}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:'Inter',system-ui,sans-serif;font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}
.nav{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.5rem;border-bottom:1px solid var(--border)}
.nav .brand{font-family:'Fraunces',serif;font-weight:700;font-size:1.1rem;color:var(--fg);letter-spacing:-.01em}
.nav .brand:hover{text-decoration:none}
.nav .to-atlas{font-size:.82rem;font-weight:500;color:var(--muted)}
.wrap{max-width:720px;margin:0 auto;padding:2.5rem 1.5rem 5rem}
.crumbs{font-family:'IBM Plex Mono',monospace;font-size:.72rem;color:var(--muted);margin-bottom:2rem}
.crumbs a{color:var(--muted);text-decoration:underline}
.flag{font-size:2.75rem;line-height:1}
h1{font-family:'Fraunces',serif;font-weight:700;font-size:2.6rem;line-height:1.04;letter-spacing:-.02em;text-wrap:balance;margin:.4rem 0 .5rem}
.lede{color:var(--muted);font-size:1.05rem;max-width:60ch;margin:0 0 1.6rem}
.cta{display:inline-block;background:var(--primary);color:#fff;font-weight:600;font-size:.9rem;padding:.7rem 1.15rem;border-radius:var(--radius)}
.cta:hover{text-decoration:none;filter:brightness(1.06)}
section{margin-top:2.5rem}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.16em;color:var(--muted);margin:0 0 1rem;padding-top:1.5rem;border-top:1px solid var(--border)}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.15rem;margin:.7rem 0}
.card-head{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.4rem}
.label{font-family:'IBM Plex Mono',monospace;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
.pill{font-family:'IBM Plex Mono',monospace;font-size:.66rem;border:1px solid var(--border);border-radius:999px;padding:.1rem .55rem;color:var(--muted)}
.pill.lead{background:color-mix(in srgb,var(--verified) 15%,transparent);border-color:transparent;color:var(--verified)}
.card h3{font-family:'Fraunces',serif;font-weight:600;font-size:1.18rem;line-height:1.2;margin:0 0 .35rem}
.summary{color:var(--muted);font-size:.92rem;margin:0}
.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.65rem 0 0}
.chips span{font-family:'IBM Plex Mono',monospace;font-size:.72rem;background:var(--secondary);border-radius:.35rem;padding:.14rem .5rem;color:var(--fg)}
.sources{font-size:.8rem;color:var(--muted);margin:.75rem 0 0;border-top:1px dashed var(--border);padding-top:.6rem}
.sources a{color:var(--muted);text-decoration:underline}
.tags{display:flex;flex-wrap:wrap;gap:.4rem}
.tags span{background:var(--card);border:1px solid var(--border);border-radius:999px;padding:.35rem .8rem;font-size:.85rem}
.empty{color:var(--muted);font-size:.92rem;border:1px dashed var(--border);border-radius:var(--radius);padding:.9rem 1.1rem;margin:.7rem 0}
footer{margin-top:3.5rem;padding-top:1.5rem;border-top:1px solid var(--border);font-size:.82rem;color:var(--muted)}
footer a{color:var(--muted);text-decoration:underline}
@media(max-width:560px){h1{font-size:2.1rem}.wrap{padding:2rem 1.15rem 4rem}}
`.trim();

const CITIZENSHIP_MODE_LABELS: Record<string, string> = {
  ancestry: 'Ancestry', naturalization: 'Naturalization', birth: 'Birth', investment: 'Investment',
};

function jsonLd(obj: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

interface Ctx {
  citizenship: CitizenshipRoutesData;
  mobility: BlocsData;
  slugByIso: Map<string, string>;
}

function countryPage(iso: string, ctx: Ctx): string {
  const { citizenship, mobility, slugByIso } = ctx;
  const jur = citizenship.jurisdictions.find(j => j.iso_n3 === iso)!;
  const name = jur.name;
  const slug = slugByIso.get(iso)!;
  const url = `${SITE}/country/${slug}/`;
  const routes = citizenship.routes.filter(r => r.country.iso_n3 === iso);
  const residence = (citizenship.residence_routes ?? []).filter(r => r.country.iso_n3 === iso);
  const blocs = mobility.blocs.filter(b => b.members.some(m => m.iso_n3 === iso));
  const lanesIn = mobility.bilateral_lanes.filter(l => l.destination.iso_n3 === iso);
  const flag = countryFlag(iso);

  const presentModes = Object.entries(jur.coverage)
    .filter(([, state]) => state === 'reviewed' || state === 'partial')
    .map(([mode]) => CITIZENSHIP_MODE_LABELS[mode] ?? mode);
  const residenceCats = [...new Set(residence.map(r => r.category))]
    .map(c => RESIDENCE_CATEGORY_LABELS[c]);

  const desc = `How to get citizenship and residence in ${name}: `
    + `${routes.length} citizenship route${routes.length === 1 ? '' : 's'}`
    + (residence.length ? ` and ${residence.length} residence programme${residence.length === 1 ? '' : 's'} (${residenceCats.join(', ')})` : '')
    + `, with official sources. Part of the Flag Paths atlas.`;

  const sourcesRow = (sources: Array<{ title: string; url: string }>) => sources.length
    ? `<p class="sources">Sources: ${sources.map(s => `<a href="${esc(s.url)}" rel="nofollow noreferrer">${esc(s.title)}</a>`).join(' · ')}</p>`
    : '';

  const routeCard = (r: typeof routes[number]) => `
      <article class="card">
        <div class="card-head"><span class="label">${esc(CITIZENSHIP_MODE_LABELS[r.mode] ?? r.mode)}</span><span class="pill">${esc(r.status.replace(/_/g, ' '))}</span></div>
        <h3>${esc(r.title)}</h3>
        <p class="summary">${esc(r.summary)}</p>
        ${sourcesRow(r.sources)}
      </article>`;

  const resCard = (r: typeof residence[number]) => {
    const chips: string[] = [];
    if (r.min_investment) chips.push(`from ${r.min_investment.currency} ${r.min_investment.amount.toLocaleString('en-US')}`);
    if (r.min_income_monthly) chips.push(`${r.min_income_monthly.currency} ${r.min_income_monthly.amount.toLocaleString('en-US')}/mo`);
    if (r.physical_presence_days_per_year !== null) chips.push(r.physical_presence_days_per_year === 0 ? 'no stay required' : `${r.physical_presence_days_per_year} days/yr`);
    const leadsTo = r.counts_toward_naturalization ? '→ citizenship'
      : r.counts_toward_permanent_residence ? '→ permanent residence'
      : 'renewable — no PR';
    const leadClass = (r.counts_toward_naturalization || r.counts_toward_permanent_residence) ? 'pill lead' : 'pill';
    return `
      <article class="card">
        <div class="card-head"><span class="label">${esc(RESIDENCE_CATEGORY_LABELS[r.category])}</span><span class="${leadClass}">${esc(leadsTo)}</span></div>
        <h3>${esc(r.title)}</h3>
        <p class="summary">${esc(r.summary)}</p>
        ${chips.length ? `<div class="chips">${chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
        ${sourcesRow(r.sources)}
      </article>`;
  };

  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question', name: `How can I get citizenship in ${name}?`,
        acceptedAnswer: { '@type': 'Answer', text: presentModes.length
          ? `${name} grants citizenship through: ${presentModes.join(', ')}. See the route-level detail and official sources.`
          : `${name}'s citizenship routes have not yet been reviewed at route level in the Flag Paths atlas.` },
      },
      {
        '@type': 'Question', name: `What residence or golden-visa options does ${name} offer?`,
        acceptedAnswer: { '@type': 'Answer', text: residence.length
          ? `${name} offers ${residence.length} residence programme(s): ${residenceCats.join(', ')}.`
          : `No residence-by-investment or long-stay programme is recorded for ${name} in the Flag Paths atlas yet.` },
      },
    ],
  };
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Flag Paths', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Countries', item: `${SITE}/country/` },
      { '@type': 'ListItem', position: 3, name, item: url },
    ],
  };
  const place = {
    '@context': 'https://schema.org', '@type': 'Country', name,
    url, description: desc,
  };

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} — Citizenship &amp; Residence Routes | Flag Paths</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${THEME_META}
<meta property="og:type" content="article"><meta property="og:site_name" content="Flag Paths">
<meta property="og:url" content="${url}"><meta property="og:title" content="${esc(name)} — Citizenship &amp; Residence Routes">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
${FONT_LINKS}
${jsonLd(place)}${jsonLd(breadcrumb)}${jsonLd(faq)}
<style>${PAGE_STYLE}</style>
</head><body>
<nav class="nav"><a class="brand" href="/">Flag Paths</a><a class="to-atlas" href="/?country=${esc(iso)}">Interactive atlas →</a></nav>
<main class="wrap">
<div class="crumbs"><a href="/">Flag Paths</a> › <a href="/country/">Countries</a> › ${esc(name)}</div>
${flag ? `<div class="flag" aria-hidden="true">${flag}</div>` : ''}
<h1>${esc(name)}</h1>
<p class="lede">${esc(desc)}</p>
<a class="cta" href="/?country=${esc(iso)}">Explore ${esc(name)} on the interactive map →</a>

<section>
<h2 class="eyebrow">Citizenship routes</h2>
${routes.length ? routes.map(routeCard).join('') : '<p class="empty">Not yet reviewed at route level — a coverage gap, not a claim that no path exists.</p>'}
</section>

${residence.length ? `<section><h2 class="eyebrow">Residence &amp; settlement</h2>${residence.map(resCard).join('')}</section>` : ''}

${blocs.length ? `<section><h2 class="eyebrow">Regional rights</h2><div class="tags">${blocs.map(b => `<span>${esc(b.name)}</span>`).join('')}</div></section>` : ''}
${lanesIn.length ? `<section><h2 class="eyebrow">Treaty &amp; country paths</h2><div class="tags">${lanesIn.map(l => `<span>${esc(l.name)}</span>`).join('')}</div></section>` : ''}

<footer>
<p>Data is compiled from official and primary legal sources and reviewed for the Flag Paths atlas. Programmes — especially residence-by-investment — change frequently; verify against the linked official sources before acting.</p>
<p><a href="/country/">All countries</a> · <a href="/">Interactive atlas</a></p>
</footer>
</main></body></html>`;
}

function indexPage(ctx: Ctx, isos: string[]): string {
  const items = isos
    .map(iso => ({ iso, name: ctx.citizenship.jurisdictions.find(j => j.iso_n3 === iso)!.name, slug: ctx.slugByIso.get(iso)! }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const links = items.map(i => `<li><a href="/country/${i.slug}/">${esc(i.name)}</a></li>`).join('');
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Flag Paths', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Countries', item: `${SITE}/country/` },
    ],
  };
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>All countries — Citizenship &amp; Residence Routes | Flag Paths</title>
<meta name="description" content="Browse citizenship and residence routes for ${items.length} countries and territories: naturalization, ancestry, birth, investment, golden visas, digital-nomad and retirement residence.">
<meta name="robots" content="index, follow"><link rel="canonical" href="${SITE}/country/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${THEME_META}
${FONT_LINKS}
${jsonLd(breadcrumb)}
<style>${PAGE_STYLE} .country-list{columns:2;column-gap:2rem;list-style:none;padding:0;margin:1.5rem 0 0}@media(max-width:560px){.country-list{columns:1}}.country-list li{margin:.3rem 0;break-inside:avoid}</style>
</head><body>
<nav class="nav"><a class="brand" href="/">Flag Paths</a><a class="to-atlas" href="/">Interactive atlas →</a></nav>
<main class="wrap">
<div class="crumbs"><a href="/">Flag Paths</a> › Countries</div>
<h1>All countries &amp; territories</h1>
<p class="lede">Citizenship and residence routes for ${items.length} jurisdictions — naturalization, ancestry, birth, investment, and residence programmes, each with official sources.</p>
<a class="cta" href="/">Open the interactive atlas →</a>
<ul class="country-list">${links}</ul>
</main></body></html>`;
}

// --- generate ---
// Callable from the Vite build (see vite.config.ts) so `vite build` alone emits
// the pages, and runnable directly as `bun scripts/build_country_pages.ts`.
export function generateCountryPages(distDir: string = dist): void {
  const citizenship = readJson<CitizenshipRoutesData>('public/citizenship_routes.json');
  const mobility = readJson<BlocsData>('public/blocs_data.json');
  const slugByIso = buildCountrySlugMap(citizenship.jurisdictions);
  const ctx: Ctx = { citizenship, mobility, slugByIso };

  if (!fs.existsSync(distDir)) {
    throw new Error(`dist/ not found at ${distDir} — run "vite build" before generating country pages.`);
  }

  const isos = citizenship.jurisdictions
    .map(j => j.iso_n3)
    .filter(iso => !NON_APPLICABLE.has(iso));

  for (const iso of isos) {
    const slug = slugByIso.get(iso)!;
    const dir = path.join(distDir, 'country', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), countryPage(iso, ctx));
  }
  fs.writeFileSync(path.join(distDir, 'country', 'index.html'), indexPage(ctx, isos));

  // Sitemap: root + hub + every country page.
  const urls = [`${SITE}/`, `${SITE}/country/`, ...isos.map(iso => `${SITE}/country/${slugByIso.get(iso)}/`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap);

  console.log(`build_country_pages: ${isos.length} country pages + hub + sitemap (${urls.length} urls) -> ${distDir}`);
}

if (import.meta.main) {
  generateCountryPages();
}

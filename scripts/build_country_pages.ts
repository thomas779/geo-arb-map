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

// Flag Paths design system (mirrors src/index.css tokens + the site typography + app header).
const PAGE_STYLE = `
:root{--bg:#EFEDE7;--fg:#222321;--card:#F9F7F1;--primary:#3552B8;--muted:#62645F;--border:#C9C9C1;--secondary:#DEDFDA;--verified:#3F755E;--radius:.5rem}
@media(prefers-color-scheme:dark){:root{--bg:#191A18;--fg:#EEEAE1;--card:#23241F;--primary:#91A4FF;--muted:#A8AAA3;--border:#3B3D36;--secondary:#2E302A;--verified:#7DB18F}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font-family:'Inter',system-ui,sans-serif;font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}
.hdr{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:.7rem;height:56px;padding:0 1.25rem;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--card) 92%,transparent);backdrop-filter:blur(8px)}
.hdr .mark{width:32px;height:32px;flex:none}
.hdr .brand{display:flex;align-items:center;gap:.6rem}.hdr .brand:hover{text-decoration:none}
.hdr .name{font-family:'Fraunces',serif;font-weight:700;font-size:1.4rem;letter-spacing:-.035em;color:var(--fg);display:block;line-height:1}
.hdr .sub{font-family:'IBM Plex Mono',monospace;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:.2em;color:var(--muted);display:block;margin-top:3px}
.hdr nav{margin-left:auto;display:flex;align-items:center;gap:1.5rem}
.hdr nav a{font-size:.8rem;font-weight:600;color:var(--muted)}.hdr nav a:hover{color:var(--fg);text-decoration:none}
.hdr nav a[aria-current]{color:var(--fg)}
.wrap{max-width:1060px;margin:0 auto;padding:2rem 1.5rem 5rem}
.crumbs{font-family:'IBM Plex Mono',monospace;font-size:.72rem;color:var(--muted);margin-bottom:1.5rem}
.crumbs a{color:var(--muted);text-decoration:underline}
.layout{display:grid;grid-template-columns:1fr;gap:1.75rem}
@media(min-width:880px){.layout{grid-template-columns:266px 1fr;gap:3rem;align-items:start}.rail{position:sticky;top:80px}}
.rail .flag{font-size:3rem;line-height:1}
.rail h1{font-family:'Fraunces',serif;font-weight:700;font-size:2rem;line-height:1.04;letter-spacing:-.02em;text-wrap:balance;margin:.35rem 0 1rem}
.facts{display:flex;flex-direction:column;gap:.8rem;padding:1rem 1.1rem;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:1.1rem}
.fact .k{font-family:'IBM Plex Mono',monospace;font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);display:block}
.fact .v{font-size:.95rem;font-weight:600;margin-top:.1rem}
.cta{display:block;text-align:center;background:var(--primary);color:#fff;font-weight:600;font-size:.9rem;padding:.7rem 1rem;border-radius:var(--radius)}
.cta:hover{text-decoration:none;filter:brightness(1.06)}
.jump{display:flex;flex-wrap:wrap;gap:.45rem .9rem;margin-top:1.1rem;font-family:'IBM Plex Mono',monospace;font-size:.72rem}
.jump a{color:var(--muted)}
.lede{color:var(--muted);font-size:1.02rem;margin:0 0 1.75rem;max-width:62ch}
section{scroll-margin-top:72px}section+section{margin-top:2.25rem}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.16em;color:var(--muted);margin:0 0 1rem;padding-top:1.4rem;border-top:1px solid var(--border)}
.coverage{display:grid;grid-template-columns:repeat(2,1fr);gap:.5rem;margin:0 0 1.1rem}
@media(min-width:520px){.coverage{grid-template-columns:repeat(4,1fr)}}
.cov{border:1px solid var(--border);border-radius:var(--radius);padding:.55rem .65rem;background:var(--card)}
.cov .m{font-family:'IBM Plex Mono',monospace;font-size:.6rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);display:block}
.cov .s{font-size:.8rem;font-weight:600;margin-top:.2rem;display:flex;align-items:center;gap:.35rem;text-transform:capitalize}
.cov .dot{width:.5rem;height:.5rem;border-radius:999px;background:var(--muted);flex:none}
.cov.reviewed .dot{background:var(--verified)}.cov.partial .dot{background:var(--primary)}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.15rem;margin:.7rem 0}
.card-head{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.4rem}
.label{font-family:'IBM Plex Mono',monospace;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
.pill{font-family:'IBM Plex Mono',monospace;font-size:.66rem;border:1px solid var(--border);border-radius:999px;padding:.1rem .55rem;color:var(--muted)}
.pill.lead{background:color-mix(in srgb,var(--verified) 15%,transparent);border-color:transparent;color:var(--verified)}
.card h3{font-family:'Fraunces',serif;font-weight:600;font-size:1.15rem;line-height:1.2;margin:0 0 .35rem}
.summary{color:var(--muted);font-size:.92rem;margin:0}
.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.65rem 0 0}
.chips span{font-family:'IBM Plex Mono',monospace;font-size:.72rem;background:var(--secondary);border-radius:.35rem;padding:.14rem .5rem;color:var(--fg)}
.sources{font-size:.8rem;color:var(--muted);margin:.75rem 0 0;border-top:1px dashed var(--border);padding-top:.6rem}
.sources a{color:var(--muted);text-decoration:underline}
.tags{display:flex;flex-wrap:wrap;gap:.4rem}
.tags a,.tags span{background:var(--card);border:1px solid var(--border);border-radius:999px;padding:.35rem .8rem;font-size:.85rem;color:var(--fg)}
.tags a:hover{border-color:var(--primary);text-decoration:none}
.empty{color:var(--muted);font-size:.92rem;border:1px dashed var(--border);border-radius:var(--radius);padding:.9rem 1.1rem;margin:.7rem 0}
footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border);font-size:.82rem;color:var(--muted)}
footer a{color:var(--muted);text-decoration:underline}
@media(max-width:560px){.rail h1{font-size:1.75rem}.wrap{padding:1.5rem 1.15rem 4rem}}
`.trim();

const BRAND_MARK = '<svg class="mark" aria-hidden="true" viewBox="0 0 32 32" fill="none">'
  + '<path d="M5.5 24.5c0-7.2 4.1-9.8 9.1-9.8 5.8 0 6.1-7.2 11.9-7.2" stroke="var(--primary)" stroke-width="2" stroke-linecap="round"/>'
  + '<circle cx="5.5" cy="24.5" r="3" fill="var(--card)" stroke="var(--fg)" stroke-width="1.5"/>'
  + '<circle cx="26.5" cy="7.5" r="3" fill="var(--primary)" stroke="var(--card)" stroke-width="1.5"/></svg>';

function siteHeader(active: 'atlas' | 'countries'): string {
  return `<header class="hdr">`
    + `<a class="brand" href="/">${BRAND_MARK}<span><span class="name">Flag Paths</span><span class="sub">Mobility atlas</span></span></a>`
    + `<nav><a href="/"${active === 'atlas' ? ' aria-current="page"' : ''}>Atlas</a>`
    + `<a href="/planner">Planner</a>`
    + `<a href="/country"${active === 'countries' ? ' aria-current="page"' : ''}>Countries</a></nav>`
    + `</header>`;
}

const CITIZENSHIP_MODE_LABELS: Record<string, string> = {
  ancestry: 'Ancestry', naturalization: 'Naturalization', birth: 'Birth', investment: 'Investment',
};
const COVERAGE_ORDER = ['ancestry', 'naturalization', 'birth', 'investment'] as const;

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

  const reviewedModes = Object.values(jur.coverage).filter(state => state === 'reviewed').length;
  const investmentResidence = residence
    .filter(r => r.min_investment)
    .sort((a, b) => a.min_investment!.amount - b.min_investment!.amount);
  const cheapest = investmentResidence[0]?.min_investment ?? null;

  const coverageStrip = `<div class="coverage">${COVERAGE_ORDER.map(mode => {
    const state = jur.coverage[mode] ?? 'unchecked';
    return `<div class="cov ${esc(state)}"><span class="m">${esc(CITIZENSHIP_MODE_LABELS[mode])}</span><span class="s"><span class="dot"></span>${esc(state)}</span></div>`;
  }).join('')}</div>`;

  const facts = [
    `<div class="fact"><span class="k">Citizenship</span><span class="v">${reviewedModes} of 4 modes reviewed</span></div>`,
    routes.length ? `<div class="fact"><span class="k">Citizenship routes</span><span class="v">${routes.length}</span></div>` : '',
    residence.length ? `<div class="fact"><span class="k">Residence programmes</span><span class="v">${residence.length}</span></div>` : '',
    cheapest ? `<div class="fact"><span class="k">Residence by investment from</span><span class="v">${esc(cheapest.currency)} ${cheapest.amount.toLocaleString('en-US')}</span></div>` : '',
    blocs.length ? `<div class="fact"><span class="k">Regional systems</span><span class="v">${blocs.length}</span></div>` : '',
  ].filter(Boolean).join('');

  const jump = [
    '<a href="#citizenship">Citizenship</a>',
    residence.length ? '<a href="#residence">Residence</a>' : '',
    blocs.length ? '<a href="#regional">Regional</a>' : '',
    lanesIn.length ? '<a href="#treaties">Treaties</a>' : '',
  ].filter(Boolean).join('');

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
${siteHeader('countries')}
<main class="wrap">
<div class="crumbs"><a href="/">Flag Paths</a> › <a href="/country/">Countries</a> › ${esc(name)}</div>
<div class="layout">
<aside class="rail">
${flag ? `<div class="flag" aria-hidden="true">${flag}</div>` : ''}
<h1>${esc(name)}</h1>
<div class="facts">${facts}</div>
<a class="cta" href="/?country=${esc(iso)}">Open in the interactive atlas →</a>
<nav class="jump">${jump}</nav>
</aside>
<div class="content">
<p class="lede">${esc(desc)}</p>
<section id="citizenship">
<h2 class="eyebrow">Citizenship routes</h2>
${coverageStrip}
${routes.length ? routes.map(routeCard).join('') : '<p class="empty">Not yet reviewed at route level — a coverage gap, not a claim that no path exists.</p>'}
</section>
${residence.length ? `<section id="residence"><h2 class="eyebrow">Residence &amp; settlement</h2>${residence.map(resCard).join('')}</section>` : ''}
${blocs.length ? `<section id="regional"><h2 class="eyebrow">Regional rights</h2><div class="tags">${blocs.map(b => `<a href="/?blocs=${esc(b.id)}">${esc(b.name)}</a>`).join('')}</div></section>` : ''}
${lanesIn.length ? `<section id="treaties"><h2 class="eyebrow">Treaty &amp; country paths</h2><div class="tags">${lanesIn.map(l => `<a href="/?lane=${esc(l.id)}">${esc(l.name)}</a>`).join('')}</div></section>` : ''}
<footer>
<p>Data is compiled from official and primary legal sources and reviewed for the Flag Paths atlas. Programmes — especially residence-by-investment — change frequently; verify against the linked official sources before acting.</p>
<p><a href="/country/">All countries</a> · <a href="/?country=${esc(iso)}">Open ${esc(name)} in the atlas</a></p>
</footer>
</div>
</div>
</main></body></html>`;
}

function indexPage(ctx: Ctx, isos: string[]): string {
  const items = isos
    .map(iso => ({ iso, name: ctx.citizenship.jurisdictions.find(j => j.iso_n3 === iso)!.name, slug: ctx.slugByIso.get(iso)! }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const links = items.map(i => `<li><a href="/country/${i.slug}/"><span aria-hidden="true">${countryFlag(i.iso)}</span> ${esc(i.name)}</a></li>`).join('');
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
<style>${PAGE_STYLE} .hub-h1{font-family:'Fraunces',serif;font-weight:700;font-size:2.4rem;line-height:1.05;letter-spacing:-.02em;text-wrap:balance;margin:.2rem 0 .6rem}.wrap .cta{display:inline-block}.country-list{columns:3;column-gap:2rem;list-style:none;padding:0;margin:1.75rem 0 0}@media(max-width:760px){.country-list{columns:2}}@media(max-width:480px){.country-list{columns:1}}.country-list li{margin:.35rem 0;break-inside:avoid}</style>
</head><body>
${siteHeader('countries')}
<main class="wrap">
<div class="crumbs"><a href="/">Flag Paths</a> › Countries</div>
<h1 class="hub-h1">All countries &amp; territories</h1>
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

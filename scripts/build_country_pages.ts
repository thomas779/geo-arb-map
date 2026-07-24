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

const PAGE_STYLE = `
:root{--bg:#faf9f6;--fg:#1a1b19;--muted:#5f6360;--card:#fff;--border:#e4e1d9;--accent:#2f6f4f}
@media(prefers-color-scheme:dark){:root{--bg:#141513;--fg:#eceae4;--muted:#a0a39d;--card:#1d1f1c;--border:#2c2e2a;--accent:#6fbf8f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:2rem 1.25rem 4rem}
a{color:var(--accent)}
header nav{font-size:.85rem;color:var(--muted);margin-bottom:1.5rem}
h1{font-size:2rem;margin:.2rem 0 .3rem;display:flex;align-items:center;gap:.5rem}
.lede{color:var(--muted);margin:0 0 1.5rem}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:2rem 0 .75rem;border-top:1px solid var(--border);padding-top:1.25rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem;margin:.6rem 0}
.card h3{margin:0 0 .3rem;font-size:1rem}
.tag{display:inline-block;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-right:.5rem}
.badge{display:inline-block;font-size:.7rem;border:1px solid var(--border);border-radius:99px;padding:.05rem .5rem;color:var(--muted)}
.chips{margin:.4rem 0 0}.chips span{display:inline-block;font-size:.72rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.1rem .45rem;margin:.15rem .3rem .15rem 0}
.src{font-size:.8rem;margin:.4rem 0 0}.src a{color:var(--muted)}
.cta{display:inline-block;margin:1.5rem 0 0;background:var(--accent);color:#fff;padding:.6rem 1rem;border-radius:8px;text-decoration:none;font-weight:600}
.muted{color:var(--muted)}footer{margin-top:3rem;font-size:.8rem;color:var(--muted)}
`.trim();

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
    .map(([mode]) => mode);
  const residenceCats = [...new Set(residence.map(r => r.category))]
    .map(c => RESIDENCE_CATEGORY_LABELS[c]);

  const desc = `How to get citizenship and residence in ${name}: `
    + `${routes.length} citizenship route${routes.length === 1 ? '' : 's'}`
    + (residence.length ? ` and ${residence.length} residence programme${residence.length === 1 ? '' : 's'} (${residenceCats.join(', ')})` : '')
    + `, with official sources. Part of the Flag Paths atlas.`;

  const routeCard = (r: typeof routes[number]) => `
    <div class="card">
      <span class="tag">${esc(r.mode)}</span><span class="badge">${esc(r.status.replace(/_/g, ' '))}</span>
      <h3>${esc(r.title)}</h3>
      <p class="muted">${esc(r.summary)}</p>
      ${r.sources.length ? `<p class="src">Sources: ${r.sources.map(s => `<a href="${esc(s.url)}" rel="nofollow noreferrer">${esc(s.title)}</a>`).join(' · ')}</p>` : ''}
    </div>`;

  const resCard = (r: typeof residence[number]) => {
    const chips: string[] = [];
    if (r.min_investment) chips.push(`from ${r.min_investment.currency} ${r.min_investment.amount.toLocaleString('en-US')}`);
    if (r.min_income_monthly) chips.push(`${r.min_income_monthly.currency} ${r.min_income_monthly.amount.toLocaleString('en-US')}/mo`);
    if (r.physical_presence_days_per_year !== null) chips.push(r.physical_presence_days_per_year === 0 ? 'no stay required' : `${r.physical_presence_days_per_year} days/yr`);
    const leadsTo = r.counts_toward_naturalization ? 'leads to citizenship'
      : r.counts_toward_permanent_residence ? 'leads to permanent residence'
      : 'renewable — no PR/citizenship';
    return `
    <div class="card">
      <span class="tag">${esc(RESIDENCE_CATEGORY_LABELS[r.category])}</span><span class="badge">${esc(leadsTo)}</span>
      <h3>${esc(r.title)}</h3>
      <p class="muted">${esc(r.summary)}</p>
      ${chips.length ? `<p class="chips">${chips.map(c => `<span>${esc(c)}</span>`).join('')}</p>` : ''}
      ${r.sources.length ? `<p class="src">Sources: ${r.sources.map(s => `<a href="${esc(s.url)}" rel="nofollow noreferrer">${esc(s.title)}</a>`).join(' · ')}</p>` : ''}
    </div>`;
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
<meta property="og:type" content="article"><meta property="og:site_name" content="Flag Paths">
<meta property="og:url" content="${url}"><meta property="og:title" content="${esc(name)} — Citizenship &amp; Residence Routes">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
${jsonLd(place)}${jsonLd(breadcrumb)}${jsonLd(faq)}
<style>${PAGE_STYLE}</style>
</head><body><div class="wrap">
<header><nav><a href="/">Flag Paths</a> › <a href="/country/">Countries</a> › ${esc(name)}</nav></header>
<h1>${flag ? `<span aria-hidden="true">${flag}</span>` : ''}${esc(name)}</h1>
<p class="lede">${esc(desc)}</p>
<a class="cta" href="/?country=${esc(iso)}">Explore ${esc(name)} on the interactive map →</a>

<h2>Citizenship routes</h2>
${routes.length ? routes.map(routeCard).join('') : '<p class="muted">Not yet reviewed at route level — a coverage gap, not a claim that no path exists.</p>'}

${residence.length ? `<h2>Residence &amp; settlement</h2>${residence.map(resCard).join('')}` : ''}

${blocs.length ? `<h2>Regional rights</h2><p class="muted">Member of: ${blocs.map(b => esc(b.name)).join(', ')}.</p>` : ''}
${lanesIn.length ? `<h2>Treaty &amp; country paths</h2><p class="muted">${lanesIn.map(l => esc(l.name)).join(', ')}.</p>` : ''}

<footer>
<p>Data is compiled from official and primary legal sources and reviewed for the Flag Paths atlas. Programmes — especially residence-by-investment — change frequently; verify against the linked official sources before acting.</p>
<p><a href="/country/">All countries</a> · <a href="/">Interactive atlas</a></p>
</footer>
</div></body></html>`;
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
${jsonLd(breadcrumb)}
<style>${PAGE_STYLE} ul{columns:2;gap:2rem;list-style:none;padding:0}@media(max-width:560px){ul{columns:1}}li{margin:.25rem 0}</style>
</head><body><div class="wrap">
<header><nav><a href="/">Flag Paths</a> › Countries</nav></header>
<h1>All countries &amp; territories</h1>
<p class="lede">Citizenship and residence routes for ${items.length} jurisdictions. <a href="/">Open the interactive atlas →</a></p>
<ul>${links}</ul>
</div></body></html>`;
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

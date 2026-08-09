/**
 * Progressive enhancement for /routes/driving-licences/
 * Fetches /licence_exchange.json and powers the origin → destination lookup.
 * Page remains readable without JS via the static fallback list.
 */
(function () {
  const root = document.getElementById('licence-exchange-live');
  if (!root) return;

  const resultsEl = document.getElementById('licence-exchange-results');
  const selectEl = document.getElementById('licence-exchange-origin');
  const statusEl = document.getElementById('licence-exchange-status');
  if (!resultsEl || !selectEl) return;

  function testLabel(theory, practical) {
    if (theory === false && practical === false) return 'No retest';
    if (theory === true && practical === false) return 'Theory only';
    if (theory === false && practical === true) return 'Practical only';
    if (theory === true && practical === true) return 'Theory + practical';
    return 'Tests unknown';
  }

  function badgeClass(theory, practical) {
    if (theory === false && practical === false) return 'licence-badge licence-badge--ok';
    if (theory === true || practical === true) return 'licence-badge licence-badge--warn';
    return 'licence-badge';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(data, originKey) {
    resultsEl.innerHTML = '';
    if (!originKey) {
      resultsEl.innerHTML =
        '<p class="text-sm text-muted-foreground">Choose the country (or territory group) that issued your licence.</p>';
      return;
    }

    const matches = [];
    for (const dest of data.destinations) {
      const entries = dest.entries.filter(function (e) {
        if (originKey.indexOf('nat:') === 0) {
          var id = originKey.slice(4);
          if (e.subnational) return e.parent_iso_n3 === id;
          return e.origin_iso_n3 === id || e.origin_label === id || e.origin_label_en === id;
        }
        return false;
      });
      if (entries.length) matches.push({ dest: dest, entries: entries });
    }

    if (!matches.length) {
      resultsEl.innerHTML =
        '<p class="text-sm text-muted-foreground">No seeded destination annex lists this origin yet. Coverage is Germany-only in v1.</p>';
      return;
    }

    var html = '';
    matches.forEach(function (m) {
      var varies = m.entries.some(function (e) {
        return e.subnational || e.varies_by_subnational;
      });
      html += '<article class="licence-result rounded-lg border bg-card p-4">';
      html += '<header class="mb-3 flex flex-wrap items-baseline justify-between gap-2">';
      html += '<h3 class="font-heading text-lg font-semibold">' + escapeHtml(m.dest.name) + '</h3>';
      html +=
        '<a class="font-mono text-xs text-primary underline-offset-2 hover:underline" href="' +
        escapeHtml(m.dest.source_url) +
        '" rel="noopener noreferrer" target="_blank">Primary source</a>';
      html += '</header>';
      html +=
        '<p class="mb-3 text-xs text-muted-foreground">' +
        escapeHtml(m.dest.instrument) +
        '</p>';
      if (varies) {
        html +=
          '<p class="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">' +
          'Conditions <strong>vary by state / province / territory</strong>. Do not treat this as a single country-wide rule.' +
          '</p>';
      }
      html += '<div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr class="border-b text-xs text-muted-foreground">';
      html += '<th class="py-2 pr-3 font-medium">Origin unit</th><th class="py-2 pr-3 font-medium">Classes</th><th class="py-2 font-medium">Tests</th>';
      html += '</tr></thead><tbody>';
      m.entries.forEach(function (e) {
        var unit = e.subnational
          ? e.subnational_label || e.origin_label_en
          : e.origin_label_en;
        html += '<tr class="border-b border-border/60">';
        html += '<td class="py-2 pr-3">' + escapeHtml(unit) + '</td>';
        html +=
          '<td class="py-2 pr-3 font-mono text-xs">' +
          escapeHtml(e.classes || '—') +
          '</td>';
        html +=
          '<td class="py-2"><span class="' +
          badgeClass(e.theory_test_required, e.practical_test_required) +
          '">' +
          escapeHtml(testLabel(e.theory_test_required, e.practical_test_required)) +
          '</span></td>';
        html += '</tr>';
      });
      html += '</tbody></table></div></article>';
    });
    resultsEl.innerHTML = html;
  }

  if (statusEl) statusEl.textContent = 'Loading exchange data…';

  fetch('/licence_exchange.json')
    .then(function (r) {
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    })
    .then(function (data) {
      // Build origin options (national / parent groups)
      var map = {};
      var PARENT = { '840': 'United States', '124': 'Canada', '036': 'Australia' };
      data.destinations.forEach(function (dest) {
        dest.entries.forEach(function (e) {
          var key;
          var label;
          if (e.subnational && e.parent_iso_n3) {
            key = 'nat:' + e.parent_iso_n3;
            label = PARENT[e.parent_iso_n3] || e.origin_label_en;
          } else {
            key = 'nat:' + (e.origin_iso_n3 || e.origin_label);
            label = e.origin_label_en;
          }
          if (!map[key]) map[key] = { key: key, label: label };
        });
      });
      var origins = Object.keys(map)
        .map(function (k) { return map[k]; })
        .sort(function (a, b) { return a.label.localeCompare(b.label); });

      selectEl.innerHTML = '<option value="">Select issuing country…</option>';
      origins.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.key;
        opt.textContent = o.label;
        selectEl.appendChild(opt);
      });
      selectEl.disabled = false;
      if (statusEl) statusEl.textContent = '';

      // Hide static fallback once live UI is ready
      var fallback = document.getElementById('licence-exchange-fallback');
      if (fallback) fallback.hidden = true;
      root.hidden = false;

      selectEl.addEventListener('change', function () {
        render(data, selectEl.value);
      });

      var params = new URLSearchParams(window.location.search);
      var from = params.get('from');
      if (from) {
        var want = 'nat:' + from;
        if (map[want]) {
          selectEl.value = want;
          render(data, want);
        }
      }
    })
    .catch(function () {
      if (statusEl) {
        statusEl.textContent =
          'Could not load live lookup. Use the static origin list below.';
      }
    });
})();

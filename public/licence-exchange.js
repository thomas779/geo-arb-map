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
    if (theory === false && practical === false) return 'No tests required';
    if (theory === true && practical === false) return 'Theory test required';
    if (theory === false && practical === true) return 'Practical test required';
    if (theory === true && practical === true) return 'Theory + practical required';
    return 'Confirm test requirements';
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
        '<div class="licence-empty-state"><span class="licence-empty-mark" aria-hidden="true">→</span>' +
        '<div><p class="font-semibold text-foreground">Choose the issuing country</p>' +
        '<p class="mt-0.5 text-sm text-muted-foreground">Your mapped exchange destinations will appear here.</p></div></div>';
      if (statusEl) statusEl.textContent = '';
      return;
    }

    const matches = [];
    for (const dest of data.destinations) {
      const entries = dest.entries.filter(function (e) {
        if (originKey.indexOf('nat:') === 0) {
          var id = originKey.slice(4);
          if (e.subnational) return e.parent_iso_n3 === id;
          return e.origin_iso_n3 === id || (e.origin_label || e.origin_label_en) === id || e.origin_label_en === id;
        }
        return false;
      });
      if (entries.length) matches.push({ dest: dest, entries: entries });
    }

    if (!matches.length) {
      resultsEl.innerHTML =
        '<div class="licence-empty-state"><span class="licence-empty-mark" aria-hidden="true">—</span>' +
        '<div><p class="font-semibold text-foreground">No mapped exchange found yet</p>' +
        '<p class="mt-0.5 text-sm text-muted-foreground">This is a coverage gap, not proof that exchange is unavailable.</p></div></div>';
      if (statusEl) statusEl.textContent = 'No destination in the current dataset lists this licence.';
      return;
    }

    var selected = selectEl.options[selectEl.selectedIndex];
    var originLabel = selected ? selected.textContent : 'This licence';
    if (statusEl) {
      statusEl.textContent = matches.length + ' mapped destination' + (matches.length === 1 ? '' : 's') +
        ' for a licence issued in ' + originLabel + '.';
    }

    var html = '';
    matches.forEach(function (m) {
      var varies = m.entries.some(function (e) {
        return e.subnational || e.varies_by_subnational;
      });
      var theory = m.entries.some(function (e) { return e.theory_test_required === true; })
        ? true
        : m.entries.every(function (e) { return e.theory_test_required === false; }) ? false : null;
      var practical = m.entries.some(function (e) { return e.practical_test_required === true; })
        ? true
        : m.entries.every(function (e) { return e.practical_test_required === false; }) ? false : null;
      html += '<article class="licence-result-card">';
      html += '<div class="licence-route-line">';
      html += '<span class="licence-route-place"><small>Issued in</small>' + escapeHtml(originLabel) + '</span>';
      html += '<span class="licence-route-arrow" aria-hidden="true">→</span>';
      html += '<span class="licence-route-place"><small>Exchange in</small>' + escapeHtml(m.dest.name) + '</span>';
      html += '</div>';
      html += '<div class="licence-result-meta">';
      html += '<span class="' + badgeClass(theory, practical) + '">' +
        escapeHtml(testLabel(theory, practical)) + '</span>';
      html += '<a class="licence-source-link" href="' + escapeHtml(m.dest.source_url) +
        '" rel="noopener noreferrer" target="_blank">Official source ↗</a>';
      html += '</div>';
      if (varies) {
        html +=
          '<p class="licence-variation-note">' +
          'Conditions <strong>vary by state, province, or territory</strong>. Open the rows below before relying on this result.' +
          '</p>';
      }
      if (m.entries.length > 1 || varies || (m.entries[0].classes && m.entries[0].classes !== 'all')) {
        html += '<details class="licence-row-details"><summary>Licence classes and local units</summary>';
        html += '<div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr class="border-b text-xs text-muted-foreground">';
        html += '<th class="py-2 pr-3 font-medium">Origin unit</th><th class="py-2 pr-3 font-medium">Classes</th><th class="py-2 font-medium">Tests</th>';
        html += '</tr></thead><tbody>';
        m.entries.forEach(function (e) {
          var unit = e.subnational
            ? e.subnational_label || e.origin_label_en
            : e.origin_label_en;
          html += '<tr class="border-b border-border/60">';
          html += '<td class="py-2 pr-3">' + escapeHtml(unit) + '</td>';
          html += '<td class="py-2 pr-3 font-mono text-xs">' + escapeHtml(e.classes || 'All') + '</td>';
          html += '<td class="py-2">' + escapeHtml(testLabel(e.theory_test_required, e.practical_test_required)) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></details>';
      }
      html += '<p class="licence-instrument">' + escapeHtml(m.dest.instrument) + '</p>';
      html += '</article>';
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
            key = 'nat:' + (e.origin_iso_n3 || e.origin_label || e.origin_label_en);
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
      if (statusEl) statusEl.textContent = 'Choose an issuing country to check the mapped destinations.';

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

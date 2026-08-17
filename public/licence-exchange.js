/**
 * Progressive enhancement for /routes/driving-licences/
 *
 * Two fetches, not one blob (#210). /licence_exchange.json is now an INDEX — the
 * disclaimer, the agreements and the origin picker — and the rows for one origin
 * live at /licence-exchange/<origin>.json, whose path the index carries on each
 * origin. That is what lets the layer hold 45 destinations and 909 entries: the
 * browser downloads the one list it was asked about instead of all of them.
 *
 * The page remains readable without JS via the prerendered fallback section.
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

  // Mirrors nationalityGateLabel in src/lib/licence-exchange.ts. null is NOT
  // RECORDED and says so: a reader who is told a swap is available and is then
  // refused at the counter for holding the wrong passport is the worst outcome
  // this page can produce, and an unlabelled row is exactly how that happens.
  function gateLabel(gate) {
    if (gate === 'all') return 'Any nationality';
    if (gate === 'nationals_only') return 'Nationals of the issuing country only';
    if (gate === 'gcc') return 'Nationals of the listed exception countries (GCC)';
    return 'Nationality rule not recorded';
  }

  function windowLines(dest, entry) {
    var lines = [];
    var deadline = (entry && entry.exchange_deadline_months != null)
      ? entry.exchange_deadline_months : dest.exchange_deadline_months;
    var grace = (entry && entry.foreign_licence_grace_months != null)
      ? entry.foreign_licence_grace_months : dest.foreign_licence_grace_months;
    if (deadline != null) {
      lines.push('Apply within ' + deadline + ' month' + (deadline === 1 ? '' : 's') +
        ' of taking up residence, or the exchange right lapses.');
    }
    if (grace != null) {
      lines.push('You may drive on the foreign licence for ' + grace + ' month' +
        (grace === 1 ? '' : 's') + ' after arrival; after that the exchange is compulsory.');
    }
    return lines;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function emptyState(mark, title, body) {
    return '<div class="licence-empty-state"><span class="licence-empty-mark" aria-hidden="true">' +
      mark + '</span><div><p class="font-semibold text-foreground">' + escapeHtml(title) +
      '</p><p class="mt-0.5 text-sm text-muted-foreground">' + escapeHtml(body) + '</p></div></div>';
  }

  function render(slice, originLabel) {
    resultsEl.innerHTML = '';
    var matches = (slice && slice.matches) || [];
    if (!matches.length) {
      resultsEl.innerHTML = emptyState('—', 'No mapped exchange found yet',
        'This is a coverage gap, not proof that exchange is unavailable.');
      if (statusEl) statusEl.textContent = 'No destination in the current dataset lists this licence.';
      return;
    }

    if (statusEl) {
      statusEl.textContent = matches.length + ' mapped destination' + (matches.length === 1 ? '' : 's') +
        ' for a licence issued in ' + originLabel + '.';
    }

    var html = '';
    matches.forEach(function (m) {
      var dest = m.destination;
      var theory = m.any_theory ? true
        : m.entries.every(function (e) { return e.theory_test_required === false; }) ? false : null;
      var practical = m.any_practical ? true
        : m.entries.every(function (e) { return e.practical_test_required === false; }) ? false : null;
      var gates = m.nationality_gates || [];

      html += '<article class="licence-result-card">';
      html += '<div class="licence-route-line">';
      html += '<span class="licence-route-place"><small>Issued in</small>' + escapeHtml(originLabel) + '</span>';
      html += '<span class="licence-route-arrow" aria-hidden="true">→</span>';
      html += '<span class="licence-route-place"><small>Exchange in</small>' + escapeHtml(dest.name) + '</span>';
      html += '</div>';
      html += '<div class="licence-result-meta">';
      html += '<span class="' + badgeClass(theory, practical) + '">' +
        escapeHtml(testLabel(theory, practical)) + '</span>';
      // One badge per distinct gate, including the null one, so a list that gates
      // some rows and not others cannot render as though it gated none.
      gates.forEach(function (gate) {
        html += '<span class="licence-badge licence-badge--gate" data-nationality-gate="' +
          escapeHtml(gate === null || gate === undefined ? 'not_recorded' : gate) + '">' +
          escapeHtml(gateLabel(gate === undefined ? null : gate)) + '</span>';
      });
      html += '<a class="licence-source-link" href="' + escapeHtml(dest.source_url) +
        '" rel="noopener noreferrer" target="_blank">Official source ↗</a>';
      html += '</div>';

      if (m.nationality_restricted) {
        html += '<p class="licence-gate-note">This list is gated on <strong>your nationality</strong>, ' +
          'not only on where the licence was issued. Holding an accepted licence is not on its own ' +
          'an answer here.</p>';
      } else if (gates.length === 1 && (gates[0] === null || gates[0] === undefined)) {
        html += '<p class="licence-gate-note">No nationality rule is recorded for this list. That is ' +
          'silence in the source, not a statement that any nationality qualifies.</p>';
      }

      if (m.varies_by_subnational) {
        html += '<p class="licence-variation-note">Conditions <strong>vary by state, province, or ' +
          'territory</strong>. Open the rows below before relying on this result.</p>';
      }

      windowLines(dest, m.entries.length === 1 ? m.entries[0] : null).forEach(function (line) {
        html += '<p class="licence-dest-note">' + escapeHtml(line) + '</p>';
      });

      if (m.entries.length > 1 || m.varies_by_subnational || gates.length > 1 ||
        (m.entries[0].classes && m.entries[0].classes !== 'all')) {
        html += '<details class="licence-row-details"><summary>Licence classes, nationality and local units</summary>';
        html += '<div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr class="border-b text-xs text-muted-foreground">';
        html += '<th class="py-2 pr-3 font-medium">Origin unit</th><th class="py-2 pr-3 font-medium">Classes</th>';
        html += '<th class="py-2 pr-3 font-medium">Tests</th><th class="py-2 font-medium">Nationality</th>';
        html += '</tr></thead><tbody>';
        m.entries.forEach(function (e) {
          var unit = e.subnational ? (e.subnational_label || e.origin_label_en) : e.origin_label_en;
          html += '<tr class="border-b border-border/60">';
          html += '<td class="py-2 pr-3">' + escapeHtml(unit) + '</td>';
          html += '<td class="py-2 pr-3 font-mono text-xs">' + escapeHtml(e.classes || 'All') + '</td>';
          html += '<td class="py-2 pr-3">' + escapeHtml(testLabel(e.theory_test_required, e.practical_test_required)) + '</td>';
          html += '<td class="py-2">' + escapeHtml(gateLabel(e.nationality_gate === undefined ? null : e.nationality_gate)) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></details>';
      }

      (dest.notes || []).forEach(function (note) {
        html += '<p class="licence-dest-note">' + escapeHtml(note) + '</p>';
      });
      html += '<p class="licence-instrument">' + escapeHtml(dest.instrument) + '</p>';
      html += '</article>';
    });
    resultsEl.innerHTML = html;
  }

  function resetResults() {
    resultsEl.innerHTML = emptyState('→', 'Choose the issuing country',
      'Your mapped exchange destinations will appear here.');
    if (statusEl) statusEl.textContent = '';
  }

  if (statusEl) statusEl.textContent = 'Loading exchange data…';

  fetch('/licence_exchange.json')
    .then(function (r) {
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    })
    .then(function (index) {
      var byKey = {};
      var origins = (index.origins || []).slice().sort(function (a, b) {
        return a.label.localeCompare(b.label);
      });

      selectEl.innerHTML = '<option value="">Select issuing country…</option>';
      origins.forEach(function (o) {
        byKey[o.key] = o;
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

      var pending = 0;
      function select(key) {
        if (!key || !byKey[key]) {
          resetResults();
          return;
        }
        var origin = byKey[key];
        var token = ++pending;
        if (statusEl) statusEl.textContent = 'Loading destinations for ' + origin.label + '…';
        fetch(origin.slice)
          .then(function (r) {
            if (!r.ok) throw new Error('slice ' + origin.slice + ': ' + r.status);
            return r.json();
          })
          .then(function (slice) {
            if (token !== pending) return; // a later selection won the race
            render(slice, origin.label);
          })
          .catch(function () {
            if (token !== pending) return;
            resultsEl.innerHTML = emptyState('!', 'Could not load this origin',
              'The lookup for this country did not load. Reload the page, or use the official sources listed below.');
            if (statusEl) statusEl.textContent = 'Lookup failed for ' + origin.label + '.';
          });
      }

      selectEl.addEventListener('change', function () { select(selectEl.value); });

      var params = new URLSearchParams(window.location.search);
      var from = params.get('from');
      if (from) {
        var want = 'nat:' + from;
        if (byKey[want]) {
          selectEl.value = want;
          select(want);
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

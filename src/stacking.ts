import type { BlocsData, AppState } from './types';

export function render(
  state: AppState,
  data: BlocsData,
  onBlocSelect: (id: string) => void,
): void {
  const view = document.getElementById('stacking-view')!;
  const mapEl = document.getElementById('map')!;
  const hint = document.getElementById('hint')!;

  if (state.view !== 'stacking') {
    view.classList.remove('visible');
    mapEl.style.display = '';
    hint.style.display = '';
    return;
  }

  mapEl.style.display = 'none';
  hint.style.display = 'none';
  view.classList.add('visible');

  const blocById = new Map(data.blocs.map(b => [b.id, b]));

  let html = `
    <div class="stacking-header">
      <button class="back-btn" id="stacking-back">← Back to Map</button>
      <div class="stacking-title">Stacking Plays</div>
    </div>
    <div class="stacking-grid">`;

  data.stacking_plays.forEach(play => {
    const pillsHtml = play.blocs.map(blocId => {
      const b = blocById.get(blocId);
      if (!b) return '';
      return `<button class="s-bloc-pill" data-bloc="${b.id}" style="background:${b.color}">${b.name}</button>`;
    }).join('');

    html += `
      <div class="stacking-card">
        <div class="s-passport">${play.passport}</div>
        <div class="s-timeline">${play.timeline}</div>
        <div class="s-blocs">${pillsHtml}</div>
        <div class="s-footprint">${play.footprint}</div>
      </div>`;
  });

  html += `</div>`;

  if (data.meta.excluded?.length) {
    html += `
      <div class="excluded-section">
        <div class="excluded-title">Evaluated &amp; excluded</div>
        <p class="excluded-intro">Arrangements checked against the same criteria and deliberately left off the map:</p>
        ${data.meta.excluded.map(x => `
          <div class="excluded-item"><b>${x.name}</b> — ${x.reason}</div>`).join('')}
      </div>`;
  }

  view.innerHTML = html;

  document.getElementById('stacking-back')?.addEventListener('click', () => {
    onBlocSelect('__back__');
  });

  view.querySelectorAll<HTMLButtonElement>('.s-bloc-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const id = pill.dataset.bloc;
      if (id) onBlocSelect(id);
    });
  });
}

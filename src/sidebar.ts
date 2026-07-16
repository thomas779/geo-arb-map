import type { BlocsData, AppState } from './types';

const CATEGORIES: Array<[string, string]> = [
  ['full', 'Full blocs'],
  ['partial', 'Partial blocs'],
  ['hub_spoke', 'Hub & spoke'],
  ['one_way', 'One-way / asymmetric'],
  ['closed', 'Closed to entry'],
  ['proto', 'Proto-blocs'],
];

interface Callbacks {
  onBloc: (id: string | null) => void;
  onLane: (id: string | null) => void;
  onView: (v: 'map' | 'stacking') => void;
}

export function init(data: BlocsData, callbacks: Callbacks): void {
  const container = document.getElementById('sidebar')!;

  const stackingBtn = document.createElement('button');
  stackingBtn.className = 'stacking-btn';
  stackingBtn.dataset.action = 'stacking';
  stackingBtn.textContent = '⊕ Stacking Plays';
  stackingBtn.onclick = () => callbacks.onView('stacking');
  container.appendChild(stackingBtn);

  CATEGORIES.forEach(([cat, label]) => {
    const blocs = data.blocs.filter(b => b.category === cat);
    if (!blocs.length) return;

    const h = document.createElement('div');
    h.className = 'cat-label';
    h.textContent = label;
    container.appendChild(h);

    blocs.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'bloc-btn';
      btn.dataset.bloc = b.id;
      btn.innerHTML = `<span class="chip" style="background:${b.color}"></span>${b.name}<span class="n">${b.members.length}</span>`;
      btn.onclick = () => {
        const isActive = btn.classList.contains('active');
        callbacks.onBloc(isActive ? null : b.id);
      };
      container.appendChild(btn);
    });
  });

  const laneGroups: Array<[string, (typeof data.bilateral_lanes)]> = [
    ['Bilateral fast lanes', data.bilateral_lanes.filter(l => l.beneficiaries.length > 0)],
    ['Ancestry & diaspora routes', data.bilateral_lanes.filter(l => l.beneficiaries.length === 0)],
  ];

  laneGroups.forEach(([label, lanes]) => {
    if (!lanes.length) return;
    const h = document.createElement('div');
    h.className = 'cat-label';
    h.textContent = label;
    container.appendChild(h);

    lanes.forEach(l => {
      const btn = document.createElement('button');
      btn.className = 'bloc-btn';
      btn.dataset.lane = l.id;
      btn.innerHTML = `<span class="chip" style="background:${l.color}"></span>${l.name}<span class="n">→${l.destination.name === 'United States of America' ? 'US' : l.destination.name}</span>`;
      btn.onclick = () => {
        const isActive = btn.classList.contains('active');
        callbacks.onLane(isActive ? null : l.id);
      };
      container.appendChild(btn);
    });
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-btn';
  clearBtn.textContent = 'Show all (count overlay)';
  clearBtn.onclick = () => callbacks.onBloc(null);
  container.appendChild(clearBtn);
}

export function render(state: AppState): void {
  document.querySelectorAll<HTMLButtonElement>('.bloc-btn').forEach(el => {
    const active = el.dataset.bloc
      ? el.dataset.bloc === state.bloc
      : el.dataset.lane === state.lane;
    el.classList.toggle('active', active);
  });

  const stackingBtn = document.querySelector<HTMLButtonElement>('.stacking-btn');
  if (stackingBtn) {
    stackingBtn.classList.toggle('active', state.view === 'stacking');
  }
}

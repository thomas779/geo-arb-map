import type { BlocsData, AppState } from './types';

export function render(state: AppState, data: BlocsData, onClose: () => void): void {
  const detail = document.getElementById('detail')!;

  if (!state.country) {
    detail.classList.remove('open');
    return;
  }

  const iso = state.country;
  const blocs = data.blocs.filter(b => b.members.some(m => m.iso_n3 === iso));
  const formerBlocs = data.blocs.filter(b =>
    b.former_members?.some(m => m.iso_n3 === iso));
  const lanesIn = data.bilateral_lanes.filter(l => l.destination.iso_n3 === iso);
  const lanesOut = data.bilateral_lanes.filter(l =>
    l.beneficiaries.some(m => m.iso_n3 === iso));

  // Resolve display name: prefer state.countryName (from map click),
  // fall back to the name stored in blocs data, then the ISO code.
  const nameFromBlocs = data.blocs
    .flatMap(b => [...b.members, ...(b.former_members ?? [])])
    .find(m => m.iso_n3 === iso)?.name;
  const countryName = state.countryName ?? nameFromBlocs ?? iso;

  const laneCount = lanesIn.length + lanesOut.length;
  const total = blocs.length + formerBlocs.length + laneCount;
  let html = `
    <button class="close-x" id="detail-close">×</button>
    <h2>${countryName}</h2>
    <div class="d-sub">${
      total
        ? [
            blocs.length ? `${blocs.length} bloc membership${blocs.length !== 1 ? 's' : ''}` : '',
            formerBlocs.length ? `${formerBlocs.length} former` : '',
            laneCount ? `${laneCount} fast lane${laneCount !== 1 ? 's' : ''}` : '',
          ].filter(Boolean).join(' · ')
        : 'No mapped bloc membership'
    }</div>`;

  if (!total) {
    html += `<p class="d-none-msg">This country isn't part of any mapped settlement bloc. Its citizens rely on bilateral visa arrangements only.</p>`;
  }

  const blocCard = (b: (typeof data.blocs)[number], former: boolean): string => {
    const inSubBloc = !former && b.sub_bloc?.members_iso.includes(iso);
    return `
      <div class="d-bloc">
        <h3><span class="chip" style="background:${b.color}"></span>${b.name}${
          former ? '<span class="former-tag">former member</span>' : ''
        }</h3>
        ${inSubBloc ? `<div class="sub-bloc-badge">✦ ${b.sub_bloc!.name}: full free movement among these members</div>` : ''}
        <div class="rung"><span class="tier">TR</span><p>${b.rights.TR}</p></div>
        <div class="rung"><span class="tier">PR</span><p>${b.rights.PR}</p></div>
        <div class="rung"><span class="tier">CIT</span><p>${b.rights.CIT}</p></div>
        <div class="fast"><b>Fastest entry:</b> ${b.fastest_entry}</div>
        ${b.notes ? `<div class="notes">${b.notes}</div>` : ''}
      </div>`;
  };

  blocs.forEach(b => { html += blocCard(b, false); });
  formerBlocs.forEach(b => { html += blocCard(b, true); });

  const laneCard = (l: (typeof data.bilateral_lanes)[number], inbound: boolean): string => `
    <div class="d-bloc">
      <h3><span class="chip" style="background:${l.color}"></span>${l.name}
        <span class="${l.leads_to_settlement ? 'settle-badge yes' : 'settle-badge'}">${
          l.leads_to_settlement ? '→ settlement path' : 'work access only'
        }</span></h3>
      <div class="lane-dir">${
        inbound
          ? `Inbound lane — privileged access into ${countryName}`
          : `Outbound lane — access to ${l.destination.name}`
      }</div>
      <div class="rung"><span class="tier">GET</span><p>${l.grants}</p></div>
      <div class="rung"><span class="tier">BUT</span><p>${l.limits}</p></div>
      ${l.beneficiaries_note ? `<div class="notes">${l.beneficiaries_note}</div>` : ''}
      ${l.confidence || l.volatility ? `<div class="lane-meta">${[
        l.confidence ? `confidence: ${l.confidence}` : '',
        l.volatility ? `volatility: ${l.volatility}` : '',
      ].filter(Boolean).join(' · ')}</div>` : ''}
      ${l.sources?.length ? `<div class="lane-sources">Sources: ${l.sources.join('; ')}</div>` : ''}
    </div>`;

  if (lanesIn.length) {
    html += `<div class="d-section-label">Fast lanes into ${countryName}</div>`;
    lanesIn.forEach(l => { html += laneCard(l, true); });
  }
  if (lanesOut.length) {
    html += `<div class="d-section-label">Fast-lane access elsewhere</div>`;
    lanesOut.forEach(l => { html += laneCard(l, false); });
  }

  detail.innerHTML = html;
  detail.classList.add('open');

  document.getElementById('detail-close')?.addEventListener('click', onClose);
}

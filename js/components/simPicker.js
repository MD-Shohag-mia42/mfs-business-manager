import { openSheet } from './sheet.js';
import { escapeHtml } from '../utils/format.js';

// Turns the plain browser dropdown of SIMs into a tappable card that opens a nicer picker.
// The original <select> stays in the page (hidden), so the page code that reads its value
// or listens to "change" keeps working unchanged.
//
// A select is treated as a SIM picker when its first option is the empty
// "— SIM বেছে নিন —" placeholder (Received Money and Send Money pages).

const CHEVRON =
  '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function isSimSelect(select) {
  const first = select?.options?.[0];
  return Boolean(first) && first.value === '' && /SIM বেছে নিন/.test(first.textContent || '');
}

// Option text looks like "Anik 21 · 01923009821"; the <optgroup> label is the service name.
export function readOptions(select) {
  return [...select.options]
    .filter((o) => o.value)
    .map((o) => {
      const text = (o.textContent || '').trim();
      const cut = text.lastIndexOf(' · ');
      const service = o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement.label || '' : '';
      return {
        id: o.value,
        name: cut > -1 ? text.slice(0, cut) : text,
        number: cut > -1 ? text.slice(cut + 3) : '',
        service,
        key: service.toLowerCase().replace(/[^a-z0-9]/g, ''),
      };
    });
}

export function pickButtonHtml(current) {
  return current
    ? `<span class="sim-pick-main"><strong>${escapeHtml(current.name)}</strong><span>${escapeHtml(current.number)}${
        current.service ? ` · ${escapeHtml(current.service)}` : ''
      }</span></span>${CHEVRON}`
    : `<span class="sim-pick-main"><strong>SIM বেছে নিন</strong></span>${CHEVRON}`;
}

export function optionsHtml(options, selectedId) {
  if (!options.length) return '<p class="muted">বাছার মতো কোনো active SIM নেই।</p>';
  return `<div class="sim-options">${options
    .map(
      (o) => `
      <button type="button" class="sim-option${o.id === selectedId ? ' is-selected' : ''}"
              data-id="${escapeHtml(o.id)}" data-service="${escapeHtml(o.key)}">
        <span class="sim-option-main"><strong>${escapeHtml(o.name)}</strong><span>${escapeHtml(o.number)}</span></span>
        <span class="badge badge-${escapeHtml(o.key)}">${escapeHtml(o.service)}</span>
        <span class="sim-check" aria-hidden="true">✓</span>
      </button>`
    )
    .join('')}</div>`;
}

function enhance(select) {
  if (select.dataset.pickerReady) return;
  select.dataset.pickerReady = '1';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sim-pick';
  button.setAttribute('aria-haspopup', 'dialog');
  select.after(button);
  select.hidden = true;

  // tapping the field label opens the picker too
  const label = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
  label?.addEventListener('click', (e) => {
    e.preventDefault();
    button.click();
  });

  const render = () => {
    const current = readOptions(select).find((o) => o.id === select.value);
    button.dataset.service = current?.key ?? '';
    button.classList.toggle('is-placeholder', !current);
    button.innerHTML = pickButtonHtml(current);
  };

  button.addEventListener('click', () => {
    const sheet = openSheet({
      title: 'SIM বেছে নিন',
      html: optionsHtml(readOptions(select), select.value),
    });
    sheet.el.addEventListener('click', (e) => {
      const opt = e.target.closest('.sim-option');
      if (!opt) return;
      const id = opt.dataset.id;
      if (select.value !== id) {
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      render();
      sheet.close();
    });
  });

  select.addEventListener('change', render);
  render();
}

// Call once. Watches the page and upgrades every SIM dropdown that appears
// (including the ones the Received Money page draws again for each SMS card).
export function watchSimSelects(root) {
  let queued = false;
  const run = () => {
    queued = false;
    root.querySelectorAll('select').forEach((s) => {
      if (isSimSelect(s)) enhance(s);
    });
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  }).observe(root, { childList: true, subtree: true });
  run();
}

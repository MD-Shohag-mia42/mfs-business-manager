import { NAV_ITEMS } from '../components/nav.js';

export function renderMorePage(view) {
  const items = NAV_ITEMS.filter((i) => !i.bottom);
  view.innerHTML = `
    <nav class="card menu-list" aria-label="More">
      ${items.map((i) => `<a href="#/${i.key}">${i.icon}<span>${i.label}</span></a>`).join('')}
    </nav>`;
}

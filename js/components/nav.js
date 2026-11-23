import { escapeHtml } from '../utils/format.js';
import { toggleTheme } from '../utils/theme.js';

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  dashboard: svg('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
  receive:   svg('<path d="M17 7 7 17"/><path d="M17 17H7V7"/>'),
  send:      svg('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>'),
  history:   svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  reports:   svg('<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V8"/><path d="M17 16v-3"/>'),
  sims:      svg('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>'),
  settings:  svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  more:      svg('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
  moon:      svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
};

export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard',           short: 'Home',     icon: ICONS.dashboard, bottom: true },
  { key: 'receive',   label: 'Received Money',      short: 'Received', icon: ICONS.receive,   bottom: true },
  { key: 'send',      label: 'Send Money',          short: 'Send',     icon: ICONS.send,      bottom: true },
  { key: 'history',   label: 'Transaction History', short: 'History',  icon: ICONS.history,   bottom: true },
  { key: 'reports',   label: 'Reports',             short: 'Reports',  icon: ICONS.reports,   bottom: false },
  { key: 'sims',      label: 'SIM Management',      short: 'SIMs',     icon: ICONS.sims,      bottom: false },
  { key: 'settings',  label: 'Settings',            short: 'Settings', icon: ICONS.settings,  bottom: false },
];

const MORE_ITEM = { key: 'more', short: 'More', icon: ICONS.more };
const MORE_KEYS = ['more', 'reports', 'sims', 'settings'];

export function renderShell(root, user) {
  const sideLinks = NAV_ITEMS.map(
    (i) => `<a class="side-link" href="#/${i.key}" data-key="${i.key}">${i.icon}<span>${i.label}</span></a>`
  ).join('');

  const bottomLinks = [...NAV_ITEMS.filter((i) => i.bottom), MORE_ITEM]
    .map((i) => `<a href="#/${i.key}" data-key="${i.key}">${i.icon}<span>${i.short}</span></a>`)
    .join('');

  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">৳</span><strong>MFS Manager</strong></div>
        <nav class="side-nav" aria-label="Main">${sideLinks}</nav>
        <div class="side-user muted">${escapeHtml(user.email || '')}</div>
      </aside>

      <div class="main">
        <header class="topbar">
          <h1 id="page-title"></h1>
          <button class="icon-btn" id="theme-btn" type="button" aria-label="Dark mode চালু/বন্ধ">${ICONS.moon}</button>
        </header>
        <main id="view" tabindex="-1"></main>
      </div>

      <nav class="bottom-nav" aria-label="Main">${bottomLinks}</nav>
    </div>`;

  root.querySelector('#theme-btn').addEventListener('click', toggleTheme);
}

export function setActiveNav(key) {
  document.querySelectorAll('[data-key]').forEach((el) => {
    const k = el.dataset.key;
    const active = k === key || (k === 'more' && MORE_KEYS.includes(key));
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

export function setPageTitle(title) {
  const el = document.getElementById('page-title');
  if (el) el.textContent = title;
}

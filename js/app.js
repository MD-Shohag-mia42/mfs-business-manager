import { renderSimsPage } from './pages/sims.js';
import { isConfigured } from './supabaseClient.js';
import { getSession, onAuthChange } from './services/auth.js';
import { initTheme } from './utils/theme.js';
import { escapeHtml } from './utils/format.js';
import { renderShell, setActiveNav, setPageTitle } from './components/nav.js';
import { renderLoginPage } from './pages/login.js';
import { renderDashboardPage } from './pages/dashboard.js';
import { renderMorePage } from './pages/more.js';
import { renderSettingsPage } from './pages/settings.js';
import { placeholderPage } from './pages/placeholder.js';

const routes = {
  dashboard: { title: 'Dashboard',           render: renderDashboardPage },
  receive:   { title: 'Received Money',      render: placeholderPage('Received Money', 5) },
  send:      { title: 'Send Money',          render: placeholderPage('Send Money', 6) },
  history:   { title: 'Transaction History', render: placeholderPage('Transaction History', 8) },
  reports:   { title: 'Reports',             render: placeholderPage('Reports', 9) },
  sims:      { title: 'SIM Management',      render: placeholderPage('SIM Management', 4) },
  settings:  { title: 'Settings',            render: renderSettingsPage },
  more:      { title: 'More',                render: renderMorePage },
};

const appEl = document.getElementById('app');
let currentUser = null;
let shellMounted = false;
let renderToken = 0;

function currentKey() {
  return location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
}

async function route() {
  if (!currentUser) {
    shellMounted = false;
    document.title = 'Login · MFS Manager';
    renderLoginPage(appEl);
    return;
  }

  const key = currentKey();
  if (!routes[key]) {
    history.replaceState(null, '', '#/dashboard');
    return route();
  }

  if (!shellMounted) {
    renderShell(appEl, currentUser);
    shellMounted = true;
  }

  const r = routes[key];
  const token = ++renderToken;
  setActiveNav(key);
  setPageTitle(r.title);
  document.title = `${r.title} · MFS Manager`;

  const view = document.getElementById('view');
  view.innerHTML = '';
  window.scrollTo(0, 0);

  try {
    await r.render(view, { user: currentUser });
  } catch (err) {
    console.error(err);
    if (token === renderToken) {
      view.innerHTML = `
        <div class="empty-state">
          <h2>কিছু সমস্যা হয়েছে</h2>
          <p class="muted">${escapeHtml(err.message || 'Unknown error')}</p>
        </div>`;
    }
  }
}

function showConfigError() {
  appEl.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card stack">
        <h1>Setup বাকি আছে</h1>
        <p>js/config.js ফাইলে Supabase URL ও anon key বসিয়ে আবার deploy করুন।</p>
      </div>
    </div>`;
}

async function boot() {
  initTheme();
  if (!isConfigured) return showConfigError();

  try {
    const session = await getSession();
    currentUser = session?.user ?? null;
  } catch (err) {
    console.error(err);
    currentUser = null;
  }

  onAuthChange((_event, session) => {
    const next = session?.user ?? null;
    const changed = (next?.id ?? null) !== (currentUser?.id ?? null);
    currentUser = next;
    // setTimeout: avoid calling Supabase inside the auth callback
    if (changed) setTimeout(route, 0);
  });

  window.addEventListener('hashchange', route);
  route();
}

boot();

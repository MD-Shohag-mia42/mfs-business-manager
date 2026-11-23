const KEY = 'mfs-theme';

export function getThemePref() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref = getThemePref()) {
  const dark =
    pref === 'dark' ||
    (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#111a2e' : '#ffffff';
}

export function setThemePref(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage blocked: theme just won't persist */
  }
  applyTheme(pref);
}

export function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  setThemePref(isDark ? 'light' : 'dark');
}

export function initTheme() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme('system');
  });
}

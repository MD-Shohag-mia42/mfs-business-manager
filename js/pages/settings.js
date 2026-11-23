import { signOut } from '../services/auth.js';
import { confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { getThemePref, setThemePref } from '../utils/theme.js';
import { escapeHtml } from '../utils/format.js';

export function renderSettingsPage(view, { user }) {
  const pref = getThemePref();

  view.innerHTML = `
    <section class="card stack">
      <h2>Account</h2>
      <p class="muted">Login করা আছে:</p>
      <p><strong>${escapeHtml(user.email || '')}</strong></p>
    </section>

    <section class="card stack">
      <h2>Appearance</h2>
      <div class="field">
        <label for="theme-select">Theme</label>
        <select id="theme-select">
          <option value="system" ${pref === 'system' ? 'selected' : ''}>ফোনের সেটিং অনুযায়ী</option>
          <option value="light" ${pref === 'light' ? 'selected' : ''}>Light</option>
          <option value="dark" ${pref === 'dark' ? 'selected' : ''}>Dark</option>
        </select>
      </div>
    </section>

    <button class="btn btn-danger btn-block" id="logout-btn" type="button">Logout</button>`;

  view.querySelector('#theme-select').addEventListener('change', (e) => {
    setThemePref(e.target.value);
  });

  view.querySelector('#logout-btn').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Logout করবেন?',
      message: 'আবার login করতে email ও password লাগবে।',
      confirmText: 'Logout',
      danger: true,
    });
    if (!ok) return;

    try {
      history.replaceState(null, '', '#/dashboard');
      await signOut();
      toast('Logout হয়েছে', 'success');
    } catch (err) {
      console.error(err);
      toast('Logout করা যায়নি', 'error');
    }
  });
}

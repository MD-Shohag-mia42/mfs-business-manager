import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../utils/format.js';

// Step 3: placeholder + database connection check.
// Real statistics come in Step 7.
export async function renderDashboardPage(view, { user }) {
  view.innerHTML = `
    <section class="card stack">
      <h2>স্বাগতম</h2>
      <p class="muted">${escapeHtml(user.email || '')}</p>
    </section>

    <section class="card stack">
      <h2>Database সংযোগ</h2>
      <p id="db-status" class="muted">যাচাই হচ্ছে…</p>
    </section>

    <section class="empty-state">
      <h2>Dashboard</h2>
      <p class="muted">পরিসংখ্যান ও chart ধাপ ৭-এ যোগ হবে।</p>
    </section>`;

  const statusEl = view.querySelector('#db-status');
  const { count, error } = await supabase
    .from('sims')
    .select('id', { count: 'exact', head: true });

  if (!view.contains(statusEl)) return; // user already left this page

  if (error) {
    statusEl.className = 'form-error';
    statusEl.textContent = `সংযোগে সমস্যা: ${error.message}`;
  } else {
    statusEl.className = 'text-success';
    statusEl.textContent = `সংযোগ ঠিক আছে ✓ (নিবন্ধিত SIM: ${count ?? 0})`;
  }
}

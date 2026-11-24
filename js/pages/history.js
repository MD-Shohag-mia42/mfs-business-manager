import { listSimsWithStats } from '../services/sims.js';
import { getServices, getTransactionTypes } from '../services/lookups.js';
import {
  searchTransactions, updateTransaction, setTransactionStatus, listAuditLogs,
} from '../services/history.js';
import { openSheet } from '../components/sheet.js';
import { confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { parseAmount, dhakaLocalToIso, normalizeSmsText } from '../parsers/helpers.js';
import { normalizeBdMobile } from '../utils/phone.js';
import {
  dhakaToday, addDays, monthStartOf, prevMonthRange, toDhakaLocal, dayCaption,
} from '../utils/dates.js';
import { setLoading } from '../utils/dom.js';
import { escapeHtml, formatTaka } from '../utils/format.js';
import { friendlyError } from '../utils/errors.js';
import { ACTION_LABELS, FIELD_LABELS, changedFields } from '../utils/audit.js';

const PAGE = 20;

const PERIODS = [
  { key: 'today', label: 'আজ' },
  { key: 'month', label: 'এই মাস' },
  { key: 'last_month', label: 'গত মাস' },
  { key: 'all', label: 'সব' },
  { key: 'custom', label: 'তারিখ বাছুন' },
];

const DEFAULTS = {
  period: 'month', from: '', to: '',
  simId: '', service: '', type: '', status: 'active',
  minAmount: '', maxAmount: '', search: '',
};

export async function renderHistoryPage(view) {
  view.innerHTML = '<div class="boot" style="min-height:200px"><span class="spinner"></span></div>';

  let sims;
  let services;
  let types;
  try {
    [sims, services, types] = await Promise.all([
      listSimsWithStats(),
      getServices(),
      getTransactionTypes(),
    ]);
  } catch (err) {
    console.error(err);
    view.innerHTML = `
      <div class="empty-state">
        <h2>লোড করা যায়নি</h2>
        <p class="muted">ইন্টারনেট দেখে পেজ আবার খুলুন।</p>
      </div>`;
    return;
  }

  const simById = new Map(sims.map((s) => [s.id, s]));
  const serviceLabel = (code) => services.find((s) => s.code === code)?.label ?? code;
  const typeLabel = (code) => types.find((t) => t.code === code)?.label ?? code;
  const dirOf = (code) => types.find((t) => t.code === code)?.direction ?? null;
  const simName = (id) => simById.get(id)?.sim_name ?? 'অজানা SIM';

  /* ---------- skeleton ---------- */

  const simOptions = (extra = '') => {
    const groups = services
      .map((svc) => {
        const list = sims.filter((s) => s.service === svc.code);
        if (!list.length) return '';
        const opts = list
          .map(
            (s) =>
              `<option value="${escapeHtml(s.id)}">${escapeHtml(s.sim_name)} · ${escapeHtml(s.mobile_number)}${s.status === 'active' ? '' : ' (Inactive)'}</option>`
          )
          .join('');
        return `<optgroup label="${escapeHtml(svc.label)}">${opts}</optgroup>`;
      })
      .join('');
    return `<option value="">${extra}</option>${groups}`;
  };

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Transaction History</h2>
        <p class="muted" id="h-count">&nbsp;</p>
      </div>
      <button class="btn btn-ghost btn-sm" id="h-reset" type="button">রিসেট</button>
    </div>

    <section class="card stack" id="h-filters">
      <div class="field">
        <label class="sr-only" for="h-search">খুঁজুন</label>
        <input id="h-search" data-f="search" type="search" autocomplete="off"
               placeholder="TrxID, নম্বর, reference বা note দিয়ে খুঁজুন">
      </div>

      <div class="seg" id="h-periods" role="group" aria-label="সময়কাল">
        ${PERIODS.map((p) => `<button type="button" data-period="${p.key}">${p.label}</button>`).join('')}
      </div>

      <div class="form-grid" id="h-custom" hidden>
        <div class="field">
          <label for="h-from">শুরুর তারিখ</label>
          <input id="h-from" data-f="from" type="date">
        </div>
        <div class="field">
          <label for="h-to">শেষের তারিখ</label>
          <input id="h-to" data-f="to" type="date">
        </div>
      </div>

      <details>
        <summary id="h-filter-summary">আরও ফিল্টার</summary>
        <div class="form-grid" style="margin-top:12px">
          <div class="field">
            <label for="h-sim">SIM</label>
            <select id="h-sim" data-f="simId">${simOptions('সব SIM')}</select>
          </div>
          <div class="field">
            <label for="h-service">Service</label>
            <select id="h-service" data-f="service">
              <option value="">সব Service</option>
              ${services.map((s) => `<option value="${escapeHtml(s.code)}">${escapeHtml(s.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="h-type">ধরন</label>
            <select id="h-type" data-f="type">
              <option value="">সব ধরন</option>
              ${types.map((t) => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="h-status">অবস্থা</label>
            <select id="h-status" data-f="status">
              <option value="active">চালু (Active)</option>
              <option value="voided">বাতিল (Voided)</option>
              <option value="all">সব</option>
            </select>
          </div>
          <div class="field">
            <label for="h-min">সর্বনিম্ন Amount</label>
            <input id="h-min" data-f="minAmount" inputmode="decimal" autocomplete="off" placeholder="যেমন 500">
          </div>
          <div class="field">
            <label for="h-max">সর্বোচ্চ Amount</label>
            <input id="h-max" data-f="maxAmount" inputmode="decimal" autocomplete="off" placeholder="যেমন 5000">
          </div>
        </div>
      </details>

      <p class="form-error" id="h-error" role="alert" hidden></p>
    </section>

    <div id="h-list"></div>
    <div id="h-more"></div>`;

  const filtersEl = view.querySelector('#h-filters');
  const listEl = view.querySelector('#h-list');
  const moreEl = view.querySelector('#h-more');
  const countEl = view.querySelector('#h-count');
  const errEl = view.querySelector('#h-error');
  const customEl = view.querySelector('#h-custom');
  const summaryEl = view.querySelector('#h-filter-summary');

  /* ---------- state ---------- */

  const f = { ...DEFAULTS };
  let items = [];
  let total = 0;
  let loadToken = 0;
  let searchTimer = null;

  const showError = (msg) => {
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  };

  function syncControls() {
    for (const el of filtersEl.querySelectorAll('[data-f]')) el.value = f[el.dataset.f];
    for (const b of filtersEl.querySelectorAll('[data-period]')) {
      b.setAttribute('aria-pressed', String(b.dataset.period === f.period));
    }
    customEl.hidden = f.period !== 'custom';
    view.querySelector('#h-service').disabled = Boolean(f.simId);

    const active = [f.simId, f.service && !f.simId, f.type, f.status !== 'active', f.minAmount, f.maxAmount].filter(Boolean).length;
    summaryEl.textContent = active ? `আরও ফিল্টার · ${active}টি চালু` : 'আরও ফিল্টার';
  }

  function dateRange() {
    const today = dhakaToday();
    switch (f.period) {
      case 'today': return { from: today, to: today };
      case 'month': return { from: monthStartOf(today), to: today };
      case 'last_month': return prevMonthRange();
      case 'custom': return { from: f.from, to: f.to };
      default: return { from: '', to: '' };
    }
  }

  // Returns the query for the database, or null (and shows a message) when a filter is invalid.
  function buildQuery() {
    const { from, to } = dateRange();
    if (from && to && from > to) {
      showError('শুরুর তারিখ শেষের তারিখের পরে হতে পারে না।');
      return null;
    }

    let minAmount = null;
    let maxAmount = null;
    if (f.minAmount.trim()) {
      minAmount = parseAmount(f.minAmount);
      if (minAmount == null) {
        showError('সর্বনিম্ন Amount ঠিক নেই।');
        return null;
      }
    }
    if (f.maxAmount.trim()) {
      maxAmount = parseAmount(f.maxAmount);
      if (maxAmount == null) {
        showError('সর্বোচ্চ Amount ঠিক নেই।');
        return null;
      }
    }
    showError('');

    return {
      status: f.status,
      simId: f.simId,
      service: f.service,
      type: f.type,
      fromIso: from ? `${from}T00:00:00+06:00` : '',
      toIso: to ? `${addDays(to, 1)}T00:00:00+06:00` : '',
      minAmount,
      maxAmount,
      search: normalizeSmsText(f.search),
    };
  }

  /* ---------- load ---------- */

  async function reload() {
    const query = buildQuery();
    if (!query) return;

    const token = ++loadToken;
    items = [];
    total = 0;
    moreEl.innerHTML = '';
    listEl.innerHTML = '<div class="boot" style="min-height:160px"><span class="spinner"></span></div>';

    try {
      const { rows, count } = await searchTransactions(query, { offset: 0, limit: PAGE });
      if (token !== loadToken) return;
      items = rows;
      total = count;
      drawList();
    } catch (err) {
      console.error(err);
      if (token !== loadToken) return;
      listEl.innerHTML = `
        <div class="empty-state">
          <h2>লোড করা যায়নি</h2>
          <p class="muted">ইন্টারনেট দেখে আবার চেষ্টা করুন।</p>
        </div>`;
    }
  }

  async function loadMore(btn) {
    const query = buildQuery();
    if (!query) return;
    const token = loadToken;
    setLoading(btn, true);
    try {
      const { rows, count } = await searchTransactions(query, { offset: items.length, limit: PAGE });
      if (token !== loadToken) return;
      const known = new Set(items.map((x) => x.id));
      items = [...items, ...rows.filter((r) => !known.has(r.id))];
      total = count;
      drawList();
    } catch (err) {
      console.error(err);
      toast(friendlyError(err), 'error');
      setLoading(btn, false);
    }
  }

  /* ---------- list ---------- */

  function rowHtml(tx, time) {
    const dir = dirOf(tx.transaction_type);
    const sign = dir === 'in' ? '+' : dir === 'out' ? '−' : '';
    const cls = dir === 'in' ? 'text-success' : dir === 'out' ? 'text-danger' : '';
    const who = dir === 'in' ? tx.sender_number : tx.receiver_number;

    return `
      <button type="button" class="tx-row ${tx.status === 'voided' ? 'is-void' : ''}" data-id="${escapeHtml(tx.id)}">
        <span class="tx-line">
          <strong class="tx-amount ${cls}">${sign}${escapeHtml(formatTaka(tx.amount))}</strong>
          <span class="tx-sub">${escapeHtml(time)}</span>
        </span>
        <span class="tx-line">
          <span class="tx-sub">
            <span class="badge badge-${escapeHtml(tx.service)}">${escapeHtml(serviceLabel(tx.service))}</span>
            ${escapeHtml(simName(tx.sim_id))}${who ? ` · ${escapeHtml(who)}` : ''}
          </span>
          ${tx.status === 'voided' ? '<span class="badge badge-send">বাতিল</span>' : ''}
        </span>
        ${tx.trx_id ? `<span class="tx-line"><span class="tx-sub">TrxID: ${escapeHtml(tx.trx_id)}</span></span>` : ''}
      </button>`;
  }

  function drawList() {
    countEl.textContent = total ? `মোট ${total} টি` : '\u00A0';

    if (!items.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <h2>কোনো transaction পাওয়া যায়নি</h2>
          <p class="muted">সময়কাল বা ফিল্টার বদলে দেখুন।</p>
        </div>`;
      moreEl.innerHTML = '';
      return;
    }

    let html = '';
    let lastDate = '';
    for (const tx of items) {
      const local = toDhakaLocal(tx.transaction_datetime);
      const date = local.slice(0, 10);
      if (date !== lastDate) {
        if (lastDate) html += '</div>';
        html += `<h3 class="tx-date">${escapeHtml(dayCaption(date))} ${date.slice(0, 4)}</h3><div class="card tx-group">`;
        lastDate = date;
      }
      html += rowHtml(tx, local.slice(11));
    }
    html += '</div>';
    listEl.innerHTML = html;

    moreEl.innerHTML =
      items.length < total
        ? `<button class="btn btn-ghost btn-block" data-more type="button" style="margin-top:16px">আরও দেখুন (${total - items.length}টি বাকি)</button>`
        : '';
  }

  // Update one row after edit / void / restore without reloading the whole list.
  function applyChange(row) {
    const i = items.findIndex((x) => x.id === row.id);
    if (i === -1) return;

    if (f.status === 'all' || row.status === f.status) items[i] = row;
    else {
      items.splice(i, 1);
      total = Math.max(0, total - 1);
    }
    items.sort(
      (a, b) =>
        new Date(b.transaction_datetime) - new Date(a.transaction_datetime) ||
        new Date(b.created_at) - new Date(a.created_at)
    );
    drawList();
  }

  /* ---------- filter events ---------- */

  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    f.period = btn.dataset.period;
    syncControls();
    if (f.period !== 'custom' || (f.from && f.to)) reload();
  });

  const onFilterInput = (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    f[el.dataset.f] = el.value;

    if (el.dataset.f === 'simId' && f.simId) f.service = '';
    const instant = el.matches('select, input[type="date"]');

    if (e.type === 'change' && !instant) return; // typed fields react on "input"
    if (e.type === 'input' && instant) return; // selects/dates react on "change"

    syncControls();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reload, instant ? 0 : 400);
  };
  filtersEl.addEventListener('input', onFilterInput);
  filtersEl.addEventListener('change', onFilterInput);

  view.querySelector('#h-reset').addEventListener('click', () => {
    Object.assign(f, DEFAULTS);
    syncControls();
    reload();
  });

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    const tx = row && items.find((x) => x.id === row.dataset.id);
    if (tx) openDetails(tx);
  });

  moreEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-more]');
    if (btn) loadMore(btn);
  });

  /* ---------- details ---------- */

  const kv = (label, text) =>
    text === null || text === undefined || text === ''
      ? ''
      : `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd></div>`;
  const kvHtml = (label, html) => `<div><dt>${escapeHtml(label)}</dt><dd>${html}</dd></div>`;

  function openDetails(tx) {
    const dir = dirOf(tx.transaction_type);
    const sim = simById.get(tx.sim_id);
    const local = toDhakaLocal(tx.transaction_datetime);
    const isActive = tx.status === 'active';

    const sheet = openSheet({
      title: typeLabel(tx.transaction_type),
      html: `
        <dl class="kv">
          ${kvHtml('Amount', `<strong class="${dir === 'in' ? 'text-success' : 'text-danger'}">${escapeHtml(formatTaka(tx.amount))}</strong>`)}
          ${kv('Fee', Number(tx.fee) > 0 ? formatTaka(tx.fee) : '')}
          ${kvHtml('Service', `<span class="badge badge-${escapeHtml(tx.service)}">${escapeHtml(serviceLabel(tx.service))}</span>`)}
          ${kv('SIM', sim ? `${sim.sim_name} · ${sim.mobile_number}` : 'অজানা SIM')}
          ${kv('Sender', tx.sender_number)}
          ${kv('Receiver', tx.receiver_number)}
          ${kv('তারিখ ও সময়', `${local.slice(0, 10)} ${local.slice(11)}`)}
          ${kv('TrxID', tx.trx_id)}
          ${kv('Reference', tx.reference)}
          ${kv('Balance (পরে)', tx.balance_after != null ? formatTaka(tx.balance_after) : '')}
          ${kv('Entry', tx.entry_method === 'sms' ? 'SMS থেকে' : 'নিজে লেখা')}
          ${kv('Note', tx.notes)}
          ${kvHtml('অবস্থা', isActive ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-send">Voided (বাতিল)</span>')}
        </dl>

        ${
          tx.original_sms
            ? `<details class="draft-sms" style="margin-top:12px"><summary>মূল SMS দেখুন</summary><pre>${escapeHtml(tx.original_sms)}</pre></details>`
            : ''
        }

        <div class="detail-actions">
          ${isActive ? '<button class="btn btn-ghost" data-act="edit" type="button">Edit</button>' : ''}
          <button class="btn ${isActive ? 'btn-ghost' : 'btn-primary'}" data-act="toggle" type="button">${isActive ? 'বাতিল করুন (Void)' : 'ফিরিয়ে আনুন'}</button>
          <button class="btn btn-ghost" data-act="log" type="button">পরিবর্তনের ইতিহাস</button>
        </div>
        <div id="tx-log" style="margin-top:12px"></div>`,
    });

    sheet.el.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;

      if (btn.dataset.act === 'edit') {
        sheet.close();
        openEdit(tx);
      }

      if (btn.dataset.act === 'toggle') {
        const makeVoid = isActive;
        const ok = await confirmDialog({
          title: makeVoid ? 'Transaction বাতিল করবেন?' : 'Transaction ফিরিয়ে আনবেন?',
          message: makeVoid
            ? 'হিসাব ও Dashboard থেকে বাদ যাবে, তবে ইতিহাসে থাকবে। পরে ফিরিয়ে আনা যাবে।'
            : 'আবার হিসাব ও Dashboard-এ যোগ হবে।',
          confirmText: makeVoid ? 'বাতিল করুন' : 'ফিরিয়ে আনুন',
          danger: makeVoid,
        });
        if (!ok) return;

        setLoading(btn, true);
        try {
          const row = await setTransactionStatus(tx.id, makeVoid ? 'voided' : 'active');
          applyChange(row);
          toast(makeVoid ? 'Transaction বাতিল করা হয়েছে' : 'Transaction ফিরিয়ে আনা হয়েছে', 'success');
          sheet.close();
        } catch (err) {
          console.error(err);
          toast(friendlyError(err), 'error');
          setLoading(btn, false);
        }
      }

      if (btn.dataset.act === 'log') {
        setLoading(btn, true);
        await drawAuditLog(sheet.el.querySelector('#tx-log'), tx);
        setLoading(btn, false);
      }
    });
  }

  /* ---------- audit log ---------- */

  function fmtValue(key, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (['amount', 'fee', 'balance_after'].includes(key)) return formatTaka(value);
    if (key === 'transaction_datetime') {
      const l = toDhakaLocal(value);
      return `${l.slice(0, 10)} ${l.slice(11)}`;
    }
    if (key === 'sim_id') return simName(value);
    if (key === 'status') return value === 'voided' ? 'Voided' : 'Active';
    return String(value);
  }

  async function drawAuditLog(box, tx) {
    box.innerHTML = '<p class="muted">লোড হচ্ছে…</p>';
    try {
      const logs = await listAuditLogs(tx.id);
      if (!logs.length) {
        box.innerHTML = '<p class="muted">কোনো ইতিহাস পাওয়া যায়নি।</p>';
        return;
      }
      box.innerHTML = logs
        .map((log) => {
          const when = toDhakaLocal(log.created_at);
          const changes =
            log.action === 'create'
              ? ''
              : changedFields(log.old_data, log.new_data)
                  .map(
                    (key) =>
                      `<li>${escapeHtml(FIELD_LABELS[key])}: ${escapeHtml(fmtValue(key, log.old_data?.[key]))} → ${escapeHtml(fmtValue(key, log.new_data?.[key]))}</li>`
                  )
                  .join('');
          return `
            <div class="log-item">
              <strong>${escapeHtml(ACTION_LABELS[log.action] ?? log.action)}</strong>
              <span class="muted"> · ${when.slice(0, 10)} ${when.slice(11)}</span>
              ${changes ? `<ul class="log-changes">${changes}</ul>` : ''}
            </div>`;
        })
        .join('');
    } catch (err) {
      console.error(err);
      box.innerHTML = '<p class="form-error">ইতিহাস আনা যায়নি।</p>';
    }
  }


/* ---------- edit ---------- */

  function openEdit(tx) {
    const dir = dirOf(tx.transaction_type);
    const whoKey = dir === 'in' ? 'sender_number' : 'receiver_number';
    const whoLabel = dir === 'in' ? 'Sender-এর নম্বর' : 'Receiver-এর নম্বর (ঐচ্ছিক)';

    const simChoices = sims
      .filter((s) => s.service === tx.service && (s.status === 'active' || s.id === tx.sim_id))
      .map(
        (s) =>
          `<option value="${escapeHtml(s.id)}" ${s.id === tx.sim_id ? 'selected' : ''}>${escapeHtml(s.sim_name)} · ${escapeHtml(s.mobile_number)}</option>`
      )
      .join('');

    const sheet = openSheet({
      title: `${typeLabel(tx.transaction_type)} Edit করুন`,
      html: `
        <form id="edit-form" novalidate>
          <div class="field">
            <label for="e-sim">SIM</label>
            <select id="e-sim" name="sim">${simChoices}</select>
          </div>
          <div class="field">
            <label for="e-who">${whoLabel}</label>
            <input id="e-who" name="who" type="tel" inputmode="numeric" autocomplete="off"
                   value="${escapeHtml(tx[whoKey] ?? '')}">
          </div>
          <div class="form-grid" style="margin-top:14px">
            <div class="field">
              <label for="e-amount">Amount (৳)</label>
              <input id="e-amount" name="amount" inputmode="decimal" autocomplete="off" value="${escapeHtml(Number(tx.amount).toFixed(2))}">
            </div>
            <div class="field">
              <label for="e-fee">Fee (৳)</label>
              <input id="e-fee" name="fee" inputmode="decimal" autocomplete="off" value="${escapeHtml(Number(tx.fee).toFixed(2))}">
            </div>
          </div>
          <div class="field">
            <label for="e-dt">তারিখ ও সময়</label>
            <input id="e-dt" name="datetime" type="datetime-local" value="${escapeHtml(toDhakaLocal(tx.transaction_datetime))}">
          </div>
          <div class="form-grid" style="margin-top:14px">
            <div class="field">
              <label for="e-trx">TrxID</label>
              <input id="e-trx" name="trx_id" autocapitalize="characters" autocomplete="off" value="${escapeHtml(tx.trx_id ?? '')}">
            </div>
            <div class="field">
              <label for="e-bal">Balance (পরে)</label>
              <input id="e-bal" name="balance_after" inputmode="decimal" autocomplete="off" value="${tx.balance_after != null ? escapeHtml(Number(tx.balance_after).toFixed(2)) : ''}">
            </div>
            <div class="field">
              <label for="e-ref">Reference</label>
              <input id="e-ref" name="reference" maxlength="100" autocomplete="off" value="${escapeHtml(tx.reference ?? '')}">
            </div>
            <div class="field">
              <label for="e-notes">Note</label>
              <input id="e-notes" name="notes" maxlength="500" autocomplete="off" value="${escapeHtml(tx.notes ?? '')}">
            </div>
          </div>
          <p class="form-error" id="e-error" role="alert" hidden style="margin-top:14px"></p>
          <button class="btn btn-primary btn-block" id="e-save" type="submit" style="margin-top:18px">Save</button>
        </form>`,
    });

    const form = sheet.el.querySelector('#edit-form');
    const errBox = sheet.el.querySelector('#e-error');
    const saveBtn = sheet.el.querySelector('#e-save');
    let busy = false;

    const showErrors = (list) => {
      errBox.innerHTML = list.map(escapeHtml).join('<br>');
      errBox.hidden = list.length === 0;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;

      const el = form.elements;
      const errors = [];

      const simId = el.sim.value;
      if (!sims.some((s) => s.id === simId && s.service === tx.service)) errors.push('SIM বেছে নিন।');

      let who = null;
      const whoRaw = el.who.value.trim();
      if (whoRaw) {
        const compact = whoRaw.replace(/[\s-]/g, '');
        who = normalizeBdMobile(whoRaw) ?? (dir === 'in' && /^\+?\d{5,15}$/.test(compact) ? compact : null);
        if (!who) errors.push('নম্বর ঠিক নেই।');
      }

      const amount = parseAmount(el.amount.value);
      if (amount == null || amount <= 0) errors.push('সঠিক Amount দিন।');
      else if (amount >= 1e10) errors.push('Amount অনেক বড়।');

      let fee = 0;
      if (el.fee.value.trim()) {
        fee = parseAmount(el.fee.value);
        if (fee == null) {
          errors.push('Fee-এর মান ঠিক নেই।');
          fee = 0;
        }
      }

      const iso = dhakaLocalToIso(el.datetime.value);
      if (!iso) errors.push('তারিখ ও সময় দিন।');
      else if (new Date(iso).getTime() > Date.now() + 5 * 60 * 1000) {
        errors.push('তারিখ-সময় ভবিষ্যতের হতে পারে না।');
      }

      const trx = el.trx_id.value.trim().toUpperCase();
      if (trx && !/^[A-Z0-9]{6,20}$/.test(trx)) {
        errors.push('TrxID-তে শুধু ইংরেজি অক্ষর ও সংখ্যা (৬–২০টি) থাকতে পারে।');
      }

      let balance = null;
      if (el.balance_after.value.trim()) {
        balance = parseAmount(el.balance_after.value);
        if (balance == null) errors.push('Balance-এর মান ঠিক নেই।');
      }

      showErrors(errors);
      if (errors.length) return;

      busy = true;
      setLoading(saveBtn, true);
      try {
        const row = await updateTransaction(tx.id, {
          sim_id: simId,
          [whoKey]: who,
          amount,
          fee,
          transaction_datetime: iso,
          trx_id: trx || null,
          balance_after: balance,
          reference: el.reference.value.trim().slice(0, 100) || null,
          notes: el.notes.value.trim().slice(0, 500) || null,
        });
        applyChange(row);
        toast('Transaction আপডেট হয়েছে', 'success');
        sheet.close();
      } catch (err) {
        console.error(err);
        showErrors([friendlyError(err)]);
      } finally {
        busy = false;
        setLoading(saveBtn, false);
      }
    });
  }

  syncControls();
  await reload();
}

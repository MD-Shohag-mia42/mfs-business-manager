import {
  listSimsWithStats, createSim, updateSim, setSimStatus,
  listLimits, saveLimit, deleteLimit,
} from '../services/sims.js';
import { getServices, getTransactionTypes } from '../services/lookups.js';
import { openSheet } from '../components/sheet.js';
import { confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { setLoading } from '../utils/dom.js';
import { escapeHtml, formatTaka } from '../utils/format.js';
import { normalizeBdMobile } from '../utils/phone.js';
import { friendlyError } from '../utils/errors.js';

const ACCOUNT_TYPES = [
  { value: 'personal', label: 'Personal' },
  { value: 'agent', label: 'Agent' },
  { value: 'merchant', label: 'Merchant' },
  { value: 'other', label: 'Other' },
];
const accountLabel = (v) => ACCOUNT_TYPES.find((a) => a.value === v)?.label ?? v;

export async function renderSimsPage(view) {
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h2>আমার SIM</h2>
        <p class="muted" id="sim-summary">লোড হচ্ছে…</p>
      </div>
      <button class="btn btn-primary" id="add-sim" type="button">+ নতুন SIM</button>
    </div>
    <div id="sim-list">
      <div class="boot" style="min-height:160px"><span class="spinner"></span></div>
    </div>`;

  const listEl = view.querySelector('#sim-list');
  const summaryEl = view.querySelector('#sim-summary');

  let sims = [];
  let services = [];
  let types = [];

  const serviceLabel = (code) => services.find((s) => s.code === code)?.label ?? code;

  /* ---------- load & draw ---------- */

  async function load() {
    try {
      [sims, services, types] = await Promise.all([
        listSimsWithStats(),
        getServices(),
        getTransactionTypes(),
      ]);
      draw();
    } catch (err) {
      console.error(err);
      summaryEl.textContent = '';
      listEl.innerHTML = `
        <div class="empty-state">
          <h2>লোড করা যায়নি</h2>
          <p class="muted">ইন্টারনেট দেখে আবার চেষ্টা করুন।</p>
        </div>`;
    }
  }

  function draw() {
    if (!sims.length) {
      summaryEl.textContent = 'এখনো কোনো SIM নেই';
      listEl.innerHTML = `
        <div class="empty-state">
          <h2>কোনো SIM যোগ করা হয়নি</h2>
          <p class="muted">উপরের "+ নতুন SIM" চেপে আপনার প্রথম bKash বা Nagad SIM যোগ করুন।</p>
        </div>`;
      return;
    }
    const active = sims.filter((s) => s.status === 'active').length;
    summaryEl.textContent = `মোট ${sims.length}টি · Active ${active}টি`;
    listEl.innerHTML = `<div class="sim-grid">${sims.map(simCard).join('')}</div>`;
  }

  function simCard(sim) {
    const st = sim.stats;
    const isActive = sim.status === 'active';
    const balance =
      st.latest_balance != null
        ? `<p class="muted sim-balance">সর্বশেষ জানা balance: <strong>${formatTaka(st.latest_balance)}</strong></p>`
        : '';

    return `
      <article class="card sim-card ${isActive ? '' : 'is-inactive'}" data-id="${escapeHtml(sim.id)}">
        <header class="sim-card-head">
          <div>
            <h3>${escapeHtml(sim.sim_name)}</h3>
            <p class="muted">${escapeHtml(sim.mobile_number)} · ${escapeHtml(accountLabel(sim.account_type))}</p>
          </div>
          <div class="sim-badges">
            <span class="badge badge-${escapeHtml(sim.service)}">${escapeHtml(serviceLabel(sim.service))}</span>
            <span class="badge ${isActive ? 'badge-active' : 'badge-inactive'}">${isActive ? 'Active' : 'Inactive'}</span>
          </div>
        </header>

        <div class="sim-stats">
          <div>
            <span class="muted">Received</span>
            <strong>${st.received_count} টি</strong>
            <span class="text-success">${formatTaka(st.received_total)}</span>
          </div>
          <div>
            <span class="muted">Send</span>
            <strong>${st.send_count} টি</strong>
            <span class="text-danger">${formatTaka(st.send_total)}</span>
          </div>
        </div>

        ${balance}
        ${sim.notes ? `<p class="muted sim-note">${escapeHtml(sim.notes)}</p>` : ''}

        <div class="sim-actions">
          <button class="btn btn-ghost" data-action="edit" type="button">Edit</button>
          <button class="btn btn-ghost" data-action="limits" type="button">Limits</button>
          <button class="btn btn-ghost" data-action="toggle" type="button">${isActive ? 'Deactivate' : 'Activate'}</button>
        </div>
      </article>`;
  }

  /* ---------- events ---------- */

  view.querySelector('#add-sim').addEventListener('click', () => openSimForm(null));

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const sim = sims.find((s) => s.id === btn.closest('[data-id]')?.dataset.id);
    if (!sim) return;

    if (btn.dataset.action === 'edit') openSimForm(sim);
    if (btn.dataset.action === 'limits') openLimits(sim);
    if (btn.dataset.action === 'toggle') await toggleStatus(sim, btn);
  });

  async function toggleStatus(sim, btn) {
    const makeActive = sim.status !== 'active';

    if (!makeActive) {
      const ok = await confirmDialog({
        title: `${sim.sim_name} বন্ধ করবেন?`,
        message: 'Inactive SIM নতুন entry-র তালিকায় দেখাবে না। পুরনো হিসাব ঠিক থাকবে।',
        confirmText: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }

    setLoading(btn, true);
    try {
      await setSimStatus(sim.id, makeActive ? 'active' : 'inactive');
      toast(makeActive ? 'SIM চালু হয়েছে' : 'SIM বন্ধ হয়েছে', 'success');
      await load();
    } catch (err) {
      console.error(err);
      toast(friendlyError(err), 'error');
      setLoading(btn, false);
    }
  }

  /* ---------- add / edit SIM ---------- */

  function openSimForm(sim) {
    const isEdit = Boolean(sim);
    const hasTx = isEdit && sim.stats.received_count + sim.stats.send_count > 0;

    const serviceOptions = services
      .map(
        (s) =>
          `<option value="${escapeHtml(s.code)}" ${sim?.service === s.code ? 'selected' : ''}>${escapeHtml(s.label)}</option>`
      )
      .join('');

    const typeOptions = ACCOUNT_TYPES.map(
      (a) =>
        `<option value="${a.value}" ${(sim?.account_type ?? 'personal') === a.value ? 'selected' : ''}>${a.label}</option>`
    ).join('');

    const sheet = openSheet({
      title: isEdit ? 'SIM Edit করুন' : 'নতুন SIM যোগ করুন',
      html: `
        <form id="sim-form" novalidate>
          <div class="field">
            <label for="f-service">Service</label>
            <select id="f-service" name="service" ${hasTx ? 'disabled' : ''}>${serviceOptions}</select>
            ${hasTx ? '<small class="muted">এই SIM-এ transaction আছে, তাই service বদলানো যাবে না।</small>' : ''}
          </div>
          <div class="field">
            <label for="f-name">SIM-এর নাম</label>
            <input id="f-name" name="sim_name" maxlength="30" autocomplete="off"
                   placeholder="যেমন: bKash-01" value="${escapeHtml(sim?.sim_name ?? '')}">
          </div>
          <div class="field">
            <label for="f-number">মোবাইল নম্বর</label>
            <input id="f-number" name="mobile_number" type="tel" inputmode="numeric"
                   autocomplete="off" placeholder="01XXXXXXXXX"
                   value="${escapeHtml(sim?.mobile_number ?? '')}">
          </div>
          <div class="field">
            <label for="f-type">Account type</label>
            <select id="f-type" name="account_type">${typeOptions}</select>
          </div>
          <div class="field">
            <label for="f-notes">Note (ঐচ্ছিক)</label>
            <textarea id="f-notes" name="notes" maxlength="200" style="min-height:72px">${escapeHtml(sim?.notes ?? '')}</textarea>
          </div>
          <p class="form-error" id="sim-error" role="alert" hidden style="margin-top:14px"></p>
          <button class="btn btn-primary btn-block" id="sim-save" type="submit" style="margin-top:18px">Save</button>
        </form>`,
    });

    const form = sheet.el.querySelector('#sim-form');
    const saveBtn = sheet.el.querySelector('#sim-save');
    const errEl = sheet.el.querySelector('#sim-error');
    let busy = false;

    const showError = (msg) => {
      errEl.textContent = msg;
      errEl.hidden = false;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;

      const f = form.elements;
      const service = f.service.value;
      const sim_name = f.sim_name.value.trim();
      const mobile_number = normalizeBdMobile(f.mobile_number.value);
      const account_type = f.account_type.value;
      const notes = f.notes.value.trim() || null;

      if (!service) return showError('Service বেছে নিন।');
      if (!sim_name) return showError('SIM-এর নাম দিন।');
      if (sim_name.length > 30) return showError('নাম ৩০ অক্ষরের মধ্যে রাখুন।');
      if (!mobile_number) return showError('সঠিক মোবাইল নম্বর দিন (যেমন 01712345678)।');

      busy = true;
      errEl.hidden = true;
      setLoading(saveBtn, true);

      try {
        if (isEdit) {
          const patch = { sim_name, mobile_number, account_type, notes };
          if (!hasTx) patch.service = service;
          await updateSim(sim.id, patch);
        } else {
          await createSim({ service, sim_name, mobile_number, account_type, notes });
        }
        toast(isEdit ? 'SIM আপডেট হয়েছে' : 'SIM যোগ হয়েছে', 'success');
        sheet.close();
        await load();
      } catch (err) {
        console.error(err);
        showError(friendlyError(err));
      } finally {
        busy = false;
        setLoading(saveBtn, false);
      }
    });
  }

  /* ---------- limits ---------- */

  async function openLimits(sim) {
    const typeOptions = types
      .map((t) => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.label)}</option>`)
      .join('');

    const sheet = openSheet({
      title: `${sim.sim_name} · Limits`,
      html: `
        <p class="muted">এগুলো শুধু আপনার নিজের নজরদারির সীমা। bKash বা Nagad-এর অফিশিয়াল সীমা অতিক্রম করার অনুমতি নয়।</p>
        <div id="limit-list" class="stack" style="margin-top:14px"></div>

        <form id="limit-form" class="limit-form" novalidate>
          <h3 id="limit-form-title">নতুন limit যোগ করুন</h3>
          <div class="field">
            <label for="l-type">ধরন</label>
            <select id="l-type" name="limit_type">
              <option value="count">Transaction সংখ্যা</option>
              <option value="amount">মোট Amount (৳)</option>
              <option value="balance">Balance সীমা (৳)</option>
            </select>
          </div>
          <div class="field" id="l-period-wrap">
            <label for="l-period">সময়কাল</label>
            <select id="l-period" name="period">
              <option value="monthly">মাসিক</option>
              <option value="daily">দৈনিক</option>
            </select>
          </div>
          <div class="field" id="l-applies-wrap">
            <label for="l-applies">কোন transaction-এর জন্য</label>
            <select id="l-applies" name="applies_to">
              <option value="">সব ধরন</option>
              ${typeOptions}
            </select>
          </div>
          <div class="field">
            <label for="l-value">সীমার মান</label>
            <input id="l-value" name="limit_value" type="text" inputmode="decimal"
                   autocomplete="off" placeholder="যেমন 50 বা 200000">
          </div>
          <div class="field">
            <label for="l-warn">কত শতাংশে সতর্ক করবে</label>
            <input id="l-warn" name="warn_percent" type="text" inputmode="numeric"
                   autocomplete="off" value="80">
          </div>
          <p class="form-error" id="limit-error" role="alert" hidden style="margin-top:14px"></p>
          <div class="form-actions">
            <button class="btn btn-ghost" id="limit-cancel" type="button" hidden>Cancel</button>
            <button class="btn btn-primary" id="limit-save" type="submit">Save limit</button>
          </div>
        </form>`,
    });

    const listBox = sheet.el.querySelector('#limit-list');
    const form = sheet.el.querySelector('#limit-form');
    const titleEl = sheet.el.querySelector('#limit-form-title');
    const periodWrap = sheet.el.querySelector('#l-period-wrap');
    const appliesWrap = sheet.el.querySelector('#l-applies-wrap');
    const errEl = sheet.el.querySelector('#limit-error');
    const saveBtn = sheet.el.querySelector('#limit-save');
    const cancelBtn = sheet.el.querySelector('#limit-cancel');

    let limits = [];
    let editingId = null;
    let busy = false;

    const showError = (msg) => {
      errEl.textContent = msg;
      errEl.hidden = false;
    };

    const typeLabel = (code) => types.find((t) => t.code === code)?.label ?? code;

    const describe = (l) => {
      const kind = { count: 'Transaction সংখ্যা', amount: 'মোট Amount', balance: 'Balance সীমা' }[l.limit_type];
      const period = { daily: 'দৈনিক', monthly: 'মাসিক', none: '' }[l.period];
      const scope =
        l.limit_type === 'balance' ? '' : l.transaction_type ? typeLabel(l.transaction_type) : 'সব ধরন';
      return [period, kind, scope].filter(Boolean).join(' · ');
    };

    const valueText = (l) =>
      l.limit_type === 'count' ? `${Number(l.limit_value)} টি` : formatTaka(l.limit_value);

    const syncFields = () => {
      const isBalance = form.elements.limit_type.value === 'balance';
      periodWrap.hidden = isBalance;
      appliesWrap.hidden = isBalance;
    };
    form.elements.limit_type.addEventListener('change', syncFields);

    const resetForm = () => {
      editingId = null;
      form.reset();
      titleEl.textContent = 'নতুন limit যোগ করুন';
      cancelBtn.hidden = true;
      errEl.hidden = true;
      syncFields();
    };

    function drawLimits() {
      if (!limits.length) {
        listBox.innerHTML = '<p class="muted">এখনো কোনো limit সেট করা নেই।</p>';
        return;
      }
      listBox.innerHTML = limits
        .map(
          (l) => `
        <div class="limit-row" data-id="${escapeHtml(l.id)}">
          <div>
            <strong>${escapeHtml(describe(l))}</strong>
            <p class="muted">সীমা: ${escapeHtml(valueText(l))} · সতর্কতা ${l.warn_percent}%-এ</p>
          </div>
          <div class="limit-row-actions">
            <button class="btn btn-ghost btn-sm" data-act="edit" type="button">Edit</button>
            <button class="btn btn-ghost btn-sm text-danger" data-act="delete" type="button">Delete</button>
          </div>
        </div>`
        )
        .join('');
    }

    async function loadLimits() {
      try {
        limits = await listLimits(sim.id);
        drawLimits();
      } catch (err) {
        console.error(err);
        listBox.innerHTML = '<p class="form-error">Limit লোড করা যায়নি।</p>';
      }
    }

    listBox.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const limit = limits.find((l) => l.id === btn.closest('[data-id]')?.dataset.id);
      if (!limit) return;

      if (btn.dataset.act === 'edit') {
        editingId = limit.id;
        const f = form.elements;
        f.limit_type.value = limit.limit_type;
        if (limit.period !== 'none') f.period.value = limit.period;
        f.applies_to.value = limit.transaction_type ?? '';
        f.limit_value.value = String(Number(limit.limit_value));
        f.warn_percent.value = String(limit.warn_percent);
        titleEl.textContent = 'Limit Edit করুন';
        cancelBtn.hidden = false;
        errEl.hidden = true;
        syncFields();
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      if (btn.dataset.act === 'delete') {
        const ok = await confirmDialog({
          title: 'Limit মুছবেন?',
          message: describe(limit),
          confirmText: 'Delete',
          danger: true,
        });
        if (!ok) return;
        try {
          await deleteLimit(limit.id);
          toast('Limit মুছে গেছে', 'success');
          if (editingId === limit.id) resetForm();
          await loadLimits();
        } catch (err) {
          console.error(err);
          toast(friendlyError(err), 'error');
        }
      }
    });

    cancelBtn.addEventListener('click', resetForm);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;

      const f = form.elements;
      const limit_type = f.limit_type.value;
      const isBalance = limit_type === 'balance';
      const limit_value = Number(String(f.limit_value.value).replace(/,/g, '').trim());
      const warn_percent = Number(String(f.warn_percent.value).trim());

      if (!Number.isFinite(limit_value) || limit_value <= 0) {
        return showError('সীমার মান ০-এর বেশি হতে হবে।');
      }
      if (limit_value > 99999999999) return showError('সংখ্যাটি অনেক বড়।');
      if (limit_type === 'count' && !Number.isInteger(limit_value)) {
        return showError('Transaction সংখ্যা পূর্ণসংখ্যা হতে হবে।');
      }
      if (!Number.isInteger(warn_percent) || warn_percent < 1 || warn_percent > 100) {
        return showError('সতর্কতার শতাংশ ১ থেকে ১০০-এর মধ্যে দিন।');
      }

      busy = true;
      errEl.hidden = true;
      setLoading(saveBtn, true);

      try {
        await saveLimit({
          id: editingId,
          sim_id: sim.id,
          limit_type,
          period: isBalance ? 'none' : f.period.value,
          transaction_type: isBalance ? null : f.applies_to.value || null,
          limit_value,
          warn_percent,
        });
        toast('Limit সংরক্ষিত হয়েছে', 'success');
        resetForm();
        await loadLimits();
      } catch (err) {
        console.error(err);
        showError(friendlyError(err));
      } finally {
        busy = false;
        setLoading(saveBtn, false);
      }
    });

    syncFields();
    await loadLimits();
  }

  await load();
  }

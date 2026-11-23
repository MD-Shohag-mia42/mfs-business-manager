import { listSimsWithStats } from '../services/sims.js';
import { getServices, getTransactionTypes } from '../services/lookups.js';
import { findPossibleDuplicate, insertTransaction, listRecentReceivers } from '../services/transactions.js';
import { getLimitStatus, describeLimit, limitValueText } from '../services/limits.js';
import { parseAmount, dhakaLocalToIso } from '../parsers/helpers.js';
import { normalizeBdMobile } from '../utils/phone.js';
import { nowDhakaLocal } from '../utils/dates.js';
import { setLoading } from '../utils/dom.js';
import { escapeHtml, formatTaka } from '../utils/format.js';
import { friendlyError } from '../utils/errors.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';

const LAST_SIM_KEY = 'mfs-last-send-sim';

const readLastSim = () => {
  try {
    return localStorage.getItem(LAST_SIM_KEY) || '';
  } catch {
    return '';
  }
};
const writeLastSim = (id) => {
  try {
    localStorage.setItem(LAST_SIM_KEY, id);
  } catch {
    /* storage blocked: ignore */
  }
};

export async function renderSendPage(view) {
  view.innerHTML = '<div class="boot" style="min-height:200px"><span class="spinner"></span></div>';

  let sims;
  let services;
  let types;
  let recent = [];
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
  try {
    recent = await listRecentReceivers();
  } catch (err) {
    console.error(err); // suggestions are optional
  }
  sims = sims.filter((s) => s.status === 'active');

  if (!sims.length) {
    view.innerHTML = `
      <div class="empty-state">
        <h2>আগে একটি SIM যোগ করুন</h2>
        <p class="muted">Send Money সেভ করতে অন্তত একটি active SIM লাগবে।</p>
        <p style="margin-top:14px"><a class="btn btn-primary" href="#/sims">SIM Management-এ যান</a></p>
      </div>`;
    return;
  }

  const serviceLabel = (code) => services.find((s) => s.code === code)?.label ?? code;
  const typeLabel = (code) => types.find((t) => t.code === code)?.label ?? code;

  const lastSim = readLastSim();
  const initialSim = sims.some((s) => s.id === lastSim) ? lastSim : sims.length === 1 ? sims[0].id : '';
  const preselectedFromMemory = Boolean(initialSim) && initialSim === lastSim && sims.length > 1;

  const simOptions = () => {
    const codes = [...new Set(sims.map((s) => s.service))];
    const groups = codes
      .map((code) => {
        const opts = sims
          .filter((s) => s.service === code)
          .map(
            (s) =>
              `<option value="${escapeHtml(s.id)}" ${s.id === initialSim ? 'selected' : ''}>${escapeHtml(s.sim_name)} · ${escapeHtml(s.mobile_number)}</option>`
          )
          .join('');
        return `<optgroup label="${escapeHtml(serviceLabel(code))}">${opts}</optgroup>`;
      })
      .join('');
    return `<option value="">— SIM বেছে নিন —</option>${groups}`;
  };

  view.innerHTML = `
    <div class="card stack" id="s-last" hidden></div>

    <form class="card stack" id="send-form" novalidate>
      <div class="field">
        <label for="s-sim">কোন SIM থেকে পাঠিয়েছেন</label>
        <select id="s-sim" name="sim">${simOptions()}</select>
        <small class="muted" id="s-sim-note" ${preselectedFromMemory ? '' : 'hidden'}>শেষবার ব্যবহার করা SIM বেছে রাখা হয়েছে। ভুল হলে বদলে নিন।</small>
      </div>

      <div class="field">
        <label for="s-receiver">Receiver-এর নম্বর</label>
        <input id="s-receiver" name="receiver" type="tel" inputmode="numeric"
               list="s-recent" autocomplete="off" placeholder="01XXXXXXXXX">
        <datalist id="s-recent">
          ${recent.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}
        </datalist>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="s-amount">Amount (৳)</label>
          <input id="s-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="যেমন 1500">
        </div>
        <div class="field">
          <label for="s-fee">Fee (৳)</label>
          <input id="s-fee" name="fee" inputmode="decimal" autocomplete="off" placeholder="0">
        </div>
      </div>

      <div class="field">
        <label for="s-datetime">তারিখ ও সময়</label>
        <input id="s-datetime" name="datetime" type="datetime-local" value="${nowDhakaLocal()}">
      </div>

      <details class="draft-more">
        <summary>আরও (TrxID, Balance, Reference, Note)</summary>
        <div class="form-grid">
          <div class="field">
            <label for="s-trx">TrxID</label>
            <input id="s-trx" name="trx_id" autocapitalize="characters" autocomplete="off">
          </div>
          <div class="field">
            <label for="s-balance">Balance (পাঠানোর পরে)</label>
            <input id="s-balance" name="balance_after" inputmode="decimal" autocomplete="off">
          </div>
          <div class="field">
            <label for="s-ref">Reference</label>
            <input id="s-ref" name="reference" maxlength="100" autocomplete="off">
          </div>
          <div class="field">
            <label for="s-notes">Note</label>
            <input id="s-notes" name="notes" maxlength="500" autocomplete="off">
          </div>
        </div>
      </details>

      <p class="form-error" id="s-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" id="s-save" type="submit">Save Send Money</button>
    </form>

    <section class="card stack" id="s-limits" hidden>
      <h2>Limit অবস্থা</h2>
      <div id="s-limit-list" class="stack"></div>
      <p class="muted">এটা শুধু আপনার নিজের নজরদারির জন্য, সেভ আটকাবে না।</p>
    </section>`;

  const form = view.querySelector('#send-form');
  const simEl = form.elements.sim;
  const amountEl = form.elements.amount;
  const errEl = view.querySelector('#s-error');
  const saveBtn = view.querySelector('#s-save');
  const lastEl = view.querySelector('#s-last');
  const simNote = view.querySelector('#s-sim-note');
  const limitsBox = view.querySelector('#s-limits');
  const limitList = view.querySelector('#s-limit-list');
  const recentList = view.querySelector('#s-recent');

  let busy = false;
  let limitStatus = [];
  let statusToken = 0;

  const showErrors = (list) => {
    errEl.innerHTML = list.map(escapeHtml).join('<br>');
    errEl.hidden = list.length === 0;
  };

  /* ---------- limit panel ---------- */

  function drawLimits() {
    if (!simEl.value || !limitStatus.length) {
      limitsBox.hidden = true;
      return;
    }
    limitsBox.hidden = false;
    const amount = parseAmount(amountEl.value) ?? 0;

    limitList.innerHTML = limitStatus
      .map(({ limit, used }) => {
        const value = Number(limit.limit_value);
        const after = used + (limit.limit_type === 'count' ? 1 : amount);
        const ratio = (after * 100) / value;
        const level = ratio >= 100 ? 'over' : ratio >= limit.warn_percent ? 'warn' : 'ok';
        const width = Math.min(100, Math.round(ratio));
        const badge =
          level === 'over'
            ? '<span class="badge badge-send">সীমা পেরোবে</span>'
            : level === 'warn'
              ? '<span class="badge badge-warn">সতর্কতা</span>'
              : '<span class="badge badge-active">ঠিক আছে</span>';

        return `
          <div class="limit-item">
            <div class="limit-item-head">
              <strong>${escapeHtml(describeLimit(limit, typeLabel))}</strong>${badge}
            </div>
            <div class="meter ${level}"><span style="width:${width}%"></span></div>
            <p class="muted">এখন পর্যন্ত ${escapeHtml(limitValueText(limit, used))} · এই entry-সহ ${escapeHtml(limitValueText(limit, after))} · সীমা ${escapeHtml(limitValueText(limit))}</p>
          </div>`;
      })
      .join('');
  }

  async function loadLimitStatus() {
    const simId = simEl.value;
    const token = ++statusToken;

    if (!simId) {
      limitStatus = [];
      drawLimits();
      return;
    }

    try {
      const rows = await getLimitStatus(simId);
      if (token !== statusToken) return; // SIM changed meanwhile
      limitStatus = rows.filter(
        (r) => !r.limit.transaction_type || r.limit.transaction_type === 'send_money'
      );
    } catch (err) {
      console.error(err);
      if (token !== statusToken) return;
      limitStatus = [];
    }
    drawLimits();
  }

  simEl.addEventListener('change', () => {
    simNote.hidden = true;
    loadLimitStatus();
  });
  amountEl.addEventListener('input', drawLimits);

  /* ---------- validate ---------- */

  function buildRow() {
    const errors = [];
    const f = form.elements;

    const sim = sims.find((s) => s.id === f.sim.value);
    if (!sim) errors.push('SIM বেছে নিন।');

    const receiver = normalizeBdMobile(f.receiver.value);
    if (!receiver) errors.push('Receiver-এর সঠিক মোবাইল নম্বর দিন (যেমন 01712345678)।');

    const amount = parseAmount(f.amount.value);
    if (amount == null || amount <= 0) errors.push('সঠিক Amount দিন (যেমন 1500 বা 1500.50)।');
    else if (amount >= 1e10) errors.push('Amount অনেক বড়।');

    let fee = 0;
    if (f.fee.value.trim()) {
      fee = parseAmount(f.fee.value);
      if (fee == null) {
        errors.push('Fee-এর মান ঠিক নেই।');
        fee = 0;
      }
    }

    const iso = dhakaLocalToIso(f.datetime.value);
    if (!iso) errors.push('তারিখ ও সময় দিন।');
    else if (new Date(iso).getTime() > Date.now() + 5 * 60 * 1000) {
      errors.push('তারিখ-সময় ভবিষ্যতের হতে পারে না।');
    }

    const trx = f.trx_id.value.trim().toUpperCase();
    if (trx && !/^[A-Z0-9]{6,20}$/.test(trx)) {
      errors.push('TrxID-তে শুধু ইংরেজি অক্ষর ও সংখ্যা (৬–২০টি) থাকতে পারে।');
    }

    let balance = null;
    if (f.balance_after.value.trim()) {
      balance = parseAmount(f.balance_after.value);
      if (balance == null) errors.push('Balance-এর মান ঠিক নেই।');
    }

    const row = errors.length
      ? null
      : {
          sim_id: sim.id,
          service: sim.service,
          transaction_type: 'send_money',
          amount,
          fee,
          sender_number: null,
          receiver_number: receiver,
          reference: f.reference.value.trim().slice(0, 100) || null,
          trx_id: trx || null,
          balance_after: balance,
          transaction_datetime: iso,
          entry_method: 'manual',
          original_sms: null,
          notes: f.notes.value.trim().slice(0, 500) || null,
        };
    return { errors, row };
  }

  function resetFields() {
    for (const name of ['receiver', 'amount', 'fee', 'trx_id', 'balance_after', 'reference', 'notes']) {
      form.elements[name].value = '';
    }
    form.elements.datetime.value = nowDhakaLocal();
  }

  /* ---------- save ---------- */

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;

    const { errors, row } = buildRow();
    showErrors(errors);
    if (errors.length) return;

    busy = true;
    setLoading(saveBtn, true);

    try {
      if (!row.trx_id) {
        const t = new Date(row.transaction_datetime).getTime();
        const exists = await findPossibleDuplicate({
          simId: row.sim_id,
          amount: row.amount,
          isoFrom: new Date(t - 60000).toISOString(),
          isoTo: new Date(t + 60000).toISOString(),
        });
        if (exists) {
          const ok = await confirmDialog({
            title: 'আগে সেভ করা আছে কি?',
            message: 'একই SIM-এ একই amount ও প্রায় একই সময়ের transaction আগে থেকেই আছে। তবুও সেভ করবেন?',
            confirmText: 'হ্যাঁ, সেভ করুন',
          });
          if (!ok) return;
        }
      }

      await insertTransaction(row);
      writeLastSim(row.sim_id);

      toast('Send Money সংরক্ষিত হয়েছে', 'success');
      lastEl.hidden = false;
      lastEl.innerHTML = `
        <p class="text-success"><strong>✓ সংরক্ষিত</strong></p>
        <p>${escapeHtml(formatTaka(row.amount))} → ${escapeHtml(row.receiver_number)}</p>`;

      if (!recent.includes(row.receiver_number)) {
        recent = [row.receiver_number, ...recent].slice(0, 8);
        recentList.innerHTML = recent.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
      }

      resetFields();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await loadLimitStatus();
    } catch (err) {
      console.error(err);
      showErrors([friendlyError(err)]);
    } finally {
      busy = false;
      setLoading(saveBtn, false);
    }
  });

  await loadLimitStatus();
        }

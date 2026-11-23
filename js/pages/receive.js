import { listSimsWithStats } from '../services/sims.js';
import { getServices } from '../services/lookups.js';
import {
  findExistingTrxIds, findPossibleDuplicate, insertTransactions, saveUnparsedSms,
} from '../services/transactions.js';
import { parseSms } from '../parsers/index.js';
import { parseAmount, dhakaLocalToIso } from '../parsers/helpers.js';
import { normalizeBdMobile } from '../utils/phone.js';
import { setLoading } from '../utils/dom.js';
import { escapeHtml, formatTaka } from '../utils/format.js';
import { friendlyError } from '../utils/errors.js';
import { toast } from '../components/toast.js';

const MAX_INPUT = 20000;
const MAX_MESSAGES = 30;
const SENSITIVE_RE = /\b(otp|pin|passcode|password|verification code)\b/i;

const FIELDS = [
  { key: 'amount', label: 'Amount (৳)', inputmode: 'decimal', required: true },
  { key: 'datetime', label: 'তারিখ ও সময়', type: 'datetime-local', required: true },
  { key: 'sender_number', label: 'Sender-এর নম্বর', type: 'tel', inputmode: 'numeric', recommended: true },
  { key: 'trx_id', label: 'TrxID', autocapitalize: 'characters', recommended: true },
  { key: 'balance_after', label: 'Balance (SMS অনুযায়ী)', inputmode: 'decimal' },
];
const EXTRA_FIELDS = [
  { key: 'fee', label: 'Fee (৳)', inputmode: 'decimal' },
  { key: 'reference', label: 'Reference' },
];
const FIELD_BY_KEY = Object.fromEntries([...FIELDS, ...EXTRA_FIELDS].map((f) => [f.key, f]));

export async function renderReceivePage(view) {
  view.innerHTML = '<div class="boot" style="min-height:200px"><span class="spinner"></span></div>';

  let sims;
  let services;
  try {
    [sims, services] = await Promise.all([listSimsWithStats(), getServices()]);
  } catch (err) {
    console.error(err);
    view.innerHTML = `
      <div class="empty-state">
        <h2>লোড করা যায়নি</h2>
        <p class="muted">ইন্টারনেট দেখে পেজ আবার খুলুন।</p>
      </div>`;
    return;
  }
  sims = sims.filter((s) => s.status === 'active');

  if (!sims.length) {
    view.innerHTML = `
      <div class="empty-state">
        <h2>আগে একটি SIM যোগ করুন</h2>
        <p class="muted">Received Money সেভ করতে অন্তত একটি active SIM লাগবে।</p>
        <p style="margin-top:14px"><a class="btn btn-primary" href="#/sims">SIM Management-এ যান</a></p>
      </div>`;
    return;
  }

  const serviceLabel = (code) => services.find((s) => s.code === code)?.label ?? code;

  function simOptions(selectedId, onlyService = null) {
    const codes = onlyService ? [onlyService] : [...new Set(sims.map((s) => s.service))];
    const groups = codes
      .map((code) => {
        const items = sims.filter((s) => s.service === code);
        if (!items.length) return '';
        const opts = items
          .map(
            (s) =>
              `<option value="${escapeHtml(s.id)}" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.sim_name)} · ${escapeHtml(s.mobile_number)}</option>`
          )
          .join('');
        return `<optgroup label="${escapeHtml(serviceLabel(code))}">${opts}</optgroup>`;
      })
      .join('');
    return `<option value="">— SIM বেছে নিন —</option>${groups}`;
  }

  view.innerHTML = `
    <section class="card stack">
      <div class="field">
        <label for="r-sim">যে SIM-এ SMS এসেছে</label>
        <select id="r-sim">${simOptions('')}</select>
      </div>
      <div class="field">
        <label for="r-sms">SMS paste করুন (একাধিক হলে সব একসাথে)</label>
        <textarea id="r-sms" maxlength="${MAX_INPUT}"
          placeholder="bKash বা Nagad-এর Received Money SMS এখানে paste করুন"></textarea>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" id="r-clip" type="button">Clipboard থেকে Paste</button>
        <button class="btn btn-primary" id="r-detect" type="button">Detect Transaction</button>
      </div>
      <p class="form-error" id="r-error" role="alert" hidden></p>
    </section>
    <div id="r-drafts"></div>`;

  const simEl = view.querySelector('#r-sim');
  const smsEl = view.querySelector('#r-sms');
  const detectBtn = view.querySelector('#r-detect');
  const clipBtn = view.querySelector('#r-clip');
  const errEl = view.querySelector('#r-error');
  const draftsEl = view.querySelector('#r-drafts');

  let drafts = [];
  let nextId = 1;
  let busy = false;

  const showError = (msg) => {
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  };

  const money = (n) => (n == null ? '' : Number(n).toFixed(2));

  /* ---------- drafts ---------- */

  function makeDraft(parsed, topSimId) {
    const f = parsed.fields;
    const topSim = sims.find((s) => s.id === topSimId);
    const simId = topSim && (!parsed.service || topSim.service === parsed.service) ? topSim.id : '';
    return {
      id: nextId++,
      raw: parsed.raw,
      recognized: parsed.recognized,
      service: parsed.service,
      simId,
      values: {
        amount: money(f.amount),
        datetime: f.datetime ?? '',
        sender_number: f.sender_number ?? '',
        trx_id: f.trx_id ?? '',
        balance_after: money(f.balance_after),
        fee: money(f.fee),
        reference: f.reference ?? '',
      },
      include: true,
      dup: null,
      dupNote: '',
      errors: [],
    };
  }

  const serviceOf = (d) => d.service ?? sims.find((s) => s.id === d.simId)?.service ?? null;
  const trxOf = (d) => d.values.trx_id.trim().toUpperCase();

  function markDup(d, kind, note) {
    d.dup = kind;
    d.dupNote = note;
    d.include = false;
  }

  async function detectDuplicates(list) {
    // 1) same TrxID twice inside this paste
    const seen = new Set();
    for (const d of list) {
      const svc = serviceOf(d);
      const trx = trxOf(d);
      if (!trx || !svc) continue;
      const key = `${svc}:${trx}`;
      if (seen.has(key)) markDup(d, 'trx', 'এই TrxID এই তালিকাতেই আগে একবার আছে।');
      else seen.add(key);
    }

    // 2) TrxID already saved in the database
    const byService = new Map();
    for (const d of list) {
      const svc = serviceOf(d);
      const trx = trxOf(d);
      if (d.dup || !trx || !svc) continue;
      if (!byService.has(svc)) byService.set(svc, new Set());
      byService.get(svc).add(trx);
    }
    for (const [svc, ids] of byService) {
      const existing = await findExistingTrxIds(svc, [...ids]);
      for (const d of list) {
        if (!d.dup && serviceOf(d) === svc && existing.has(trxOf(d))) {
          markDup(d, 'trx', 'এই TrxID আগে থেকেই সংরক্ষিত আছে।');
        }
      }
    }

    // 3) no TrxID: gentle warning only (same SIM + amount + ±1 minute)
    for (const d of list) {
      if (d.dup || trxOf(d) || !d.simId) continue;
      const amount = parseAmount(d.values.amount);
      const iso = dhakaLocalToIso(d.values.datetime);
      if (amount == null || !iso) continue;
      const t = new Date(iso).getTime();
      const exists = await findPossibleDuplicate({
        simId: d.simId,
        amount,
        isoFrom: new Date(t - 60000).toISOString(),
        isoTo: new Date(t + 60000).toISOString(),
      });
      if (exists) {
        markDup(
          d,
          'possible',
          'TrxID নেই, আর একই SIM-এ একই amount ও প্রায় একই সময়ের transaction আগে থেকেই আছে। আলাদা হলে টিক দিয়ে Save করুন।'
        );
      }
    }
  }

  /* ---------- rendering ---------- */

  const badge = (text, cls) => `<span class="badge ${cls}">${escapeHtml(text)}</span>`;

  function fieldHtml(d, f) {
    const value = d.values[f.key] ?? '';
    const missing = !String(value).trim();
    const cls = missing && f.required ? 'is-missing-required' : missing && f.recommended ? 'is-missing' : '';
    const hint = f.required
      ? 'অবশ্যই দিতে হবে'
      : f.recommended
        ? 'SMS থেকে পাওয়া যায়নি — চাইলে নিজে লিখুন'
        : '';
    const id = `d${d.id}-${f.key}`;
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(f.label)}</label>
        <input id="${id}" data-field="${f.key}" type="${f.type ?? 'text'}"
               ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}
               ${f.autocapitalize ? `autocapitalize="${f.autocapitalize}"` : ''}
               autocomplete="off" class="${cls}" value="${escapeHtml(value)}">
        ${hint ? `<small class="field-hint ${f.required ? 'text-danger' : 'text-warning'}" ${missing ? '' : 'hidden'}>${hint}</small>` : ''}
      </div>`;
  }

  function cardHtml(d, n) {
    if (d.dup === 'trx') {
      const amt = parseAmount(d.values.amount);
      return `
        <article class="card draft draft-dup" data-id="${d.id}">
          <header class="draft-head">
            <strong>SMS #${n}</strong>${badge('Duplicate', 'badge-send')}
          </header>
          <p class="muted">${escapeHtml(d.dupNote)}</p>
          <p class="muted">${amt != null ? `${formatTaka(amt)} · ` : ''}TrxID: ${escapeHtml(d.values.trx_id)}</p>
          <div class="draft-actions">
            <button class="btn btn-ghost btn-sm" data-remove type="button">তালিকা থেকে সরান</button>
          </div>
        </article>`;
    }

    const badges = [];
    if (d.recognized) {
      badges.push(badge(serviceLabel(d.service), `badge-${d.service}`));
      const complete = ['amount', 'datetime', 'trx_id', 'sender_number'].every(
        (k) => String(d.values[k]).trim() !== ''
      );
      badges.push(complete ? badge('সব তথ্য পাওয়া গেছে', 'badge-active') : badge('কিছু তথ্য নেই', 'badge-warn'));
    } else {
      badges.push(badge('চেনা যায়নি', 'badge-warn'));
    }

    const notes = [];
    if (!d.recognized) {
      notes.push('<p class="form-warn">এই SMS-এর ফরম্যাট চেনা যায়নি। চাইলে নিজে তথ্য দিয়ে সেভ করতে পারেন।</p>');
    }
    if (d.service && !sims.some((s) => s.service === d.service)) {
      notes.push(`<p class="form-warn">${escapeHtml(serviceLabel(d.service))}-এর কোনো active SIM নেই। আগে SIM যোগ করুন।</p>`);
    }
    if (d.dup === 'possible') notes.push(`<p class="form-warn">${escapeHtml(d.dupNote)}</p>`);
    if (d.errors.length) {
      notes.push(`<div class="form-error">${d.errors.map(escapeHtml).join('<br>')}</div>`);
    }

    return `
      <article class="card draft ${d.include ? '' : 'is-off'} ${d.errors.length ? 'has-error' : ''}" data-id="${d.id}">
        <header class="draft-head">
          <label class="check">
            <input type="checkbox" data-include ${d.include ? 'checked' : ''}>
            <span>SMS #${n}</span>
          </label>
          <div class="draft-badges">${badges.join('')}</div>
        </header>
        ${notes.join('')}
        <details class="draft-sms">
          <summary>মূল SMS দেখুন</summary>
          <pre>${escapeHtml(d.raw)}</pre>
        </details>
        <div class="field">
          <label for="d${d.id}-sim">কোন SIM-এ এসেছে</label>
          <select id="d${d.id}-sim" data-sim>${simOptions(d.simId, d.service)}</select>
          ${d.service ? `<small class="muted">SMS অনুযায়ী ${escapeHtml(serviceLabel(d.service))} — শুধু ওই service-এর SIM দেখাচ্ছে।</small>` : ''}
        </div>
        <div class="draft-grid">${FIELDS.map((f) => fieldHtml(d, f)).join('')}</div>
        <details class="draft-more">
          <summary>আরও (Fee, Reference)</summary>
          <div class="draft-grid">${EXTRA_FIELDS.map((f) => fieldHtml(d, f)).join('')}</div>
        </details>
        <div class="draft-actions">
          ${d.recognized ? '' : '<button class="btn btn-ghost btn-sm" data-unparsed type="button">Parser উন্নত করতে এই SMS জমা রাখুন</button>'}
          <button class="btn btn-ghost btn-sm" data-remove type="button">বাদ দিন</button>
        </div>
      </article>`;
  }

  function draw() {
    if (!drafts.length) {
      draftsEl.innerHTML = '';
      return;
    }
    draftsEl.innerHTML = `
      <h2 class="section-title">Preview — যাচাই করে Save করুন</h2>
      <div class="draft-list">${drafts.map((d, i) => cardHtml(d, i + 1)).join('')}</div>
      <div class="card sticky-actions">
        <span class="muted" data-summary></span>
        <button class="btn btn-primary" data-save type="button">Save Transaction</button>
      </div>`;
    updateSummary();
  }

  function updateSummary() {
    const summary = draftsEl.querySelector('[data-summary]');
    const saveBtn = draftsEl.querySelector('[data-save]');
    if (!summary || !saveBtn) return;
    const chosen = drafts.filter((d) => d.include && d.dup !== 'trx');
    const total = chosen.reduce((sum, d) => sum + (parseAmount(d.values.amount) ?? 0), 0);
    summary.textContent = chosen.length ? `${chosen.length} টি · মোট ${formatTaka(total)}` : 'কিছু নির্বাচিত নেই';
    saveBtn.disabled = busy || chosen.length === 0;
  }

  /* ---------- detect ---------- */

  async function onDetect() {
    if (busy) return;
    const text = smsEl.value;
    showError('');

    if (!text.trim()) return showError('আগে SMS paste করুন।');
    if (text.length > MAX_INPUT) return showError('লেখা অনেক বড়। কয়েকবারে paste করুন।');

    const parsed = parseSms(text);
    if (!parsed.length) return showError('কোনো SMS পাওয়া যায়নি।');
    if (parsed.length > MAX_MESSAGES) return showError(`একবারে সর্বোচ্চ ${MAX_MESSAGES}টি SMS দিন।`);

    busy = true;
    setLoading(detectBtn, true);
    try {
      drafts = parsed.map((p) => makeDraft(p, simEl.value));
      try {
        await detectDuplicates(drafts);
      } catch (err) {
        console.error(err);
        toast('Duplicate যাচাই করা যায়নি। Save-এর সময় আবার যাচাই হবে।', 'error');
      }
      draw();
      draftsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      busy = false;
      setLoading(detectBtn, false);
      updateSummary();
    }
  }

  detectBtn.addEventListener('click', onDetect);

  clipBtn.addEventListener('click', async () => {
    showError('');
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return showError('Clipboard-এ কিছু নেই।');
      smsEl.value = text.slice(0, MAX_INPUT);
      await onDetect();
    } catch {
      showError('Clipboard পড়া যায়নি। নিচের ঘরে paste করে Detect চাপুন।');
    }
  });

  simEl.addEventListener('change', () => {
    const sim = sims.find((s) => s.id === simEl.value);
    if (!sim || !drafts.length) return;
    for (const d of drafts) {
      if (d.dup === 'trx') continue;
      if (!d.service || d.service === sim.service) d.simId = sim.id;
    }
    draw();
  });

  /* ---------- card events ---------- */

  const draftOf = (el) => drafts.find((d) => String(d.id) === el.closest('[data-id]')?.dataset.id);

  draftsEl.addEventListener('input', (e) => {
    const input = e.target.closest('[data-field]');
    if (!input) return;
    const d = draftOf(input);
    if (!d) return;

    const key = input.dataset.field;
    d.values[key] = input.value;

    const def = FIELD_BY_KEY[key];
    if (def.required || def.recommended) {
      const missing = !input.value.trim();
      input.classList.toggle('is-missing-required', missing && Boolean(def.required));
      input.classList.toggle('is-missing', missing && Boolean(def.recommended));
      const hint = input.parentElement.querySelector('.field-hint');
      if (hint) hint.hidden = !missing;
    }
    if (key === 'amount') updateSummary();
  });

  draftsEl.addEventListener('change', (e) => {
    const d = draftOf(e.target);
    if (!d) return;

    if (e.target.matches('[data-sim]')) {
      d.simId = e.target.value;
    }
    if (e.target.matches('[data-include]')) {
      d.include = e.target.checked;
      e.target.closest('.draft').classList.toggle('is-off', !d.include);
      updateSummary();
    }
  });

  draftsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.matches('[data-save]')) return onSave();

    const d = draftOf(btn);
    if (!d) return;

    if (btn.matches('[data-remove]')) {
      drafts = drafts.filter((x) => x !== d);
      draw();
    }

    if (btn.matches('[data-unparsed]')) {
      if (SENSITIVE_RE.test(d.raw)) {
        return toast('এতে OTP/PIN-এর মতো শব্দ আছে, তাই জমা রাখা হয়নি।', 'error');
      }
      setLoading(btn, true);
      try {
        await saveUnparsedSms(d.raw);
        toast('SMS জমা রাখা হয়েছে', 'success');
        btn.textContent = 'জমা রাখা হয়েছে';
      } catch (err) {
        console.error(err);
        toast(friendlyError(err), 'error');
        setLoading(btn, false);
      }
    }
  });

  /* ---------- validate & save ---------- */

  function buildRow(d) {
    const errors = [];
    const v = d.values;

    const sim = sims.find((s) => s.id === d.simId);
    if (!sim) errors.push('SIM বেছে নিন।');
    else if (d.service && sim.service !== d.service) {
      errors.push(`এই SMS ${serviceLabel(d.service)}-এর, কিন্তু SIM ${serviceLabel(sim.service)}-এর।`);
    }

    const amount = parseAmount(v.amount);
    if (amount == null || amount <= 0) errors.push('সঠিক Amount দিন (যেমন 1500 বা 1500.50)।');
    else if (amount >= 1e10) errors.push('Amount অনেক বড়।');

    const iso = dhakaLocalToIso(v.datetime);
    if (!iso) errors.push('তারিখ ও সময় দিন।');
    else if (new Date(iso).getTime() > Date.now() + 5 * 60 * 1000) {
      errors.push('তারিখ-সময় ভবিষ্যতের হতে পারে না।');
    }

    let sender = null;
    const rawSender = v.sender_number.trim();
    if (rawSender) {
      const compact = rawSender.replace(/[\s-]/g, '');
      sender = normalizeBdMobile(rawSender) ?? (/^\+?\d{5,15}$/.test(compact) ? compact : null);
      if (!sender) errors.push('Sender-এর নম্বর ঠিক নেই।');
    }

    const trx = v.trx_id.trim().toUpperCase();
    if (trx && !/^[A-Z0-9]{6,20}$/.test(trx)) {
      errors.push('TrxID-তে শুধু ইংরেজি অক্ষর ও সংখ্যা (৬–২০টি) থাকতে পারে।');
    }

    let balance = null;
    if (v.balance_after.trim()) {
      balance = parseAmount(v.balance_after);
      if (balance == null) errors.push('Balance-এর মান ঠিক নেই।');
    }

    let fee = 0;
    if (v.fee.trim()) {
      fee = parseAmount(v.fee);
      if (fee == null) {
        errors.push('Fee-এর মান ঠিক নেই।');
        fee = 0;
      }
    }

    if (SENSITIVE_RE.test(d.raw)) {
      errors.push('এই SMS-এ OTP/PIN-এর মতো শব্দ আছে, তাই সেভ করা যাবে না।');
    }

    const row = errors.length
      ? null
      : {
          sim_id: sim.id,
          service: sim.service,
          transaction_type: 'received',
          amount,
          fee,
          sender_number: sender,
          receiver_number: null,
          reference: v.reference.trim().slice(0, 100) || null,
          trx_id: trx || null,
          balance_after: balance,
          transaction_datetime: iso,
          entry_method: 'sms',
          original_sms: d.raw.slice(0, 2000),
          notes: null,
        };
    return { errors, row };
  }

  async function onSave() {
    if (busy) return;

    const chosen = drafts.filter((d) => d.include && d.dup !== 'trx');
    drafts.forEach((d) => {
      d.errors = [];
    });
    if (!chosen.length) return;

    const items = [];
    let hasError = false;
    for (const d of chosen) {
      const { errors, row } = buildRow(d);
      d.errors = errors;
      if (errors.length) hasError = true;
      else items.push({ d, row });
    }

    const seen = new Set();
    for (const it of items) {
      if (!it.row.trx_id) continue;
      const key = `${it.row.service}:${it.row.trx_id}`;
      if (seen.has(key)) {
        it.d.errors = ['এই TrxID আরেকটি card-এও আছে।'];
        hasError = true;
      } else seen.add(key);
    }

    if (hasError) {
      draw();
      draftsEl.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('কিছু card-এ ভুল আছে, ঠিক করে আবার Save করুন।', 'error');
      return;
    }

    busy = true;
    const saveBtn = draftsEl.querySelector('[data-save]');
    setLoading(saveBtn, true);

    try {
      const { saved, failed } = await insertTransactions(items.map((it) => it.row));
      const failedAt = new Map(failed.map((f) => [f.index, f.error]));
      const savedDrafts = new Set();
      items.forEach((it, i) => {
        if (failedAt.has(i)) it.d.errors = [friendlyError(failedAt.get(i))];
        else savedDrafts.add(it.d);
      });
      drafts = drafts.filter((d) => !savedDrafts.has(d));

      if (failed.length) {
        console.error(failed);
        toast(`${saved}টি সংরক্ষিত, ${failed.length}টি হয়নি।`, 'error');
        draw();
        draftsEl.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        toast(`${saved}টি transaction সংরক্ষিত হয়েছে`, 'success');
        if (drafts.length) draw();
        else {
          smsEl.value = '';
          draftsEl.innerHTML = `
            <div class="card stack">
              <h2 class="text-success">✓ ${saved}টি transaction সংরক্ষিত হয়েছে</h2>
              <p class="muted">SIM Management-এ গিয়ে প্রতিটা SIM-এর মোট দেখতে পারেন। Dashboard ও History পরের ধাপে আসছে।</p>
              <a class="btn btn-ghost btn-block" href="#/sims">SIM Management</a>
            </div>`;
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    } catch (err) {
      console.error(err);
      toast(friendlyError(err), 'error');
    } finally {
      busy = false;
      updateSummary();
    }
  }
}

import { listSimsWithStats } from '../services/sims.js';
import { getServices, getTransactionTypes } from '../services/lookups.js';
import { getReportBySim, getReportByPeriod, getReportTopNumbers } from '../services/reports.js';
import { searchTransactions } from '../services/history.js';
import { PERIODS, resolveRange, rangeToIso, rangeLabel, daysBetween } from '../utils/ranges.js';
import { summarizeBySim, groupByBucket, splitTop, zero } from '../utils/reportData.js';
import { toCsv, downloadCsv } from '../utils/csv.js';
import { dayCaption, monthCaption, toDhakaLocal } from '../utils/dates.js';
import { setLoading } from '../utils/dom.js';
import { escapeHtml, formatTaka } from '../utils/format.js';
import { friendlyError } from '../utils/errors.js';
import { toast } from '../components/toast.js';

const EXPORT_PAGE = 1000;
const EXPORT_MAX = 20000;
const MAX_DAILY_DAYS = 62;

const money = (n) => ({ raw: Number(n).toFixed(2) });

export async function renderReportsPage(view) {
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

  const simOptions = sims.length
    ? services
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
        .join('')
    : '';

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Reports</h2>
        <p class="muted" id="r-range">&nbsp;</p>
      </div>
    </div>

    <section class="card stack" id="r-filters">
      <div class="seg" role="group" aria-label="সময়কাল">
        ${PERIODS.map((p) => `<button type="button" data-period="${p.key}">${p.label}</button>`).join('')}
      </div>

      <div class="form-grid" id="r-custom" hidden>
        <div class="field">
          <label for="r-from">শুরুর তারিখ</label>
          <input id="r-from" data-f="from" type="date">
        </div>
        <div class="field">
          <label for="r-to">শেষের তারিখ</label>
          <input id="r-to" data-f="to" type="date">
        </div>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="r-sim">SIM</label>
          <select id="r-sim" data-f="simId"><option value="">সব SIM</option>${simOptions}</select>
        </div>
        <div class="field">
          <label for="r-service">Service</label>
          <select id="r-service" data-f="service">
            <option value="">সব Service</option>
            ${services.map((s) => `<option value="${escapeHtml(s.code)}">${escapeHtml(s.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="r-group">ভাগ করুন</label>
          <select id="r-group" data-f="group">
            <option value="day">দিন অনুযায়ী</option>
            <option value="month">মাস অনুযায়ী</option>
          </select>
        </div>
      </div>

      <p class="form-error" id="r-error" role="alert" hidden></p>
    </section>

    <div class="btn-row">
      <button class="btn btn-ghost" id="r-csv-report" type="button" disabled>Report CSV</button>
      <button class="btn btn-ghost" id="r-csv-tx" type="button" disabled>Transaction CSV</button>
    </div>

    <div id="r-body"></div>`;

  const filtersEl = view.querySelector('#r-filters');
  const bodyEl = view.querySelector('#r-body');
  const errEl = view.querySelector('#r-error');
  const rangeEl = view.querySelector('#r-range');
  const customEl = view.querySelector('#r-custom');
  const csvReportBtn = view.querySelector('#r-csv-report');
  const csvTxBtn = view.querySelector('#r-csv-tx');

  /* ---------- state ---------- */

  const f = { period: 'month', from: '', to: '', simId: '', service: '', group: 'day' };
  let data = null; // last loaded report
  let loadToken = 0;
  let exporting = false;

  const showError = (msg) => {
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  };

  function autoGroup() {
    if (f.period === 'all') f.group = 'month';
    else if (f.period === 'custom' && f.from && f.to && daysBetween(f.from, f.to) > MAX_DAILY_DAYS) f.group = 'month';
    else f.group = 'day';
  }

  function syncControls() {
    for (const el of filtersEl.querySelectorAll('[data-f]')) el.value = f[el.dataset.f];
    for (const b of filtersEl.querySelectorAll('[data-period]')) {
      b.setAttribute('aria-pressed', String(b.dataset.period === f.period));
    }
    customEl.hidden = f.period !== 'custom';
    view.querySelector('#r-service').disabled = Boolean(f.simId);
  }

  function currentFilter() {
    const range = resolveRange(f.period, f.from, f.to);
    if (range.from && range.to && range.from > range.to) {
      showError('শুরুর তারিখ শেষের তারিখের পরে হতে পারে না।');
      return null;
    }
    if (f.period === 'custom' && !range.from && !range.to) {
      showError('অন্তত একটি তারিখ বাছুন।');
      return null;
    }
    if (f.group === 'day' && range.from && range.to && daysBetween(range.from, range.to) > 366) {
      showError('এক বছরের বেশি সময় "দিন অনুযায়ী" দেখানো যায় না। "মাস অনুযায়ী" বাছুন।');
      return null;
    }
    showError('');
    return { range, ...rangeToIso(range), simId: f.simId, service: f.simId ? '' : f.service };
  }

  /* ---------- load ---------- */

  async function load() {
    const filter = currentFilter();
    if (!filter) return;

    const token = ++loadToken;
    csvReportBtn.disabled = true;
    csvTxBtn.disabled = true;
    bodyEl.innerHTML = '<div class="boot" style="min-height:200px"><span class="spinner"></span></div>';

    try {
      const [simRows, periodRows, topRows] = await Promise.all([
        getReportBySim(filter),
        getReportByPeriod(filter, f.group),
        getReportTopNumbers(filter, 10),
      ]);
      if (token !== loadToken) return;

      const { sum, bySim } = summarizeBySim(simRows, dirOf);
      data = {
        filter,
        group: f.group,
        sum,
        bySim,
        buckets: groupByBucket(periodRows, dirOf),
        top: splitTop(topRows),
      };
      rangeEl.textContent = `${rangeLabel(filter.range)} · বাংলাদেশ সময়`;
      draw();
      csvReportBtn.disabled = false;
      csvTxBtn.disabled = false;
    } catch (err) {
      console.error(err);
      if (token !== loadToken) return;
      const missingFn = err?.code === 'PGRST202';
      bodyEl.innerHTML = `
        <div class="empty-state">
          <h2>Report লোড করা যায়নি</h2>
          <p class="muted">${
            missingFn
              ? 'Database function পাওয়া যায়নি। supabase/007_reports.sql চালিয়েছেন কি?'
              : 'ইন্টারনেট দেখে আবার চেষ্টা করুন।'
          }</p>
        </div>`;
    }
  }

  /* ---------- draw ---------- */

  const bucketLabel = (bucket, group) =>
    group === 'month' ? monthCaption(bucket) : `${dayCaption(bucket)} ${bucket.slice(0, 4)}`;

  const net = (a) => a.in.total - a.out.total;
  const netClass = (n) => (n >= 0 ? 'text-success' : 'text-danger');

  const numsHtml = (a) => `
    <span class="text-success">Received ${a.in.count} টি · ${formatTaka(a.in.total)}</span>
    <span class="text-danger">Send ${a.out.count} টি · ${formatTaka(a.out.total)}</span>`;

  function topList(items) {
    if (!items.length) return '<p class="muted">কোনো তথ্য নেই।</p>';
    return `<ol class="top-list">${items
      .map(
        (t) => `
        <li>
          <span><strong>${escapeHtml(t.number)}</strong><br><span class="muted">${t.count} টি</span></span>
          <strong>${escapeHtml(formatTaka(t.total))}</strong>
        </li>`
      )
      .join('')}</ol>`;
  }

  function draw() {
    const { sum, bySim, buckets, group, top } = data;

    const hasAny = sum.in.count + sum.out.count > 0;
    if (!hasAny) {
      bodyEl.innerHTML = `
        <div class="empty-state">
          <h2>এই সময়ে কোনো transaction নেই</h2>
          <p class="muted">সময়কাল বা ফিল্টার বদলে দেখুন।</p>
        </div>`;
      return;
    }

    const total = net(sum);

    // per service
    const serviceRows = services
      .map((svc) => {
        const agg = { in: zero(), out: zero() };
        for (const [simId, a] of bySim) {
          if (simById.get(simId)?.service !== svc.code) continue;
          for (const d of ['in', 'out']) {
            agg[d].count += a[d].count;
            agg[d].total += a[d].total;
          }
        }
        if (!agg.in.count && !agg.out.count) return '';
        return `
          <div class="rowitem">
            <div class="rowitem-head"><span class="badge badge-${escapeHtml(svc.code)}">${escapeHtml(svc.label)}</span>
              <strong class="${netClass(net(agg))}">নিট ${escapeHtml(formatTaka(net(agg)))}</strong></div>
            <div class="rowitem-nums">${numsHtml(agg)}</div>
          </div>`;
      })
      .join('');

    // per SIM
    const simRows = [...bySim.entries()]
      .map(([simId, a]) => ({ sim: simById.get(simId), a }))
      .sort((x, y) => y.a.in.total + y.a.out.total - (x.a.in.total + x.a.out.total))
      .map(
        ({ sim, a }) => `
        <div class="rowitem">
          <div class="rowitem-head">
            <strong>${escapeHtml(sim?.sim_name ?? 'অজানা SIM')}</strong>
            <span class="badge badge-${escapeHtml(sim?.service ?? '')}">${escapeHtml(serviceLabel(sim?.service ?? ''))}</span>
          </div>
          <p class="muted">${escapeHtml(sim?.mobile_number ?? '')}</p>
          <div class="rowitem-nums">${numsHtml(a)}</div>
          <p>নিট: <strong class="${netClass(net(a))}">${escapeHtml(formatTaka(net(a)))}</strong></p>
        </div>`
      )
      .join('');

    // per day / month
    const bucketRows = buckets
      .map(
        (b) => `
        <tr>
          <td>${escapeHtml(bucketLabel(b.bucket, group))}</td>
          <td class="num"><span class="text-success">${escapeHtml(formatTaka(b.in.total))}</span><small class="muted">${b.in.count} টি</small></td>
          <td class="num"><span class="text-danger">${escapeHtml(formatTaka(b.out.total))}</span><small class="muted">${b.out.count} টি</small></td>
          <td class="num"><span class="${netClass(net(b))}">${escapeHtml(formatTaka(net(b)))}</span></td>
        </tr>`
      )
      .join('');

    bodyEl.innerHTML = `
      <div class="stat-grid">
        <div class="card stat">
          <span class="muted">Received</span>
          <strong class="text-success">${formatTaka(sum.in.total)}</strong>
          <small class="muted">${sum.in.count} টি</small>
        </div>
        <div class="card stat">
          <span class="muted">Send</span>
          <strong class="text-danger">${formatTaka(sum.out.total)}</strong>
          <small class="muted">${sum.out.count} টি</small>
        </div>
        <div class="card stat">
          <span class="muted">নিট (Received − Send)</span>
          <strong class="${netClass(total)}">${formatTaka(total)}</strong>
        </div>
        <div class="card stat">
          <span class="muted">মোট Fee</span>
          <strong>${formatTaka(sum.fee)}</strong>
        </div>
      </div>

      <section class="card stack">
        <h2>Service অনুযায়ী</h2>
        <div class="rowlist">${serviceRows}</div>
      </section>

      <section class="card stack">
        <h2>SIM-ভিত্তিক হিসাব</h2>
        <div class="rowlist">${simRows}</div>
      </section>

      <section class="card stack">
        <h2>${group === 'month' ? 'মাস অনুযায়ী' : 'দিন অনুযায়ী'}</h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>${group === 'month' ? 'মাস' : 'তারিখ'}</th><th class="num">Received</th><th class="num">Send</th><th class="num">নিট</th></tr></thead>
            <tbody>${bucketRows}</tbody>
            <tfoot>
              <tr>
                <td>মোট</td>
                <td class="num"><span class="text-success">${escapeHtml(formatTaka(sum.in.total))}</span><small class="muted">${sum.in.count} টি</small></td>
                <td class="num"><span class="text-danger">${escapeHtml(formatTaka(sum.out.total))}</span><small class="muted">${sum.out.count} টি</small></td>
                <td class="num"><span class="${netClass(total)}">${escapeHtml(formatTaka(total))}</span></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section class="card stack">
        <h2>শীর্ষ Sender (যাদের কাছ থেকে পেয়েছেন)</h2>
        ${topList(top.in)}
      </section>

      <section class="card stack">
        <h2>শীর্ষ Receiver (যাদের পাঠিয়েছেন)</h2>
        ${topList(top.out)}
      </section>`;
  }

  /* ---------- CSV export ---------- */

  const fileSuffix = (range) => `${range.from || 'start'}_${range.to || 'today'}`;

  function exportReport() {
    const { filter, sum, bySim, buckets, group } = data;
    const rows = [];

    rows.push(['MFS Business Manager - Report']);
    rows.push(['Period', rangeLabel(filter.range)]);
    rows.push(['SIM', filter.simId ? simById.get(filter.simId)?.sim_name ?? '' : 'All']);
    rows.push(['Service', filter.service ? serviceLabel(filter.service) : 'All']);
    rows.push([]);

    rows.push(['Summary']);
    rows.push(['Metric', 'Count', 'Amount']);
    rows.push(['Received', sum.in.count, money(sum.in.total)]);
    rows.push(['Send', sum.out.count, money(sum.out.total)]);
    rows.push(['Net (Received - Send)', '', money(sum.in.total - sum.out.total)]);
    rows.push(['Total Fee', '', money(sum.fee)]);
    rows.push([]);

    rows.push(['By SIM']);
    rows.push(['SIM Name', 'SIM Number', 'Service', 'Received Count', 'Received Amount', 'Send Count', 'Send Amount', 'Net']);
    for (const [simId, a] of bySim) {
      const sim = simById.get(simId);
      rows.push([
        sim?.sim_name ?? '',
        { text: sim?.mobile_number ?? '' },
        serviceLabel(sim?.service ?? ''),
        a.in.count, money(a.in.total), a.out.count, money(a.out.total),
        money(a.in.total - a.out.total),
      ]);
    }
    rows.push([]);

    rows.push([group === 'month' ? 'By Month' : 'By Day']);
    rows.push([group === 'month' ? 'Month' : 'Date', 'Received Count', 'Received Amount', 'Send Count', 'Send Amount', 'Net']);
    for (const b of [...buckets].reverse()) {
      rows.push([b.bucket, b.in.count, money(b.in.total), b.out.count, money(b.out.total), money(b.in.total - b.out.total)]);
    }

    downloadCsv(`report_${fileSuffix(filter.range)}.csv`, toCsv(rows));
    toast('Report CSV নামানো হয়েছে', 'success');
  }

  async function fetchAllTransactions(filter) {
    const query = {
      status: 'active',
      simId: filter.simId,
      service: filter.service,
      type: '',
      fromIso: filter.fromIso,
      toIso: filter.toIso,
      minAmount: null,
      maxAmount: null,
      search: '',
    };
    const all = [];
    let offset = 0;
    let count = 0;
    while (all.length < EXPORT_MAX) {
      const res = await searchTransactions(query, { offset, limit: EXPORT_PAGE });
      count = res.count;
      all.push(...res.rows);
      offset += EXPORT_PAGE;
      if (res.rows.length < EXPORT_PAGE || all.length >= count) break;
    }
    return { rows: all.slice(0, EXPORT_MAX), count };
  }

  async function exportTransactions() {
    if (exporting) return;
    exporting = true;
    setLoading(csvTxBtn, true);
    try {
      const { filter } = data;
      const { rows, count } = await fetchAllTransactions(filter);
      if (!rows.length) {
        toast('এই সময়ে কোনো transaction নেই', 'error');
        return;
      }

      const out = [[
        'Date', 'Time', 'Service', 'SIM Name', 'SIM Number', 'Type', 'Amount', 'Fee',
        'Sender', 'Receiver', 'TrxID', 'Reference', 'Balance After', 'Entry Method', 'Note', 'Status',
      ]];
      for (const tx of rows) {
        const local = toDhakaLocal(tx.transaction_datetime);
        const sim = simById.get(tx.sim_id);
        out.push([
          local.slice(0, 10),
          local.slice(11),
          serviceLabel(tx.service),
          sim?.sim_name ?? '',
          { text: sim?.mobile_number ?? '' },
          typeLabel(tx.transaction_type),
          money(tx.amount),
          money(tx.fee),
          { text: tx.sender_number ?? '' },
          { text: tx.receiver_number ?? '' },
          { text: tx.trx_id ?? '' },
          tx.reference ?? '',
          tx.balance_after != null ? money(tx.balance_after) : '',
          tx.entry_method === 'sms' ? 'SMS' : 'Manual',
          tx.notes ?? '',
          tx.status === 'voided' ? 'Voided' : 'Active',
        ]);
      }

      downloadCsv(`transactions_${fileSuffix(filter.range)}.csv`, toCsv(out));
      toast(
        count > rows.length
          ? `প্রথম ${rows.length}টি নামানো হয়েছে (মোট ${count}টি)। সময়কাল ছোট করে আবার নামান।`
          : `${rows.length}টি transaction নামানো হয়েছে`,
        count > rows.length ? 'error' : 'success'
      );
    } catch (err) {
      console.error(err);
      toast(friendlyError(err), 'error');
    } finally {
      exporting = false;
      setLoading(csvTxBtn, false);
    }
  }

  csvReportBtn.addEventListener('click', () => data && exportReport());
  csvTxBtn.addEventListener('click', () => data && exportTransactions());

  /* ---------- events ---------- */

  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    f.period = btn.dataset.period;
    autoGroup();
    syncControls();
    if (f.period !== 'custom' || f.from || f.to) load();
  });

  filtersEl.addEventListener('change', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    f[el.dataset.f] = el.value;

    if (el.dataset.f === 'simId' && f.simId) f.service = '';
    if (el.dataset.f === 'from' || el.dataset.f === 'to') autoGroup();

    syncControls();
    load();
  });

  syncControls();
  await load();
    }

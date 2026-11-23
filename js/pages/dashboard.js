import { listSimsWithStats } from '../services/sims.js';
import { getServices, getTransactionTypes } from '../services/lookups.js';
import {
  getPeriodTotals, getDailyTotals, getMonthlyTotals, getAllSimUsage, listActiveLimits,
} from '../services/reports.js';
import { computeLimitStatus, describeLimit, limitValueText } from '../services/limits.js';
import { renderBarChart } from '../components/charts.js';
import {
  nowDhakaLocal, lastNDays, lastNMonths, shortDayLabel, dayCaption, monthLabel, monthCaption,
} from '../utils/dates.js';
import { escapeHtml, formatTaka } from '../utils/format.js';

const PERIODS = [
  { key: 'today', label: 'আজ' },
  { key: 'month', label: 'এই মাস' },
  { key: 'last_month', label: 'গত মাস' },
  { key: 'all', label: 'সব' },
];
const DAYS = 14;
const MONTHS = 6;

const zero = () => ({ count: 0, total: 0 });

export async function renderDashboardPage(view) {
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h2>সারসংক্ষেপ</h2>
        <p class="muted" id="d-note">বাংলাদেশ সময় অনুযায়ী</p>
      </div>
      <button class="btn btn-ghost btn-sm" id="d-refresh" type="button">রিফ্রেশ</button>
    </div>
    <div id="d-body"></div>`;

  const bodyEl = view.querySelector('#d-body');
  const noteEl = view.querySelector('#d-note');
  const refreshBtn = view.querySelector('#d-refresh');

  let period = 'month';
  let periodToken = 0;
  let state = null;

  const dirOf = (code) => state.types.find((t) => t.code === code)?.direction ?? null;
  const serviceLabel = (code) => state.services.find((s) => s.code === code)?.label ?? code;

  /* ---------- load ---------- */

  async function load() {
    bodyEl.innerHTML = '<div class="boot" style="min-height:200px"><span class="spinner"></span></div>';
    refreshBtn.disabled = true;
    try {
      const [sims, services, types, totals, daily, monthly, usage, limits] = await Promise.all([
        listSimsWithStats(),
        getServices(),
        getTransactionTypes(),
        getPeriodTotals(period),
        getDailyTotals(DAYS),
        getMonthlyTotals(MONTHS),
        getAllSimUsage(),
        listActiveLimits(),
      ]);
      state = { sims, services, types, totals, daily, monthly, usage, limits };
      drawAll();
      noteEl.textContent = `বাংলাদেশ সময় অনুযায়ী · আপডেট ${nowDhakaLocal().slice(11)}`;
    } catch (err) {
      console.error(err);
      const missingFn = err?.code === 'PGRST202';
      bodyEl.innerHTML = `
        <div class="empty-state">
          <h2>Dashboard লোড করা যায়নি</h2>
          <p class="muted">${
            missingFn
              ? 'Database function পাওয়া যায়নি। supabase/006_dashboard.sql চালিয়েছেন কি?'
              : 'ইন্টারনেট দেখে আবার চেষ্টা করুন।'
          }</p>
          <p style="margin-top:14px"><button class="btn btn-primary" data-retry type="button">আবার চেষ্টা করুন</button></p>
        </div>`;
    } finally {
      refreshBtn.disabled = false;
    }
  }

  async function loadPeriod() {
    const token = ++periodToken;
    try {
      const totals = await getPeriodTotals(period);
      if (token !== periodToken) return;
      state.totals = totals;
      drawPeriodSections();
    } catch (err) {
      console.error(err);
    }
  }

  /* ---------- draw ---------- */

  function drawAll() {
    bodyEl.innerHTML = `
      <div class="seg" id="d-periods" role="group" aria-label="সময়কাল">
        ${PERIODS.map(
          (p) => `<button type="button" data-period="${p.key}" aria-pressed="${p.key === period}">${p.label}</button>`
        ).join('')}
      </div>

      <div id="d-summary"></div>

      <section class="card stack">
        <h2>Limit পর্যবেক্ষণ</h2>
        <div id="d-limits" class="stack"></div>
      </section>

      <section class="card stack">
        <h2>Service অনুযায়ী</h2>
        <div id="d-services" class="rowlist"></div>
      </section>

      <section class="card stack">
        <h2>SIM-ভিত্তিক হিসাব</h2>
        <div id="d-sims" class="rowlist"></div>
      </section>

      <section class="card stack">
        <h2>শেষ ${DAYS} দিন</h2>
        <div id="d-chart-days"></div>
      </section>

      <section class="card stack">
        <h2>মাসিক ট্রেন্ড (${MONTHS} মাস)</h2>
        <div id="d-chart-months"></div>
      </section>`;

    drawPeriodSections();
    drawLimits();
    drawCharts();
  }

  function drawPeriodSections() {
    const { sims, services, totals } = state;

    const sum = { in: zero(), out: zero(), fee: 0 };
    const bySim = new Map();
    for (const r of totals) {
      const dir = dirOf(r.tx_type);
      if (!dir) continue;
      const count = Number(r.tx_count);
      const total = Number(r.tx_total);
      sum[dir].count += count;
      sum[dir].total += total;
      sum.fee += Number(r.fee_total);

      const a = bySim.get(r.sim_id) ?? { in: zero(), out: zero() };
      a[dir].count += count;
      a[dir].total += total;
      bySim.set(r.sim_id, a);
    }

    const net = sum.in.total - sum.out.total;
    const activeSims = sims.filter((s) => s.status === 'active');
    const known = activeSims.filter((s) => s.stats.latest_balance != null);
    const balanceTotal = known.reduce((acc, s) => acc + Number(s.stats.latest_balance), 0);

    bodyEl.querySelector('#d-summary').innerHTML = `
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
          <strong class="${net >= 0 ? 'text-success' : 'text-danger'}">${formatTaka(net)}</strong>
        </div>
        <div class="card stat">
          <span class="muted">মোট Fee</span>
          <strong>${formatTaka(sum.fee)}</strong>
        </div>
      </div>
      <div class="card stat" style="margin-top:12px">
        <span class="muted">সর্বশেষ জানা মোট Balance</span>
        <strong>${known.length ? formatTaka(balanceTotal) : '—'}</strong>
        <small class="muted">${
          known.length
            ? `${activeSims.length}টির মধ্যে ${known.length}টি SIM-এর শেষ entry-র balance অনুযায়ী`
            : 'কোনো entry-তে balance নেই'
        }</small>
      </div>`;

    const numsHtml = (a) => `
      <span class="text-success">Received ${a.in.count} টি · ${formatTaka(a.in.total)}</span>
      <span class="text-danger">Send ${a.out.count} টি · ${formatTaka(a.out.total)}</span>`;

    // per service
    bodyEl.querySelector('#d-services').innerHTML = services
      .map((svc) => {
        const agg = { in: zero(), out: zero() };
        for (const s of sims.filter((x) => x.service === svc.code)) {
          const a = bySim.get(s.id);
          if (!a) continue;
          for (const d of ['in', 'out']) {
            agg[d].count += a[d].count;
            agg[d].total += a[d].total;
          }
        }
        return `
          <div class="rowitem">
            <div class="rowitem-head"><span class="badge badge-${escapeHtml(svc.code)}">${escapeHtml(svc.label)}</span></div>
            <div class="rowitem-nums">${numsHtml(agg)}</div>
          </div>`;
      })
      .join('');

    // per SIM
    const shown = sims.filter((s) => s.status === 'active' || bySim.has(s.id));
    bodyEl.querySelector('#d-sims').innerHTML = shown.length
      ? shown
          .map((s) => {
            const a = bySim.get(s.id) ?? { in: zero(), out: zero() };
            return `
              <div class="rowitem">
                <div class="rowitem-head">
                  <strong>${escapeHtml(s.sim_name)}</strong>
                  <span>
                    <span class="badge badge-${escapeHtml(s.service)}">${escapeHtml(serviceLabel(s.service))}</span>
                    ${s.status === 'active' ? '' : '<span class="badge badge-inactive">Inactive</span>'}
                  </span>
                </div>
                <p class="muted">${escapeHtml(s.mobile_number)}</p>
                <div class="rowitem-nums">${numsHtml(a)}</div>
                ${
                  s.stats.latest_balance != null
                    ? `<p class="muted">সর্বশেষ জানা balance: <strong>${formatTaka(s.stats.latest_balance)}</strong></p>`
                    : ''
                }
              </div>`;
          })
          .join('')
      : `<p class="muted">কোনো SIM নেই। <a href="#/sims">SIM যোগ করুন</a></p>`;
  }

  /* ---------- limits ---------- */

  function collectLimitRows() {
    const { sims, usage, limits } = state;
    const rows = [];

    for (const sim of sims.filter((s) => s.status === 'active')) {
      const simLimits = limits.filter((l) => l.sim_id === sim.id);
      if (!simLimits.length) continue;
      const simUsage = usage.filter((u) => u.sim_id === sim.id);

      for (const { limit, used } of computeLimitStatus(simLimits, simUsage)) {
        rows.push({ sim, limit, used });
      }
      if (sim.stats.latest_balance != null) {
        for (const l of simLimits.filter((x) => x.limit_type === 'balance')) {
          rows.push({ sim, limit: l, used: Number(sim.stats.latest_balance) });
        }
      }
    }

    return rows
      .map((r) => {
        const ratio = (r.used * 100) / Number(r.limit.limit_value);
        const level = ratio >= 100 ? 'over' : ratio >= r.limit.warn_percent ? 'warn' : 'ok';
        return { ...r, ratio, level };
      })
      .sort((a, b) => b.ratio - a.ratio);
  }

  function limitItem(r) {
    const badge =
      r.level === 'over'
        ? '<span class="badge badge-send">সীমা ছাড়িয়েছে</span>'
        : r.level === 'warn'
          ? '<span class="badge badge-warn">সতর্কতা</span>'
          : '<span class="badge badge-active">ঠিক আছে</span>';
    const typeLabel = (code) => state.types.find((t) => t.code === code)?.label ?? code;
    return `
      <div class="limit-item">
        <div class="limit-item-head">
          <strong>${escapeHtml(r.sim.sim_name)} · ${escapeHtml(describeLimit(r.limit, typeLabel))}</strong>${badge}
        </div>
        <div class="meter ${r.level}"><span style="width:${Math.min(100, Math.round(r.ratio))}%"></span></div>
        <p class="muted">এখন ${escapeHtml(limitValueText(r.limit, r.used))} · সীমা ${escapeHtml(limitValueText(r.limit))} (${Math.round(r.ratio)}%)</p>
      </div>`;
  }

  function drawLimits() {
    const box = bodyEl.querySelector('#d-limits');
    const rows = collectLimitRows();

    if (!rows.length) {
      box.innerHTML =
        '<p class="muted">কোনো limit সেট করা নেই। SIM Management → Limits থেকে যোগ করুন।</p>';
      return;
    }

    const alerts = rows.filter((r) => r.level !== 'ok');
    box.innerHTML = `
      ${alerts.length ? alerts.map(limitItem).join('') : '<p class="text-success">✓ সব limit ঠিক আছে।</p>'}
      <details>
        <summary>সব limit দেখুন (${rows.length}টি)</summary>
        <div class="stack" style="margin-top:12px">${rows.map(limitItem).join('')}</div>
      </details>
      <p class="muted">এটা শুধু আপনার নিজের নজরদারির জন্য।</p>`;
  }

  /* ---------- charts ---------- */

  function sumByKey(rows, keyField) {
    const map = new Map();
    for (const r of rows) {
      const dir = dirOf(r.tx_type);
      if (!dir) continue;
      const key = `${r[keyField]}|${dir}`;
      map.set(key, (map.get(key) ?? 0) + Number(r.tx_total));
    }
    return map;
  }

  function drawCharts() {
    const seriesOf = (keys, map) => [
      { name: 'Received', cls: 'bar-in', legendCls: 'legend-in', values: keys.map((k) => map.get(`${k}|in`) ?? 0) },
      { name: 'Send', cls: 'bar-out', legendCls: 'legend-out', values: keys.map((k) => map.get(`${k}|out`) ?? 0) },
    ];
    const sumOf = (s) => s.values.reduce((a, b) => a + b, 0);

    const days = lastNDays(DAYS);
    const dayMap = sumByKey(state.daily, 'tx_day');
    const daySeries = seriesOf(days, dayMap);
    renderBarChart(bodyEl.querySelector('#d-chart-days'), {
      labels: days.map(shortDayLabel),
      captions: days.map(
        (d, i) =>
          `${dayCaption(d)} · Received ${formatTaka(daySeries[0].values[i])} · Send ${formatTaka(daySeries[1].values[i])}`
      ),
      series: daySeries,
      defaultCaption: `${DAYS} দিনে: Received ${formatTaka(sumOf(daySeries[0]))} · Send ${formatTaka(sumOf(daySeries[1]))}। কোনো কলামে ট্যাপ করলে ওই দিনের হিসাব দেখাবে।`,
      ariaLabel: `শেষ ${DAYS} দিনের Received ও Send`,
      barMax: 10,
    });

    const months = lastNMonths(MONTHS);
    const monthMap = sumByKey(state.monthly, 'tx_month');
    const monthSeries = seriesOf(months, monthMap);
    renderBarChart(bodyEl.querySelector('#d-chart-months'), {
      labels: months.map(monthLabel),
      captions: months.map(
        (m, i) =>
          `${monthCaption(m)} · Received ${formatTaka(monthSeries[0].values[i])} · Send ${formatTaka(monthSeries[1].values[i])}`
      ),
      series: monthSeries,
      defaultCaption: `${MONTHS} মাসে: Received ${formatTaka(sumOf(monthSeries[0]))} · Send ${formatTaka(sumOf(monthSeries[1]))}। কোনো কলামে ট্যাপ করলে ওই মাসের হিসাব দেখাবে।`,
      ariaLabel: `শেষ ${MONTHS} মাসের Received ও Send`,
      barMax: 18,
    });
  }

  /* ---------- events ---------- */

  bodyEl.addEventListener('click', async (e) => {
    if (e.target.closest('[data-retry]')) return load();

    const btn = e.target.closest('[data-period]');
    if (!btn || btn.dataset.period === period) return;
    period = btn.dataset.period;
    bodyEl.querySelectorAll('[data-period]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.period === period));
    });
    await loadPeriod();
  });

  refreshBtn.addEventListener('click', load);

  await load();
                                                     }

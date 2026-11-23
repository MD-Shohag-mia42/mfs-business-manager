import { escapeHtml } from '../utils/format.js';

const W = 360;
const H = 220;
const PAD = { l: 42, r: 6, t: 8, b: 24 };
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

function niceMax(v) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * exp;
}

// Self-drawn SVG grouped bar chart. Colors come from CSS variables,
// so it follows light/dark mode automatically. Tap a column to see its numbers.
// series: [{ name, values, cls, legendCls }]
export function renderBarChart(container, { labels, captions, series, defaultCaption, ariaLabel, barMax = 18 }) {
  const rawMax = Math.max(0, ...series.flatMap((s) => s.values));
  if (rawMax <= 0) {
    container.innerHTML = '<p class="muted">এই সময়ে কোনো transaction নেই।</p>';
    return;
  }

  const n = labels.length;
  const max = niceMax(rawMax);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const groupW = plotW / n;
  const k = series.length;
  const gap = 2;
  const barW = Math.min(groupW * 0.36, barMax);
  const clusterW = barW * k + gap * (k - 1);
  const yOf = (v) => PAD.t + plotH - (v / max) * plotH;

  const grid = [0, 1, 2, 3, 4]
    .map((i) => {
      const v = (max * i) / 4;
      const y = yOf(v).toFixed(1);
      return `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/>
        <text class="axis" x="${PAD.l - 5}" y="${(yOf(v) + 3.5).toFixed(1)}" text-anchor="end">${compact.format(v)}</text>`;
    })
    .join('');

  const groups = labels
    .map((label, i) => {
      const gx = PAD.l + i * groupW;
      const start = gx + (groupW - clusterW) / 2;
      const bars = series
        .map((s, j) => {
          const v = s.values[i];
          const h = (v / max) * plotH;
          if (!(h > 0)) return '';
          return `<rect class="${s.cls}" x="${(start + j * (barW + gap)).toFixed(1)}" y="${yOf(v).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
        })
        .join('');
      return `<g class="grp" data-i="${i}">
        <rect class="hit" x="${gx.toFixed(1)}" y="${PAD.t}" width="${groupW.toFixed(1)}" height="${plotH + PAD.b}"/>
        ${bars}
        <text class="axis" x="${(gx + groupW / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${escapeHtml(label)}</text>
      </g>`;
    })
    .join('');

  container.innerHTML = `
    <div class="chart-legend">
      ${series.map((s) => `<span><i class="${s.legendCls}"></i>${escapeHtml(s.name)}</span>`).join('')}
    </div>
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(ariaLabel)}">${grid}${groups}</svg>
    <p class="chart-caption muted" aria-live="polite"></p>`;

  const caption = container.querySelector('.chart-caption');
  caption.textContent = defaultCaption;

  container.querySelector('svg').addEventListener('click', (e) => {
    const group = e.target.closest('[data-i]');
    if (!group) return;
    container.querySelectorAll('.grp').forEach((el) => el.classList.toggle('active', el === group));
    caption.textContent = captions[Number(group.dataset.i)] ?? defaultCaption;
  });
    }

export const zero = () => ({ count: 0, total: 0 });

// rows: [{ sim_id, tx_type, tx_count, tx_total, fee_total }]
// dirOf(type) -> 'in' | 'out' | null
export function summarizeBySim(rows, dirOf) {
  const sum = { in: zero(), out: zero(), fee: 0 };
  const bySim = new Map();

  for (const r of rows) {
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
  return { sum, bySim };
}

// rows: [{ bucket, tx_type, tx_count, tx_total }]  ->  newest bucket first
export function groupByBucket(rows, dirOf) {
  const map = new Map();
  for (const r of rows) {
    const dir = dirOf(r.tx_type);
    if (!dir) continue;
    const entry = map.get(r.bucket) ?? { bucket: r.bucket, in: zero(), out: zero() };
    entry[dir].count += Number(r.tx_count);
    entry[dir].total += Number(r.tx_total);
    map.set(r.bucket, entry);
  }
  return [...map.values()].sort((a, b) => (a.bucket < b.bucket ? 1 : a.bucket > b.bucket ? -1 : 0));
}

// rows: [{ direction, party_number, tx_count, tx_total }] (already ranked by the database)
export function splitTop(rows) {
  const out = { in: [], out: [] };
  for (const r of rows) {
    if (r.direction !== 'in' && r.direction !== 'out') continue;
    out[r.direction].push({ number: r.party_number, count: Number(r.tx_count), total: Number(r.tx_total) });
  }
  return out;
}

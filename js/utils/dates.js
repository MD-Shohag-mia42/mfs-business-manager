const MONTHS = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];
const MONTHS_SHORT = [
  'জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে',
];

// Current Dhaka time as "YYYY-MM-DDTHH:mm" (value for <input type="datetime-local">)
export function nowDhakaLocal(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Today's date in Dhaka: "YYYY-MM-DD"
export function dhakaToday() {
  return nowDhakaLocal().slice(0, 10);
}

export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// ["2026-11-10", ..., "2026-11-23"]  (oldest first, ends today)
export function lastNDays(n) {
  const today = dhakaToday();
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

// ["2026-06-01", ..., "2026-11-01"]  (first day of each month, oldest first)
export function lastNMonths(n) {
  const [y, m] = dhakaToday().split('-').map(Number);
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 10)
  );
}

export const shortDayLabel = (dateStr) => String(Number(dateStr.slice(8, 10)));

export function dayCaption(dateStr) {
  return `${Number(dateStr.slice(8, 10))} ${MONTHS[Number(dateStr.slice(5, 7)) - 1]}`;
}

export const monthLabel = (dateStr) => MONTHS_SHORT[Number(dateStr.slice(5, 7)) - 1];

export function monthCaption(dateStr) {
  return `${MONTHS[Number(dateStr.slice(5, 7)) - 1]} ${dateStr.slice(0, 4)}`;
}

// "2026-11-23" -> "2026-11-01"
export const monthStartOf = (dateStr) => `${dateStr.slice(0, 7)}-01`;

// Whole previous month (Dhaka): { from: "2026-10-01", to: "2026-10-31" }
export function prevMonthRange() {
  const start = monthStartOf(dhakaToday());
  const end = addDays(start, -1);
  return { from: monthStartOf(end), to: end };
}

// ISO timestamp from the database -> "YYYY-MM-DDTHH:mm" in Dhaka time
export const toDhakaLocal = (iso) => nowDhakaLocal(new Date(iso));

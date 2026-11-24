import { dhakaToday, addDays, monthStartOf, prevMonthRange } from './dates.js';

export const PERIODS = [
  { key: 'today', label: 'আজ' },
  { key: 'month', label: 'এই মাস' },
  { key: 'last_month', label: 'গত মাস' },
  { key: 'all', label: 'সব' },
  { key: 'custom', label: 'তারিখ বাছুন' },
];

// -> { from: "YYYY-MM-DD" | "", to: "YYYY-MM-DD" | "" }   (Dhaka dates)
export function resolveRange(period, from = '', to = '') {
  const today = dhakaToday();
  switch (period) {
    case 'today': return { from: today, to: today };
    case 'month': return { from: monthStartOf(today), to: today };
    case 'last_month': return prevMonthRange();
    case 'custom': return { from, to };
    default: return { from: '', to: '' };
  }
}

// Dhaka dates -> timestamps for the database ("to" is inclusive, so +1 day exclusive)
export function rangeToIso({ from, to }) {
  return {
    fromIso: from ? `${from}T00:00:00+06:00` : null,
    toIso: to ? `${addDays(to, 1)}T00:00:00+06:00` : null,
  };
}

export const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

export function rangeLabel({ from, to }) {
  if (!from && !to) return 'সব সময়';
  if (from && to) return from === to ? from : `${from} থেকে ${to}`;
  return from ? `${from} থেকে` : `${to} পর্যন্ত`;
}

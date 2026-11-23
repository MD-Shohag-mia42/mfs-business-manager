const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

// Cleans pasted SMS text: Bengali digits -> English, strange spaces and
// control characters removed, line endings unified.
export function normalizeSmsText(input) {
  return String(input ?? '')
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function firstMatch(text, regex) {
  const m = regex.exec(text);
  return m ? m[1] : null;
}

// "2,565.00" -> 2565 ; returns null when it is not a valid money amount
export function parseAmount(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const DATE_RE =
  /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i;

// Finds "dd/mm/yyyy hh:mm" and returns "YYYY-MM-DDTHH:mm" (Dhaka local time)
export function findDateTime(text) {
  const m = DATE_RE.exec(text);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const ampm = m[6]?.toUpperCase();

  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ampm === 'PM' ? 12 : 0);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const p = (n) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}`;
}

// "2026-11-22T14:01" (Dhaka time) -> "2026-11-22T14:01:00+06:00"
export function dhakaLocalToIso(local) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(local ?? ''))) return null;
  const iso = `${local}:00+06:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export function cleanRef(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v || /^(n\/?a|none|null|nil|-+)$/i.test(v)) return null;
  return v.slice(0, 100);
}

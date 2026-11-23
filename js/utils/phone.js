const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

// Returns a clean 11-digit BD mobile number (01XXXXXXXXX) or null.
export function normalizeBdMobile(input) {
  if (input == null) return null;

  let s = String(input).replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  s = s.replace(/[\s\-().]/g, '');

  if (s.startsWith('+88')) s = s.slice(3);
  else if (s.startsWith('88') && s.length === 13) s = s.slice(2);

  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}

// Turns database errors into short, readable Bengali messages.
export function friendlyError(err) {
  const code = err?.code;
  const msg = String(err?.message || '');

  if (code === '23505') {
    if (msg.includes('sims_user_name_uq')) return 'এই নামে আরেকটি SIM আগে থেকেই আছে।';
    if (msg.includes('sims_user_number_uq')) return 'এই service-এ এই নম্বর আগে থেকেই আছে।';
    if (msg.includes('sim_limits_uq')) return 'এই ধরনের limit এই SIM-এ আগে থেকেই আছে। সেটা Edit করুন।';
    if (msg.includes('transactions_trxid_uq')) return 'এই TrxID আগে থেকেই সংরক্ষিত আছে।';
    return 'এই তথ্য আগে থেকেই আছে।';
  }
  if (code === '23503') return 'এই তথ্য অন্য রেকর্ডের সাথে যুক্ত, তাই বদলানো যাচ্ছে না।';
  if (code === '23514') return 'দেওয়া তথ্য ঠিক ফরম্যাটে নেই।';
  if (code === '22003') return 'সংখ্যাটি অনেক বড়।';
  if (code === '42501') return 'এই কাজের অনুমতি নেই। আবার login করুন।';
  return 'কিছু সমস্যা হয়েছে। আবার চেষ্টা করুন।';
}

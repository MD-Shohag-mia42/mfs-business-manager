export const ACTION_LABELS = {
  create: 'তৈরি হয়েছে',
  update: 'সম্পাদনা করা হয়েছে',
  void: 'বাতিল করা হয়েছে',
  restore: 'ফিরিয়ে আনা হয়েছে',
  delete: 'মুছে ফেলা হয়েছে',
};

export const FIELD_LABELS = {
  sim_id: 'SIM',
  amount: 'Amount',
  fee: 'Fee',
  sender_number: 'Sender',
  receiver_number: 'Receiver',
  reference: 'Reference',
  trx_id: 'TrxID',
  balance_after: 'Balance',
  transaction_datetime: 'তারিখ ও সময়',
  notes: 'Note',
  status: 'অবস্থা',
};

// Which user-visible fields differ between two snapshots of a transaction?
export function changedFields(oldData, newData) {
  if (!oldData || !newData) return [];
  return Object.keys(FIELD_LABELS).filter((key) => {
    const a = oldData[key] ?? null;
    const b = newData[key] ?? null;
    if (key === 'transaction_datetime' && a && b) {
      return new Date(a).getTime() !== new Date(b).getTime();
    }
    if (['amount', 'fee', 'balance_after'].includes(key) && a !== null && b !== null) {
      return Number(a) !== Number(b);
    }
    return a !== b;
  });
}

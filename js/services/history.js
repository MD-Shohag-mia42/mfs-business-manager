import { supabase } from '../supabaseClient.js';

export const TX_COLUMNS =
  'id, sim_id, service, transaction_type, amount, fee, sender_number, receiver_number, reference, ' +
  'trx_id, balance_after, transaction_datetime, entry_method, original_sms, notes, status, created_at, updated_at';

// Only letters, digits, spaces and - + . are allowed inside the search text,
// so it can never break the filter syntax.
const UNSAFE_SEARCH_CHARS = /[^\p{L}\p{N}\s+.\-]/gu;

const EDITABLE = [
  'sim_id', 'amount', 'fee', 'sender_number', 'receiver_number', 'reference',
  'trx_id', 'balance_after', 'transaction_datetime', 'notes', 'status',
];

// f: { status, simId, service, type, fromIso, toIso, minAmount, maxAmount, search }
export async function searchTransactions(f, { offset = 0, limit = 20 } = {}) {
  let q = supabase.from('transactions').select(TX_COLUMNS, { count: 'exact' });

  if (f.status && f.status !== 'all') q = q.eq('status', f.status);
  if (f.simId) q = q.eq('sim_id', f.simId);
  else if (f.service) q = q.eq('service', f.service);
  if (f.type) q = q.eq('transaction_type', f.type);
  if (f.fromIso) q = q.gte('transaction_datetime', f.fromIso);
  if (f.toIso) q = q.lt('transaction_datetime', f.toIso);
  if (f.minAmount != null) q = q.gte('amount', f.minAmount);
  if (f.maxAmount != null) q = q.lte('amount', f.maxAmount);

  const search = String(f.search ?? '').replace(UNSAFE_SEARCH_CHARS, '').trim();
  if (search) {
    const p = `%${search}%`;
    q = q.or(
      `trx_id.ilike.${p},sender_number.ilike.${p},receiver_number.ilike.${p},reference.ilike.${p},notes.ilike.${p}`
    );
  }

  q = q
    .order('transaction_datetime', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}

export async function updateTransaction(id, patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => EDITABLE.includes(k)));
  const { data, error } = await supabase
    .from('transactions')
    .update(clean)
    .eq('id', id)
    .select(TX_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export const setTransactionStatus = (id, status) => updateTransaction(id, { status });

export async function listAuditLogs(transactionId) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, old_data, new_data, created_at')
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

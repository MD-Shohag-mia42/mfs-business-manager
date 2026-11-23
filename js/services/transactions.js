import { supabase } from '../supabaseClient.js';

// Which of these TrxIDs are already saved (active records only)?
export async function findExistingTrxIds(service, trxIds) {
  if (!trxIds.length) return new Set();
  const { data, error } = await supabase
    .from('transactions')
    .select('trx_id')
    .eq('service', service)
    .eq('status', 'active')
    .in('trx_id', trxIds);
  if (error) throw error;
  return new Set(data.map((r) => r.trx_id));
}

// Soft duplicate check when there is no TrxID:
// same SIM + same amount + almost the same time.
export async function findPossibleDuplicate({ simId, amount, isoFrom, isoTo }) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id')
    .eq('sim_id', simId)
    .eq('amount', amount)
    .eq('status', 'active')
    .gte('transaction_datetime', isoFrom)
    .lte('transaction_datetime', isoTo)
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

export async function insertTransaction(row) {
  const { data, error } = await supabase.from('transactions').insert(row).select().single();
  if (error) throw error;
  return data;
}

// Saves all rows in one go. If that fails, saves one by one so valid rows
// are still stored and only the bad ones are reported.
export async function insertTransactions(rows) {
  if (!rows.length) return { saved: 0, failed: [] };

  const bulk = await supabase.from('transactions').insert(rows);
  if (!bulk.error) return { saved: rows.length, failed: [] };

  const failed = [];
  let saved = 0;
  for (let i = 0; i < rows.length; i++) {
    const { error } = await supabase.from('transactions').insert(rows[i]);
    if (error) failed.push({ index: i, error });
    else saved++;
  }
  return { saved, failed };
}

// Latest distinct receiver numbers used for Send Money (for suggestions).
export async function listRecentReceivers(max = 8) {
  const { data, error } = await supabase
    .from('transactions')
    .select('receiver_number, transaction_datetime')
    .eq('transaction_type', 'send_money')
    .eq('status', 'active')
    .not('receiver_number', 'is', null)
    .order('transaction_datetime', { ascending: false })
    .limit(80);
  if (error) throw error;

  const seen = new Set();
  const out = [];
  for (const r of data) {
    if (seen.has(r.receiver_number)) continue;
    seen.add(r.receiver_number);
    out.push(r.receiver_number);
    if (out.length >= max) break;
  }
  return out;
}

export async function saveUnparsedSms(rawSms) {
  const { error } = await supabase
    .from('unparsed_sms')
    .insert({ raw_sms: String(rawSms).slice(0, 2000) });
  if (error) throw error;
}

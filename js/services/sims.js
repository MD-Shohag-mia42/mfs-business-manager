import { supabase } from '../supabaseClient.js';

const SIM_COLUMNS =
  'id, service, sim_name, mobile_number, account_type, status, notes, created_at';

const EMPTY_STATS = {
  received_count: 0,
  received_total: 0,
  send_count: 0,
  send_total: 0,
  latest_balance: null,
};

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

const SIM_FIELDS = ['service', 'sim_name', 'mobile_number', 'account_type', 'notes'];

export async function listSimsWithStats() {
  const [simsRes, statsRes] = await Promise.all([
    supabase.from('sims').select(SIM_COLUMNS).order('service').order('sim_name'),
    supabase.from('sim_stats').select('*'),
  ]);
  if (simsRes.error) throw simsRes.error;
  if (statsRes.error) throw statsRes.error;

  const stats = new Map(statsRes.data.map((s) => [s.sim_id, s]));
  return simsRes.data.map((sim) => ({ ...sim, stats: stats.get(sim.id) ?? EMPTY_STATS }));
}

export async function createSim(values) {
  const { data, error } = await supabase
    .from('sims')
    .insert({ ...pick(values, SIM_FIELDS), status: 'active' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSim(id, patch) {
  const { data, error } = await supabase
    .from('sims')
    .update(pick(patch, [...SIM_FIELDS, 'status']))
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function setSimStatus(id, status) {
  return updateSim(id, { status });
}

/* ---------- limits ---------- */

export async function listLimits(simId) {
  const { data, error } = await supabase
    .from('sim_limits')
    .select('id, sim_id, limit_type, period, transaction_type, limit_value, warn_percent, is_active')
    .eq('sim_id', simId)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function saveLimit({
  id = null,
  sim_id,
  limit_type,
  period,
  transaction_type,
  limit_value,
  warn_percent,
}) {
  const fields = { limit_type, period, transaction_type, limit_value, warn_percent };
  const query = id
    ? supabase.from('sim_limits').update(fields).eq('id', id)
    : supabase.from('sim_limits').insert({ sim_id, ...fields });

  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function deleteLimit(id) {
  const { error } = await supabase.from('sim_limits').delete().eq('id', id);
  if (error) throw error;
}

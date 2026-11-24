import { supabase } from '../supabaseClient.js';

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data ?? [];
}

// period: 'today' | 'month' | 'last_month' | 'all'  (Dhaka time, computed in the database)
export const getPeriodTotals = (period) => rpc('period_totals', { p_period: period });
export const getDailyTotals = (days = 14) => rpc('daily_totals', { p_days: days });
export const getMonthlyTotals = (months = 6) => rpc('monthly_totals', { p_months: months });
export const getAllSimUsage = () => rpc('all_sim_usage');

export async function listActiveLimits() {
  const { data, error } = await supabase
    .from('sim_limits')
    .select('id, sim_id, limit_type, period, transaction_type, limit_value, warn_percent, is_active')
    .eq('is_active', true);
  if (error) throw error;
  return data ?? [];
}

/* ---------- Reports page ---------- */

// f: { fromIso, toIso, simId, service }
const filterArgs = (f) => ({
  p_from: f.fromIso || null,
  p_to: f.toIso || null,
  p_sim_id: f.simId || null,
  p_service: f.service || null,
});

export const getReportBySim = (f) => rpc('report_by_sim', filterArgs(f));
export const getReportByPeriod = (f, group = 'day') => rpc('report_by_period', { ...filterArgs(f), p_group: group });
export const getReportTopNumbers = (f, limit = 10) => rpc('report_top_numbers', { ...filterArgs(f), p_limit: limit });

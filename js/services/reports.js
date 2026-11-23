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

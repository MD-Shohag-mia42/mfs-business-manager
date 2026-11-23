import { supabase } from '../supabaseClient.js';
import { listLimits } from './sims.js';
import { formatTaka } from '../utils/format.js';

// Current daily / monthly usage of one SIM (Dhaka time), computed in the database.
export async function getSimUsage(simId) {
  const { data, error } = await supabase.rpc('sim_usage', { p_sim_id: simId });
  if (error) throw error;
  return data ?? [];
}

// limits: sim_limits rows of ONE sim, usage: usage rows of the same sim.
// Returns every active count/amount limit with how much is used so far.
export function computeLimitStatus(limits, usage) {
  return limits
    .filter((l) => l.is_active && l.limit_type !== 'balance')
    .map((limit) => {
      const rows = usage.filter(
        (u) => u.usage_period === limit.period && (!limit.transaction_type || u.tx_type === limit.transaction_type)
      );
      const count = rows.reduce((sum, u) => sum + Number(u.tx_count), 0);
      const total = rows.reduce((sum, u) => sum + Number(u.tx_total), 0);
      return { limit, used: limit.limit_type === 'count' ? count : total };
    });
}

export async function getLimitStatus(simId) {
  const [limits, usage] = await Promise.all([listLimits(simId), getSimUsage(simId)]);
  return computeLimitStatus(limits, usage);
}

export function describeLimit(limit, typeLabel = (c) => c) {
  const kind = { count: 'Transaction সংখ্যা', amount: 'মোট Amount', balance: 'Balance সীমা' }[limit.limit_type];
  const period = { daily: 'দৈনিক', monthly: 'মাসিক', none: '' }[limit.period];
  const scope =
    limit.limit_type === 'balance' ? '' : limit.transaction_type ? typeLabel(limit.transaction_type) : 'সব ধরন';
  return [period, kind, scope].filter(Boolean).join(' · ');
}

export function limitValueText(limit, value = limit.limit_value) {
  return limit.limit_type === 'count' ? `${Number(value)} টি` : formatTaka(value);
}

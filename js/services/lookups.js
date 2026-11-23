import { supabase } from '../supabaseClient.js';

let servicesCache = null;
let typesCache = null;

export async function getServices() {
  if (servicesCache) return servicesCache;
  const { data, error } = await supabase
    .from('services')
    .select('code, label')
    .eq('is_active', true)
    .order('label');
  if (error) throw error;
  servicesCache = data;
  return data;
}

export async function getTransactionTypes() {
  if (typesCache) return typesCache;
  const { data, error } = await supabase
    .from('transaction_types')
    .select('code, label, direction')
    .eq('is_active', true)
    .order('label');
  if (error) throw error;
  typesCache = data;
  return data;
}

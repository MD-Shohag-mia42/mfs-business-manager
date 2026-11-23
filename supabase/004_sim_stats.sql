-- =========================================================
-- 004_sim_stats.sql  -  per-SIM totals (RLS-safe view)
-- =========================================================
create or replace view public.sim_stats
with (security_invoker = true) as
select
  s.id as sim_id,
  count(t.id) filter (where t.transaction_type = 'received')            as received_count,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'received'), 0)   as received_total,
  count(t.id) filter (where t.transaction_type = 'send_money')          as send_count,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'send_money'), 0) as send_total,
  (array_agg(t.balance_after order by t.transaction_datetime desc)
     filter (where t.balance_after is not null))[1]                     as latest_balance
from public.sims s
left join public.transactions t
  on t.sim_id = s.id and t.status = 'active'
group by s.id;

grant select on public.sim_stats to authenticated;

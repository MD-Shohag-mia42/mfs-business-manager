-- =========================================================
-- 005_sim_usage.sql  -  today / this month usage of one SIM
--                       (Asia/Dhaka time, RLS applies)
-- =========================================================
create or replace function public.sim_usage(p_sim_id uuid)
returns table (usage_period text, tx_type text, tx_count bigint, tx_total numeric)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      (date_trunc('day',   now() at time zone 'Asia/Dhaka')) at time zone 'Asia/Dhaka' as day_start,
      (date_trunc('month', now() at time zone 'Asia/Dhaka')) at time zone 'Asia/Dhaka' as month_start
  )
  select
    p.usage_period,
    t.transaction_type,
    count(*)::bigint,
    coalesce(sum(t.amount), 0)::numeric
  from public.transactions t
  cross join bounds b
  cross join lateral (
    values ('daily'::text, b.day_start), ('monthly'::text, b.month_start)
  ) as p(usage_period, start_at)
  where t.sim_id = p_sim_id
    and t.status = 'active'
    and t.transaction_datetime >= p.start_at
  group by p.usage_period, t.transaction_type;
$$;

revoke all on function public.sim_usage(uuid) from public, anon;
grant execute on function public.sim_usage(uuid) to authenticated;

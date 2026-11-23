-- =========================================================
-- 006_dashboard.sql  -  dashboard / chart numbers (Asia/Dhaka time)
-- All functions run with the caller's rights, so RLS applies.
-- =========================================================

-- ---------- totals for a period, per SIM and transaction type ----------
-- p_period: 'today' | 'month' | 'last_month' | 'all'
create or replace function public.period_totals(p_period text default 'month')
returns table (sim_id uuid, tx_type text, tx_count bigint, tx_total numeric, fee_total numeric)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      (date_trunc('day',   now() at time zone 'Asia/Dhaka')) at time zone 'Asia/Dhaka' as day_start,
      (date_trunc('month', now() at time zone 'Asia/Dhaka')) at time zone 'Asia/Dhaka' as month_start,
      (date_trunc('month', now() at time zone 'Asia/Dhaka') - interval '1 month') at time zone 'Asia/Dhaka' as prev_month_start
  ),
  win as (
    select
      case p_period
        when 'today'      then day_start
        when 'month'      then month_start
        when 'last_month' then prev_month_start
        else null
      end as from_at,
      case p_period
        when 'last_month' then month_start
        else null
      end as to_at
    from bounds
  )
  select
    t.sim_id,
    t.transaction_type,
    count(*)::bigint,
    coalesce(sum(t.amount), 0)::numeric,
    coalesce(sum(t.fee), 0)::numeric
  from public.transactions t
  cross join win w
  where t.status = 'active'
    and (w.from_at is null or t.transaction_datetime >= w.from_at)
    and (w.to_at   is null or t.transaction_datetime <  w.to_at)
  group by t.sim_id, t.transaction_type;
$$;

-- ---------- last N days (Dhaka dates) ----------
create or replace function public.daily_totals(p_days integer default 14)
returns table (tx_day date, tx_type text, tx_count bigint, tx_total numeric)
language sql
stable
set search_path = public
as $$
  select
    (t.transaction_datetime at time zone 'Asia/Dhaka')::date,
    t.transaction_type,
    count(*)::bigint,
    coalesce(sum(t.amount), 0)::numeric
  from public.transactions t
  where t.status = 'active'
    and t.transaction_datetime >= (
      (date_trunc('day', now() at time zone 'Asia/Dhaka')
        - make_interval(days => greatest(least(p_days, 366), 1) - 1))
      at time zone 'Asia/Dhaka'
    )
  group by 1, 2;
$$;

-- ---------- last N months (Dhaka months, first day of month) ----------
create or replace function public.monthly_totals(p_months integer default 6)
returns table (tx_month date, tx_type text, tx_count bigint, tx_total numeric)
language sql
stable
set search_path = public
as $$
  select
    date_trunc('month', t.transaction_datetime at time zone 'Asia/Dhaka')::date,
    t.transaction_type,
    count(*)::bigint,
    coalesce(sum(t.amount), 0)::numeric
  from public.transactions t
  where t.status = 'active'
    and t.transaction_datetime >= (
      (date_trunc('month', now() at time zone 'Asia/Dhaka')
        - make_interval(months => greatest(least(p_months, 24), 1) - 1))
      at time zone 'Asia/Dhaka'
    )
  group by 1, 2;
$$;

-- ---------- today / this month usage of ALL SIMs (for limit monitoring) ----------
create or replace function public.all_sim_usage()
returns table (sim_id uuid, usage_period text, tx_type text, tx_count bigint, tx_total numeric)
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
    t.sim_id,
    p.usage_period,
    t.transaction_type,
    count(*)::bigint,
    coalesce(sum(t.amount), 0)::numeric
  from public.transactions t
  cross join bounds b
  cross join lateral (
    values ('daily'::text, b.day_start), ('monthly'::text, b.month_start)
  ) as p(usage_period, start_at)
  where t.status = 'active'
    and t.transaction_datetime >= p.start_at
  group by t.sim_id, p.usage_period, t.transaction_type;
$$;

-- ---------- permissions: logged-in users only ----------
revoke all on function public.period_totals(text)    from public, anon;
revoke all on function public.daily_totals(integer)  from public, anon;
revoke all on function public.monthly_totals(integer) from public, anon;
revoke all on function public.all_sim_usage()        from public, anon;

grant execute on function public.period_totals(text)    to authenticated;
grant execute on function public.daily_totals(integer)  to authenticated;
grant execute on function public.monthly_totals(integer) to authenticated;
grant execute on function public.all_sim_usage()        to authenticated;

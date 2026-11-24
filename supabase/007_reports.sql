-- =========================================================
-- 007_reports.sql  -  Reports page (Asia/Dhaka time, RLS applies)
-- Common filters: p_from (inclusive), p_to (exclusive), p_sim_id, p_service
-- Pass NULL to skip a filter.
-- =========================================================

-- ---------- totals per SIM and transaction type ----------
create or replace function public.report_by_sim(
  p_from    timestamptz default null,
  p_to      timestamptz default null,
  p_sim_id  uuid        default null,
  p_service text        default null
)
returns table (sim_id uuid, tx_type text, tx_count bigint, tx_total numeric, fee_total numeric)
language sql
stable
set search_path = public
as $$
  select
    t.sim_id,
    t.transaction_type,
    count(*)::bigint,
    coalesce(sum(t.amount), 0)::numeric,
    coalesce(sum(t.fee), 0)::numeric
  from public.transactions t
  where t.status = 'active'
    and (p_from    is null or t.transaction_datetime >= p_from)
    and (p_to      is null or t.transaction_datetime <  p_to)
    and (p_sim_id  is null or t.sim_id  = p_sim_id)
    and (p_service is null or t.service = p_service)
  group by t.sim_id, t.transaction_type;
$$;

-- ---------- totals per Dhaka day or month ----------
create or replace function public.report_by_period(
  p_from    timestamptz default null,
  p_to      timestamptz default null,
  p_sim_id  uuid        default null,
  p_service text        default null,
  p_group   text        default 'day'
)
returns table (bucket date, tx_type text, tx_count bigint, tx_total numeric)
language sql
stable
set search_path = public
as $$
  select
    date_trunc(
      case when p_group = 'month' then 'month' else 'day' end,
      t.transaction_datetime at time zone 'Asia/Dhaka'
    )::date,
    t.transaction_type,
    count(*)::bigint,
    coalesce(sum(t.amount), 0)::numeric
  from public.transactions t
  where t.status = 'active'
    and (p_from    is null or t.transaction_datetime >= p_from)
    and (p_to      is null or t.transaction_datetime <  p_to)
    and (p_sim_id  is null or t.sim_id  = p_sim_id)
    and (p_service is null or t.service = p_service)
  group by 1, 2;
$$;

-- ---------- top senders ('in') and top receivers ('out') ----------
create or replace function public.report_top_numbers(
  p_from    timestamptz default null,
  p_to      timestamptz default null,
  p_sim_id  uuid        default null,
  p_service text        default null,
  p_limit   integer     default 10
)
returns table (direction text, party_number text, tx_count bigint, tx_total numeric)
language sql
stable
set search_path = public
as $$
  with base as (
    select
      tt.direction as dir,
      case tt.direction when 'in' then t.sender_number else t.receiver_number end as num,
      t.amount as amt
    from public.transactions t
    join public.transaction_types tt on tt.code = t.transaction_type
    where t.status = 'active'
      and (p_from    is null or t.transaction_datetime >= p_from)
      and (p_to      is null or t.transaction_datetime <  p_to)
      and (p_sim_id  is null or t.sim_id  = p_sim_id)
      and (p_service is null or t.service = p_service)
  ),
  agg as (
    select dir, num, count(*)::bigint as cnt, sum(amt)::numeric as tot
    from base
    where num is not null
    group by dir, num
  ),
  ranked as (
    select dir, num, cnt, tot,
           row_number() over (partition by dir order by tot desc, cnt desc) as rn
    from agg
  )
  select dir, num, cnt, tot
  from ranked
  where rn <= greatest(least(p_limit, 50), 1)
  order by dir, rn;
$$;

-- ---------- permissions: logged-in users only ----------
revoke all on function public.report_by_sim(timestamptz, timestamptz, uuid, text)          from public, anon;
revoke all on function public.report_by_period(timestamptz, timestamptz, uuid, text, text) from public, anon;
revoke all on function public.report_top_numbers(timestamptz, timestamptz, uuid, text, integer) from public, anon;

grant execute on function public.report_by_sim(timestamptz, timestamptz, uuid, text)          to authenticated;
grant execute on function public.report_by_period(timestamptz, timestamptz, uuid, text, text) to authenticated;
grant execute on function public.report_top_numbers(timestamptz, timestamptz, uuid, text, integer) to authenticated;

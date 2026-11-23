-- =========================================================
-- 002_rls.sql  -  Row Level Security + grants
-- =========================================================

alter table public.profiles           enable row level security;
alter table public.services           enable row level security;
alter table public.transaction_types  enable row level security;
alter table public.sims               enable row level security;
alter table public.sim_limits         enable row level security;
alter table public.transactions       enable row level security;
alter table public.audit_logs         enable row level security;
alter table public.unparsed_sms       enable row level security;

-- ---------- profiles ----------
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- ---------- lookup tables: read-only ----------
create policy "services_read" on public.services
  for select to authenticated using (true);

create policy "transaction_types_read" on public.transaction_types
  for select to authenticated using (true);

-- ---------- sims ----------
create policy "sims_select_own" on public.sims
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "sims_insert_own" on public.sims
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "sims_update_own" on public.sims
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "sims_delete_own" on public.sims
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- sim_limits ----------
create policy "sim_limits_select_own" on public.sim_limits
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "sim_limits_insert_own" on public.sim_limits
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sims s
      where s.id = sim_limits.sim_id and s.user_id = (select auth.uid())
    )
  );

create policy "sim_limits_update_own" on public.sim_limits
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sims s
      where s.id = sim_limits.sim_id and s.user_id = (select auth.uid())
    )
  );

create policy "sim_limits_delete_own" on public.sim_limits
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- transactions ----------
-- No DELETE policy: "delete" in the app = status 'voided' (keeps history).
create policy "transactions_select_own" on public.transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "transactions_insert_own" on public.transactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sims s
      where s.id = transactions.sim_id and s.user_id = (select auth.uid())
    )
  );

create policy "transactions_update_own" on public.transactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sims s
      where s.id = transactions.sim_id and s.user_id = (select auth.uid())
    )
  );

-- ---------- audit_logs: read-only for users ----------
create policy "audit_logs_select_own" on public.audit_logs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- unparsed_sms ----------
create policy "unparsed_sms_select_own" on public.unparsed_sms
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "unparsed_sms_insert_own" on public.unparsed_sms
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "unparsed_sms_delete_own" on public.unparsed_sms
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- grants (logged-in users only; anon gets nothing) ----------
grant usage on schema public to authenticated;

grant select on public.profiles, public.services, public.transaction_types
  to authenticated;
grant select, insert, update, delete on public.sims, public.sim_limits
  to authenticated;
grant select, insert, update on public.transactions to authenticated;
grant select on public.audit_logs to authenticated;
grant select, insert, delete on public.unparsed_sms to authenticated;

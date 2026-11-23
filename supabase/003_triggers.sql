-- =========================================================
-- 003_triggers.sql  -  triggers and helper functions
-- =========================================================

-- ---------- auto-create profile for every new auth user ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill for users that already exist
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- ---------- updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sims_set_updated_at
  before update on public.sims
  for each row execute function public.set_updated_at();

create trigger sim_limits_set_updated_at
  before update on public.sim_limits
  for each row execute function public.set_updated_at();

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------- normalize transaction text fields ----------
create or replace function public.normalize_transaction()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.trx_id          := nullif(upper(btrim(new.trx_id)), '');
  new.sender_number   := nullif(btrim(new.sender_number), '');
  new.receiver_number := nullif(btrim(new.receiver_number), '');
  new.reference       := nullif(btrim(new.reference), '');
  new.notes           := nullif(btrim(new.notes), '');
  return new;
end;
$$;

create trigger transactions_normalize
  before insert or update on public.transactions
  for each row execute function public.normalize_transaction();

-- ---------- audit log ----------
create or replace function public.log_transaction_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (user_id, transaction_id, action, old_data, new_data)
    values (new.user_id, new.id, 'create', null, to_jsonb(new));
    return new;

  elsif tg_op = 'UPDATE' then
    -- ignore updates where nothing but updated_at changed
    if (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
      return new;
    end if;

    v_action := case
      when old.status = 'active' and new.status = 'voided' then 'void'
      when old.status = 'voided' and new.status = 'active' then 'restore'
      else 'update'
    end;

    insert into public.audit_logs (user_id, transaction_id, action, old_data, new_data)
    values (new.user_id, new.id, v_action, to_jsonb(old), to_jsonb(new));
    return new;

  else -- DELETE
    insert into public.audit_logs (user_id, transaction_id, action, old_data, new_data)
    values (old.user_id, old.id, 'delete', to_jsonb(old), null);
    return old;
  end if;
end;
$$;

create trigger transactions_audit
  after insert or update or delete on public.transactions
  for each row execute function public.log_transaction_audit();

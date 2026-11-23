-- =========================================================
-- 001_schema.sql  -  MFS Business Manager
-- =========================================================

-- ---------- profiles ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

-- ---------- lookup tables (extensible) ----------
create table public.services (
  code       text primary key,
  label      text not null,
  is_active  boolean not null default true
);

create table public.transaction_types (
  code       text primary key,
  label      text not null,
  direction  text not null check (direction in ('in', 'out')),
  is_active  boolean not null default true
);

insert into public.services (code, label) values
  ('bkash', 'bKash'),
  ('nagad', 'Nagad');

insert into public.transaction_types (code, label, direction) values
  ('received',   'Received Money', 'in'),
  ('send_money', 'Send Money',     'out');

-- ---------- sims ----------
create table public.sims (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid()
                   references public.profiles(id) on delete cascade,
  service        text not null references public.services(code),
  sim_name       text not null,
  mobile_number  text not null,
  account_type   text not null default 'personal',
  status         text not null default 'active'
                   check (status in ('active', 'inactive')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint sims_name_not_blank check (length(btrim(sim_name)) > 0),
  constraint sims_mobile_format  check (mobile_number ~ '^01[3-9][0-9]{8}$'),
  constraint sims_user_name_uq   unique (user_id, sim_name),
  constraint sims_user_number_uq unique (user_id, service, mobile_number),
  constraint sims_id_service_uq  unique (id, service)
);

create index sims_user_idx on public.sims (user_id, status);

-- ---------- sim_limits ----------
-- limit_type: count | amount | balance
-- period    : daily | monthly (balance limit uses 'none')
-- transaction_type NULL = applies to all types
create table public.sim_limits (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid()
                      references public.profiles(id) on delete cascade,
  sim_id            uuid not null references public.sims(id) on delete cascade,
  limit_type        text not null check (limit_type in ('count', 'amount', 'balance')),
  period            text not null check (period in ('daily', 'monthly', 'none')),
  transaction_type  text references public.transaction_types(code),
  limit_value       numeric(14,2) not null check (limit_value > 0),
  warn_percent      integer not null default 80 check (warn_percent between 1 and 100),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint sim_limits_period_chk check (
    (limit_type = 'balance' and period = 'none')
    or (limit_type <> 'balance' and period in ('daily', 'monthly'))
  ),
  constraint sim_limits_uq
    unique nulls not distinct (sim_id, limit_type, period, transaction_type)
);

create index sim_limits_sim_idx on public.sim_limits (sim_id);

-- ---------- transactions ----------
create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid()
                          references public.profiles(id) on delete cascade,
  sim_id                uuid not null,
  service               text not null,
  transaction_type      text not null references public.transaction_types(code),
  amount                numeric(12,2) not null check (amount > 0),
  fee                   numeric(12,2) not null default 0 check (fee >= 0),
  sender_number         text,
  receiver_number       text,
  reference             text,
  trx_id                text,
  balance_after         numeric(14,2),
  transaction_datetime  timestamptz not null default now(),
  entry_method          text not null check (entry_method in ('sms', 'manual')),
  original_sms          text,
  notes                 text,
  status                text not null default 'active'
                          check (status in ('active', 'voided')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- SIM must belong to the same service as the transaction
  constraint transactions_sim_fk
    foreign key (sim_id, service) references public.sims (id, service),

  constraint transactions_sender_fmt
    check (sender_number is null or sender_number ~ '^[0-9+]{5,15}$'),
  constraint transactions_receiver_fmt
    check (receiver_number is null or receiver_number ~ '^[0-9+]{5,15}$'),
  constraint transactions_sms_len
    check (original_sms is null or length(original_sms) <= 2000),
  constraint transactions_notes_len
    check (notes is null or length(notes) <= 500)
);

-- Duplicate TrxID protection (per user + service, active records only)
create unique index transactions_trxid_uq
  on public.transactions (user_id, service, trx_id)
  where trx_id is not null and status = 'active';

create index transactions_user_dt_idx
  on public.transactions (user_id, transaction_datetime desc);

create index transactions_sim_dt_idx
  on public.transactions (sim_id, transaction_datetime desc);

create index transactions_type_idx
  on public.transactions (user_id, service, transaction_type);

create index transactions_sender_idx
  on public.transactions (user_id, sender_number) where sender_number is not null;

create index transactions_receiver_idx
  on public.transactions (user_id, receiver_number) where receiver_number is not null;

-- helps the "possible duplicate" warning when TrxID is missing
create index transactions_dupe_hint_idx
  on public.transactions (user_id, sim_id, amount, transaction_datetime);

-- ---------- audit_logs ----------
-- transaction_id has no FK on purpose, so history survives any deletion
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  transaction_id  uuid,
  action          text not null
                    check (action in ('create', 'update', 'void', 'restore', 'delete')),
  old_data        jsonb,
  new_data        jsonb,
  created_at      timestamptz not null default now()
);

create index audit_logs_user_dt_idx on public.audit_logs (user_id, created_at desc);
create index audit_logs_tx_idx on public.audit_logs (transaction_id);

-- ---------- unparsed_sms (to improve parser later) ----------
create table public.unparsed_sms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
                references public.profiles(id) on delete cascade,
  raw_sms     text not null check (length(raw_sms) <= 2000),
  created_at  timestamptz not null default now()
);

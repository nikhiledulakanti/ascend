-- Ascend multi-tenant schema. Run once in the Supabase SQL editor.
-- If you already ran the earlier reservations.sql, run this first:
--   drop view if exists public.suite_availability;
--   drop table if exists public.reservations, public.leads cascade;

create extension if not exists btree_gist with schema extensions;

-- Tenants and staff access -------------------------------------------------

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create or replace function public.has_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  );
$$;

-- Business data ------------------------------------------------------------

create table public.suites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  nightly_rate_cents integer not null check (nightly_rate_cents > 0),
  capacity integer not null default 2 check (capacity between 1 and 10),
  active boolean not null default true,
  unique (org_id, name)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200 and email like '%_@_%'),
  phone text check (phone is null or char_length(phone) <= 40),
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  suite_id uuid not null references public.suites(id),
  customer_id uuid not null references public.customers(id),
  check_in date not null,
  check_out date not null,
  stay daterange generated always as (daterange(check_in, check_out, '[)')) stored,
  guests integer not null check (guests between 1 and 10),
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'checked_in', 'checked_out', 'cancelled')),
  source text not null default 'web' check (source in ('web', 'staff', 'phone')),
  nightly_rate_cents integer not null check (nightly_rate_cents > 0),
  created_at timestamptz not null default now(),
  check (check_out > check_in),
  check (check_out - check_in <= 60),
  exclude using gist (suite_id with =, stay with &&) where (status <> 'cancelled')
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  intent text not null check (intent in ('signup', 'sales')),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200 and email like '%_@_%'),
  company text check (company is null or char_length(company) <= 160),
  message text check (message is null or char_length(message) <= 1000),
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor uuid,
  action text not null,
  table_name text not null,
  row_id uuid,
  detail jsonb,
  at timestamptz not null default now()
);

-- Guardrails ---------------------------------------------------------------

create or replace function public.enforce_reservation_org()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from suites s where s.id = new.suite_id and s.org_id = new.org_id)
     or not exists (select 1 from customers c where c.id = new.customer_id and c.org_id = new.org_id) then
    raise exception 'reservation references data from another organization' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger reservations_same_org
  before insert or update on public.reservations
  for each row execute function public.enforce_reservation_org();

create or replace function public.audit_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (org_id, actor, action, table_name, row_id, detail)
    values (new.org_id, auth.uid(), 'create', 'reservations', new.id,
            jsonb_build_object('status', new.status, 'source', new.source));
  elsif old.status is distinct from new.status then
    insert into audit_log (org_id, actor, action, table_name, row_id, detail)
    values (new.org_id, auth.uid(), 'status_change', 'reservations', new.id,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

create trigger reservations_audit
  after insert or update on public.reservations
  for each row execute function public.audit_reservation();

-- Row-level security -------------------------------------------------------

alter table public.orgs enable row level security;
alter table public.memberships enable row level security;
alter table public.suites enable row level security;
alter table public.customers enable row level security;
alter table public.reservations enable row level security;
alter table public.leads enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.orgs, public.memberships, public.suites, public.customers,
  public.reservations, public.leads, public.audit_log from anon;

create policy orgs_read on public.orgs for select to authenticated
  using (public.has_role(id, array['owner', 'manager', 'staff']));

create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.has_role(org_id, array['owner', 'manager']));
create policy memberships_owner_write on public.memberships for all to authenticated
  using (public.has_role(org_id, array['owner']))
  with check (public.has_role(org_id, array['owner']));

create policy suites_read on public.suites for select to authenticated
  using (public.has_role(org_id, array['owner', 'manager', 'staff']));
create policy suites_manage on public.suites for all to authenticated
  using (public.has_role(org_id, array['owner', 'manager']))
  with check (public.has_role(org_id, array['owner', 'manager']));

create policy customers_read on public.customers for select to authenticated
  using (public.has_role(org_id, array['owner', 'manager', 'staff']));
create policy customers_update on public.customers for update to authenticated
  using (public.has_role(org_id, array['owner', 'manager', 'staff']))
  with check (public.has_role(org_id, array['owner', 'manager', 'staff']));
create policy customers_owner_delete on public.customers for delete to authenticated
  using (public.has_role(org_id, array['owner']));

create policy reservations_read on public.reservations for select to authenticated
  using (public.has_role(org_id, array['owner', 'manager', 'staff']));
create policy reservations_staff_insert on public.reservations for insert to authenticated
  with check (public.has_role(org_id, array['owner', 'manager', 'staff']));
create policy reservations_staff_update on public.reservations for update to authenticated
  using (public.has_role(org_id, array['owner', 'manager', 'staff']))
  with check (public.has_role(org_id, array['owner', 'manager', 'staff']));

create policy leads_read on public.leads for select to authenticated
  using (public.has_role(org_id, array['owner', 'manager', 'staff']));
create policy leads_update on public.leads for update to authenticated
  using (public.has_role(org_id, array['owner', 'manager', 'staff']))
  with check (public.has_role(org_id, array['owner', 'manager', 'staff']));

create policy audit_read on public.audit_log for select to authenticated
  using (public.has_role(org_id, array['owner', 'manager']));

-- Public API for the website (no direct table access for anonymous visitors)

create or replace function public.public_suite_availability(p_org text)
returns table (suite text, check_in date, check_out date)
language sql
stable
security definer
set search_path = public
as $$
  select s.name, r.check_in, r.check_out
  from reservations r
  join orgs o on o.id = r.org_id
  join suites s on s.id = r.suite_id
  where o.slug = p_org
    and s.active
    and r.status <> 'cancelled'
    and r.check_out >= current_date;
$$;

create or replace function public.submit_reservation(
  p_org text,
  p_suite text,
  p_check_in date,
  p_check_out date,
  p_guests integer,
  p_name text,
  p_email text,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_suite suites;
  v_customer uuid;
  v_recent integer;
  v_id uuid;
begin
  if p_check_in < current_date or p_check_out <= p_check_in or p_check_out - p_check_in > 60 then
    raise exception 'Please choose valid dates (up to 60 nights).' using errcode = '22023';
  end if;

  select id into v_org from orgs where slug = p_org;
  if v_org is null then
    raise exception 'Unknown property.' using errcode = '22023';
  end if;

  select * into v_suite from suites where org_id = v_org and name = p_suite and active;
  if v_suite.id is null then
    raise exception 'Unknown suite.' using errcode = '22023';
  end if;
  if p_guests < 1 or p_guests > v_suite.capacity then
    raise exception 'Guest count is above this suite''s capacity.' using errcode = '22023';
  end if;

  select count(*) into v_recent
  from reservations r
  join customers c on c.id = r.customer_id
  where r.org_id = v_org and c.email = lower(p_email) and r.created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'Too many requests. Please try again later.' using errcode = '53400';
  end if;

  insert into customers (org_id, full_name, email, phone)
  values (v_org, p_name, lower(p_email), p_phone)
  on conflict (org_id, email) do nothing;

  select id into v_customer from customers where org_id = v_org and email = lower(p_email);

  insert into reservations (org_id, suite_id, customer_id, check_in, check_out, guests, source, nightly_rate_cents)
  values (v_org, v_suite.id, v_customer, p_check_in, p_check_out, p_guests, 'web', v_suite.nightly_rate_cents)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.submit_lead(
  p_org text,
  p_intent text,
  p_name text,
  p_email text,
  p_company text default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_recent integer;
  v_id uuid;
begin
  select id into v_org from orgs where slug = p_org;
  if v_org is null then
    raise exception 'Unknown property.' using errcode = '22023';
  end if;

  select count(*) into v_recent from leads
  where org_id = v_org and email = lower(p_email) and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    raise exception 'Too many requests. Please try again later.' using errcode = '53400';
  end if;

  insert into leads (org_id, intent, name, email, company, message)
  values (v_org, p_intent, p_name, lower(p_email), p_company, p_message)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.public_suite_availability(text) to anon, authenticated;
grant execute on function public.submit_reservation(text, text, date, date, integer, text, text, text) to anon, authenticated;
grant execute on function public.submit_lead(text, text, text, text, text, text) to anon, authenticated;

-- Reports (run as the signed-in user, so RLS applies) ----------------------

create or replace function public.report_summary(p_org uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_suites integer;
  v jsonb;
begin
  if not public.has_role(p_org, array['owner', 'manager', 'staff']) then
    raise exception 'Not authorized for this organization.' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > 366 then
    raise exception 'Choose a range of up to 366 days.' using errcode = '22023';
  end if;

  select count(*) into v_suites from suites where org_id = p_org and active;

  with booked as (
    select r.nightly_rate_cents as rate,
           greatest(0, least(r.check_out, p_to) - greatest(r.check_in, p_from)) as nights
    from reservations r
    where r.org_id = p_org
      and r.status <> 'cancelled'
      and r.check_in < p_to
      and r.check_out > p_from
  )
  select jsonb_build_object(
    'nights_booked', coalesce(sum(nights), 0),
    'nights_available', v_suites * (p_to - p_from),
    'occupancy_pct', case when v_suites = 0 then 0
                          else round(100.0 * coalesce(sum(nights), 0) / (v_suites * (p_to - p_from)), 1) end,
    'revenue_cents', coalesce(sum(nights * rate), 0),
    'bookings', count(*),
    'leads', (select count(*) from leads
              where org_id = p_org and created_at >= p_from and created_at < p_to + 1)
  )
  into v
  from booked;

  return v;
end;
$$;

create or replace function public.report_daily_occupancy(p_org uuid, p_from date, p_to date)
returns table (day date, nights_booked bigint, suites_active bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.has_role(p_org, array['owner', 'manager', 'staff']) then
    raise exception 'Not authorized for this organization.' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > 366 then
    raise exception 'Choose a range of up to 366 days.' using errcode = '22023';
  end if;

  return query
  select d::date,
         count(r.id),
         (select count(*) from suites s where s.org_id = p_org and s.active)
  from generate_series(p_from, p_to - 1, interval '1 day') as d
  left join reservations r
    on r.org_id = p_org
   and r.status <> 'cancelled'
   and d::date >= r.check_in
   and d::date < r.check_out
  group by d
  order by d;
end;
$$;

grant execute on function public.report_summary(uuid, date, date) to authenticated;
grant execute on function public.report_daily_occupancy(uuid, date, date) to authenticated;

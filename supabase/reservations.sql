create extension if not exists btree_gist with schema extensions;

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  suite text not null check (suite in ('Dolphin Horizon Suite', 'Lighthouse Loft')),
  check_in date not null,
  check_out date not null,
  stay daterange generated always as (daterange(check_in, check_out, '[)')) stored,
  guests int not null check (guests between 1 and 4),
  guest_name text not null check (char_length(guest_name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200 and email like '%_@_%'),
  phone text check (phone is null or char_length(phone) <= 40),
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  check (check_out > check_in),
  exclude using gist (suite with =, stay with &&) where (status <> 'cancelled')
);

alter table public.reservations enable row level security;

create policy "public can request a stay"
  on public.reservations for insert
  to anon
  with check (status = 'requested');

create view public.suite_availability as
  select suite, check_in, check_out
  from public.reservations
  where status <> 'cancelled';

grant select on public.suite_availability to anon;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  intent text not null check (intent in ('signup', 'sales')),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200 and email like '%_@_%'),
  company text check (company is null or char_length(company) <= 160),
  message text check (message is null or char_length(message) <= 1000),
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;

create policy "public can submit a lead"
  on public.leads for insert
  to anon
  with check (true);

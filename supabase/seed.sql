-- Run after schema.sql. Creates the Bay-Beach Inn client and its two suites.
insert into orgs (slug, name) values ('bay-beach-inn', 'Bay-Beach Inn')
on conflict (slug) do nothing;

insert into suites (org_id, name, nightly_rate_cents, capacity)
select id, 'The Dolphin Horizon Suite', 42000, 2 from orgs where slug = 'bay-beach-inn'
on conflict (org_id, name) do nothing;

insert into suites (org_id, name, nightly_rate_cents, capacity)
select id, 'Lighthouse Loft', 31000, 2 from orgs where slug = 'bay-beach-inn'
on conflict (org_id, name) do nothing;

-- After you sign in to admin.html once, give your account owner access.
-- Replace the user id with yours from Authentication > Users in Supabase:
--   insert into memberships (org_id, user_id, role)
--   select id, '00000000-0000-0000-0000-000000000000', 'owner' from orgs where slug = 'bay-beach-inn';

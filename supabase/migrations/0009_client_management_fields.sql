-- First-class client-management fields extend the existing clients table.
-- Contacts and operational assignments remain normalized in their existing tables.

alter table public.clients
  add column if not exists legal_name text,
  add column if not exists client_type text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists referral_source text,
  add column if not exists owner_id uuid references public.profiles(id),
  add column if not exists tags text[] not null default '{}';

alter table public.clients drop constraint if exists clients_dates_check;
alter table public.clients add constraint clients_dates_check
  check (end_date is null or start_date is null or end_date >= start_date);
create index if not exists clients_company_owner_idx on public.clients(company_id, owner_id) where archived_at is null;
create index if not exists clients_company_tags_idx on public.clients using gin(tags);

-- Existing data may predate this invariant. Retain the most recently changed
-- primary contact and reclassify any older duplicates as ordinary contacts.
with ranked_contacts as (
  select id, row_number() over (partition by client_id order by updated_at desc, created_at desc, id desc) as position
  from public.client_contacts
  where is_primary and archived_at is null
)
update public.client_contacts c
set is_primary = false
from ranked_contacts r
where c.id = r.id and r.position > 1;

create unique index if not exists client_contacts_one_active_primary
  on public.client_contacts(client_id)
  where is_primary and archived_at is null;

create or replace function public.validate_client_owner_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null and not exists (
    select 1
    from public.memberships m
    where m.user_id = new.owner_id
      and m.company_id = new.company_id
      and m.status = 'active'
      and m.archived_at is null
  ) then
    raise exception 'Client owner must be an active member of the client company';
  end if;
  return new;
end;
$$;

drop trigger if exists clients_validate_owner_scope on public.clients;
create trigger clients_validate_owner_scope
before insert or update on public.clients
for each row execute procedure public.validate_client_owner_scope();

-- This read-only helper returns only active members of the selected company and
-- preserves the company permission boundary for owner selection.
create or replace function public.client_management_profiles(target_company uuid)
returns table(id uuid, display_name text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(target_company, 'clients.read') then
    raise exception 'Client read permission is required for this company';
  end if;
  return query
  select distinct p.id, p.display_name, p.email
  from public.profiles p
  join public.memberships m on m.user_id = p.id
  where m.company_id = target_company
    and m.status = 'active'
    and m.archived_at is null
    and p.deactivated_at is null
  order by p.display_name nulls last, p.email;
end;
$$;

grant execute on function public.client_management_profiles(uuid) to authenticated;

insert into public.company_modules(company_id, module_key, enabled)
select id, 'clients', true
from public.companies
where slug = 'tidemark-va'
on conflict(company_id, module_key) do update set enabled = true;

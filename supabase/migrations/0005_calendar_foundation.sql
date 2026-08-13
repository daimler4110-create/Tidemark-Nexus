-- Shared calendar foundation. Events are always company scoped and use the
-- same permission/RLS model as the existing operational system of record.

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  client_id uuid references public.clients(id),
  provider_id uuid references public.providers(id),
  clinician_id uuid references public.clinicians(id),
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  source text not null default 'nexus' check (source = 'nexus'),
  external_id text,
  archived_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create index calendar_events_company_starts_idx on public.calendar_events(company_id, starts_at) where archived_at is null;
create index calendar_events_workspace_starts_idx on public.calendar_events(workspace_id, starts_at) where archived_at is null;

create table public.event_participants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  profile_id uuid references public.profiles(id),
  email text,
  response_status text not null default 'pending' check (response_status in ('pending','accepted','declined','tentative')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (profile_id is not null or email is not null)
);
create unique index event_participants_profile_unique on public.event_participants(event_id, profile_id) where profile_id is not null;
create unique index event_participants_email_unique on public.event_participants(event_id, lower(email)) where email is not null;

create or replace function public.validate_calendar_event_scope() returns trigger language plpgsql security definer set search_path=public as $$
declare related_company uuid;
begin
  if new.workspace_id is not null then select company_id into related_company from public.workspaces where id = new.workspace_id; if related_company is distinct from new.company_id then raise exception 'Workspace must belong to event company'; end if; end if;
  if new.client_id is not null then select company_id into related_company from public.clients where id = new.client_id; if related_company is distinct from new.company_id then raise exception 'Client must belong to event company'; end if; end if;
  if new.provider_id is not null then select company_id into related_company from public.providers where id = new.provider_id; if related_company is distinct from new.company_id then raise exception 'Provider must belong to event company'; end if; end if;
  if new.clinician_id is not null then select company_id into related_company from public.clinicians where id = new.clinician_id; if related_company is distinct from new.company_id then raise exception 'Clinician must belong to event company'; end if; end if;
  return new;
end; $$;

create or replace function public.validate_event_participant_scope() returns trigger language plpgsql security definer set search_path=public as $$
declare event_company uuid;
begin
  select company_id into event_company from public.calendar_events where id = new.event_id;
  if event_company is null or event_company <> new.company_id then raise exception 'Participant must belong to the event company'; end if;
  return new;
end; $$;

create trigger calendar_events_set_updated_at before update on public.calendar_events for each row execute procedure public.set_updated_at();
create trigger calendar_events_tenant_scope before insert or update on public.calendar_events for each row execute procedure public.validate_calendar_event_scope();
create trigger event_participants_set_updated_at before update on public.event_participants for each row execute procedure public.set_updated_at();
create trigger event_participants_tenant_scope before insert or update on public.event_participants for each row execute procedure public.validate_event_participant_scope();

alter table public.calendar_events enable row level security;
alter table public.event_participants enable row level security;
create policy calendar_events_read on public.calendar_events for select to authenticated using (public.has_permission(company_id, 'calendar.read'));
create policy calendar_events_create on public.calendar_events for insert to authenticated with check (public.has_permission(company_id, 'calendar.create'));
create policy calendar_events_update on public.calendar_events for update to authenticated using (public.has_permission(company_id, 'calendar.update')) with check (public.has_permission(company_id, 'calendar.update'));
create policy event_participants_read on public.event_participants for select to authenticated using (public.has_permission(company_id, 'calendar.read'));
create policy event_participants_create on public.event_participants for insert to authenticated with check (public.has_permission(company_id, 'calendar.create'));
create policy event_participants_update on public.event_participants for update to authenticated using (public.has_permission(company_id, 'calendar.update')) with check (public.has_permission(company_id, 'calendar.update'));

insert into public.permissions(key, description) values
  ('calendar.read', 'Read calendar events'),
  ('calendar.create', 'Create calendar events'),
  ('calendar.update', 'Update calendar events')
on conflict(key) do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.key in ('global_admin', 'company_admin') and p.key in ('calendar.read', 'calendar.create', 'calendar.update')
on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('calendar.read', 'calendar.create', 'calendar.update')
where r.key = 'manager'
on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key = 'calendar.read'
where r.key in ('member', 'viewer')
on conflict do nothing;

create extension if not exists pgcrypto;

create table public.companies (
  id uuid primary key default gen_random_uuid(), slug text not null unique check (slug in ('tidemark-va','tidemark-therapy','mental-health-managed')),
  name text not null unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, email text not null, display_name text,
  is_global_admin boolean not null default false, deactivated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.roles (
  id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id) on delete cascade,
  key text not null, name text not null, is_system boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,key)
);
create unique index roles_system_key_unique on public.roles(key) where company_id is null;
create table public.permissions (id uuid primary key default gen_random_uuid(), key text not null unique, description text, created_at timestamptz not null default now());
create table public.role_permissions (role_id uuid not null references public.roles(id) on delete cascade, permission_id uuid not null references public.permissions(id) on delete cascade, primary key(role_id,permission_id));
create table public.workspaces (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), name text not null, slug text not null,
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,slug)
);
create table public.memberships (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade, workspace_id uuid references public.workspaces(id) on delete cascade,
  role_id uuid not null references public.roles(id), status text not null default 'active' check(status in ('pending','active','revoked')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique(user_id,company_id,workspace_id)
);
create index memberships_user_company_idx on public.memberships(user_id,company_id) where status='active' and archived_at is null;
create table public.company_modules (company_id uuid not null references public.companies(id) on delete cascade, module_key text not null, enabled boolean not null default true, configuration jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(company_id,module_key));
create table public.invitations (
  id uuid primary key default gen_random_uuid(), email text not null, token_hash text not null unique, company_id uuid not null references public.companies(id), workspace_id uuid references public.workspaces(id), role_id uuid not null references public.roles(id), invited_by uuid references public.profiles(id), expires_at timestamptz not null, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now(), check(expires_at > created_at)
);
create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), company_id uuid references public.companies(id), action text not null, resource_type text not null, resource_id uuid, before_data jsonb, after_data jsonb, created_at timestamptz not null default now());
create index audit_logs_company_created_idx on public.audit_logs(company_id,created_at desc);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,email,display_name) values (new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.email)); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.current_user_company_ids() returns setof uuid language sql stable security definer set search_path=public as $$ select c.id from companies c where exists(select 1 from profiles p where p.id=auth.uid() and p.is_global_admin and p.deactivated_at is null) union select m.company_id from memberships m where m.user_id=auth.uid() and m.status='active' and m.archived_at is null $$;
create or replace function public.has_permission(target_company uuid, permission_key text) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles p where p.id=auth.uid() and p.is_global_admin and p.deactivated_at is null) or exists(select 1 from memberships m join role_permissions rp on rp.role_id=m.role_id join permissions pm on pm.id=rp.permission_id where m.user_id=auth.uid() and m.company_id=target_company and m.status='active' and m.archived_at is null and pm.key=permission_key) $$;
grant execute on function public.current_user_company_ids() to authenticated;
grant execute on function public.has_permission(uuid,text) to authenticated;

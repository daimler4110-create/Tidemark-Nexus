-- Phase 1 hardening. This migration is additive so existing Supabase environments
-- retain their migration history.

alter table public.invitations add column if not exists updated_at timestamptz not null default now();
alter table public.invitations add column if not exists created_by uuid references public.profiles(id);
update public.invitations set created_by = invited_by where created_by is null;
create index if not exists invitations_company_email_idx on public.invitations(company_id, lower(email));
create index if not exists invitations_pending_idx on public.invitations(expires_at) where accepted_at is null and revoked_at is null;
create index if not exists workspaces_company_active_idx on public.workspaces(company_id, name) where archived_at is null;
create index if not exists memberships_workspace_idx on public.memberships(workspace_id) where status = 'active' and archived_at is null;
create unique index if not exists memberships_unique_company_scope on public.memberships(user_id, company_id) where workspace_id is null;
create unique index if not exists memberships_unique_workspace_scope on public.memberships(user_id, company_id, workspace_id) where workspace_id is not null;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists companies_set_updated_at on public.companies;
drop trigger if exists profiles_set_updated_at on public.profiles;
drop trigger if exists roles_set_updated_at on public.roles;
drop trigger if exists workspaces_set_updated_at on public.workspaces;
drop trigger if exists memberships_set_updated_at on public.memberships;
drop trigger if exists invitations_set_updated_at on public.invitations;
drop trigger if exists company_modules_set_updated_at on public.company_modules;
create trigger companies_set_updated_at before update on public.companies for each row execute procedure public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger roles_set_updated_at before update on public.roles for each row execute procedure public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute procedure public.set_updated_at();
create trigger memberships_set_updated_at before update on public.memberships for each row execute procedure public.set_updated_at();
create trigger invitations_set_updated_at before update on public.invitations for each row execute procedure public.set_updated_at();
create trigger company_modules_set_updated_at before update on public.company_modules for each row execute procedure public.set_updated_at();

create or replace function public.validate_tenant_scope() returns trigger language plpgsql security definer set search_path=public as $$
declare role_company_id uuid; workspace_company_id uuid;
begin
  if tg_table_name in ('memberships', 'invitations') then
    select company_id into role_company_id from public.roles where id = new.role_id;
    if role_company_id is not null and role_company_id <> new.company_id then raise exception 'Role must be system-wide or belong to the membership company'; end if;
  end if;
  if new.workspace_id is not null then
    select company_id into workspace_company_id from public.workspaces where id = new.workspace_id;
    if workspace_company_id is null or workspace_company_id <> new.company_id then raise exception 'Workspace must belong to the same company'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists memberships_validate_tenant_scope on public.memberships;
drop trigger if exists invitations_validate_tenant_scope on public.invitations;
create trigger memberships_validate_tenant_scope before insert or update on public.memberships for each row execute procedure public.validate_tenant_scope();
create trigger invitations_validate_tenant_scope before insert or update on public.invitations for each row execute procedure public.validate_tenant_scope();

create or replace function public.has_workspace_access(target_workspace uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles p where p.id = auth.uid() and p.is_global_admin and p.deactivated_at is null)
  or exists(select 1 from workspaces w join memberships m on m.company_id = w.company_id where w.id = target_workspace and m.user_id = auth.uid() and m.status = 'active' and m.archived_at is null and (m.workspace_id is null or m.workspace_id = target_workspace));
$$;
create or replace function public.has_workspace_permission(target_workspace uuid, permission_key text) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles p where p.id = auth.uid() and p.is_global_admin and p.deactivated_at is null)
  or exists(select 1 from workspaces w join memberships m on m.company_id = w.company_id join role_permissions rp on rp.role_id = m.role_id join permissions p on p.id = rp.permission_id where w.id = target_workspace and m.user_id = auth.uid() and m.status = 'active' and m.archived_at is null and (m.workspace_id is null or m.workspace_id = target_workspace) and p.key = permission_key);
$$;
-- Company-scoped permissions require a company membership, not merely a workspace grant.
create or replace function public.has_permission(target_company uuid, permission_key text) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles p where p.id = auth.uid() and p.is_global_admin and p.deactivated_at is null)
  or exists(select 1 from memberships m join role_permissions rp on rp.role_id = m.role_id join permissions pm on pm.id = rp.permission_id where m.user_id = auth.uid() and m.company_id = target_company and m.workspace_id is null and m.status = 'active' and m.archived_at is null and pm.key = permission_key);
$$;
create or replace function public.current_user_permission_keys(target_company uuid) returns setof text language sql stable security definer set search_path=public as $$
  select p.key from public.permissions p where exists(select 1 from profiles pr where pr.id = auth.uid() and pr.is_global_admin and pr.deactivated_at is null)
  union
  select p.key from memberships m join role_permissions rp on rp.role_id = m.role_id join permissions p on p.id = rp.permission_id
  where m.user_id = auth.uid() and m.company_id = target_company and m.workspace_id is null and m.status = 'active' and m.archived_at is null;
$$;
grant execute on function public.has_workspace_access(uuid) to authenticated;
grant execute on function public.has_workspace_permission(uuid,text) to authenticated;
grant execute on function public.current_user_permission_keys(uuid) to authenticated;

drop policy if exists workspaces_read on public.workspaces;
create policy workspaces_read on public.workspaces for select to authenticated using (archived_at is null and public.has_workspace_access(id));
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated using (user_id = auth.uid() or public.has_permission(company_id, 'users.invite'));
drop policy if exists invitations_manage on public.invitations;
create policy invitations_read on public.invitations for select to authenticated using (public.has_permission(company_id, 'users.invite'));
create policy invitations_insert on public.invitations for insert to authenticated with check (public.has_permission(company_id, 'users.invite') and created_by = auth.uid());
create policy invitations_update on public.invitations for update to authenticated using (public.has_permission(company_id, 'users.invite')) with check (public.has_permission(company_id, 'users.invite'));

-- Invitation recipients do not have membership privileges yet. This tightly scoped
-- transaction checks the JWT identity's email before activating the one-time invite.
create or replace function public.accept_invitation(raw_token text) returns uuid language plpgsql security definer set search_path=public as $$
declare invitation_row public.invitations%rowtype; profile_email text;
begin
  if char_length(raw_token) < 32 then raise exception 'Invalid invitation token'; end if;
  select * into invitation_row from public.invitations
    where token_hash = encode(digest(raw_token, 'sha256'), 'hex') and accepted_at is null and revoked_at is null and expires_at > now()
    for update;
  if not found then raise exception 'Invitation is invalid, expired, or already accepted'; end if;
  select email into profile_email from public.profiles where id = auth.uid() and deactivated_at is null;
  if profile_email is null or lower(profile_email) <> lower(invitation_row.email) then raise exception 'Invitation email does not match authenticated account'; end if;
  if invitation_row.workspace_id is null then
    insert into public.memberships(user_id, company_id, workspace_id, role_id, status, archived_at)
    values (auth.uid(), invitation_row.company_id, null, invitation_row.role_id, 'active', null)
    on conflict (user_id, company_id) where workspace_id is null do update set role_id = excluded.role_id, status = 'active', archived_at = null;
  else
    insert into public.memberships(user_id, company_id, workspace_id, role_id, status, archived_at)
    values (auth.uid(), invitation_row.company_id, invitation_row.workspace_id, invitation_row.role_id, 'active', null)
    on conflict (user_id, company_id, workspace_id) where workspace_id is not null do update set role_id = excluded.role_id, status = 'active', archived_at = null;
  end if;
  update public.invitations set accepted_at = now() where id = invitation_row.id;
  insert into public.audit_logs(actor_id, company_id, action, resource_type, resource_id, after_data)
    values (auth.uid(), invitation_row.company_id, 'invitation.accepted', 'invitation', invitation_row.id, jsonb_build_object('workspace_id', invitation_row.workspace_id, 'role_id', invitation_row.role_id));
  return invitation_row.company_id;
end;
$$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

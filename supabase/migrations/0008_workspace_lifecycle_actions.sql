-- Workspace lifecycle controls are additive. Archive remains the normal action;
-- permanent deletion is limited to empty, authorized workspaces.

insert into public.permissions(key, description)
values ('workspace.delete', 'Permanently delete empty workspaces')
on conflict(key) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key = 'workspace.delete'
where r.key = 'global_admin'
on conflict do nothing;

-- Replace the historic all-operations workspace policy so DELETE is never
-- inferred from workspace.manage. Administrators retain read access to archived
-- workspace metadata; normal workspace access continues to include active rows only.
drop policy if exists workspaces_manage on public.workspaces;
create policy workspaces_admin_read on public.workspaces for select to authenticated
  using (public.has_permission(company_id, 'workspace.manage') or public.has_permission(company_id, 'workspace.delete'));
create policy workspaces_create on public.workspaces for insert to authenticated
  with check (public.has_permission(company_id, 'workspace.manage'));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.has_permission(company_id, 'workspace.manage'))
  with check (public.has_permission(company_id, 'workspace.manage'));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (public.has_permission(company_id, 'workspace.delete'));

-- Archived workspaces cannot be entered or operated through a workspace-scoped
-- membership. Global administrators retain their company-wide authority and can
-- inspect archived metadata through workspace management.
create or replace function public.has_workspace_access(target_workspace uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles p where p.id = auth.uid() and p.is_global_admin and p.deactivated_at is null)
  or exists(select 1 from workspaces w join memberships m on m.company_id = w.company_id where w.id = target_workspace and w.archived_at is null and m.user_id = auth.uid() and m.status = 'active' and m.archived_at is null and (m.workspace_id is null or m.workspace_id = target_workspace));
$$;

create or replace function public.has_workspace_permission(target_workspace uuid, permission_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles p where p.id = auth.uid() and p.is_global_admin and p.deactivated_at is null)
  or exists(select 1 from workspaces w join memberships m on m.company_id = w.company_id join role_permissions rp on rp.role_id = m.role_id join permissions p on p.id = rp.permission_id where w.id = target_workspace and w.archived_at is null and m.user_id = auth.uid() and m.status = 'active' and m.archived_at is null and (m.workspace_id is null or m.workspace_id = target_workspace) and p.key = permission_key);
$$;

create or replace function public.workspace_delete_dependencies(p_workspace_id uuid, p_company_id uuid)
returns table(dependency text, record_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(p_company_id, 'workspace.delete') then
    raise exception 'Permanent workspace deletion permission is required for this company';
  end if;

  if not exists (
    select 1
    from public.workspaces w
    where w.id = p_workspace_id and w.company_id = p_company_id
  ) then
    raise exception 'Workspace was not found in the selected company';
  end if;

  return query
  select d.dependency, d.record_count
  from (
    select 'workspace memberships'::text as dependency, count(*)::bigint as record_count from public.memberships m where m.company_id = p_company_id and m.workspace_id = p_workspace_id
    union all select 'workspace invitations', count(*)::bigint from public.invitations i where i.company_id = p_company_id and i.workspace_id = p_workspace_id
    union all select 'providers', count(*)::bigint from public.providers p where p.company_id = p_company_id and p.workspace_id = p_workspace_id
    union all select 'clinicians', count(*)::bigint from public.clinicians c where c.company_id = p_company_id and c.workspace_id = p_workspace_id
    union all select 'clients', count(*)::bigint from public.clients c where c.company_id = p_company_id and c.workspace_id = p_workspace_id
    union all select 'activities', count(*)::bigint from public.activities a where a.company_id = p_company_id and a.workspace_id = p_workspace_id
    union all select 'invoices', count(*)::bigint from public.invoices i where i.company_id = p_company_id and i.workspace_id = p_workspace_id
    union all select 'billable records', count(*)::bigint from public.billable_records b where b.company_id = p_company_id and b.workspace_id = p_workspace_id
    union all select 'pay periods', count(*)::bigint from public.pay_periods pp where pp.company_id = p_company_id and pp.workspace_id = p_workspace_id
    union all select 'documents', count(*)::bigint from public.documents dcm where dcm.company_id = p_company_id and dcm.workspace_id = p_workspace_id
    union all select 'calendar events', count(*)::bigint from public.calendar_events ce where ce.company_id = p_company_id and ce.workspace_id = p_workspace_id
  ) as d
  where d.record_count > 0;
end;
$$;

create or replace function public.prevent_unsafe_workspace_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.workspace_delete_dependencies(old.id, old.company_id) as d) then
    raise exception 'Permanent workspace deletion is blocked by protected dependent records. Archive this workspace instead.';
  end if;
  return old;
end;
$$;

drop trigger if exists workspaces_prevent_unsafe_delete on public.workspaces;
create trigger workspaces_prevent_unsafe_delete
before delete on public.workspaces
for each row execute procedure public.prevent_unsafe_workspace_delete();

grant execute on function public.workspace_delete_dependencies(uuid, uuid) to authenticated;
grant execute on function public.has_workspace_access(uuid) to authenticated;
grant execute on function public.has_workspace_permission(uuid, text) to authenticated;

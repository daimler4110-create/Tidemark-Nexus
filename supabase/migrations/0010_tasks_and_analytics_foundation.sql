-- Production task foundation for Tidemark VA.  Task state is operational data;
-- dashboard values are derived from it and are never stored separately.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  title text not null check (length(btrim(title)) > 0),
  description text,
  status text not null default 'not_started'
    check (status in ('not_started', 'working', 'waiting', 'blocked', 'done')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  assignee_id uuid references public.profiles(id),
  due_at timestamptz,
  completed_at timestamptz,
  client_id uuid references public.clients(id),
  provider_id uuid references public.providers(id),
  clinician_id uuid references public.clinicians(id),
  credential_id uuid references public.credentials(id),
  invoice_id uuid references public.invoices(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index tasks_company_status_due_idx on public.tasks(company_id, status, due_at) where archived_at is null;
create index tasks_company_assignee_idx on public.tasks(company_id, assignee_id) where archived_at is null;
create index tasks_company_workspace_idx on public.tasks(company_id, workspace_id) where archived_at is null;
create index tasks_client_idx on public.tasks(client_id) where archived_at is null;

insert into public.permissions(key, description) values
  ('tasks.read', 'Read tasks'),
  ('tasks.create', 'Create tasks'),
  ('tasks.update', 'Update tasks'),
  ('tasks.archive', 'Archive tasks'),
  ('tasks.delete', 'Permanently delete disposable tasks')
on conflict(key) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('tasks.read', 'tasks.create', 'tasks.update', 'tasks.archive', 'tasks.delete')
where r.key = 'global_admin'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('tasks.read', 'tasks.create', 'tasks.update', 'tasks.archive')
where r.key in ('company_admin', 'manager')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key = 'tasks.read'
where r.key in ('member', 'viewer')
on conflict do nothing;

insert into public.company_modules(company_id, module_key, enabled)
select c.id, 'tasks', true
from public.companies c
where c.slug = 'tidemark-va'
on conflict(company_id, module_key) do update set enabled = true;

alter table public.tasks enable row level security;
create policy tasks_read on public.tasks for select to authenticated
  using (public.has_permission(company_id, 'tasks.read') and (workspace_id is null or public.has_workspace_permission(workspace_id, 'tasks.read')));
create policy tasks_create on public.tasks for insert to authenticated
  with check (public.has_permission(company_id, 'tasks.create') and (workspace_id is null or public.has_workspace_permission(workspace_id, 'tasks.create')));
create policy tasks_update on public.tasks for update to authenticated
  using (public.has_permission(company_id, 'tasks.update') and (workspace_id is null or public.has_workspace_permission(workspace_id, 'tasks.update')))
  with check (public.has_permission(company_id, 'tasks.update') and (workspace_id is null or public.has_workspace_permission(workspace_id, 'tasks.update')));
create policy tasks_archive on public.tasks for update to authenticated
  using (public.has_permission(company_id, 'tasks.archive') and (workspace_id is null or public.has_workspace_permission(workspace_id, 'tasks.archive')))
  with check (public.has_permission(company_id, 'tasks.archive') and (workspace_id is null or public.has_workspace_permission(workspace_id, 'tasks.archive')));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_permission(company_id, 'tasks.delete') and (workspace_id is null or public.has_workspace_permission(workspace_id, 'tasks.delete')));

create policy workspaces_tasks_read on public.workspaces for select to authenticated
  using (archived_at is null and public.has_permission(company_id, 'tasks.read') and public.has_workspace_access(id));

create or replace function public.validate_task_assignee_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null and not exists (
    select 1 from public.memberships m
    where m.user_id = new.assignee_id
      and m.company_id = new.company_id
      and m.status = 'active'
      and m.archived_at is null
      and (new.workspace_id is null or m.workspace_id is null or m.workspace_id = new.workspace_id)
  ) then
    raise exception 'Task assignee must be an active member of the task company and workspace';
  end if;
  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_archive_permission() returns trigger
language plpgsql security definer set search_path=public as $$
declare required_permission text;
begin
  if old.archived_at is null and new.archived_at is not null then
    required_permission := case tg_table_name
      when 'providers' then 'providers.archive'
      when 'clinicians' then 'clinicians.archive'
      when 'clients' then 'clients.archive'
      when 'credentials' then 'credentials.archive'
      when 'documents' then 'documents.archive'
      when 'tasks' then 'tasks.archive'
      else null
    end;
    if required_permission is not null and not public.has_permission(new.company_id, required_permission) then
      raise exception 'Archive permission is required';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_task_update_permission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.has_permission(new.company_id, 'tasks.update') then return new; end if;
  if not public.has_permission(new.company_id, 'tasks.archive')
    or old.archived_at is not null or new.archived_at is null
    or new.company_id is distinct from old.company_id or new.workspace_id is distinct from old.workspace_id
    or new.title is distinct from old.title or new.description is distinct from old.description
    or new.status is distinct from old.status or new.priority is distinct from old.priority
    or new.assignee_id is distinct from old.assignee_id or new.due_at is distinct from old.due_at
    or new.completed_at is distinct from old.completed_at or new.client_id is distinct from old.client_id
    or new.provider_id is distinct from old.provider_id or new.clinician_id is distinct from old.clinician_id
    or new.credential_id is distinct from old.credential_id or new.invoice_id is distinct from old.invoice_id
    or new.created_by is distinct from old.created_by then
    raise exception 'Task update permission is required; archive permission can only archive an active task';
  end if;
  return new;
end;
$$;

create trigger tasks_set_updated_at before update on public.tasks
for each row execute procedure public.set_updated_at();
create trigger tasks_tenant_scope before insert or update on public.tasks
for each row execute procedure public.validate_va_tenant_scope();
create trigger tasks_validate_assignee_scope before insert or update on public.tasks
for each row execute procedure public.validate_task_assignee_scope();
create trigger tasks_enforce_update_permission before update on public.tasks
for each row execute procedure public.enforce_task_update_permission();
create trigger tasks_enforce_archive before update on public.tasks
for each row execute procedure public.enforce_archive_permission();

-- Keep the original safe-delete RPC contract and add task-aware dependency
-- protection.  Alias-qualified output columns prevent the 0006 ambiguity from
-- returning when this function is regenerated.
create or replace function public.va_delete_dependencies(target_table text, target_id uuid, target_company uuid)
returns table(dependency text, record_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare required_permission text;
begin
  required_permission := case target_table
    when 'clients' then 'clients.delete'
    when 'providers' then 'providers.delete'
    when 'clinicians' then 'clinicians.delete'
    when 'credentials' then 'credentials.delete'
    when 'tasks' then 'tasks.delete'
    else null
  end;
  if required_permission is null or not public.has_permission(target_company, required_permission) then
    raise exception 'Permanent deletion permission is required for this company';
  end if;
  return query
  select d.dependency, d.record_count
  from (
    select 'client contacts'::text as dependency, count(*)::bigint as record_count from public.client_contacts where target_table = 'clients' and company_id = target_company and client_id = target_id
    union all select 'client assignments', count(*)::bigint from public.client_assignments where company_id = target_company and ((target_table = 'clients' and client_id = target_id) or (target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
    union all select 'activities', count(*)::bigint from public.activities where company_id = target_company and ((target_table = 'clients' and subject_type = 'client' and subject_id = target_id) or (target_table = 'providers' and subject_type = 'provider' and subject_id = target_id) or (target_table = 'clinicians' and subject_type = 'clinician' and subject_id = target_id) or (target_table = 'credentials' and subject_type = 'credential' and subject_id = target_id) or (target_table = 'tasks' and subject_type = 'task' and subject_id = target_id))
    union all select 'credentials', count(*)::bigint from public.credentials where company_id = target_company and ((target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
    union all select 'billable records', count(*)::bigint from public.billable_records where company_id = target_company and ((target_table = 'clients' and client_id = target_id) or (target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
    union all select 'invoices', count(*)::bigint from public.invoices where target_table = 'clients' and company_id = target_company and client_id = target_id
    union all select 'payments', count(*)::bigint from public.payments where target_table = 'clients' and company_id = target_company and client_id = target_id
    union all select 'payroll records', count(*)::bigint from public.payroll_records where company_id = target_company and ((target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
    union all select 'documents', count(*)::bigint from public.documents where company_id = target_company and ((target_table = 'clients' and client_id = target_id) or (target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id) or (target_table = 'credentials' and credential_id = target_id))
    union all select 'calendar events', count(*)::bigint from public.calendar_events where company_id = target_company and ((target_table = 'clients' and client_id = target_id) or (target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
  ) as d
  where d.record_count > 0;
end;
$$;

create trigger tasks_prevent_unsafe_delete before delete on public.tasks
for each row execute procedure public.prevent_unsafe_va_delete();

-- Workspaces may not be deleted while they still own operational tasks.
create or replace function public.workspace_delete_dependencies(p_workspace_id uuid, p_company_id uuid)
returns table(dependency text, record_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(p_company_id, 'workspace.delete') then
    raise exception 'Permanent workspace deletion permission is required for this company';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.company_id = p_company_id) then
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
    union all select 'tasks', count(*)::bigint from public.tasks t where t.company_id = p_company_id and t.workspace_id = p_workspace_id
    union all select 'invoices', count(*)::bigint from public.invoices i where i.company_id = p_company_id and i.workspace_id = p_workspace_id
    union all select 'billable records', count(*)::bigint from public.billable_records b where b.company_id = p_company_id and b.workspace_id = p_workspace_id
    union all select 'pay periods', count(*)::bigint from public.pay_periods pp where pp.company_id = p_company_id and pp.workspace_id = p_workspace_id
    union all select 'documents', count(*)::bigint from public.documents dcm where dcm.company_id = p_company_id and dcm.workspace_id = p_workspace_id
    union all select 'calendar events', count(*)::bigint from public.calendar_events ce where ce.company_id = p_company_id and ce.workspace_id = p_workspace_id
  ) as d
  where d.record_count > 0;
end;
$$;

create or replace function public.task_assignment_options(target_company uuid, target_workspace uuid default null)
returns table(id uuid, display_name text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_permission(target_company, 'tasks.read') or public.has_permission(target_company, 'tasks.create')) then
    raise exception 'Task permission is required for this company';
  end if;
  return query
  select distinct p.id, p.display_name, p.email
  from public.profiles p
  join public.memberships m on m.user_id = p.id
  where m.company_id = target_company
    and m.status = 'active'
    and m.archived_at is null
    and p.deactivated_at is null
    and (target_workspace is null or m.workspace_id is null or m.workspace_id = target_workspace)
  order by p.display_name nulls last, p.email;
end;
$$;

grant execute on function public.va_delete_dependencies(text, uuid, uuid) to authenticated;
grant execute on function public.task_assignment_options(uuid, uuid) to authenticated;

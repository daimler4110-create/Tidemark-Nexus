-- Explicit, tenant-safe permanent deletion for disposable operational records.
-- Financial, payroll, document, activity, and audit history always blocks hard deletion.

insert into public.permissions(key, description) values
  ('clients.delete', 'Permanently delete disposable clients'),
  ('providers.delete', 'Permanently delete disposable providers'),
  ('clinicians.delete', 'Permanently delete disposable clinicians'),
  ('credentials.delete', 'Permanently delete disposable credentials'),
  ('calendar.delete', 'Delete calendar events')
on conflict(key) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('clients.delete', 'providers.delete', 'clinicians.delete', 'credentials.delete', 'calendar.delete')
where r.key = 'global_admin'
on conflict do nothing;

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete to authenticated using (public.has_permission(company_id, 'clients.delete'));
drop policy if exists providers_delete on public.providers;
create policy providers_delete on public.providers for delete to authenticated using (public.has_permission(company_id, 'providers.delete'));
drop policy if exists clinicians_delete on public.clinicians;
create policy clinicians_delete on public.clinicians for delete to authenticated using (public.has_permission(company_id, 'clinicians.delete'));
drop policy if exists credentials_delete on public.credentials;
create policy credentials_delete on public.credentials for delete to authenticated using (public.has_permission(company_id, 'credentials.delete'));
drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete on public.calendar_events for delete to authenticated using (public.has_permission(company_id, 'calendar.delete'));
drop policy if exists event_participants_delete on public.event_participants;
create policy event_participants_delete on public.event_participants for delete to authenticated using (public.has_permission(company_id, 'calendar.delete'));

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
    else null
  end;
  if required_permission is null or not public.has_permission(target_company, required_permission) then
    raise exception 'Permanent deletion permission is required for this company';
  end if;
  return query select dependency, record_count from (
    select 'client contacts'::text as dependency, count(*)::bigint as record_count from public.client_contacts where target_table = 'clients' and company_id = target_company and client_id = target_id
    union all select 'client assignments', count(*)::bigint from public.client_assignments where company_id = target_company and ((target_table = 'clients' and client_id = target_id) or (target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
    union all select 'activities', count(*)::bigint from public.activities where company_id = target_company and ((target_table = 'clients' and subject_type = 'client' and subject_id = target_id) or (target_table = 'providers' and subject_type = 'provider' and subject_id = target_id) or (target_table = 'clinicians' and subject_type = 'clinician' and subject_id = target_id) or (target_table = 'credentials' and subject_type = 'credential' and subject_id = target_id))
    union all select 'credentials', count(*)::bigint from public.credentials where company_id = target_company and ((target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
    union all select 'billable records', count(*)::bigint from public.billable_records where company_id = target_company and ((target_table = 'clients' and client_id = target_id) or (target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
    union all select 'invoices', count(*)::bigint from public.invoices where target_table = 'clients' and company_id = target_company and client_id = target_id
    union all select 'payments', count(*)::bigint from public.payments where target_table = 'clients' and company_id = target_company and client_id = target_id
    union all select 'payroll records', count(*)::bigint from public.payroll_records where company_id = target_company and ((target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
    union all select 'documents', count(*)::bigint from public.documents where company_id = target_company and ((target_table = 'clients' and client_id = target_id) or (target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id) or (target_table = 'credentials' and credential_id = target_id))
    union all select 'calendar events', count(*)::bigint from public.calendar_events where company_id = target_company and ((target_table = 'clients' and client_id = target_id) or (target_table = 'providers' and provider_id = target_id) or (target_table = 'clinicians' and clinician_id = target_id))
  ) dependencies where record_count > 0;
end;
$$;
grant execute on function public.va_delete_dependencies(text, uuid, uuid) to authenticated;

create or replace function public.prevent_unsafe_va_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from public.va_delete_dependencies(tg_table_name, old.id, old.company_id)) then
    raise exception 'Permanent deletion is blocked by protected dependent records. Archive this record instead.';
  end if;
  return old;
end;
$$;
create trigger clients_prevent_unsafe_delete before delete on public.clients for each row execute procedure public.prevent_unsafe_va_delete();
create trigger providers_prevent_unsafe_delete before delete on public.providers for each row execute procedure public.prevent_unsafe_va_delete();
create trigger clinicians_prevent_unsafe_delete before delete on public.clinicians for each row execute procedure public.prevent_unsafe_va_delete();
create trigger credentials_prevent_unsafe_delete before delete on public.credentials for each row execute procedure public.prevent_unsafe_va_delete();

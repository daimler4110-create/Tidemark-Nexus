-- The previous dependency function exposed RETURNS TABLE output columns named
-- dependency and record_count. In PL/pgSQL those are variables, so the
-- unqualified outer SELECT was ambiguous with the derived table columns.
-- Keep the existing RPC argument and response names for the application, but
-- qualify every derived-table column reference.

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

  return query
  select d.dependency, d.record_count
  from (
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
  ) as d
  where d.record_count > 0;
end;
$$;

create or replace function public.prevent_unsafe_va_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.va_delete_dependencies(tg_table_name, old.id, old.company_id) as d) then
    raise exception 'Permanent deletion is blocked by protected dependent records. Archive this record instead.';
  end if;
  return old;
end;
$$;

grant execute on function public.va_delete_dependencies(text, uuid, uuid) to authenticated;

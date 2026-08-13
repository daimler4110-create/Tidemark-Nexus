-- Tidemark VA operational foundation. All records remain company-keyed and RLS-protected.

create table public.providers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), workspace_id uuid references public.workspaces(id),
  provider_code text, first_name text not null, middle_name text, last_name text not null, display_name text, email text, phone text,
  status text not null default 'active', provider_type text, specialty text, notes text, start_date date, end_date date,
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create unique index providers_company_code_unique on public.providers(company_id, provider_code) where provider_code is not null;
create index providers_company_active_idx on public.providers(company_id, status) where archived_at is null;
create index providers_company_name_idx on public.providers(company_id, last_name, first_name) where archived_at is null;

create table public.clinicians (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), workspace_id uuid references public.workspaces(id),
  clinician_code text, first_name text not null, middle_name text, last_name text not null, display_name text, email text, phone text,
  status text not null default 'active', role text, specialty text, notes text, start_date date, end_date date,
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create unique index clinicians_company_code_unique on public.clinicians(company_id, clinician_code) where clinician_code is not null;
create index clinicians_company_active_idx on public.clinicians(company_id, status) where archived_at is null;
create index clinicians_company_name_idx on public.clinicians(company_id, last_name, first_name) where archived_at is null;

create table public.clients (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), workspace_id uuid references public.workspaces(id),
  name text not null, status text not null default 'active', email text, phone text, address_line_1 text, address_line_2 text, city text, state_region text, postal_code text,
  notes text, archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index clients_company_active_idx on public.clients(company_id, status) where archived_at is null;
create index clients_company_name_idx on public.clients(company_id, name) where archived_at is null;

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), client_id uuid not null references public.clients(id),
  first_name text not null, last_name text not null, title text, email text, phone text, is_primary boolean not null default false, notes text,
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index client_contacts_client_idx on public.client_contacts(client_id) where archived_at is null;

create table public.client_assignments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), client_id uuid not null references public.clients(id),
  provider_id uuid references public.providers(id), clinician_id uuid references public.clinicians(id), assignment_role text, notes text,
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (num_nonnulls(provider_id, clinician_id) = 1)
);
create index client_assignments_client_idx on public.client_assignments(client_id) where archived_at is null;

create table public.activities (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), workspace_id uuid references public.workspaces(id),
  subject_type text not null, subject_id uuid not null, activity_type text not null default 'note', title text not null, body text, due_at timestamptz, completed_at timestamptz,
  assigned_to uuid references public.profiles(id), archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index activities_company_subject_idx on public.activities(company_id, subject_type, subject_id) where archived_at is null;
create index activities_company_due_idx on public.activities(company_id, due_at) where archived_at is null;

create table public.credential_monitor_configs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null unique references public.companies(id), enabled boolean not null default false,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0), notes text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.credentials (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), provider_id uuid references public.providers(id), clinician_id uuid references public.clinicians(id),
  credential_type text not null, credential_number text, issuing_authority text, issue_date date, expiration_date date, status text not null default 'pending', renewal_status text, notes text,
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (num_nonnulls(provider_id, clinician_id) = 1), check (expiration_date is null or issue_date is null or expiration_date >= issue_date)
);
create index credentials_company_status_expiry_idx on public.credentials(company_id, status, expiration_date) where archived_at is null;

create table public.invoices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), workspace_id uuid references public.workspaces(id), client_id uuid not null references public.clients(id),
  invoice_number text not null, billing_period_start date, billing_period_end date, issue_date date, due_date date, subtotal numeric(14,2) not null default 0 check (subtotal >= 0), adjustments numeric(14,2) not null default 0,
  total numeric(14,2) generated always as (subtotal + adjustments) stored, status text not null default 'draft' check (status in ('draft','approved','sent','partially_paid','paid','void','cancelled')),
  notes text, archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (billing_period_end is null or billing_period_start is null or billing_period_end >= billing_period_start), check (subtotal + adjustments >= 0)
);
create unique index invoices_company_number_unique on public.invoices(company_id, invoice_number);
create index invoices_company_status_due_idx on public.invoices(company_id, status, due_date) where archived_at is null;
create index invoices_client_idx on public.invoices(client_id) where archived_at is null;

create table public.billable_records (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), workspace_id uuid references public.workspaces(id), client_id uuid not null references public.clients(id),
  provider_id uuid references public.providers(id), clinician_id uuid references public.clinicians(id), billing_period_start date, billing_period_end date, service_date date,
  description text not null, quantity numeric(12,2), unit_amount numeric(14,2), status text not null default 'draft', notes text, invoice_id uuid references public.invoices(id),
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (quantity is null or quantity >= 0), check (unit_amount is null or unit_amount >= 0), check (billing_period_end is null or billing_period_start is null or billing_period_end >= billing_period_start), check (num_nonnulls(provider_id, clinician_id) <= 1)
);
create index billable_records_company_status_idx on public.billable_records(company_id, status) where archived_at is null;
create index billable_records_client_idx on public.billable_records(client_id) where archived_at is null;

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), invoice_id uuid not null references public.invoices(id) on delete cascade, billable_record_id uuid references public.billable_records(id),
  description text not null, quantity numeric(12,2) not null default 1 check (quantity >= 0), unit_amount numeric(14,2) not null default 0 check (unit_amount >= 0),
  line_total numeric(14,2) generated always as (quantity * unit_amount) stored, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), client_id uuid not null references public.clients(id), invoice_id uuid not null references public.invoices(id),
  amount numeric(14,2) not null check (amount > 0), payment_date date not null default current_date, payment_method text, reference text, status text not null default 'pending' check (status in ('pending','succeeded','failed','void')), notes text,
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index payments_invoice_status_idx on public.payments(invoice_id, status) where archived_at is null;
create index payments_company_date_idx on public.payments(company_id, payment_date) where archived_at is null;

create table public.pay_periods (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), workspace_id uuid references public.workspaces(id),
  start_date date not null, end_date date not null, status text not null default 'draft' check (status in ('draft','review','approved','finalized','paid')),
  review_state text, approval_state text, finalized_at timestamptz, finalized_by uuid references public.profiles(id), paid_at timestamptz, paid_by uuid references public.profiles(id), notes text,
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (end_date >= start_date)
);
create unique index pay_periods_company_dates_unique on public.pay_periods(company_id, start_date, end_date) where archived_at is null;
create index pay_periods_company_status_idx on public.pay_periods(company_id, status) where archived_at is null;

create table public.payroll_records (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), pay_period_id uuid not null references public.pay_periods(id),
  provider_id uuid references public.providers(id), clinician_id uuid references public.clinicians(id), status text not null default 'draft' check (status in ('draft','review','approved','finalized','paid')),
  gross_input_amount numeric(14,2), adjustments numeric(14,2) not null default 0, approved_amount numeric(14,2), notes text, reviewed_at timestamptz, reviewed_by uuid references public.profiles(id), approved_at timestamptz, approved_by uuid references public.profiles(id), finalized_at timestamptz, finalized_by uuid references public.profiles(id), paid_at timestamptz, paid_by uuid references public.profiles(id),
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (num_nonnulls(provider_id, clinician_id) = 1)
);
create index payroll_records_period_idx on public.payroll_records(pay_period_id) where archived_at is null;
create index payroll_records_company_status_idx on public.payroll_records(company_id, status) where archived_at is null;

create table public.payroll_items (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), payroll_record_id uuid not null references public.payroll_records(id) on delete cascade,
  description text not null, item_type text not null default 'manual_input', quantity numeric(12,2), rate numeric(14,2), amount numeric(14,2) not null, is_adjustment boolean not null default false, memo text,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index payroll_items_record_idx on public.payroll_items(payroll_record_id);

create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), payroll_record_id uuid not null references public.payroll_records(id),
  adjustment_type text not null, amount numeric(14,2), memo text not null, status text not null default 'proposed' check (status in ('proposed','approved','applied','rejected')),
  approved_at timestamptz, approved_by uuid references public.profiles(id), created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index payroll_adjustments_record_idx on public.payroll_adjustments(payroll_record_id, status);

create table public.documents (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), workspace_id uuid references public.workspaces(id),
  provider_id uuid references public.providers(id), clinician_id uuid references public.clinicians(id), client_id uuid references public.clients(id), credential_id uuid references public.credentials(id), invoice_id uuid references public.invoices(id), payroll_record_id uuid references public.payroll_records(id),
  bucket_id text not null default 'nexus-private', storage_path text not null unique, file_name text not null, content_type text, byte_size bigint check (byte_size is null or byte_size >= 0), notes text,
  archived_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index documents_company_idx on public.documents(company_id) where archived_at is null;

create or replace function public.validate_va_tenant_scope() returns trigger language plpgsql security definer set search_path=public as $$
declare related_company uuid; row_data jsonb := to_jsonb(new); related_id uuid;
begin
  if row_data->>'workspace_id' is not null then select company_id into related_company from public.workspaces where id = (row_data->>'workspace_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Workspace must belong to record company'; end if; end if;
  if row_data->>'client_id' is not null then select company_id into related_company from public.clients where id = (row_data->>'client_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Client must belong to record company'; end if; end if;
  if row_data->>'provider_id' is not null then select company_id into related_company from public.providers where id = (row_data->>'provider_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Provider must belong to record company'; end if; end if;
  if row_data->>'clinician_id' is not null then select company_id into related_company from public.clinicians where id = (row_data->>'clinician_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Clinician must belong to record company'; end if; end if;
  if row_data->>'invoice_id' is not null then select company_id into related_company from public.invoices where id = (row_data->>'invoice_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Invoice must belong to record company'; end if; end if;
  if row_data->>'payroll_record_id' is not null then select company_id into related_company from public.payroll_records where id = (row_data->>'payroll_record_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Payroll record must belong to record company'; end if; end if;
  if row_data->>'billable_record_id' is not null then select company_id into related_company from public.billable_records where id = (row_data->>'billable_record_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Billable record must belong to record company'; end if; end if;
  if row_data->>'credential_id' is not null then select company_id into related_company from public.credentials where id = (row_data->>'credential_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Credential must belong to record company'; end if; end if;
  if row_data->>'pay_period_id' is not null then select company_id into related_company from public.pay_periods where id = (row_data->>'pay_period_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Pay period must belong to record company'; end if; end if;
  return new;
end; $$;

create or replace function public.refresh_invoice_subtotal() returns trigger language plpgsql security definer set search_path=public as $$
declare target_invoice uuid;
begin
  target_invoice := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  update public.invoices set subtotal = coalesce((select sum(line_total) from public.invoice_lines where invoice_id = target_invoice), 0) where id = target_invoice;
  return null;
end; $$;

create or replace function public.validate_payment_application() returns trigger language plpgsql security definer set search_path=public as $$
declare invoice_total numeric; invoice_company uuid; invoice_client uuid; other_applied numeric;
begin
  select total, company_id, client_id into invoice_total, invoice_company, invoice_client from public.invoices where id = new.invoice_id for update;
  if invoice_company is distinct from new.company_id or invoice_client is distinct from new.client_id then raise exception 'Payment, invoice, and client must share a company/client scope'; end if;
  if new.status = 'succeeded' then
    select coalesce(sum(amount),0) into other_applied from public.payments where invoice_id = new.invoice_id and status = 'succeeded' and archived_at is null and id is distinct from new.id;
    if other_applied + new.amount > invoice_total then raise exception 'Successful payments cannot exceed invoice total'; end if;
  end if;
  return new;
end; $$;

create or replace function public.enforce_invoice_transition() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' and new.status <> 'draft' and not public.has_permission(new.company_id, 'invoices.approve') then raise exception 'Only authorized users may create non-draft invoices'; end if;
  if tg_op = 'UPDATE' and new.status <> old.status then
    if new.status = 'approved' and old.status = 'draft' and public.has_permission(new.company_id, 'invoices.approve') then return new; end if;
    if new.status = 'sent' and old.status = 'approved' and public.has_permission(new.company_id, 'invoices.update') then return new; end if;
    if new.status in ('void','cancelled') and public.has_permission(new.company_id, 'invoices.void') then return new; end if;
    if new.status in ('partially_paid','paid') and public.has_permission(new.company_id, 'payments.create') then return new; end if;
    raise exception 'Invoice status transition is not permitted';
  end if;
  return new;
end; $$;

create or replace function public.sync_invoice_payment_status() returns trigger language plpgsql security definer set search_path=public as $$
declare invoice_total numeric; paid_total numeric; next_status text; target_invoice uuid;
begin
  target_invoice := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  select total into invoice_total from public.invoices where id = target_invoice for update;
  select coalesce(sum(amount),0) into paid_total from public.payments where invoice_id = target_invoice and status = 'succeeded' and archived_at is null;
  select case when paid_total >= invoice_total then 'paid' when paid_total > 0 then 'partially_paid' else status end into next_status from public.invoices where id = target_invoice;
  if next_status in ('paid','partially_paid') then update public.invoices set status = next_status where id = target_invoice and status not in ('void','cancelled'); end if;
  return null;
end; $$;

create or replace function public.enforce_archive_permission() returns trigger language plpgsql security definer set search_path=public as $$
declare required_permission text;
begin
  if old.archived_at is null and new.archived_at is not null then
    required_permission := case tg_table_name when 'providers' then 'providers.archive' when 'clinicians' then 'clinicians.archive' when 'clients' then 'clients.archive' when 'credentials' then 'credentials.archive' when 'documents' then 'documents.archive' else null end;
    if required_permission is not null and not public.has_permission(new.company_id, required_permission) then raise exception 'Archive permission is required'; end if;
  end if;
  return new;
end; $$;

create or replace function public.protect_finalized_payroll() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status = 'paid' then raise exception 'Paid payroll cannot be changed'; end if;
  if old.status = 'finalized' then
    if new.status <> 'paid' or new.paid_at is null or new.company_id <> old.company_id or new.pay_period_id <> old.pay_period_id or new.provider_id is distinct from old.provider_id or new.clinician_id is distinct from old.clinician_id or new.gross_input_amount is distinct from old.gross_input_amount or new.adjustments is distinct from old.adjustments or new.approved_amount is distinct from old.approved_amount or new.notes is distinct from old.notes then raise exception 'Finalized payroll permits only the controlled paid transition; use payroll adjustments for changes'; end if;
  end if;
  if old.status = 'draft' and new.status not in ('draft','review') then raise exception 'Payroll must move from draft to review'; end if;
  if old.status = 'draft' and new.status = 'review' and not public.has_permission(new.company_id,'payroll.review') then raise exception 'Payroll review permission is required'; end if;
  if old.status = 'review' and new.status not in ('review','approved') then raise exception 'Payroll must move from review to approved'; end if;
  if old.status = 'review' and new.status = 'approved' and not public.has_permission(new.company_id,'payroll.approve') then raise exception 'Payroll approval permission is required'; end if;
  if old.status = 'approved' and new.status not in ('approved','finalized') then raise exception 'Payroll must move from approved to finalized'; end if;
  if old.status = 'approved' and new.status = 'finalized' and not public.has_permission(new.company_id,'payroll.finalize') then raise exception 'Payroll finalization permission is required'; end if;
  if old.status = 'finalized' and new.status = 'paid' and not public.has_permission(new.company_id,'payroll.mark_paid') then raise exception 'Payroll paid permission is required'; end if;
  if new.status = 'finalized' and new.finalized_at is null then raise exception 'Finalized payroll requires finalized_at'; end if;
  if new.status = 'paid' and new.paid_at is null then raise exception 'Paid payroll requires paid_at'; end if;
  return new;
end; $$;

-- Apply common timestamp, tenant-reference and finance integrity triggers.
create trigger providers_set_updated_at before update on public.providers for each row execute procedure public.set_updated_at();
create trigger clinicians_set_updated_at before update on public.clinicians for each row execute procedure public.set_updated_at();
create trigger clients_set_updated_at before update on public.clients for each row execute procedure public.set_updated_at();
create trigger client_contacts_set_updated_at before update on public.client_contacts for each row execute procedure public.set_updated_at();
create trigger client_assignments_set_updated_at before update on public.client_assignments for each row execute procedure public.set_updated_at();
create trigger activities_set_updated_at before update on public.activities for each row execute procedure public.set_updated_at();
create trigger credential_monitor_configs_set_updated_at before update on public.credential_monitor_configs for each row execute procedure public.set_updated_at();
create trigger credentials_set_updated_at before update on public.credentials for each row execute procedure public.set_updated_at();
create trigger invoices_set_updated_at before update on public.invoices for each row execute procedure public.set_updated_at();
create trigger billable_records_set_updated_at before update on public.billable_records for each row execute procedure public.set_updated_at();
create trigger invoice_lines_set_updated_at before update on public.invoice_lines for each row execute procedure public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute procedure public.set_updated_at();
create trigger pay_periods_set_updated_at before update on public.pay_periods for each row execute procedure public.set_updated_at();
create trigger payroll_records_set_updated_at before update on public.payroll_records for each row execute procedure public.set_updated_at();
create trigger payroll_items_set_updated_at before update on public.payroll_items for each row execute procedure public.set_updated_at();
create trigger payroll_adjustments_set_updated_at before update on public.payroll_adjustments for each row execute procedure public.set_updated_at();
create trigger documents_set_updated_at before update on public.documents for each row execute procedure public.set_updated_at();

create trigger client_contacts_tenant_scope before insert or update on public.client_contacts for each row execute procedure public.validate_va_tenant_scope();
create trigger client_assignments_tenant_scope before insert or update on public.client_assignments for each row execute procedure public.validate_va_tenant_scope();
create trigger credentials_tenant_scope before insert or update on public.credentials for each row execute procedure public.validate_va_tenant_scope();
create trigger invoices_tenant_scope before insert or update on public.invoices for each row execute procedure public.validate_va_tenant_scope();
create trigger billable_records_tenant_scope before insert or update on public.billable_records for each row execute procedure public.validate_va_tenant_scope();
create trigger invoice_lines_tenant_scope before insert or update on public.invoice_lines for each row execute procedure public.validate_va_tenant_scope();
create trigger payments_tenant_scope before insert or update on public.payments for each row execute procedure public.validate_va_tenant_scope();
create trigger payroll_records_tenant_scope before insert or update on public.payroll_records for each row execute procedure public.validate_va_tenant_scope();
create trigger payroll_items_tenant_scope before insert or update on public.payroll_items for each row execute procedure public.validate_va_tenant_scope();
create trigger payroll_adjustments_tenant_scope before insert or update on public.payroll_adjustments for each row execute procedure public.validate_va_tenant_scope();
create trigger documents_tenant_scope before insert or update on public.documents for each row execute procedure public.validate_va_tenant_scope();
create trigger invoice_lines_refresh_subtotal after insert or update or delete on public.invoice_lines for each row execute procedure public.refresh_invoice_subtotal();
create trigger payments_validate_application before insert or update on public.payments for each row execute procedure public.validate_payment_application();
create trigger invoices_enforce_transition before insert or update on public.invoices for each row execute procedure public.enforce_invoice_transition();
create trigger payments_sync_invoice_status after insert or update or delete on public.payments for each row execute procedure public.sync_invoice_payment_status();
create trigger payroll_records_protect_finalized before update on public.payroll_records for each row execute procedure public.protect_finalized_payroll();
create trigger providers_enforce_archive before update on public.providers for each row execute procedure public.enforce_archive_permission();
create trigger clinicians_enforce_archive before update on public.clinicians for each row execute procedure public.enforce_archive_permission();
create trigger clients_enforce_archive before update on public.clients for each row execute procedure public.enforce_archive_permission();
create trigger credentials_enforce_archive before update on public.credentials for each row execute procedure public.enforce_archive_permission();
create trigger documents_enforce_archive before update on public.documents for each row execute procedure public.enforce_archive_permission();

create view public.invoice_financials with (security_invoker = true) as
select i.*, coalesce(sum(p.amount) filter (where p.status = 'succeeded' and p.archived_at is null), 0)::numeric(14,2) as successful_payments,
       greatest(i.total - coalesce(sum(p.amount) filter (where p.status = 'succeeded' and p.archived_at is null), 0), 0)::numeric(14,2) as balance_due
from public.invoices i left join public.payments p on p.invoice_id = i.id group by i.id;

create view public.ar_aging with (security_invoker = true) as
select f.*, case when f.balance_due <= 0 then 'settled' when f.due_date is null or f.due_date >= current_date then 'current'
  when current_date - f.due_date <= 30 then '1_30' when current_date - f.due_date <= 60 then '31_60' when current_date - f.due_date <= 90 then '61_90' else '90_plus' end as aging_bucket
from public.invoice_financials f where f.archived_at is null and f.status not in ('void','cancelled');

insert into storage.buckets (id, name, public) values ('nexus-private', 'nexus-private', false) on conflict (id) do update set public = false;

alter table public.providers enable row level security; alter table public.clinicians enable row level security; alter table public.clients enable row level security; alter table public.client_contacts enable row level security; alter table public.client_assignments enable row level security; alter table public.activities enable row level security; alter table public.credential_monitor_configs enable row level security; alter table public.credentials enable row level security; alter table public.billable_records enable row level security; alter table public.invoices enable row level security; alter table public.invoice_lines enable row level security; alter table public.payments enable row level security; alter table public.pay_periods enable row level security; alter table public.payroll_records enable row level security; alter table public.payroll_items enable row level security; alter table public.payroll_adjustments enable row level security; alter table public.documents enable row level security;

-- Direct company-key checks keep each policy tenant-safe even when a URL is tampered.
create policy providers_read on public.providers for select to authenticated using (public.has_permission(company_id,'providers.read')); create policy providers_create on public.providers for insert to authenticated with check (public.has_permission(company_id,'providers.create')); create policy providers_update on public.providers for update to authenticated using (public.has_permission(company_id,'providers.update')) with check (public.has_permission(company_id,'providers.update'));
create policy clinicians_read on public.clinicians for select to authenticated using (public.has_permission(company_id,'clinicians.read')); create policy clinicians_create on public.clinicians for insert to authenticated with check (public.has_permission(company_id,'clinicians.create')); create policy clinicians_update on public.clinicians for update to authenticated using (public.has_permission(company_id,'clinicians.update')) with check (public.has_permission(company_id,'clinicians.update'));
create policy clients_read on public.clients for select to authenticated using (public.has_permission(company_id,'clients.read')); create policy clients_create on public.clients for insert to authenticated with check (public.has_permission(company_id,'clients.create')); create policy clients_update on public.clients for update to authenticated using (public.has_permission(company_id,'clients.update')) with check (public.has_permission(company_id,'clients.update'));
create policy client_contacts_read on public.client_contacts for select to authenticated using (public.has_permission(company_id,'clients.read')); create policy client_contacts_create on public.client_contacts for insert to authenticated with check (public.has_permission(company_id,'clients.create')); create policy client_contacts_update on public.client_contacts for update to authenticated using (public.has_permission(company_id,'clients.update')) with check (public.has_permission(company_id,'clients.update'));
create policy client_assignments_read on public.client_assignments for select to authenticated using (public.has_permission(company_id,'clients.read')); create policy client_assignments_create on public.client_assignments for insert to authenticated with check (public.has_permission(company_id,'clients.update')); create policy client_assignments_update on public.client_assignments for update to authenticated using (public.has_permission(company_id,'clients.update')) with check (public.has_permission(company_id,'clients.update'));
create policy activities_read on public.activities for select to authenticated using (public.has_permission(company_id,'activities.read')); create policy activities_create on public.activities for insert to authenticated with check (public.has_permission(company_id,'activities.create')); create policy activities_update on public.activities for update to authenticated using (public.has_permission(company_id,'activities.update')) with check (public.has_permission(company_id,'activities.update'));
create policy credential_configs_read on public.credential_monitor_configs for select to authenticated using (public.has_permission(company_id,'credentials.read')); create policy credential_configs_update on public.credential_monitor_configs for all to authenticated using (public.has_permission(company_id,'credentials.update')) with check (public.has_permission(company_id,'credentials.update'));
create policy credentials_read on public.credentials for select to authenticated using (public.has_permission(company_id,'credentials.read')); create policy credentials_create on public.credentials for insert to authenticated with check (public.has_permission(company_id,'credentials.create')); create policy credentials_update on public.credentials for update to authenticated using (public.has_permission(company_id,'credentials.update')) with check (public.has_permission(company_id,'credentials.update'));
create policy billable_read on public.billable_records for select to authenticated using (public.has_permission(company_id,'billing.read')); create policy billable_create on public.billable_records for insert to authenticated with check (public.has_permission(company_id,'billing.create')); create policy billable_update on public.billable_records for update to authenticated using (public.has_permission(company_id,'billing.update')) with check (public.has_permission(company_id,'billing.update'));
create policy invoices_read on public.invoices for select to authenticated using (public.has_permission(company_id,'invoices.read')); create policy invoices_create on public.invoices for insert to authenticated with check (public.has_permission(company_id,'invoices.create')); create policy invoices_update on public.invoices for update to authenticated using (public.has_permission(company_id,'invoices.update')) with check (public.has_permission(company_id,'invoices.update'));
create policy invoice_lines_read on public.invoice_lines for select to authenticated using (public.has_permission(company_id,'invoices.read')); create policy invoice_lines_create on public.invoice_lines for insert to authenticated with check (public.has_permission(company_id,'invoices.create')); create policy invoice_lines_update on public.invoice_lines for update to authenticated using (public.has_permission(company_id,'invoices.update')) with check (public.has_permission(company_id,'invoices.update'));
create policy payments_read on public.payments for select to authenticated using (public.has_permission(company_id,'payments.read')); create policy payments_create on public.payments for insert to authenticated with check (public.has_permission(company_id,'payments.create')); create policy payments_update on public.payments for update to authenticated using (public.has_permission(company_id,'payments.update')) with check (public.has_permission(company_id,'payments.update'));
create policy pay_periods_read on public.pay_periods for select to authenticated using (public.has_permission(company_id,'payroll.read')); create policy pay_periods_create on public.pay_periods for insert to authenticated with check (public.has_permission(company_id,'payroll.create')); create policy pay_periods_update on public.pay_periods for update to authenticated using (public.has_permission(company_id,'payroll.update') or public.has_permission(company_id,'payroll.review') or public.has_permission(company_id,'payroll.approve') or public.has_permission(company_id,'payroll.finalize') or public.has_permission(company_id,'payroll.mark_paid')) with check (public.has_permission(company_id,'payroll.update') or public.has_permission(company_id,'payroll.review') or public.has_permission(company_id,'payroll.approve') or public.has_permission(company_id,'payroll.finalize') or public.has_permission(company_id,'payroll.mark_paid'));
create policy payroll_records_read on public.payroll_records for select to authenticated using (public.has_permission(company_id,'payroll.read')); create policy payroll_records_create on public.payroll_records for insert to authenticated with check (public.has_permission(company_id,'payroll.create')); create policy payroll_records_update on public.payroll_records for update to authenticated using (public.has_permission(company_id,'payroll.update') or public.has_permission(company_id,'payroll.review') or public.has_permission(company_id,'payroll.approve') or public.has_permission(company_id,'payroll.finalize') or public.has_permission(company_id,'payroll.mark_paid')) with check (public.has_permission(company_id,'payroll.update') or public.has_permission(company_id,'payroll.review') or public.has_permission(company_id,'payroll.approve') or public.has_permission(company_id,'payroll.finalize') or public.has_permission(company_id,'payroll.mark_paid'));
create policy payroll_items_read on public.payroll_items for select to authenticated using (public.has_permission(company_id,'payroll.read')); create policy payroll_items_create on public.payroll_items for insert to authenticated with check (public.has_permission(company_id,'payroll.create')); create policy payroll_items_update on public.payroll_items for update to authenticated using (public.has_permission(company_id,'payroll.update')) with check (public.has_permission(company_id,'payroll.update'));
create policy payroll_adjustments_read on public.payroll_adjustments for select to authenticated using (public.has_permission(company_id,'payroll.read')); create policy payroll_adjustments_create on public.payroll_adjustments for insert to authenticated with check (public.has_permission(company_id,'payroll.update')); create policy payroll_adjustments_update on public.payroll_adjustments for update to authenticated using (public.has_permission(company_id,'payroll.approve')) with check (public.has_permission(company_id,'payroll.approve'));
create policy documents_read on public.documents for select to authenticated using (public.has_permission(company_id,'documents.read')); create policy documents_create on public.documents for insert to authenticated with check (public.has_permission(company_id,'documents.upload')); create policy documents_update on public.documents for update to authenticated using (public.has_permission(company_id,'documents.archive')) with check (public.has_permission(company_id,'documents.archive'));
create policy nexus_private_objects_read on storage.objects for select to authenticated using (bucket_id = 'nexus-private' and public.has_permission((storage.foldername(name))[1]::uuid,'documents.read'));
create policy nexus_private_objects_upload on storage.objects for insert to authenticated with check (bucket_id = 'nexus-private' and public.has_permission((storage.foldername(name))[1]::uuid,'documents.upload'));
create policy nexus_private_objects_archive on storage.objects for update to authenticated using (bucket_id = 'nexus-private' and public.has_permission((storage.foldername(name))[1]::uuid,'documents.archive')) with check (bucket_id = 'nexus-private' and public.has_permission((storage.foldername(name))[1]::uuid,'documents.archive'));

insert into public.permissions(key,description) values
('providers.read','Read providers'),('providers.create','Create providers'),('providers.update','Update providers'),('providers.archive','Archive providers'),
('clinicians.read','Read clinicians'),('clinicians.create','Create clinicians'),('clinicians.update','Update clinicians'),('clinicians.archive','Archive clinicians'),
('credentials.create','Create credentials'),('credentials.archive','Archive credentials'),
('billing.read','Read billing'),('billing.create','Create billable records'),('billing.update','Update billing'),('billing.approve','Approve billing'),
('invoices.approve','Approve invoices'),('invoices.void','Void invoices'),('payments.read','Read payments'),('payments.create','Create payments'),('payments.update','Update payments'),('ar.read','Read accounts receivable'),
('payroll.review','Review payroll'),('payroll.finalize','Finalize payroll'),('payroll.mark_paid','Mark payroll paid'),
('documents.read','Read documents'),('documents.upload','Upload documents'),('documents.archive','Archive documents'),
('activities.read','Read activities'),('activities.create','Create activities'),('activities.update','Update activities') on conflict(key) do nothing;
insert into public.role_permissions(role_id,permission_id) select r.id,p.id from public.roles r cross join public.permissions p where r.key in ('global_admin','company_admin') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id) select r.id,p.id from public.roles r join public.permissions p on p.key in ('providers.read','providers.create','providers.update','clinicians.read','clinicians.create','clinicians.update','credentials.read','credentials.create','credentials.update','clients.read','clients.create','clients.update','billing.read','billing.create','billing.update','invoices.read','invoices.create','invoices.update','payments.read','payments.create','payments.update','ar.read','documents.read','documents.upload','activities.read','activities.create','activities.update','reports.view','reports.export') where r.key='manager' on conflict do nothing;
insert into public.role_permissions(role_id,permission_id) select r.id,p.id from public.roles r join public.permissions p on p.key in ('providers.read','clinicians.read','credentials.read','clients.read','billing.read','invoices.read','payments.read','ar.read','documents.read','activities.read','reports.view') where r.key in ('member','viewer') on conflict do nothing;
insert into public.company_modules(company_id,module_key,enabled) select c.id,m.key,true from public.companies c join (values ('providers'),('clinicians'),('credentialing'),('billing'),('invoices'),('ar'),('payroll')) m(key) on c.slug='tidemark-va' on conflict do nothing;

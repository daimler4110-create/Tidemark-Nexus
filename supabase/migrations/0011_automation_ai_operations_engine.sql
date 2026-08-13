-- Tenant-scoped automation, communications, AI, notification, and integration
-- foundations. All user-facing access remains protected by RLS; only the
-- server-side worker invokes the fixed, audited action RPC below.

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  name text not null check (length(btrim(name)) > 0),
  description text,
  active boolean not null default false,
  trigger_type text not null check (trigger_type in ('client_created','client_status_changed','task_created','task_due_soon','task_overdue','task_completed','task_status_changed','credential_expiring','credential_expired','invoice_created','invoice_due_soon','invoice_overdue','payment_posted','calendar_event_upcoming','communication_approval_required')),
  trigger_resource text not null,
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array'),
  last_run_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index automation_rules_company_trigger_idx on public.automation_rules(company_id, trigger_type) where active and archived_at is null;

create table public.automation_actions (
  id uuid primary key default gen_random_uuid(),
  automation_rule_id uuid not null references public.automation_rules(id) on delete restrict,
  position integer not null check (position > 0),
  action_type text not null check (action_type in ('create_task','assign_task','update_task_status','create_activity','create_notification','prepare_communication','apply_approved_template','queue_ai_draft','update_record_status','queue_integration_event')),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index automation_actions_active_position_unique on public.automation_actions(automation_rule_id, position) where archived_at is null;

create table public.automation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  trigger_type text not null check (trigger_type in ('client_created','client_status_changed','task_created','task_due_soon','task_overdue','task_completed','task_status_changed','credential_expiring','credential_expired','invoice_created','invoice_due_soon','invoice_overdue','payment_posted','calendar_event_upcoming','communication_approval_required')),
  resource_type text not null,
  resource_id uuid not null,
  event_key text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  origin_run_id uuid,
  origin_depth integer not null default 0 check (origin_depth between 0 and 3),
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  retry_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique(company_id, event_key)
);
create index automation_events_pending_idx on public.automation_events(occurred_at) where processed_at is null;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_rule_id uuid not null references public.automation_rules(id) on delete restrict,
  automation_event_id uuid references public.automation_events(id) on delete set null,
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  event_key text not null,
  trigger_type text not null,
  related_resource_type text,
  related_resource_id uuid,
  trigger_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','succeeded','partially_failed','failed','skipped')),
  actions_attempted integer not null default 0,
  actions_succeeded integer not null default 0,
  actions_failed integer not null default 0,
  error_details text,
  retry_count integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique(automation_rule_id, event_key)
);
alter table public.automation_events add constraint automation_events_origin_run_fkey foreign key(origin_run_id) references public.automation_runs(id) on delete set null;
create index automation_runs_company_status_idx on public.automation_runs(company_id, status, created_at desc);

create table public.automation_action_runs (
  id uuid primary key default gen_random_uuid(),
  automation_run_id uuid not null references public.automation_runs(id) on delete restrict,
  automation_action_id uuid not null references public.automation_actions(id) on delete restrict,
  company_id uuid not null references public.companies(id),
  execution_key text not null,
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed','skipped')),
  attempt_count integer not null default 0,
  result jsonb,
  error_details text,
  retry_count integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique(automation_run_id, automation_action_id),
  unique(company_id, execution_key)
);
create index automation_action_runs_company_status_idx on public.automation_action_runs(company_id, status, created_at desc);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  name text not null check (length(btrim(name)) > 0),
  category text not null check (category in ('email','client_reply','onboarding','credential_reminder','invoice_reminder','task_template','internal_note','ai_prompt','pandadoc_preparation')),
  subject text,
  body text not null,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index templates_company_name_version_idx on public.templates(company_id, lower(name), version) where archived_at is null;

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  recipient text not null check (length(btrim(recipient)) > 0),
  subject text,
  draft_body text,
  final_body text,
  status text not null default 'draft' check (status in ('draft','ai_draft_requested','awaiting_review','approved','queued','sent','failed','cancelled')),
  related_client_id uuid references public.clients(id),
  related_provider_id uuid references public.providers(id),
  related_clinician_id uuid references public.clinicians(id),
  related_task_id uuid references public.tasks(id),
  related_invoice_id uuid references public.invoices(id),
  related_credential_id uuid references public.credentials(id),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  provider_name text,
  external_message_id text,
  external_thread_id text,
  failure_details text,
  retry_count integer not null default 0,
  delivery_claimed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(related_client_id, related_provider_id, related_clinician_id, related_task_id, related_invoice_id, related_credential_id) <= 1)
);
create index communications_company_status_idx on public.communications(company_id, status, created_at desc);
create index communications_delivery_claim_idx on public.communications(status, delivery_claimed_at) where status = 'queued';

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  communication_id uuid references public.communications(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  request_type text not null check (request_type in ('draft_client_reply','rewrite_communication','summarize_client','summarize_activities','summarize_provider','summarize_clinician','draft_credential_reminder','draft_invoice_follow_up','generate_task_checklist')),
  related_resource_type text,
  related_resource_id uuid,
  input_context jsonb not null default '{}'::jsonb check (jsonb_typeof(input_context) = 'object'),
  provider text,
  model text,
  status text not null default 'queued' check (status in ('queued','processing','awaiting_review','approved','rejected','completed','failed')),
  response jsonb,
  error_details text,
  retry_count integer not null default 0,
  processing_claim_token uuid,
  processing_claimed_at timestamptz,
  execution_key text,
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, execution_key)
);
create index ai_requests_company_status_idx on public.ai_requests(company_id, status, requested_at desc);
create index ai_requests_processing_claim_idx on public.ai_requests(status, processing_claimed_at) where status in ('queued','processing');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  recipient_user_id uuid references public.profiles(id),
  type text not null check (type in ('credential_expiring','credential_expired','invoice_overdue','task_overdue','automation_failed','ai_draft_ready','communication_failed','payroll_awaiting_review','general')),
  title text not null,
  body text,
  related_resource_type text,
  related_resource_id uuid,
  link_path text,
  status text not null default 'unread' check (status in ('unread','read','dismissed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz
);
create index notifications_recipient_status_idx on public.notifications(recipient_user_id, status, created_at desc);

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workspace_id uuid references public.workspaces(id),
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  integration text not null check (integration in ('email','pandadoc','webhook','zapier')),
  direction text not null check (direction in ('inbound','outbound')),
  event_type text not null,
  deduplication_key text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending','received','sent','succeeded','failed','skipped')),
  external_id text,
  error_details text,
  retry_count integer not null default 0,
  processing_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(company_id, integration, direction, deduplication_key)
);
create index integration_events_company_status_idx on public.integration_events(company_id, status, created_at desc);
create index integration_events_processing_claim_idx on public.integration_events(status, processing_claimed_at) where status in ('pending','sent');

insert into public.permissions(key, description) values
  ('automation.read', 'Read automation rules and run history'), ('automation.manage', 'Create and edit automation rules and templates'), ('automation.execute', 'Run approved automations'),
  ('templates.read', 'Read templates'), ('templates.manage', 'Create and edit templates'),
  ('communications.read', 'Read communications'), ('communications.create', 'Prepare communications'), ('communications.review', 'Review and approve communications'), ('communications.queue', 'Queue approved communications'),
  ('ai.read', 'Read AI requests'), ('ai.request', 'Request AI drafts'), ('ai.review', 'Review AI drafts'),
  ('notifications.read', 'Read notifications'), ('notifications.update', 'Read and dismiss notifications'),
  ('integrations.read', 'Read integration queue'), ('integrations.manage', 'Manage integration queue')
on conflict(key) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('automation.read','automation.manage','automation.execute','templates.read','templates.manage','communications.read','communications.create','communications.review','communications.queue','ai.read','ai.request','ai.review','notifications.read','notifications.update','integrations.read','integrations.manage') where r.key in ('global_admin','company_admin') on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('automation.read','automation.manage','templates.read','templates.manage','communications.read','communications.create','communications.review','ai.read','ai.request','ai.review','notifications.read','notifications.update','integrations.read') where r.key = 'manager' on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('templates.read','communications.read','ai.read','ai.request','notifications.read','notifications.update') where r.key in ('member','viewer') on conflict do nothing;

insert into public.company_modules(company_id, module_key, enabled)
select c.id, m.key, true from public.companies c cross join (values ('automation'),('ai'),('notifications')) m(key)
where c.slug = 'tidemark-va'
on conflict(company_id, module_key) do update set enabled = true;

alter table public.automation_rules enable row level security;
alter table public.automation_actions enable row level security;
alter table public.automation_events enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_action_runs enable row level security;
alter table public.templates enable row level security;
alter table public.communications enable row level security;
alter table public.ai_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.integration_events enable row level security;

create policy automation_rules_read on public.automation_rules for select to authenticated using (public.has_permission(company_id,'automation.read') and (workspace_id is null or public.has_workspace_permission(workspace_id,'automation.read')));
create policy automation_rules_create on public.automation_rules for insert to authenticated with check (public.has_permission(company_id,'automation.manage') and (workspace_id is null or public.has_workspace_permission(workspace_id,'automation.manage')));
create policy automation_rules_update on public.automation_rules for update to authenticated using (public.has_permission(company_id,'automation.manage') and (workspace_id is null or public.has_workspace_permission(workspace_id,'automation.manage'))) with check (public.has_permission(company_id,'automation.manage') and (workspace_id is null or public.has_workspace_permission(workspace_id,'automation.manage')));
create policy automation_actions_read on public.automation_actions for select to authenticated using (exists(select 1 from public.automation_rules r where r.id=automation_rule_id and public.has_permission(r.company_id,'automation.read') and (r.workspace_id is null or public.has_workspace_permission(r.workspace_id,'automation.read'))));
create policy automation_actions_create on public.automation_actions for insert to authenticated with check (exists(select 1 from public.automation_rules r where r.id=automation_rule_id and public.has_permission(r.company_id,'automation.manage') and (r.workspace_id is null or public.has_workspace_permission(r.workspace_id,'automation.manage'))));
create policy automation_actions_update on public.automation_actions for update to authenticated using (exists(select 1 from public.automation_rules r where r.id=automation_rule_id and public.has_permission(r.company_id,'automation.manage') and (r.workspace_id is null or public.has_workspace_permission(r.workspace_id,'automation.manage')))) with check (exists(select 1 from public.automation_rules r where r.id=automation_rule_id and public.has_permission(r.company_id,'automation.manage') and (r.workspace_id is null or public.has_workspace_permission(r.workspace_id,'automation.manage'))));
create policy automation_runs_read on public.automation_runs for select to authenticated using (public.has_permission(company_id,'automation.read') and (workspace_id is null or public.has_workspace_permission(workspace_id,'automation.read')));
create policy automation_action_runs_read on public.automation_action_runs for select to authenticated using (exists(select 1 from public.automation_runs r where r.id=automation_run_id and public.has_permission(r.company_id,'automation.read') and (r.workspace_id is null or public.has_workspace_permission(r.workspace_id,'automation.read'))));
create policy templates_read on public.templates for select to authenticated using (public.has_permission(company_id,'templates.read') and (workspace_id is null or public.has_workspace_permission(workspace_id,'templates.read')));
create policy templates_create on public.templates for insert to authenticated with check (public.has_permission(company_id,'templates.manage') and (workspace_id is null or public.has_workspace_permission(workspace_id,'templates.manage')));
create policy templates_update on public.templates for update to authenticated using (public.has_permission(company_id,'templates.manage') and (workspace_id is null or public.has_workspace_permission(workspace_id,'templates.manage'))) with check (public.has_permission(company_id,'templates.manage') and (workspace_id is null or public.has_workspace_permission(workspace_id,'templates.manage')));
create policy communications_read on public.communications for select to authenticated using (public.has_permission(company_id,'communications.read') and (workspace_id is null or public.has_workspace_permission(workspace_id,'communications.read')));
create policy communications_create on public.communications for insert to authenticated with check (public.has_permission(company_id,'communications.create') and (workspace_id is null or public.has_workspace_permission(workspace_id,'communications.create')));
create policy communications_update on public.communications for update to authenticated using ((public.has_permission(company_id,'communications.review') or public.has_permission(company_id,'communications.queue')) and (workspace_id is null or public.has_workspace_permission(workspace_id,'communications.read'))) with check ((public.has_permission(company_id,'communications.review') or public.has_permission(company_id,'communications.queue')) and (workspace_id is null or public.has_workspace_permission(workspace_id,'communications.read')));
create policy ai_requests_read on public.ai_requests for select to authenticated using (public.has_permission(company_id,'ai.read') and (workspace_id is null or public.has_workspace_permission(workspace_id,'ai.read')));
create policy ai_requests_create on public.ai_requests for insert to authenticated with check (public.has_permission(company_id,'ai.request') and (workspace_id is null or public.has_workspace_permission(workspace_id,'ai.request')));
create policy ai_requests_review on public.ai_requests for update to authenticated using (public.has_permission(company_id,'ai.review') and (workspace_id is null or public.has_workspace_permission(workspace_id,'ai.read'))) with check (public.has_permission(company_id,'ai.review') and (workspace_id is null or public.has_workspace_permission(workspace_id,'ai.read')));
create policy notifications_read on public.notifications for select to authenticated using (recipient_user_id=auth.uid() and public.has_permission(company_id,'notifications.read') and (workspace_id is null or public.has_workspace_permission(workspace_id,'notifications.read')));
create policy notifications_update on public.notifications for update to authenticated using (recipient_user_id=auth.uid() and public.has_permission(company_id,'notifications.update') and (workspace_id is null or public.has_workspace_permission(workspace_id,'notifications.update'))) with check (recipient_user_id=auth.uid() and public.has_permission(company_id,'notifications.update') and (workspace_id is null or public.has_workspace_permission(workspace_id,'notifications.update')));
create policy integration_events_read on public.integration_events for select to authenticated using (public.has_permission(company_id,'integrations.read'));
create policy integration_events_manage on public.integration_events for update to authenticated using (public.has_permission(company_id,'integrations.manage')) with check (public.has_permission(company_id,'integrations.manage'));

create or replace function public.automation_set_updated_at() returns trigger language plpgsql security definer set search_path=public as $$ begin new.updated_at:=now(); return new; end; $$;
create trigger automation_rules_set_updated_at before update on public.automation_rules for each row execute procedure public.automation_set_updated_at();
create trigger automation_actions_set_updated_at before update on public.automation_actions for each row execute procedure public.automation_set_updated_at();
create trigger templates_set_updated_at before update on public.templates for each row execute procedure public.automation_set_updated_at();
create trigger communications_set_updated_at before update on public.communications for each row execute procedure public.automation_set_updated_at();
create trigger ai_requests_set_updated_at before update on public.ai_requests for each row execute procedure public.automation_set_updated_at();

create or replace function public.automation_set_created_by() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.created_by is null then new.created_by:=auth.uid(); end if;
  return new;
end; $$;
create trigger automation_rules_set_created_by before insert or update on public.automation_rules for each row execute procedure public.automation_set_created_by();

create or replace function public.validate_automation_configuration() returns trigger language plpgsql security definer set search_path=public as $$
declare condition_item jsonb; expected_resource text; pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if tg_table_name='automation_rules' then
    expected_resource:=case new.trigger_type
      when 'client_created' then 'client' when 'client_status_changed' then 'client'
      when 'task_created' then 'task' when 'task_due_soon' then 'task' when 'task_overdue' then 'task' when 'task_completed' then 'task' when 'task_status_changed' then 'task'
      when 'credential_expiring' then 'credential' when 'credential_expired' then 'credential'
      when 'invoice_created' then 'invoice' when 'invoice_due_soon' then 'invoice' when 'invoice_overdue' then 'invoice'
      when 'payment_posted' then 'payment' when 'calendar_event_upcoming' then 'calendar_event' when 'communication_approval_required' then 'communication' end;
    if new.trigger_resource<>expected_resource then raise exception 'Automation trigger resource is invalid'; end if;
    for condition_item in select value from jsonb_array_elements(new.conditions) loop
      if jsonb_typeof(condition_item)<>'object' or coalesce(nullif(btrim(condition_item->>'field'),''),'')='' or coalesce(condition_item->>'operator','') not in ('equals','not_equals','contains','is_empty','is_not_empty','before_date','after_date','within_days','greater_than','less_than') then raise exception 'Automation condition is invalid'; end if;
      if coalesce(condition_item->>'operator','') not in ('is_empty','is_not_empty') and not condition_item ? 'value' then raise exception 'Automation condition requires a value'; end if;
    end loop;
  elsif tg_table_name='automation_actions' then
    if jsonb_typeof(new.configuration)<>'object' then raise exception 'Automation action configuration must be an object'; end if;
    if new.action_type='create_task' and coalesce(nullif(btrim(new.configuration->>'title'),''),'')='' then raise exception 'Create Task requires a title'; end if;
    if new.action_type='create_notification' and coalesce(nullif(btrim(new.configuration->>'title'),''),'')='' then raise exception 'Create Notification requires a title'; end if;
    if new.action_type='prepare_communication' and (coalesce(nullif(btrim(new.configuration->>'recipient'),''),'') is null and coalesce(nullif(btrim(new.configuration->>'recipient_source'),''),'') is null or coalesce(nullif(btrim(new.configuration->>'body'),''),'') is null) then raise exception 'Prepare Communication requires a safe recipient and body'; end if;
    if new.action_type='apply_approved_template' and (coalesce(nullif(btrim(new.configuration->>'template_id'),''),'') is null or (coalesce(nullif(btrim(new.configuration->>'recipient'),''),'') is null and coalesce(nullif(btrim(new.configuration->>'recipient_source'),''),'') is null)) then raise exception 'Apply Approved Template requires a template and safe recipient'; end if;
    if new.action_type='assign_task' and (new.configuration->>'assignee_id' is null or new.configuration->>'assignee_id' !~* pattern) then raise exception 'Assign Task requires an assignee UUID'; end if;
    if new.action_type in ('update_task_status','update_record_status') and new.configuration->>'status' not in ('not_started','working','waiting','blocked','done') then raise exception 'Update Task Status requires a supported task status'; end if;
    if new.configuration ? 'workspace_id' and (new.configuration->>'workspace_id' !~* pattern) then raise exception 'Workspace must be a UUID'; end if;
    if new.configuration ? 'template_id' and (new.configuration->>'template_id' !~* pattern) then raise exception 'Template must be a UUID'; end if;
    if new.configuration ? 'recipient_user_id' and (new.configuration->>'recipient_user_id' !~* pattern or not exists (select 1 from public.automation_rules r join public.memberships m on m.company_id=r.company_id and m.user_id=(new.configuration->>'recipient_user_id')::uuid where r.id=new.automation_rule_id and m.status='active' and m.archived_at is null)) then raise exception 'Notification recipient must be an active member of the rule company'; end if;
    if new.action_type in ('prepare_communication','apply_approved_template') and new.configuration ? 'recipient_source' and new.configuration->>'recipient_source' not in ('client_primary_contact','related_provider_email','related_clinician_email','credential_holder_email') then raise exception 'Communication recipient source is invalid'; end if;
    if new.action_type='create_notification' and new.configuration ? 'recipient_source' and new.configuration->>'recipient_source'<>'task_assignee' then raise exception 'Notification recipient source is invalid'; end if;
    if new.action_type='queue_integration_event' and new.configuration ? 'integration' and new.configuration->>'integration' not in ('webhook','zapier') then raise exception 'Only configured webhook or Zapier integration events are supported'; end if;
  end if;
  return new;
end; $$;
create trigger automation_rules_validate_configuration before insert or update on public.automation_rules for each row execute procedure public.validate_automation_configuration();
create trigger automation_actions_validate_configuration before insert or update on public.automation_actions for each row execute procedure public.validate_automation_configuration();

-- The non-browser worker authenticates as the Supabase service role.  It is still
-- constrained by the automation tenant checks below and never exposed to clients.
create or replace function public.enforce_task_update_permission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.automation_execution', true) = 'true' then return new; end if;
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

-- Defend the company boundary even when a privileged server worker is used.
create or replace function public.validate_automation_tenant_scope() returns trigger
language plpgsql security definer set search_path=public as $$
declare related_company uuid; relation_id uuid; relation_table text;
begin
  if to_jsonb(new)->>'workspace_id' is not null then
    select company_id into related_company from public.workspaces where id=(to_jsonb(new)->>'workspace_id')::uuid;
    if related_company is distinct from new.company_id then raise exception 'Workspace must belong to record company'; end if;
  end if;
  if tg_table_name='communications' then
    foreach relation_table in array array['related_client_id','related_provider_id','related_clinician_id','related_task_id','related_invoice_id','related_credential_id'] loop
      relation_id:=nullif(to_jsonb(new)->>relation_table,'')::uuid;
      if relation_id is not null then
        case relation_table when 'related_client_id' then select company_id into related_company from public.clients where id=relation_id;
          when 'related_provider_id' then select company_id into related_company from public.providers where id=relation_id;
          when 'related_clinician_id' then select company_id into related_company from public.clinicians where id=relation_id;
          when 'related_task_id' then select company_id into related_company from public.tasks where id=relation_id;
          when 'related_invoice_id' then select company_id into related_company from public.invoices where id=relation_id;
          when 'related_credential_id' then select company_id into related_company from public.credentials where id=relation_id; end case;
        if related_company is distinct from new.company_id then raise exception 'Related record must belong to communication company'; end if;
      end if;
    end loop;
    if new.template_id is not null then select company_id into related_company from public.templates where id=new.template_id; if related_company is distinct from new.company_id then raise exception 'Template must belong to communication company'; end if; end if;
  elsif tg_table_name='ai_requests' then
    if new.communication_id is not null then select company_id into related_company from public.communications where id=new.communication_id; if related_company is distinct from new.company_id then raise exception 'Communication must belong to AI request company'; end if; end if;
    if new.template_id is not null then select company_id into related_company from public.templates where id=new.template_id; if related_company is distinct from new.company_id then raise exception 'Template must belong to AI request company'; end if; end if;
  elsif tg_table_name in ('automation_runs','integration_events') and to_jsonb(new)->>'automation_run_id' is not null then
    select company_id into related_company from public.automation_runs where id=(to_jsonb(new)->>'automation_run_id')::uuid; if related_company is distinct from new.company_id then raise exception 'Automation run must belong to record company'; end if;
  end if;
  return new;
end; $$;
create trigger automation_rules_tenant_scope before insert or update on public.automation_rules for each row execute procedure public.validate_automation_tenant_scope();
create trigger automation_events_tenant_scope before insert or update on public.automation_events for each row execute procedure public.validate_automation_tenant_scope();
create trigger automation_runs_tenant_scope before insert or update on public.automation_runs for each row execute procedure public.validate_automation_tenant_scope();
create trigger templates_tenant_scope before insert or update on public.templates for each row execute procedure public.validate_automation_tenant_scope();
create trigger communications_tenant_scope before insert or update on public.communications for each row execute procedure public.validate_automation_tenant_scope();
create trigger ai_requests_tenant_scope before insert or update on public.ai_requests for each row execute procedure public.validate_automation_tenant_scope();
create trigger notifications_tenant_scope before insert or update on public.notifications for each row execute procedure public.validate_automation_tenant_scope();
create trigger integration_events_tenant_scope before insert or update on public.integration_events for each row execute procedure public.validate_automation_tenant_scope();

create or replace function public.automation_record_event(p_company uuid,p_workspace uuid,p_trigger text,p_resource_type text,p_resource_id uuid,p_event_key text,p_payload jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare origin_id uuid; origin_depth integer;
begin
  origin_id := nullif(current_setting('app.automation_origin_run_id',true),'')::uuid;
  origin_depth := coalesce(nullif(current_setting('app.automation_origin_depth',true),'')::integer,0);
  insert into public.automation_events(company_id,workspace_id,trigger_type,resource_type,resource_id,event_key,payload,origin_run_id,origin_depth)
  values(p_company,p_workspace,p_trigger,p_resource_type,p_resource_id,p_event_key,coalesce(p_payload,'{}'::jsonb),origin_id,origin_depth)
  on conflict(company_id,event_key) do nothing;
end; $$;

create or replace function public.automation_clients_event() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then perform public.automation_record_event(new.company_id,new.workspace_id,'client_created','client',new.id,'client_created:'||new.id,jsonb_build_object('status',new.status,'client_name',new.name));
  elsif old.status is distinct from new.status then perform public.automation_record_event(new.company_id,new.workspace_id,'client_status_changed','client',new.id,'client_status_changed:'||new.id||':'||new.updated_at::text,jsonb_build_object('old_status',old.status,'status',new.status,'client_name',new.name)); end if;
  return new;
end; $$;
create trigger automation_clients_event after insert or update on public.clients for each row execute procedure public.automation_clients_event();

create or replace function public.automation_tasks_event() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then perform public.automation_record_event(new.company_id,new.workspace_id,'task_created','task',new.id,'task_created:'||new.id,jsonb_build_object('status',new.status,'priority',new.priority,'due_at',new.due_at,'title',new.title));
  elsif old.status is distinct from new.status then
    perform public.automation_record_event(new.company_id,new.workspace_id,'task_status_changed','task',new.id,'task_status_changed:'||new.id||':'||new.updated_at::text,jsonb_build_object('old_status',old.status,'status',new.status,'priority',new.priority,'due_at',new.due_at,'title',new.title));
    if new.status='done' then perform public.automation_record_event(new.company_id,new.workspace_id,'task_completed','task',new.id,'task_completed:'||new.id||':'||new.completed_at::text,jsonb_build_object('status',new.status,'title',new.title)); end if;
  end if; return new;
end; $$;
create trigger automation_tasks_event after insert or update on public.tasks for each row execute procedure public.automation_tasks_event();

create or replace function public.automation_invoices_event() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.automation_record_event(new.company_id,new.workspace_id,'invoice_created','invoice',new.id,'invoice_created:'||new.id,jsonb_build_object('status',new.status,'due_date',new.due_date,'invoice_number',new.invoice_number,'client_id',new.client_id)); return new; end; $$;
create trigger automation_invoices_event after insert on public.invoices for each row execute procedure public.automation_invoices_event();

create or replace function public.automation_payments_event() returns trigger language plpgsql security definer set search_path=public as $$
begin if new.status='succeeded' then perform public.automation_record_event(new.company_id,null,'payment_posted','payment',new.id,'payment_posted:'||new.id,jsonb_build_object('amount',new.amount,'invoice_id',new.invoice_id,'client_id',new.client_id)); end if; return new; end; $$;
create trigger automation_payments_event after insert or update on public.payments for each row execute procedure public.automation_payments_event();

create or replace function public.automation_calendar_event() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.automation_record_event(new.company_id,new.workspace_id,'calendar_event_upcoming','calendar_event',new.id,'calendar_event_upcoming:'||new.id||':'||new.starts_at::date::text,jsonb_build_object('starts_at',new.starts_at,'title',new.title,'client_id',new.client_id)); return new; end; $$;
create trigger automation_calendar_event after insert or update of starts_at on public.calendar_events for each row execute procedure public.automation_calendar_event();

create or replace function public.automation_communications_event() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='awaiting_review' and old.status is distinct from new.status then
    perform public.automation_record_event(new.company_id,new.workspace_id,'communication_approval_required','communication',new.id,'communication_approval_required:'||new.id||':'||new.updated_at::text,jsonb_build_object('status',new.status,'recipient',new.recipient,'related_client_id',new.related_client_id,'related_invoice_id',new.related_invoice_id));
  end if;
  return new;
end; $$;
create trigger automation_communications_event after update of status on public.communications for each row execute procedure public.automation_communications_event();

-- Safe placeholder expansion deliberately supports a fixed vocabulary only.
create or replace function public.automation_render_template(p_template text,p_company uuid,p_related_type text,p_related_id uuid) returns text
language plpgsql stable security definer set search_path=public as $$
declare result text:=coalesce(p_template,''); client_name text; provider_name text; clinician_name text; invoice_number text; invoice_balance numeric; invoice_due date; credential_type text; credential_expiry date; task_title text;
begin
  if p_related_type='client' then select name into client_name from public.clients where id=p_related_id and company_id=p_company; end if;
  if p_related_type='provider' then select coalesce(display_name,concat_ws(' ',first_name,last_name)) into provider_name from public.providers where id=p_related_id and company_id=p_company; end if;
  if p_related_type='clinician' then select coalesce(display_name,concat_ws(' ',first_name,last_name)) into clinician_name from public.clinicians where id=p_related_id and company_id=p_company; end if;
  if p_related_type='invoice' then select invoice_number,balance_due,due_date into invoice_number,invoice_balance,invoice_due from public.invoice_financials where id=p_related_id and company_id=p_company; end if;
  if p_related_type='credential' then select credential_type,expiration_date into credential_type,credential_expiry from public.credentials where id=p_related_id and company_id=p_company; end if;
  if p_related_type='task' then select title into task_title from public.tasks where id=p_related_id and company_id=p_company; end if;
  result:=replace(result,'{{client.name}}',coalesce(client_name,'')); result:=replace(result,'{{provider.name}}',coalesce(provider_name,'')); result:=replace(result,'{{clinician.name}}',coalesce(clinician_name,'')); result:=replace(result,'{{invoice.number}}',coalesce(invoice_number,'')); result:=replace(result,'{{invoice.balance}}',coalesce(invoice_balance::text,'')); result:=replace(result,'{{invoice.due_date}}',coalesce(invoice_due::text,'')); result:=replace(result,'{{credential.type}}',coalesce(credential_type,'')); result:=replace(result,'{{credential.expiration_date}}',coalesce(credential_expiry::text,'')); result:=replace(result,'{{task.title}}',coalesce(task_title,'')); return result;
end; $$;

create or replace function public.automation_execute_action(p_action_run_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare ar public.automation_action_runs%rowtype; run public.automation_runs%rowtype; action public.automation_actions%rowtype; rule public.automation_rules%rowtype; target_id uuid; output jsonb; recipient_value text; recipient_source text; template_row public.templates%rowtype; due_days integer; task_id uuid; communication_id uuid; ai_id uuid;
begin
  select * into ar from public.automation_action_runs where id=p_action_run_id for update; if not found then raise exception 'Automation action run was not found'; end if;
  if ar.status='succeeded' then return coalesce(ar.result,'{}'::jsonb); end if;
  select * into run from public.automation_runs where id=ar.automation_run_id; select * into action from public.automation_actions where id=ar.automation_action_id and archived_at is null and active; select * into rule from public.automation_rules where id=run.automation_rule_id and archived_at is null;
  if action.id is null or rule.id is null or run.company_id<>rule.company_id then raise exception 'Automation rule or action is invalid'; end if;
  if (select origin_depth from public.automation_events where id=run.automation_event_id) >= 3 then raise exception 'Automation recursion limit reached'; end if;
  perform set_config('app.automation_execution','true',true);
  update public.automation_action_runs set status='running',attempt_count=attempt_count+1,started_at=now() where id=ar.id;
  perform set_config('app.automation_origin_run_id',run.id::text,true); perform set_config('app.automation_origin_depth',(coalesce((select origin_depth from public.automation_events where id=run.automation_event_id),0)+1)::text,true);
  target_id:=run.related_resource_id;
  if action.action_type='create_task' then
    due_days:=case when coalesce(action.configuration->>'due_in_days','') ~ '^\d{1,3}$' then (action.configuration->>'due_in_days')::integer else 0 end;
    insert into public.tasks(company_id,workspace_id,title,description,status,priority,due_at,client_id,provider_id,clinician_id,credential_id,invoice_id,created_by)
    values(run.company_id,coalesce((action.configuration->>'workspace_id')::uuid,run.workspace_id),public.automation_render_template(coalesce(action.configuration->>'title','Automation task'),run.company_id,run.related_resource_type,target_id),public.automation_render_template(action.configuration->>'description',run.company_id,run.related_resource_type,target_id),'not_started',coalesce(action.configuration->>'priority','medium'),case when due_days>0 then now()+make_interval(days=>due_days) else null end,case when run.related_resource_type='client' then target_id when run.related_resource_type='invoice' then (run.trigger_payload->>'client_id')::uuid end,case when run.related_resource_type='provider' then target_id end,case when run.related_resource_type='clinician' then target_id end,case when run.related_resource_type='credential' then target_id end,case when run.related_resource_type='invoice' then target_id end,rule.created_by) returning id into task_id;
    output:=jsonb_build_object('task_id',task_id);
  elsif action.action_type='assign_task' then
    if run.related_resource_type<>'task' then raise exception 'Assign Task requires a task trigger'; end if; update public.tasks set assignee_id=(action.configuration->>'assignee_id')::uuid where id=target_id and company_id=run.company_id; output:=jsonb_build_object('task_id',target_id);
  elsif action.action_type in ('update_task_status','update_record_status') then
    if run.related_resource_type<>'task' then raise exception 'Update Task Status requires a task trigger'; end if; update public.tasks set status=action.configuration->>'status' where id=target_id and company_id=run.company_id; output:=jsonb_build_object('task_id',target_id,'status',action.configuration->>'status');
  elsif action.action_type='create_activity' then
    insert into public.activities(company_id,workspace_id,subject_type,subject_id,activity_type,title,body,created_by) values(run.company_id,run.workspace_id,coalesce(run.related_resource_type,'automation'),target_id,'automation',public.automation_render_template(coalesce(action.configuration->>'title','Automation activity'),run.company_id,run.related_resource_type,target_id),public.automation_render_template(action.configuration->>'body',run.company_id,run.related_resource_type,target_id),rule.created_by) returning id into task_id; output:=jsonb_build_object('activity_id',task_id);
  elsif action.action_type='create_notification' then
    if action.configuration->>'recipient_source'='task_assignee' and run.related_resource_type='task' then select assignee_id into task_id from public.tasks where id=target_id and company_id=run.company_id; else task_id:=null; end if;
    insert into public.notifications(company_id,workspace_id,recipient_user_id,type,title,body,related_resource_type,related_resource_id,link_path,created_by) values(run.company_id,run.workspace_id,coalesce(nullif(action.configuration->>'recipient_user_id','')::uuid,task_id,rule.created_by),coalesce(action.configuration->>'notification_type','general'),public.automation_render_template(coalesce(action.configuration->>'title','Automation notification'),run.company_id,run.related_resource_type,target_id),public.automation_render_template(action.configuration->>'body',run.company_id,run.related_resource_type,target_id),run.related_resource_type,target_id,action.configuration->>'link_path',rule.created_by) returning id into task_id; output:=jsonb_build_object('notification_id',task_id);
  elsif action.action_type in ('prepare_communication','apply_approved_template') then
    if action.action_type='apply_approved_template' then select * into template_row from public.templates where id=(action.configuration->>'template_id')::uuid and company_id=run.company_id and active and archived_at is null; if template_row.id is null then raise exception 'Approved template was not found'; end if; else template_row.subject:=action.configuration->>'subject'; template_row.body:=coalesce(action.configuration->>'body',''); end if;
    recipient_value:=nullif(action.configuration->>'recipient',''); recipient_source:=action.configuration->>'recipient_source';
    if recipient_value is null then
      if recipient_source='client_primary_contact' and run.related_resource_type='client' then select cc.email into recipient_value from public.client_contacts cc where cc.client_id=target_id and cc.company_id=run.company_id and cc.is_primary and cc.archived_at is null order by cc.created_at limit 1;
      elsif recipient_source='client_primary_contact' and run.related_resource_type in ('invoice','payment') then select cc.email into recipient_value from public.client_contacts cc where cc.client_id=(run.trigger_payload->>'client_id')::uuid and cc.company_id=run.company_id and cc.is_primary and cc.archived_at is null order by cc.created_at limit 1;
      elsif recipient_source='related_provider_email' and run.related_resource_type='provider' then select p.email into recipient_value from public.providers p where p.id=target_id and p.company_id=run.company_id;
      elsif recipient_source='related_clinician_email' and run.related_resource_type='clinician' then select c.email into recipient_value from public.clinicians c where c.id=target_id and c.company_id=run.company_id;
      elsif recipient_source='credential_holder_email' and run.related_resource_type='credential' then select coalesce(p.email,c.email) into recipient_value from public.credentials cr left join public.providers p on p.id=cr.provider_id and p.company_id=cr.company_id left join public.clinicians c on c.id=cr.clinician_id and c.company_id=cr.company_id where cr.id=target_id and cr.company_id=run.company_id;
      end if;
    end if;
    if recipient_value is null or btrim(recipient_value)='' then raise exception 'Prepare Communication requires an authorized recipient with an email address'; end if;
    insert into public.communications(company_id,workspace_id,automation_run_id,template_id,recipient,subject,draft_body,status,related_client_id,related_provider_id,related_clinician_id,related_task_id,related_invoice_id,related_credential_id,created_by) values(run.company_id,run.workspace_id,run.id,template_row.id,recipient_value,public.automation_render_template(template_row.subject,run.company_id,run.related_resource_type,target_id),public.automation_render_template(template_row.body,run.company_id,run.related_resource_type,target_id),'draft',case when run.related_resource_type='client' then target_id end,case when run.related_resource_type='provider' then target_id end,case when run.related_resource_type='clinician' then target_id end,case when run.related_resource_type='task' then target_id end,case when run.related_resource_type='invoice' then target_id when run.related_resource_type='payment' then (run.trigger_payload->>'invoice_id')::uuid end,case when run.related_resource_type='credential' then target_id end,rule.created_by) returning id into communication_id; output:=jsonb_build_object('communication_id',communication_id);
  elsif action.action_type='queue_ai_draft' then
    select id into communication_id from public.communications where automation_run_id=run.id order by created_at desc limit 1;
    insert into public.ai_requests(company_id,workspace_id,communication_id,request_type,related_resource_type,related_resource_id,input_context,status,execution_key,requested_by) values(run.company_id,run.workspace_id,communication_id,coalesce(action.configuration->>'request_type','draft_client_reply'),run.related_resource_type,target_id,jsonb_build_object('trigger_type',run.trigger_type,'related_resource_type',run.related_resource_type,'related_resource_id',target_id),'queued',ar.execution_key||':ai',rule.created_by) returning id into ai_id;
    if communication_id is not null then update public.communications set status='ai_draft_requested' where id=communication_id; end if; output:=jsonb_build_object('ai_request_id',ai_id,'communication_id',communication_id);
  elsif action.action_type='queue_integration_event' then
    insert into public.integration_events(company_id,workspace_id,automation_run_id,integration,direction,event_type,deduplication_key,payload,status) values(run.company_id,run.workspace_id,run.id,coalesce(action.configuration->>'integration','webhook'),'outbound',coalesce(action.configuration->>'event_type',run.trigger_type),ar.execution_key||':integration',jsonb_build_object('related_resource_type',run.related_resource_type,'related_resource_id',target_id),'pending') returning id into task_id; output:=jsonb_build_object('integration_event_id',task_id);
  else raise exception 'Unsupported automation action'; end if;
  update public.automation_action_runs set status='succeeded',result=output,finished_at=now() where id=ar.id; return output;
end; $$;

-- Review and approval are explicit. Queuing requires an already approved draft.
create or replace function public.enforce_communication_transition() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status in ('sent','cancelled') and new.status<>old.status then raise exception 'Sent or cancelled communications cannot be changed'; end if;
  if new.status='approved' and (new.final_body is null and new.draft_body is null) then raise exception 'Approved communication requires a body'; end if;
  if new.status='approved' and current_setting('app.automation_execution', true) is distinct from 'true' and new.approved_by is distinct from auth.uid() then raise exception 'A communication must be approved by the authenticated reviewer'; end if;
  if new.status='queued' and old.status<>'approved' then raise exception 'Only an approved communication can be queued'; end if;
  if new.status='sent' and old.status<>'sent' and current_setting('app.automation_execution', true) is distinct from 'true' then raise exception 'Only the server-side delivery worker can mark a communication as sent'; end if;
  if new.status='approved' and new.approved_by is null then raise exception 'Approved communication requires an approver'; end if;
  return new;
end; $$;
create trigger communications_enforce_transition before update on public.communications for each row execute procedure public.enforce_communication_transition();

create or replace function public.enforce_communication_update_permission() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if current_setting('app.automation_execution', true) = 'true' then return new; end if;
  if new.delivery_claimed_at is distinct from old.delivery_claimed_at then raise exception 'Only the server-side delivery worker can claim a communication'; end if;
  if public.has_permission(new.company_id,'communications.review') then return new; end if;
  if not public.has_permission(new.company_id,'communications.queue') or old.status<>'approved' or new.status<>'queued'
    or new.recipient is distinct from old.recipient or new.subject is distinct from old.subject
    or new.draft_body is distinct from old.draft_body or new.final_body is distinct from old.final_body
    or new.company_id is distinct from old.company_id or new.workspace_id is distinct from old.workspace_id then
    raise exception 'Communication review permission is required; queue permission can only queue an approved communication';
  end if;
  return new;
end; $$;
create trigger communications_enforce_update_permission before update on public.communications for each row execute procedure public.enforce_communication_update_permission();

-- These narrow RPCs are the only worker-side path for changing a linked
-- communication. Browser requests continue to use the RLS-protected review API.
create or replace function public.automation_claim_ai_request(p_request_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare request_row public.ai_requests%rowtype;
begin
  select * into request_row from public.ai_requests where id=p_request_id for update;
  if not found or request_row.retry_count>=3 or (request_row.status<>'queued' and (request_row.status<>'processing' or request_row.processing_claimed_at >= now()-interval '15 minutes')) then return jsonb_build_object('claimed',false); end if;
  update public.ai_requests set status='processing',processing_claim_token=p_claim_token,processing_claimed_at=now() where id=request_row.id;
  return jsonb_build_object('claimed',true,'request_id',request_row.id,'company_id',request_row.company_id,'workspace_id',request_row.workspace_id,'request_type',request_row.request_type,'input_context',request_row.input_context,'related_resource_type',request_row.related_resource_type,'related_resource_id',request_row.related_resource_id,'communication_id',request_row.communication_id,'requested_by',request_row.requested_by);
end; $$;

create or replace function public.automation_complete_ai_request(p_request_id uuid,p_claim_token uuid,p_content text,p_provider text,p_model text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare request_row public.ai_requests%rowtype;
begin
  select * into request_row from public.ai_requests where id=p_request_id for update;
  if not found or request_row.status<>'processing' or request_row.processing_claim_token is distinct from p_claim_token then raise exception 'AI request is not available for completion'; end if;
  if coalesce(nullif(btrim(p_content),''),'') is null then raise exception 'AI completion requires draft content'; end if;
  update public.ai_requests set status='awaiting_review',response=jsonb_build_object('content',p_content),provider=p_provider,model=p_model,error_details=null,completed_at=now(),processing_claim_token=null,processing_claimed_at=null where id=request_row.id;
  if request_row.communication_id is not null then
    perform set_config('app.automation_execution','true',true);
    update public.communications set draft_body=p_content,status='awaiting_review',failure_details=null where id=request_row.communication_id and company_id=request_row.company_id;
  end if;
  return jsonb_build_object('request_id',request_row.id,'status','awaiting_review');
end; $$;

create or replace function public.automation_fail_ai_request(p_request_id uuid,p_claim_token uuid,p_error text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare request_row public.ai_requests%rowtype; retries integer; final_status text;
begin
  select * into request_row from public.ai_requests where id=p_request_id for update;
  if not found or request_row.status<>'processing' or request_row.processing_claim_token is distinct from p_claim_token then raise exception 'AI request is not available for failure handling'; end if;
  retries:=request_row.retry_count+1; final_status:=case when retries>=3 then 'failed' else 'queued' end;
  update public.ai_requests set status=final_status,retry_count=retries,error_details=left(coalesce(p_error,'AI request failed.'),2000),completed_at=case when final_status='failed' then now() else null end,processing_claim_token=null,processing_claimed_at=null where id=request_row.id;
  if final_status='failed' and request_row.communication_id is not null then
    perform set_config('app.automation_execution','true',true);
    update public.communications set status='failed',failure_details=left(coalesce(p_error,'AI request failed.'),2000) where id=request_row.communication_id and company_id=request_row.company_id;
  end if;
  return jsonb_build_object('request_id',request_row.id,'status',final_status,'retry_count',retries);
end; $$;

create or replace function public.automation_claim_communication_delivery(p_communication_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare communication_row public.communications%rowtype;
begin
  select * into communication_row from public.communications where id=p_communication_id for update;
  if not found or communication_row.status<>'queued' or (communication_row.delivery_claimed_at is not null and communication_row.delivery_claimed_at >= now()-interval '15 minutes') then return jsonb_build_object('claimed',false); end if;
  perform set_config('app.automation_execution','true',true);
  update public.communications set delivery_claimed_at=now() where id=communication_row.id;
  return jsonb_build_object('claimed',true,'communication_id',communication_row.id,'company_id',communication_row.company_id,'recipient',communication_row.recipient,'subject',communication_row.subject,'body',coalesce(communication_row.final_body,communication_row.draft_body));
end; $$;

create or replace function public.automation_record_communication_delivery(p_communication_id uuid,p_success boolean,p_provider text default null,p_message_id text default null,p_thread_id text default null,p_error text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare communication_row public.communications%rowtype; retries integer; final_status text;
begin
  select * into communication_row from public.communications where id=p_communication_id for update;
  if not found or communication_row.status<>'queued' or communication_row.delivery_claimed_at is null then raise exception 'Communication is not available for delivery'; end if;
  perform set_config('app.automation_execution','true',true);
  if p_success then
    update public.communications set status='sent',provider_name=p_provider,external_message_id=p_message_id,external_thread_id=p_thread_id,failure_details=null,delivery_claimed_at=null where id=communication_row.id;
    return jsonb_build_object('communication_id',communication_row.id,'status','sent','retry_count',communication_row.retry_count);
  end if;
  retries:=communication_row.retry_count+1; final_status:=case when retries>=3 then 'failed' else 'queued' end;
  update public.communications set status=final_status,retry_count=retries,failure_details=left(coalesce(p_error,'Email delivery failed.'),2000),delivery_claimed_at=null where id=communication_row.id;
  return jsonb_build_object('communication_id',communication_row.id,'status',final_status,'retry_count',retries);
end; $$;

create or replace function public.automation_claim_integration_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare event_row public.integration_events%rowtype;
begin
  select * into event_row from public.integration_events where id=p_event_id for update;
  if not found or event_row.direction<>'outbound' or event_row.integration not in ('webhook','zapier') or event_row.retry_count>=3 or event_row.status not in ('pending','sent') or (event_row.processing_claimed_at is not null and event_row.processing_claimed_at >= now()-interval '15 minutes') then return jsonb_build_object('claimed',false); end if;
  update public.integration_events set status='sent',processing_claimed_at=now() where id=event_row.id;
  return jsonb_build_object('claimed',true,'event_id',event_row.id,'event_type',event_row.event_type,'payload',event_row.payload,'company_id',event_row.company_id);
end; $$;

create or replace function public.automation_record_integration_delivery(p_event_id uuid,p_success boolean,p_external_id text default null,p_error text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare event_row public.integration_events%rowtype; retries integer; final_status text;
begin
  select * into event_row from public.integration_events where id=p_event_id for update;
  if not found or event_row.status<>'sent' or event_row.processing_claimed_at is null then raise exception 'Integration event is not available for delivery'; end if;
  if p_success then
    update public.integration_events set status='succeeded',external_id=p_external_id,error_details=null,processed_at=now(),processing_claimed_at=null where id=event_row.id;
    return jsonb_build_object('event_id',event_row.id,'status','succeeded','retry_count',event_row.retry_count);
  end if;
  retries:=event_row.retry_count+1; final_status:=case when retries>=3 then 'failed' else 'pending' end;
  update public.integration_events set status=final_status,retry_count=retries,error_details=left(coalesce(p_error,'Webhook delivery failed.'),2000),processing_claimed_at=null where id=event_row.id;
  return jsonb_build_object('event_id',event_row.id,'status',final_status,'retry_count',retries);
end; $$;

-- Disabled examples are reviewable starting points, not active automation.
with inserted as (
  insert into public.automation_rules(company_id,name,description,active,trigger_type,trigger_resource,conditions)
  select c.id,'Credential expires within 30 days','Create a renewal task, in-app notification, and reviewable reminder draft.',false,'credential_expiring','credential','[{"field":"expiration_date","operator":"within_days","value":30}]'::jsonb from public.companies c where c.slug='tidemark-va' returning id
) insert into public.automation_actions(automation_rule_id,position,action_type,configuration)
select id,position,action_type,configuration from inserted cross join (values
  (1,'create_task'::text,'{"title":"Renew {{credential.type}}","priority":"high","due_in_days":7}'::jsonb),
  (2,'create_notification'::text,'{"title":"Credential renewal needed","notification_type":"credential_expiring"}'::jsonb),
  (3,'prepare_communication'::text,'{"recipient_source":"credential_holder_email","subject":"Credential renewal reminder","body":"Your {{credential.type}} is approaching expiration on {{credential.expiration_date}}."}'::jsonb)
) actions(position,action_type,configuration);
with inserted as (
  insert into public.automation_rules(company_id,name,description,active,trigger_type,trigger_resource,conditions)
  select c.id,'Invoice overdue follow-up','Prepare a collection task and reviewable follow-up communication.',false,'invoice_overdue','invoice','[]'::jsonb from public.companies c where c.slug='tidemark-va' returning id
) insert into public.automation_actions(automation_rule_id,position,action_type,configuration)
select id,position,action_type,configuration from inserted cross join (values
  (1,'create_task'::text,'{"title":"Follow up on invoice {{invoice.number}}","priority":"high","due_in_days":1}'::jsonb),
  (2,'prepare_communication'::text,'{"recipient_source":"client_primary_contact","subject":"Invoice {{invoice.number}} follow-up","body":"Please review the related invoice balance and contact the client."}'::jsonb)
) actions(position,action_type,configuration);
with inserted as (
  insert into public.automation_rules(company_id,name,description,active,trigger_type,trigger_resource,conditions)
  select c.id,'New client onboarding','Create a reviewable onboarding task when a client is created.',false,'client_created','client','[]'::jsonb from public.companies c where c.slug='tidemark-va' returning id
) insert into public.automation_actions(automation_rule_id,position,action_type,configuration) select id,1,'create_task','{"title":"Onboard {{client.name}}","priority":"medium","due_in_days":3}'::jsonb from inserted;
with inserted as (
  insert into public.automation_rules(company_id,name,description,active,trigger_type,trigger_resource,conditions)
  select c.id,'Task overdue escalation','Notify the authorized task owner when a task is overdue.',false,'task_overdue','task','[]'::jsonb from public.companies c where c.slug='tidemark-va' returning id
) insert into public.automation_actions(automation_rule_id,position,action_type,configuration) select id,1,'create_notification','{"title":"Overdue task requires attention","notification_type":"task_overdue","recipient_source":"task_assignee"}'::jsonb from inserted;
with inserted as (
  insert into public.automation_rules(company_id,name,description,active,trigger_type,trigger_resource,conditions)
  select c.id,'Payment posted acknowledgement','Add a payment activity; prepare an acknowledgment only after a recipient is configured.',false,'payment_posted','payment','[]'::jsonb from public.companies c where c.slug='tidemark-va' returning id
) insert into public.automation_actions(automation_rule_id,position,action_type,configuration)
select id,position,action_type,configuration from inserted cross join (values
  (1,'create_activity'::text,'{"title":"Payment posted","body":"Payment recorded for the related invoice."}'::jsonb),
  (2,'prepare_communication'::text,'{"recipient_source":"client_primary_contact","subject":"Payment acknowledgment","body":"We received your payment. Thank you."}'::jsonb)
) actions(position,action_type,configuration);

insert into public.templates(company_id,name,category,subject,body,active,version)
select c.id,'Credential reminder','credential_reminder','Credential renewal reminder','Your {{credential.type}} is approaching expiration on {{credential.expiration_date}}.',true,1 from public.companies c where c.slug='tidemark-va'
on conflict do nothing;

grant execute on function public.automation_execute_action(uuid) to service_role;
grant execute on function public.automation_record_event(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.automation_claim_ai_request(uuid,uuid) to service_role;
grant execute on function public.automation_complete_ai_request(uuid,uuid,text,text,text) to service_role;
grant execute on function public.automation_fail_ai_request(uuid,uuid,text) to service_role;
grant execute on function public.automation_claim_communication_delivery(uuid) to service_role;
grant execute on function public.automation_record_communication_delivery(uuid,boolean,text,text,text,text) to service_role;
grant execute on function public.automation_claim_integration_event(uuid) to service_role;
grant execute on function public.automation_record_integration_delivery(uuid,boolean,text,text) to service_role;
revoke all on function public.automation_execute_action(uuid) from public, anon, authenticated;
revoke all on function public.automation_record_event(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.automation_claim_ai_request(uuid,uuid) from public, anon, authenticated;
revoke all on function public.automation_complete_ai_request(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.automation_fail_ai_request(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.automation_claim_communication_delivery(uuid) from public, anon, authenticated;
revoke all on function public.automation_record_communication_delivery(uuid,boolean,text,text,text,text) from public, anon, authenticated;
revoke all on function public.automation_claim_integration_event(uuid) from public, anon, authenticated;
revoke all on function public.automation_record_integration_delivery(uuid,boolean,text,text) from public, anon, authenticated;
revoke all on function public.automation_render_template(text,uuid,text,uuid) from public, anon, authenticated;

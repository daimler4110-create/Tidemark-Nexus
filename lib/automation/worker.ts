import "server-only";
import { randomUUID } from "node:crypto";
import { conditionsMatch, type Condition } from "@/lib/automation/conditions";
import { integrationConfiguration, requestAiDraft, sendApprovedEmail, sendOutboundWebhook } from "@/lib/automation/adapters";
import { resolveAuthorizedAiContext } from "@/lib/automation/ai-context";
import { serviceRest } from "@/lib/db/service-rest";

type Row = Record<string, unknown>;
const maxRetries = 3;
const text = (value: unknown) => typeof value === "string" ? value : "";
const uuid = (value: unknown) => text(value);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const date = (value: unknown) => text(value).slice(0, 10);
const nowDate = () => new Date().toISOString().slice(0, 10);

async function appendAudit(companyId: string, action: string, resourceType: string, resourceId?: string, after?: Record<string, unknown>) {
  await serviceRest("POST", "audit_logs", { body: { company_id: companyId, action, resource_type: resourceType, resource_id: resourceId || null, after_data: after ?? null } }).catch(() => undefined);
}

async function appendNotification(companyId: string, workspaceId: string | null, recipientId: string, type: string, title: string, body: string, resourceType: string | null, resourceId: string | null, linkPath: string) {
  await serviceRest("POST", "notifications", { body: { company_id: companyId, workspace_id: workspaceId, recipient_user_id: recipientId || null, type, title, body, related_resource_type: resourceType, related_resource_id: resourceId, link_path: linkPath, created_by: recipientId || null } }).catch(() => undefined);
}

async function enqueueScheduledEvents() {
  const today = nowDate(); const future = new Date(); future.setUTCDate(future.getUTCDate() + 365); const futureDate = future.toISOString().slice(0, 10);
  const insert = (companyId: string, workspaceId: string | null, trigger: string, resourceType: string, id: string, payload: Record<string, unknown>) => serviceRest("POST", "rpc/automation_record_event", { body: { p_company: companyId, p_workspace: workspaceId, p_trigger: trigger, p_resource_type: resourceType, p_resource_id: id, p_event_key: `${trigger}:${id}:${today}`, p_payload: payload } }).catch(() => undefined);
  const [credentials, ar, tasks, calendar] = await Promise.all([
    serviceRest<Row[]>("GET", "credentials", { query: { select: "id,company_id,expiration_date,credential_type,status", archived_at: "is.null", expiration_date: `lte.${futureDate}`, limit: "500" } }).catch(() => []),
    serviceRest<Row[]>("GET", "ar_aging", { query: { select: "id,company_id,workspace_id,due_date,invoice_number,balance_due,client_id", balance_due: "gt.0", limit: "500" } }).catch(() => []),
    serviceRest<Row[]>("GET", "tasks", { query: { select: "id,company_id,workspace_id,due_at,title,status,priority", archived_at: "is.null", status: "neq.done", limit: "500" } }).catch(() => []),
    serviceRest<Row[]>("GET", "calendar_events", { query: { select: "id,company_id,workspace_id,starts_at,title,client_id", archived_at: "is.null", starts_at: `gte.${today}`, limit: "500" } }).catch(() => []),
  ]);
  await Promise.all(credentials.flatMap((row) => { const expiry = date(row.expiration_date); if (!expiry) return []; return [insert(uuid(row.company_id), null, expiry < today ? "credential_expired" : "credential_expiring", "credential", uuid(row.id), { expiration_date: expiry, credential_type: row.credential_type, status: row.status })]; }));
  await Promise.all(ar.flatMap((row) => { const due = date(row.due_date); if (!due) return []; return [insert(uuid(row.company_id), text(row.workspace_id) || null, due < today ? "invoice_overdue" : "invoice_due_soon", "invoice", uuid(row.id), { due_date: due, invoice_number: row.invoice_number, balance_due: row.balance_due, client_id: row.client_id })]; }));
  await Promise.all(tasks.flatMap((row) => { const due = date(row.due_at); if (!due) return []; return [insert(uuid(row.company_id), text(row.workspace_id) || null, due < today ? "task_overdue" : "task_due_soon", "task", uuid(row.id), { due_at: row.due_at, title: row.title, status: row.status, priority: row.priority })]; }));
  await Promise.all(calendar.map((row) => insert(uuid(row.company_id), text(row.workspace_id) || null, "calendar_event_upcoming", "calendar_event", uuid(row.id), { starts_at: row.starts_at, title: row.title, client_id: row.client_id })));
}

function actionExecutionKey(rule: Row, action: Row, event: Row) {
  const configuration = object(action.configuration); const recurringTrigger = ["credential_expiring", "credential_expired", "invoice_due_soon", "invoice_overdue", "task_due_soon", "task_overdue", "calendar_event_upcoming"].includes(text(event.trigger_type)); const stable = recurringTrigger || configuration.dedupe_scope === "resource" || ["create_task", "prepare_communication", "apply_approved_template", "queue_ai_draft"].includes(text(action.action_type));
  return stable ? `${uuid(rule.id)}:${uuid(action.id)}:${uuid(event.resource_id)}` : `${uuid(rule.id)}:${uuid(action.id)}:${text(event.event_key)}`;
}

async function getOrCreateRun(rule: Row, event: Row) {
  const create = { automation_rule_id: uuid(rule.id), automation_event_id: uuid(event.id), company_id: uuid(event.company_id), workspace_id: text(event.workspace_id) || null, event_key: text(event.event_key), trigger_type: text(event.trigger_type), related_resource_type: text(event.resource_type), related_resource_id: uuid(event.resource_id), trigger_payload: object(event.payload), status: "pending" };
  try { return (await serviceRest<Row[]>("POST", "automation_runs", { body: create, prefer: "return=representation" }))[0]; }
  catch { return (await serviceRest<Row[]>("GET", "automation_runs", { query: { select: "*", automation_rule_id: `eq.${uuid(rule.id)}`, event_key: `eq.${text(event.event_key)}`, limit: "1" } }))[0]; }
}

async function getOrCreateActionRun(run: Row, rule: Row, action: Row, event: Row) {
  const executionKey = actionExecutionKey(rule, action, event); const create = { automation_run_id: uuid(run.id), automation_action_id: uuid(action.id), company_id: uuid(run.company_id), execution_key: executionKey, status: "pending" };
  try { return (await serviceRest<Row[]>("POST", "automation_action_runs", { body: create, prefer: "return=representation" }))[0]; }
  catch { return (await serviceRest<Row[]>("GET", "automation_action_runs", { query: { select: "*", company_id: `eq.${uuid(run.company_id)}`, execution_key: `eq.${executionKey}`, limit: "1" } }))[0]; }
}

async function executeRun(run: Row, rule: Row, event: Row): Promise<boolean> {
  const actions = await serviceRest<Row[]>("GET", "automation_actions", { query: { select: "*", automation_rule_id: `eq.${uuid(rule.id)}`, active: "eq.true", archived_at: "is.null", order: "position.asc" } });
  if (!actions.length) { await serviceRest("PATCH", "automation_runs", { query: { id: `eq.${uuid(run.id)}` }, body: { status: "skipped", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), error_details: "No active actions." } }); return true; }
  await serviceRest("PATCH", "automation_runs", { query: { id: `eq.${uuid(run.id)}` }, body: { status: "running", started_at: new Date().toISOString(), actions_attempted: actions.length } });
  let success = 0; let failure = 0; let retryable = false; const errors: string[] = [];
  for (const action of actions) {
    const actionRun = await getOrCreateActionRun(run, rule, action, event);
    if (!actionRun) throw new Error("Could not create or retrieve the idempotent automation action run.");
    if (text(actionRun.status) === "succeeded") { success += 1; continue; }
    if (["failed", "skipped"].includes(text(actionRun.status))) { failure += 1; errors.push(text(actionRun.error_details) || "Automation action previously failed."); continue; }
    try { const result = await serviceRest<Row>("POST", "rpc/automation_execute_action", { body: { p_action_run_id: uuid(actionRun.id) } }); await appendAudit(uuid(run.company_id), "automation.action_succeeded", "automation_action_run", uuid(actionRun.id), { automation_run_id: run.id, automation_action_id: action.id, action_type: action.action_type, result }); success += 1; }
    catch (error) { const message = error instanceof Error ? error.message.slice(0, 2_000) : "Automation action failed."; failure += 1; errors.push(message); const retries = Number(actionRun.retry_count ?? 0) + 1; retryable ||= retries < maxRetries; await serviceRest("PATCH", "automation_action_runs", { query: { id: `eq.${uuid(actionRun.id)}` }, body: { status: retries >= maxRetries ? "failed" : "pending", retry_count: retries, error_details: message, finished_at: retries >= maxRetries ? new Date().toISOString() : null } }); }
  }
  if (retryable) {
    await serviceRest("PATCH", "automation_runs", { query: { id: `eq.${uuid(run.id)}` }, body: { status: "running", actions_succeeded: success, actions_failed: failure, retry_count: Number(run.retry_count ?? 0) + 1, error_details: errors.join(" | "), finished_at: null } });
    return false;
  }
  const status = failure === 0 ? "succeeded" : success ? "partially_failed" : "failed";
  await serviceRest("PATCH", "automation_runs", { query: { id: `eq.${uuid(run.id)}` }, body: { status, actions_succeeded: success, actions_failed: failure, error_details: errors.length ? errors.join(" | ") : null, finished_at: new Date().toISOString() } });
  await serviceRest("PATCH", "automation_rules", { query: { id: `eq.${uuid(rule.id)}` }, body: { last_run_at: new Date().toISOString() } });
  if (failure) { await appendAudit(uuid(run.company_id), "automation.run_failed", "automation_run", uuid(run.id), { errors }); await appendNotification(uuid(run.company_id), text(run.workspace_id) || null, text(rule.created_by), "automation_failed", "Automation run failed", errors.join(" | ").slice(0, 1_000), "automation_run", uuid(run.id), "/c/tidemark-va/automation?tab=runs"); }
  return true;
}

async function processEvents(limit: number) {
  const events = await serviceRest<Row[]>("GET", "automation_events", { query: { select: "*", processed_at: "is.null", retry_count: `lt.${maxRetries}`, order: "occurred_at.asc", limit: String(limit) } }); let processed = 0;
  for (const event of events) {
    try {
      const rules = await serviceRest<Row[]>("GET", "automation_rules", { query: { select: "*", company_id: `eq.${uuid(event.company_id)}`, trigger_type: `eq.${text(event.trigger_type)}`, active: "eq.true", archived_at: "is.null" } });
      let complete = true;
      for (const rule of rules) {
        if (text(rule.workspace_id) && text(rule.workspace_id) !== text(event.workspace_id)) continue;
        if (!conditionsMatch(Array.isArray(rule.conditions) ? rule.conditions as Condition[] : [], object(event.payload))) continue;
        const run = await getOrCreateRun(rule, event); if (!run) throw new Error("Could not create or retrieve the idempotent automation run.");
        const runComplete = await executeRun(run, rule, event);
        complete = complete && runComplete;
      }
      if (complete) {
        await serviceRest("PATCH", "automation_events", { query: { id: `eq.${uuid(event.id)}` }, body: { processed_at: new Date().toISOString(), last_error: null } }); processed += 1;
      } else {
        await serviceRest("PATCH", "automation_events", { query: { id: `eq.${uuid(event.id)}` }, body: { last_error: "One or more automation actions are pending a retry." } });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2_000) : "Automation event processing failed.";
      await serviceRest("PATCH", "automation_events", { query: { id: `eq.${uuid(event.id)}` }, body: { retry_count: Number(event.retry_count ?? 0) + 1, last_error: message } }).catch(() => undefined);
      await appendAudit(uuid(event.company_id), "automation.event_failed", "automation_event", uuid(event.id), { error: message });
    }
  }
  return processed;
}

async function processAi(limit: number) {
  if (!integrationConfiguration().ai) return { processed: 0, configured: false };
  const rows = await serviceRest<Row[]>("GET", "ai_requests", { query: { select: "*", status: "in.(queued,processing)", retry_count: `lt.${maxRetries}`, order: "requested_at.asc", limit: String(limit) } }); let processed = 0;
  for (const request of rows) { const claimToken = randomUUID(); const claim = await serviceRest<Row>("POST", "rpc/automation_claim_ai_request", { body: { p_request_id: uuid(request.id), p_claim_token: claimToken } }); if (claim.claimed !== true) continue; try { const context = await resolveAuthorizedAiContext({ company_id: uuid(claim.company_id), workspace_id: text(claim.workspace_id) || null, request_type: text(claim.request_type), related_resource_type: text(claim.related_resource_type) || null, related_resource_id: uuid(claim.related_resource_id) || null }); const result = await requestAiDraft({ id: uuid(claim.request_id), request_type: text(claim.request_type), input_context: context, company_id: uuid(claim.company_id), workspace_id: text(claim.workspace_id) || null }); await serviceRest("POST", "rpc/automation_complete_ai_request", { body: { p_request_id: uuid(claim.request_id), p_claim_token: claimToken, p_content: result.content, p_provider: result.provider, p_model: result.model } }); await appendNotification(uuid(claim.company_id), text(claim.workspace_id) || null, text(claim.requested_by), "ai_draft_ready", "AI draft ready for review", "An AI draft is awaiting your review; it has not been sent externally.", text(claim.related_resource_type) || null, text(claim.related_resource_id) || null, "/c/tidemark-va/ai"); await appendAudit(uuid(claim.company_id), "ai.request_completed", "ai_request", uuid(claim.request_id)); processed += 1; } catch (error) { const message = error instanceof Error ? error.message.slice(0, 2_000) : "AI request failed."; await serviceRest("POST", "rpc/automation_fail_ai_request", { body: { p_request_id: uuid(claim.request_id), p_claim_token: claimToken, p_error: message } }).catch(() => undefined); await appendAudit(uuid(claim.company_id), "ai.request_failed", "ai_request", uuid(claim.request_id), { error: message }); } }
  return { processed, configured: true };
}

async function processCommunications(limit: number) {
  if (!integrationConfiguration().email) return { processed: 0, configured: false };
  const rows = await serviceRest<Row[]>("GET", "communications", { query: { select: "*", status: "eq.queued", retry_count: `lt.${maxRetries}`, order: "created_at.asc", limit: String(limit) } }); let processed = 0;
  for (const communication of rows) { const claim = await serviceRest<Row>("POST", "rpc/automation_claim_communication_delivery", { body: { p_communication_id: uuid(communication.id) } }); if (claim.claimed !== true) continue; try { const body = text(claim.body); if (!body) throw new Error("Approved communication has no body."); const result = await sendApprovedEmail({ id: uuid(claim.communication_id), recipient: text(claim.recipient), subject: text(claim.subject) || null, body, company_id: uuid(claim.company_id) }); await serviceRest("POST", "rpc/automation_record_communication_delivery", { body: { p_communication_id: uuid(claim.communication_id), p_success: true, p_provider: result.provider, p_message_id: result.messageId, p_thread_id: result.threadId } }); processed += 1; } catch (error) { const message = error instanceof Error ? error.message.slice(0, 2_000) : "Email delivery failed."; await serviceRest("POST", "rpc/automation_record_communication_delivery", { body: { p_communication_id: uuid(claim.communication_id), p_success: false, p_error: message } }).catch(() => undefined); await appendAudit(uuid(claim.company_id), "communication.failed", "communication", uuid(claim.communication_id), { error: message }); } }
  return { processed, configured: true };
}

async function processIntegrations(limit: number) {
  if (!integrationConfiguration().webhooks) return { processed: 0, configured: false };
  const rows = await serviceRest<Row[]>("GET", "integration_events", { query: { select: "*", direction: "eq.outbound", integration: "in.(webhook,zapier)", status: "in.(pending,sent)", retry_count: `lt.${maxRetries}`, order: "created_at.asc", limit: String(limit) } }); let processed = 0;
  for (const event of rows) {
    const claim = await serviceRest<Row>("POST", "rpc/automation_claim_integration_event", { body: { p_event_id: uuid(event.id) } }); if (claim.claimed !== true) continue;
    try {
      const result = await sendOutboundWebhook({ id: uuid(claim.event_id), eventType: text(claim.event_type), payload: object(claim.payload), companyId: uuid(claim.company_id) });
      await serviceRest("POST", "rpc/automation_record_integration_delivery", { body: { p_event_id: uuid(claim.event_id), p_success: true, p_external_id: result.externalId } }); processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2_000) : "Webhook delivery failed.";
      await serviceRest("POST", "rpc/automation_record_integration_delivery", { body: { p_event_id: uuid(claim.event_id), p_success: false, p_error: message } }).catch(() => undefined);
      await appendAudit(uuid(claim.company_id), "integration_event.failed", "integration_event", uuid(claim.event_id), { error: message });
    }
  }
  return { processed, configured: true };
}

export async function runAutomationWorker(limit = 100) {
  await enqueueScheduledEvents(); const events = await processEvents(Math.min(Math.max(limit, 1), 500)); const ai = await processAi(50); const communications = await processCommunications(50); const integrationRuns = await processIntegrations(50); return { events, ai, communications, integrationRuns, integrations: integrationConfiguration() };
}

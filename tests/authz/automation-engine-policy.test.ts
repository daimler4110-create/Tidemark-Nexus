import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/0011_automation_ai_operations_engine.sql"), "utf8");
const worker = readFileSync(resolve(process.cwd(), "lib/automation/worker.ts"), "utf8");
const automationApi = readFileSync(resolve(process.cwd(), "app/api/automation/route.ts"), "utf8");
const aiApi = readFileSync(resolve(process.cwd(), "app/api/ai/route.ts"), "utf8");
const communicationApi = readFileSync(resolve(process.cwd(), "app/api/communications/route.ts"), "utf8");
const openAiAdapter = readFileSync(resolve(process.cwd(), "lib/automation/openai.ts"), "utf8");
const aiContext = readFileSync(resolve(process.cwd(), "lib/automation/ai-context.ts"), "utf8");
const aiAssistant = readFileSync(resolve(process.cwd(), "components/automation/ai-assistant.tsx"), "utf8");
const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

describe("automation engine authorization contract", () => {
  it("uses tenant-keyed durable models, RLS, and explicit permissions", () => {
    ["automation_rules", "automation_actions", "automation_events", "automation_runs", "automation_action_runs", "templates", "communications", "ai_requests", "notifications", "integration_events"].forEach((table) => expect(migration).toContain(`public.${table}`));
    ["automation.read", "automation.manage", "communications.review", "ai.request", "notifications.update"].forEach((permission) => expect(migration).toContain(`'${permission}'`));
    ["alter table public.automation_rules enable row level security", "automation_rules_read", "automation_rules_create", "automation_actions_create", "templates_create", "communications_update", "ai_requests_create"].forEach((policy) => expect(migration).toContain(policy));
    expect(migration).toContain("validate_automation_tenant_scope");
    expect(migration).toContain("revoke all on function public.automation_execute_action");
    expect(migration).toContain("validate_automation_configuration");
    expect(automationApi).toContain("company_id: `eq.${companyId}`");
    expect(aiApi).toContain("Related record must be authorized for the selected company.");
  });

  it("keeps action execution allowlisted and prevents duplicate work", () => {
    ["create_task", "create_activity", "create_notification", "prepare_communication", "queue_ai_draft", "queue_integration_event"].forEach((action) => expect(migration).toContain(`'${action}'`));
    expect(migration).toContain("unique(company_id, execution_key)");
    expect(migration).toContain("unique(automation_rule_id, event_key)");
    expect(worker).toContain("actionExecutionKey");
    expect(worker).toContain("recurringTrigger");
    expect(worker).toContain("maxRetries = 3");
    expect(worker).toContain("text(actionRun.status) === \"succeeded\"");
    expect(worker).toContain("retry_count");
    expect(worker).toContain("automation.action_succeeded");
    expect(worker).toContain("One or more automation actions are pending a retry.");
    expect(migration).toContain("app.automation_execution");
    expect(migration).toContain("automation_claim_integration_event");
    expect(worker).toContain("automation_claim_communication_delivery");
  });

  it("requires human approval before external delivery", () => {
    expect(migration).toContain("Only an approved communication can be queued");
    expect(migration).toContain("Approved communication requires an approver");
    expect(migration).toContain("Only the server-side delivery worker can mark a communication as sent");
    expect(migration).toContain("A communication must be approved by the authenticated reviewer");
    expect(communicationApi).toContain('parsed.data.action === "queue" ? "communications.queue" : "communications.review"');
    expect(worker).toContain('status: "eq.queued"');
  });

  it("records the supported VA triggers without arbitrary scripts", () => {
    ["automation_clients_event", "automation_tasks_event", "automation_invoices_event", "automation_payments_event", "automation_calendar_event", "automation_communications_event", "credential_expiring", "invoice_overdue", "task_overdue"].forEach((item) => expect(migration).toContain(item));
    expect(migration).toContain("Safe placeholder expansion deliberately supports a fixed vocabulary only");
    expect(aiContext).toContain("resourceDefinitions");
    expect(migration).not.toContain("plv8");
  });

  it("keeps worker task updates inside the fixed execution boundary", () => {
    expect(migration).toContain("create or replace function public.enforce_task_update_permission()");
    expect(migration).toContain("current_setting('app.automation_execution', true) = 'true'");
    expect(migration).toContain("perform set_config('app.automation_execution','true',true)");
  });

  it("keeps the OpenAI adapter server-only, provider-normalized, and review-gated", () => {
    expect(envExample).toContain("OPENAI_API_KEY=");
    expect(openAiAdapter).toContain('import "server-only"');
    expect(openAiAdapter).toContain("https://api.openai.com/v1/responses");
    expect(openAiAdapter).toContain("store: false");
    expect(openAiAdapter).toContain('provider: "openai"');
    expect(openAiAdapter).not.toContain("NEXT_PUBLIC_OPENAI_API_KEY");
    expect(aiContext).toContain('import "server-only"');
    expect(aiContext).toContain("company_id: `eq.${companyId}`");
    expect(worker).toContain("resolveAuthorizedAiContext");
    expect(worker).not.toContain("requestContext(");
    expect(aiApi).toContain('input_context: { source: "manual" }');
    expect(aiAssistant).not.toContain("OPENAI_API_KEY");
    expect(migration).toContain("status='processing'");
    expect(migration).toContain("status='awaiting_review'");
    expect(aiApi).toContain('body.decision === "approve" ? "approved" : "rejected"');
  });
});

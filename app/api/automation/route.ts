import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit/log";
import { requireAutomationContext } from "@/lib/automation/auth";
import { userRest } from "@/lib/db/rest";
import { automationRuleSchema } from "@/lib/validation/automation";
import { isUuid, zodInputError } from "@/lib/validation/uuid";

type Rule = Record<string, unknown> & { id: string };
function responseError(error: unknown) { const message = error instanceof Error ? error.message : "Automation request could not be completed."; return NextResponse.json({ error: message }, { status: /required|valid UUID|must be/i.test(message) ? 400 : 403 }); }

export async function GET(request: Request) {
  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  try { await requireAutomationContext(companyId, "automation", "automation.read"); const [rules, runs, actions, integrations] = await Promise.all([userRest<Rule[]>("GET", "automation_rules", { query: { select: "*", company_id: `eq.${companyId}`, archived_at: "is.null", order: "created_at.desc" } }), userRest<Record<string, unknown>[]>("GET", "automation_runs", { query: { select: "*", company_id: `eq.${companyId}`, order: "created_at.desc", limit: "200" } }), userRest<Record<string, unknown>[]>("GET", "automation_actions", { query: { select: "*,automation_rules!inner(company_id)", "automation_rules.company_id": `eq.${companyId}`, archived_at: "is.null", order: "position.asc" } }), userRest<Record<string, unknown>[]>("GET", "integration_events", { query: { select: "*", company_id: `eq.${companyId}`, order: "created_at.desc", limit: "200" } }).catch(() => [])]); return NextResponse.json({ rules, runs, actions, integrations }); }
  catch (error) { return responseError(error); }
}

async function verifyWorkspaceScope(companyId: string, workspaceId: string | null | undefined) {
  if (!workspaceId) return;
  const rows = await userRest<Array<{ id: string }>>("GET", "workspaces", { query: { select: "id", id: `eq.${workspaceId}`, company_id: `eq.${companyId}`, archived_at: "is.null" } });
  if (!rows[0]) throw new Error("Workspace must be an active authorized workspace in the selected company.");
}

async function verifyActionReferences(companyId: string, actions: Array<{ configuration: unknown }>) {
  for (const action of actions) {
    const configuration = action.configuration && typeof action.configuration === "object" && !Array.isArray(action.configuration) ? action.configuration as Record<string, unknown> : {};
    for (const [field, table] of [["template_id", "templates"], ["workspace_id", "workspaces"]] as const) {
      const id = configuration[field]; if (typeof id !== "string" || !isUuid(id)) continue;
      const query = { select: "id", id: `eq.${id}`, company_id: `eq.${companyId}`, ...(field === "workspace_id" ? { archived_at: "is.null" } : {}) };
      const rows = await userRest<Array<{ id: string }>>("GET", table, { query });
      if (!rows[0]) throw new Error(`${field.replace("_id", "")} must be an authorized record in the selected company.`);
    }
    if (typeof configuration.assignee_id === "string" && isUuid(configuration.assignee_id)) {
      const assignees = await userRest<Array<{ id: string }>>("POST", "rpc/task_assignment_options", { body: { target_company: companyId, target_workspace: null } });
      if (!assignees.some((assignee) => assignee.id === configuration.assignee_id)) throw new Error("Assignee must be an active authorized member of the selected company.");
    }
    if (typeof configuration.recipient_user_id === "string" && isUuid(configuration.recipient_user_id)) {
      const recipients = await userRest<Array<{ id: string }>>("POST", "rpc/task_assignment_options", { body: { target_company: companyId, target_workspace: null } });
      if (!recipients.some((recipient) => recipient.id === configuration.recipient_user_id)) throw new Error("Notification recipient must be an active authorized member of the selected company.");
    }
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { companyId?: string; data?: unknown } | null; const parsed = automationRuleSchema.safeParse(body?.data);
  if (!parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
  try { const { user, companyId } = await requireAutomationContext(body?.companyId ?? "", "automation", "automation.manage"); const data = parsed.data; await verifyWorkspaceScope(companyId, data.workspace_id); await verifyActionReferences(companyId, data.actions); const rules = await userRest<Rule[]>("POST", "automation_rules", { body: { company_id: companyId, workspace_id: data.workspace_id, name: data.name, description: data.description, active: data.active, trigger_type: data.trigger_type, trigger_resource: data.trigger_resource, conditions: data.conditions, created_by: user.id }, prefer: "return=representation" }); const rule = rules[0]; const actions = await Promise.all(data.actions.sort((a, b) => a.position - b.position).map((action) => userRest("POST", "automation_actions", { body: { automation_rule_id: rule.id, position: action.position, action_type: action.action_type, configuration: action.configuration }, prefer: "return=representation" }))); await logAuditEvent({ actorId: user.id, companyId, action: "automation_rule.created", resourceType: "automation_rule", resourceId: rule.id, after: { ...data, actionCount: actions.length } }); return NextResponse.json(rule, { status: 201 }); }
  catch (error) { return responseError(error); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { companyId?: string; id?: string; data?: unknown; archive?: boolean } | null;
  if (!body?.id || !isUuid(body.id)) return NextResponse.json({ error: "Rule ID must be a valid UUID." }, { status: 400 });
  const parsed = body.archive ? null : automationRuleSchema.safeParse(body.data);
  if (parsed && !parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
  try {
    const { user, companyId } = await requireAutomationContext(body.companyId ?? "", "automation", "automation.manage");
    if (body.archive) {
      const archive = { archived_at: new Date().toISOString(), active: false };
      const rows = await userRest<Rule[]>("PATCH", "automation_rules", { query: { id: `eq.${body.id}`, company_id: `eq.${companyId}` }, body: archive, prefer: "return=representation" });
      if (!rows[0]) return NextResponse.json({ error: "Automation rule was not found." }, { status: 404 });
      await logAuditEvent({ actorId: user.id, companyId, action: "automation_rule.archived", resourceType: "automation_rule", resourceId: body.id, after: archive });
      return NextResponse.json(rows[0]);
    }
    const data = parsed!.data;
    await verifyWorkspaceScope(companyId, data.workspace_id);
    await verifyActionReferences(companyId, data.actions);
    const rows = await userRest<Rule[]>("PATCH", "automation_rules", { query: { id: `eq.${body.id}`, company_id: `eq.${companyId}` }, body: { workspace_id: data.workspace_id, name: data.name, description: data.description, active: data.active, trigger_type: data.trigger_type, trigger_resource: data.trigger_resource, conditions: data.conditions }, prefer: "return=representation" });
    if (!rows[0]) return NextResponse.json({ error: "Automation rule was not found." }, { status: 404 });
    await userRest("PATCH", "automation_actions", { query: { automation_rule_id: `eq.${body.id}` }, body: { archived_at: new Date().toISOString() } });
    await Promise.all(data.actions.map((action) => userRest("POST", "automation_actions", { body: { automation_rule_id: body.id, position: action.position, action_type: action.action_type, configuration: action.configuration }, prefer: "return=representation" })));
    await logAuditEvent({ actorId: user.id, companyId, action: "automation_rule.updated", resourceType: "automation_rule", resourceId: body.id, after: data });
    return NextResponse.json(rows[0]);
  }
  catch (error) { return responseError(error); }
}

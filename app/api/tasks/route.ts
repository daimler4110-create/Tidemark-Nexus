import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { logAuditEvent } from "@/lib/audit/log";
import { userRest } from "@/lib/db/rest";
import { createClient } from "@/lib/supabase/server";
import { taskSchema } from "@/lib/validation/tasks";
import { isUuid, zodInputError } from "@/lib/validation/uuid";

type TaskRow = Record<string, unknown> & { id: string };
type Dependency = { dependency: string; record_count: number };
const relations = {
  workspace_id: ["workspaces", "Workspace"], client_id: ["clients", "Client"], provider_id: ["providers", "Provider"],
  clinician_id: ["clinicians", "Clinician"], credential_id: ["credentials", "Credential"], invoice_id: ["invoices", "Invoice"],
} as const;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Task request could not be completed.";
  const status = /must be|required|valid UUID|not found|belongs|assignee|title/i.test(message) ? 400 : /dependenc/i.test(message) ? 409 : 403;
  return NextResponse.json({ error: message }, { status });
}

async function authorize(companyId: string, permission: string) {
  if (!isUuid(companyId)) throw new Error("Company context must be a valid UUID.");
  const supabase = await createClient();
  const { data: company, error } = await supabase.from("companies").select("id,slug").eq("id", companyId).maybeSingle();
  if (error || company?.slug !== "tidemark-va") throw new Error("An authorized Tidemark VA company context is required.");
  await requireUser();
  await assertCompanyModuleEnabled(companyId, "tasks");
  await assertPermission(companyId, permission);
}

async function validateReferences(companyId: string, data: Record<string, unknown>) {
  await Promise.all(Object.entries(relations).map(async ([field, [table, label]]) => {
    const id = data[field];
    if (id == null) return;
    const rows = await userRest<Array<{ id: string }>>("GET", table, { query: { select: "id", id: `eq.${id}`, company_id: `eq.${companyId}`, ...(field === "workspace_id" ? { archived_at: "is.null" } : {}) } });
    if (!rows[0]) throw new Error(`${label} must belong to the selected Tidemark VA company.`);
  }));
  if (data.assignee_id != null) {
    const assignees = await userRest<Array<{ id: string }>>("POST", "rpc/task_assignment_options", { body: { target_company: companyId, target_workspace: data.workspace_id ?? null } });
    if (!assignees.some((assignee) => assignee.id === data.assignee_id)) throw new Error("Assignee must be an active authorized member of the selected company and workspace.");
  }
}

export async function GET(request: Request) {
  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  try {
    await authorize(companyId, "tasks.read");
    const rows = await userRest<TaskRow[]>("GET", "tasks", { query: { select: "*", company_id: `eq.${companyId}`, archived_at: "is.null", order: "due_at.asc.nullslast" } });
    return NextResponse.json(rows);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { companyId?: string; data?: unknown } | null;
  const parsed = taskSchema.safeParse(body?.data);
  if (!parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
  try {
    const user = await requireUser(); const companyId = body?.companyId ?? "";
    await authorize(companyId, "tasks.create");
    await validateReferences(companyId, parsed.data);
    const rows = await userRest<TaskRow[]>("POST", "tasks", { body: { ...parsed.data, company_id: companyId, created_by: user.id }, prefer: "return=representation" });
    await logAuditEvent({ actorId: user.id, companyId, action: "task.created", resourceType: "task", resourceId: rows[0]?.id, after: parsed.data });
    return NextResponse.json(rows[0], { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { companyId?: string; id?: string; data?: unknown; archive?: boolean } | null;
  if (!body?.id || !isUuid(body.id)) return NextResponse.json({ error: "Task ID must be a valid UUID." }, { status: 400 });
  const parsed = body.archive ? null : taskSchema.safeParse(body.data);
  if (parsed && !parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
  try {
    const user = await requireUser(); const companyId = body.companyId ?? "";
    await authorize(companyId, body.archive ? "tasks.archive" : "tasks.update");
    const data = body.archive ? { archived_at: new Date().toISOString() } : parsed!.data;
    if (!body.archive) await validateReferences(companyId, data);
    const rows = await userRest<TaskRow[]>("PATCH", "tasks", { query: { id: `eq.${body.id}`, company_id: `eq.${companyId}` }, body: data, prefer: "return=representation" });
    if (!rows[0]) return NextResponse.json({ error: "Task was not found in the selected company." }, { status: 404 });
    await logAuditEvent({ actorId: user.id, companyId, action: body.archive ? "task.archived" : "task.updated", resourceType: "task", resourceId: body.id, after: data });
    return NextResponse.json(rows[0]);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null) as { companyId?: string; id?: string; confirmation?: string } | null;
  if (!body?.id || !isUuid(body.id)) return NextResponse.json({ error: "Task ID must be a valid UUID." }, { status: 400 });
  if (body.confirmation !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm permanent task deletion." }, { status: 400 });
  try {
    const user = await requireUser(); const companyId = body.companyId ?? "";
    await authorize(companyId, "tasks.delete");
    const dependencies = await userRest<Dependency[]>("POST", "rpc/va_delete_dependencies", { body: { target_table: "tasks", target_id: body.id, target_company: companyId } });
    if (dependencies.length) return NextResponse.json({ error: `Permanent deletion is blocked because this task has protected dependencies: ${dependencies.map((item) => `${item.record_count} ${item.dependency}`).join(", ")}. Archive it instead.`, dependencies }, { status: 409 });
    const deleted = await userRest<TaskRow[]>("DELETE", "tasks", { query: { id: `eq.${body.id}`, company_id: `eq.${companyId}` }, prefer: "return=representation" });
    if (!deleted[0]) return NextResponse.json({ error: "Task was not found in the selected company." }, { status: 404 });
    await logAuditEvent({ actorId: user.id, companyId, action: "task.deleted", resourceType: "task", resourceId: body.id, after: { permanent: true } });
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}

import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { logAuditEvent } from "@/lib/audit/log";
import { userRest } from "@/lib/db/rest";
import { calendarEventSchema } from "@/lib/validation/calendar";
import { isUuid, zodInputError } from "@/lib/validation/uuid";

const relations = { workspace_id: "workspaces", client_id: "clients", provider_id: "providers", clinician_id: "clinicians" } as const;

async function validateReferences(companyId: string, event: Record<string, unknown>) {
  await Promise.all(Object.entries(relations).map(async ([field, table]) => {
    const value = event[field];
    if (value == null) return;
    const rows = await userRest<Array<{ id: string }>>("GET", table, { query: { select: "id", id: `eq.${value}`, company_id: `eq.${companyId}`, ...(field === "workspace_id" ? { archived_at: "is.null" } : {}) } });
    if (!rows[0]) throw new Error(`${field.replaceAll("_", " ")} must belong to the selected company.`);
  }));
}

async function authorize(companyId: string, permission: string) {
  if (!isUuid(companyId)) throw new Error("Company context must be a valid UUID.");
  await requireUser();
  await assertCompanyModuleEnabled(companyId, "calendar");
  await assertPermission(companyId, permission);
}

export async function GET(request: Request) {
  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  try {
    await authorize(companyId, "calendar.read");
    const rows = await userRest<Array<Record<string, unknown>>>("GET", "calendar_events", { query: { select: "*", company_id: `eq.${companyId}`, archived_at: "is.null", order: "starts_at.asc" } });
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Calendar is unavailable." }, { status: 403 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { companyId?: string; data?: unknown } | null;
  const parsed = calendarEventSchema.safeParse(body?.data);
  if (!parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
  const companyId = body?.companyId ?? "";
  try {
    const user = await requireUser();
    if (!isUuid(companyId)) throw new Error("Company context must be a valid UUID.");
    await assertCompanyModuleEnabled(companyId, "calendar");
    await assertPermission(companyId, "calendar.create");
    await validateReferences(companyId, parsed.data);
    const rows = await userRest<Array<Record<string, unknown>>>("POST", "calendar_events", { body: { ...parsed.data, company_id: companyId, created_by: user.id }, prefer: "return=representation" });
    const event = rows[0];
    await logAuditEvent({ actorId: user.id, companyId, action: "calendar_event.created", resourceType: "calendar_event", resourceId: typeof event?.id === "string" ? event.id : undefined, after: parsed.data });
    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Calendar event could not be created." }, { status: 403 });
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { companyId?: string; id?: string; data?: unknown } | null;
  const parsed = calendarEventSchema.safeParse(body?.data);
  if (!body?.id || !isUuid(body.id)) return NextResponse.json({ error: "Event ID must be a valid UUID." }, { status: 400 });
  if (!parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
  const companyId = body.companyId ?? "";
  try {
    const user = await requireUser();
    if (!isUuid(companyId)) throw new Error("Company context must be a valid UUID.");
    await assertCompanyModuleEnabled(companyId, "calendar");
    await assertPermission(companyId, "calendar.update");
    await validateReferences(companyId, parsed.data);
    const rows = await userRest<Array<Record<string, unknown>>>("PATCH", "calendar_events", { query: { id: `eq.${body.id}`, company_id: `eq.${companyId}` }, body: parsed.data, prefer: "return=representation" });
    if (!rows[0]) return NextResponse.json({ error: "Calendar event was not found." }, { status: 404 });
    await logAuditEvent({ actorId: user.id, companyId, action: "calendar_event.updated", resourceType: "calendar_event", resourceId: body.id, after: parsed.data });
    return NextResponse.json(rows[0]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Calendar event could not be updated." }, { status: 403 });
  }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null) as { companyId?: string; id?: string; confirmation?: string } | null;
  if (!body?.id || !isUuid(body.id)) return NextResponse.json({ error: "Event ID must be a valid UUID." }, { status: 400 });
  if (body.confirmation !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm permanent event deletion." }, { status: 400 });
  const companyId = body.companyId ?? "";
  try {
    const user = await requireUser();
    if (!isUuid(companyId)) throw new Error("Company context must be a valid UUID.");
    await assertCompanyModuleEnabled(companyId, "calendar");
    await assertPermission(companyId, "calendar.delete");
    const events = await userRest<Array<{ id: string }>>("GET", "calendar_events", { query: { select: "id", id: `eq.${body.id}`, company_id: `eq.${companyId}` } });
    if (!events[0]) return NextResponse.json({ error: "Calendar event was not found in the selected company." }, { status: 404 });
    await userRest<undefined>("DELETE", "calendar_events", { query: { id: `eq.${body.id}`, company_id: `eq.${companyId}` } });
    await logAuditEvent({ actorId: user.id, companyId, action: "calendar_event.deleted", resourceType: "calendar_event", resourceId: body.id, after: { permanent: true, participants: "removed by event foreign-key cascade" } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Calendar event could not be deleted." }, { status: 403 });
  }
}

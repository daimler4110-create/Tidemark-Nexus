import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { logAuditEvent } from "@/lib/audit/log";
import { userRest } from "@/lib/db/rest";
import { clientManagementSchema } from "@/lib/validation/va";
import { isUuid, zodInputError } from "@/lib/validation/uuid";

type Input = ReturnType<typeof clientManagementSchema.parse>;
type Client = Record<string, unknown> & { id: string };
type Contact = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; is_primary: boolean };
type Assignment = { id: string; provider_id: string | null; clinician_id: string | null };

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Client could not be saved.";
  const status = /must be|required|valid|cannot|Select|End date/i.test(message) ? 400 : 403;
  return NextResponse.json({ error: message }, { status });
}

function splitContactName(name: string) { const parts = name.trim().split(/\s+/); return { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") || "—" }; }
function clientColumns(input: Input) { const { primary_contact: _contact, provider_ids: _providers, clinician_ids: _clinicians, email: _email, phone: _phone, ...client } = input; return client; }

async function ensureClient(companyId: string, clientId: string) {
  const rows = await userRest<Client[]>("GET", "clients", { query: { select: "*", id: `eq.${clientId}`, company_id: `eq.${companyId}` } });
  return rows[0] ?? null;
}

async function validateReferences(companyId: string, input: Input) {
  const references = [["workspaces", input.workspace_id, "Workspace"], ["profiles", input.owner_id, "Owner"], ...input.provider_ids.map((id: string) => ["providers", id, "Assigned provider"] as const), ...input.clinician_ids.map((id: string) => ["clinicians", id, "Assigned clinician"] as const)] as const;
  await Promise.all(references.map(async ([table, id, label]) => {
    if (!id) return;
    const query: Record<string, string> = { select: "id", id: `eq.${id}` };
    if (table !== "profiles") query.company_id = `eq.${companyId}`;
    if (table === "workspaces" || table === "providers" || table === "clinicians") query.archived_at = "is.null";
    const rows = await userRest<Array<{ id: string }>>("GET", table, { query });
    if (!rows[0]) throw new Error(`${label} must be an active authorized record in the selected company.`);
  }));
}

async function syncRelations(companyId: string, clientId: string, userId: string, input: Input) {
  const primary = input.primary_contact;
  const active = await userRest<Contact[]>("GET", "client_contacts", { query: { select: "id,first_name,last_name,email,phone,is_primary", client_id: `eq.${clientId}`, company_id: `eq.${companyId}`, archived_at: "is.null", is_primary: "eq.true" } });
  if (primary.name) {
    const current = primary.id ? active.find((contact) => contact.id === primary.id) : active[0];
    const data = { client_id: clientId, company_id: companyId, ...splitContactName(primary.name), email: primary.email, phone: primary.phone, is_primary: true };
    if (current) await userRest("PATCH", "client_contacts", { query: { id: `eq.${current.id}`, company_id: `eq.${companyId}` }, body: data });
    else await userRest("POST", "client_contacts", { body: { ...data, created_by: userId } });
  } else {
    const current = primary.id ? active.find((contact) => contact.id === primary.id) : active[0];
    if (current) await userRest("PATCH", "client_contacts", { query: { id: `eq.${current.id}`, company_id: `eq.${companyId}` }, body: { archived_at: new Date().toISOString() } });
  }
  const existing = await userRest<Assignment[]>("GET", "client_assignments", { query: { select: "id,provider_id,clinician_id", client_id: `eq.${clientId}`, company_id: `eq.${companyId}`, archived_at: "is.null" } });
  const desired = new Set([...input.provider_ids.map((id: string) => `provider:${id}`), ...input.clinician_ids.map((id: string) => `clinician:${id}`)]);
  await Promise.all(existing.map(async (assignment) => {
    const key = assignment.provider_id ? `provider:${assignment.provider_id}` : assignment.clinician_id ? `clinician:${assignment.clinician_id}` : "";
    if (!desired.has(key)) await userRest("PATCH", "client_assignments", { query: { id: `eq.${assignment.id}`, company_id: `eq.${companyId}` }, body: { archived_at: new Date().toISOString() } });
    else desired.delete(key);
  }));
  await Promise.all([...desired].map((key) => { const [kind, id] = key.split(":"); return userRest("POST", "client_assignments", { body: { company_id: companyId, client_id: clientId, provider_id: kind === "provider" ? id : null, clinician_id: kind === "clinician" ? id : null, created_by: userId } }); }));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const body = await request.json().catch(() => null) as { companyId?: string; data?: unknown; archive?: boolean } | null;
  const companyId = body?.companyId ?? "";
  if (!isUuid(companyId) || !isUuid(clientId)) return NextResponse.json({ error: "Client and company contexts must be valid UUIDs." }, { status: 400 });
  try {
    const user = await requireUser();
    await assertCompanyModuleEnabled(companyId, "clients");
    const before = await ensureClient(companyId, clientId);
    if (!before) return NextResponse.json({ error: "Client was not found in the selected company." }, { status: 404 });
    if (body?.archive) {
      await assertPermission(companyId, "clients.archive");
      const rows = await userRest<Client[]>("PATCH", "clients", { query: { id: `eq.${clientId}`, company_id: `eq.${companyId}` }, body: { archived_at: new Date().toISOString() }, prefer: "return=representation" });
      await logAuditEvent({ actorId: user.id, companyId, action: "client.archived", resourceType: "client", resourceId: clientId, before, after: { archived: true } });
      return NextResponse.json(rows[0]);
    }
    const parsed = clientManagementSchema.safeParse(body?.data);
    if (!parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
    await assertPermission(companyId, "clients.update");
    await validateReferences(companyId, parsed.data);
    const rows = await userRest<Client[]>("PATCH", "clients", { query: { id: `eq.${clientId}`, company_id: `eq.${companyId}` }, body: clientColumns(parsed.data), prefer: "return=representation" });
    if (!rows[0]) return NextResponse.json({ error: "Client was not found in the selected company." }, { status: 404 });
    await syncRelations(companyId, clientId, user.id, parsed.data);
    await logAuditEvent({ actorId: user.id, companyId, action: "client.updated", resourceType: "client", resourceId: clientId, before, after: clientColumns(parsed.data) });
    return NextResponse.json(rows[0]);
  } catch (error) { return errorResponse(error); }
}

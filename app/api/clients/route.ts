import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { logAuditEvent } from "@/lib/audit/log";
import { userRest } from "@/lib/db/rest";
import { clientManagementSchema } from "@/lib/validation/va";
import { isUuid, zodInputError } from "@/lib/validation/uuid";

type ClientRow = Record<string, unknown> & { id: string };
type ContactRow = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; is_primary: boolean };
type AssignmentRow = { id: string; provider_id: string | null; clinician_id: string | null };
type Input = ReturnType<typeof clientManagementSchema.parse>;

function splitContactName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") || "—" };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Client could not be saved.";
  const status = /must be|required|valid|cannot|Select|End date/i.test(message) ? 400 : 403;
  return NextResponse.json({ error: message }, { status });
}

async function validateReferences(companyId: string, input: Input) {
  const references = [
    ["workspaces", input.workspace_id, "Workspace"],
    ["profiles", input.owner_id, "Owner"],
    ...input.provider_ids.map((id: string) => ["providers", id, "Assigned provider"] as const),
    ...input.clinician_ids.map((id: string) => ["clinicians", id, "Assigned clinician"] as const),
  ] as const;
  await Promise.all(references.map(async ([table, id, label]) => {
    if (!id) return;
    const query: Record<string, string> = { select: "id", id: `eq.${id}` };
    if (table !== "profiles") query.company_id = `eq.${companyId}`;
    if (table === "workspaces" || table === "providers" || table === "clinicians") query.archived_at = "is.null";
    const rows = await userRest<Array<{ id: string }>>("GET", table, { query });
    if (!rows[0]) throw new Error(`${label} must be an active authorized record in the selected company.`);
  }));
}

function clientColumns(input: Input) {
  const { primary_contact: _primaryContact, provider_ids: _providerIds, clinician_ids: _clinicianIds, email: _email, phone: _phone, ...client } = input;
  return client;
}

async function syncPrimaryContact(companyId: string, clientId: string, userId: string, input: Input) {
  const primary = input.primary_contact;
  const active = await userRest<ContactRow[]>("GET", "client_contacts", { query: { select: "id,first_name,last_name,email,phone,is_primary", client_id: `eq.${clientId}`, company_id: `eq.${companyId}`, archived_at: "is.null", is_primary: "eq.true" } });
  if (!primary.name) {
    const current = primary.id ? active.find((contact) => contact.id === primary.id) : active[0];
    if (current) await userRest("PATCH", "client_contacts", { query: { id: `eq.${current.id}`, company_id: `eq.${companyId}` }, body: { archived_at: new Date().toISOString() } });
    return;
  }
  const { first_name, last_name } = splitContactName(primary.name);
  const current = primary.id ? active.find((contact) => contact.id === primary.id) : active[0];
  const data = { client_id: clientId, company_id: companyId, first_name, last_name, email: primary.email, phone: primary.phone, is_primary: true };
  if (current) {
    await userRest("PATCH", "client_contacts", { query: { id: `eq.${current.id}`, company_id: `eq.${companyId}` }, body: data });
  } else {
    await userRest("POST", "client_contacts", { body: { ...data, created_by: userId } });
  }
}

async function syncAssignments(companyId: string, clientId: string, userId: string, input: Input) {
  const existing = await userRest<AssignmentRow[]>("GET", "client_assignments", { query: { select: "id,provider_id,clinician_id", client_id: `eq.${clientId}`, company_id: `eq.${companyId}`, archived_at: "is.null" } });
  const desired = new Set([...input.provider_ids.map((id: string) => `provider:${id}`), ...input.clinician_ids.map((id: string) => `clinician:${id}`)]);
  await Promise.all(existing.map(async (assignment) => {
    const key = assignment.provider_id ? `provider:${assignment.provider_id}` : assignment.clinician_id ? `clinician:${assignment.clinician_id}` : "";
    if (!desired.has(key)) await userRest("PATCH", "client_assignments", { query: { id: `eq.${assignment.id}`, company_id: `eq.${companyId}` }, body: { archived_at: new Date().toISOString() } });
    else desired.delete(key);
  }));
  await Promise.all([...desired].map((key) => {
    const [kind, id] = key.split(":");
    return userRest("POST", "client_assignments", { body: { company_id: companyId, client_id: clientId, provider_id: kind === "provider" ? id : null, clinician_id: kind === "clinician" ? id : null, created_by: userId } });
  }));
}

export async function GET(request: Request) {
  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  if (!isUuid(companyId)) return NextResponse.json({ error: "Company context must be a valid UUID." }, { status: 400 });
  try {
    await requireUser();
    await assertCompanyModuleEnabled(companyId, "clients");
    await assertPermission(companyId, "clients.read");
    const [clients, contacts, assignments, workspaces, owners, providers, clinicians] = await Promise.all([
      userRest<ClientRow[]>("GET", "clients", { query: { select: "id,name,legal_name,status,client_type,email,phone,address_line_1,address_line_2,city,state_region,postal_code,start_date,end_date,referral_source,owner_id,workspace_id,tags,notes,created_at", company_id: `eq.${companyId}`, archived_at: "is.null", order: "created_at.desc" } }),
      userRest<ContactRow[] & Array<{ client_id: string }>>("GET", "client_contacts", { query: { select: "id,client_id,first_name,last_name,email,phone,is_primary", company_id: `eq.${companyId}`, archived_at: "is.null", order: "created_at.asc" } }),
      userRest<Array<AssignmentRow & { client_id: string }>>("GET", "client_assignments", { query: { select: "id,client_id,provider_id,clinician_id", company_id: `eq.${companyId}`, archived_at: "is.null" } }),
      userRest<Array<{ id: string; name: string }>>("GET", "workspaces", { query: { select: "id,name", company_id: `eq.${companyId}`, archived_at: "is.null", order: "name.asc" } }),
      userRest<Array<{ id: string; display_name: string | null; email: string }>>("POST", "rpc/client_management_profiles", { body: { target_company: companyId } }),
      userRest<Array<{ id: string; display_name: string | null; first_name: string; last_name: string }>>("GET", "providers", { query: { select: "id,display_name,first_name,last_name", company_id: `eq.${companyId}`, archived_at: "is.null", order: "last_name.asc" } }).catch(() => []),
      userRest<Array<{ id: string; display_name: string | null; first_name: string; last_name: string }>>("GET", "clinicians", { query: { select: "id,display_name,first_name,last_name", company_id: `eq.${companyId}`, archived_at: "is.null", order: "last_name.asc" } }).catch(() => []),
    ]);
    return NextResponse.json({ clients, contacts, assignments, workspaces, owners, providers, clinicians });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { companyId?: string; data?: unknown } | null;
  const companyId = body?.companyId ?? "";
  if (!isUuid(companyId)) return NextResponse.json({ error: "Company context must be a valid UUID." }, { status: 400 });
  const parsed = clientManagementSchema.safeParse(body?.data);
  if (!parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
  try {
    const user = await requireUser();
    await assertCompanyModuleEnabled(companyId, "clients");
    await assertPermission(companyId, "clients.create");
    await validateReferences(companyId, parsed.data);
    if (parsed.data.provider_ids.length > 0 || parsed.data.clinician_ids.length > 0) await assertPermission(companyId, "clients.update");
    const rows = await userRest<ClientRow[]>("POST", "clients", { body: { ...clientColumns(parsed.data), company_id: companyId, created_by: user.id }, prefer: "return=representation" });
    const client = rows[0];
    if (!client) throw new Error("Client could not be created.");
    await syncPrimaryContact(companyId, client.id, user.id, parsed.data);
    await syncAssignments(companyId, client.id, user.id, parsed.data);
    await logAuditEvent({ actorId: user.id, companyId, action: "client.created", resourceType: "client", resourceId: client.id, after: { ...clientColumns(parsed.data), primaryContact: Boolean(parsed.data.primary_contact.name), assignedProviders: parsed.data.provider_ids.length, assignedClinicians: parsed.data.clinician_ids.length } });
    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

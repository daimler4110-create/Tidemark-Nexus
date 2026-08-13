import { NextResponse } from "next/server";
import { requireUser, assertPermission } from "@/lib/authz/guard";
import { createClient } from "@/lib/supabase/server";
import { userRest } from "@/lib/db/rest";
import { logAuditEvent } from "@/lib/audit/log";
import { activitySchema, billableRecordSchema, clientContactSchema, clientSchema, credentialSchema, invoiceLineSchema, invoiceSchema, payPeriodSchema, paymentSchema, payrollItemSchema, payrollRecordSchema, personSchema } from "@/lib/validation/va";
import { isUuid, zodInputError } from "@/lib/validation/uuid";
import { humanName } from "@/lib/va/display";

const definitions = {
  providers: { table: "providers", read: "providers.read", create: "providers.create", update: "providers.update", archive: "providers.archive", activeOnly: true, schema: personSchema, map: (data: Record<string, unknown>) => ({ ...data, provider_type: data.type_or_role, type_or_role: undefined }) },
  clinicians: { table: "clinicians", read: "clinicians.read", create: "clinicians.create", update: "clinicians.update", archive: "clinicians.archive", activeOnly: true, schema: personSchema, map: (data: Record<string, unknown>) => ({ ...data, role: data.type_or_role, type_or_role: undefined }) },
  clients: { table: "clients", read: "clients.read", create: "clients.create", update: "clients.update", archive: "clients.archive", activeOnly: true, schema: clientSchema, map: (data: Record<string, unknown>) => data },
  credentials: { table: "credentials", read: "credentials.read", create: "credentials.create", update: "credentials.update", archive: "credentials.archive", activeOnly: true, schema: credentialSchema, map: (data: Record<string, unknown>) => data },
  billing: { table: "billable_records", read: "billing.read", create: "billing.create", update: "billing.update", activeOnly: true, schema: billableRecordSchema, map: (data: Record<string, unknown>) => data },
  invoices: { table: "invoices", read: "invoices.read", create: "invoices.create", update: "invoices.update", activeOnly: true, schema: invoiceSchema, map: (data: Record<string, unknown>) => data },
  "invoice-lines": { table: "invoice_lines", read: "invoices.read", create: "invoices.create", update: "invoices.update", schema: invoiceLineSchema, map: (data: Record<string, unknown>) => data },
  payments: { table: "payments", read: "payments.read", create: "payments.create", update: "payments.update", activeOnly: true, schema: paymentSchema, map: (data: Record<string, unknown>) => data },
  payroll: { table: "pay_periods", read: "payroll.read", create: "payroll.create", update: "payroll.update", activeOnly: true, schema: payPeriodSchema, map: (data: Record<string, unknown>) => data },
  "payroll-records": { table: "payroll_records", read: "payroll.read", create: "payroll.create", update: "payroll.update", activeOnly: true, schema: payrollRecordSchema, map: (data: Record<string, unknown>) => data },
  "payroll-items": { table: "payroll_items", read: "payroll.read", create: "payroll.create", update: "payroll.update", schema: payrollItemSchema, map: (data: Record<string, unknown>) => data },
  contacts: { table: "client_contacts", read: "clients.read", create: "clients.create", update: "clients.update", activeOnly: true, schema: clientContactSchema, map: (data: Record<string, unknown>) => data },
  activities: { table: "activities", read: "activities.read", create: "activities.create", update: "activities.update", activeOnly: true, schema: activitySchema, map: (data: Record<string, unknown>) => data },
} as const;

type Resource = keyof typeof definitions;
type ResourceDefinition = { table: string; read: string; create: string; update: string; archive?: string; activeOnly?: boolean; schema: { parse: (input: unknown) => unknown; safeParse: (input: unknown) => { success: true; data: unknown } | { success: false; error: import("zod").ZodError } }; map: (data: Record<string, unknown>) => Record<string, unknown> };
const isResource = (value: string): value is Resource => value in definitions;

async function resolveVaCompany(companyId: string) {
  if (!isUuid(companyId)) throw new Error("Company context must be a valid UUID from the authorized route.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("companies").select("id,slug").eq("id", companyId).maybeSingle();
  if (error || data?.slug !== "tidemark-va") throw new Error("An authorized Tidemark VA company context is required.");
  return data.id;
}

const relatedTables: Record<string, { table: string; label: string }> = {
  workspace_id: { table: "workspaces", label: "Workspace" },
  client_id: { table: "clients", label: "Client" },
  provider_id: { table: "providers", label: "Provider" },
  clinician_id: { table: "clinicians", label: "Clinician" },
  invoice_id: { table: "invoices", label: "Invoice" },
  billable_record_id: { table: "billable_records", label: "Billable record" },
  pay_period_id: { table: "pay_periods", label: "Pay period" },
  payroll_record_id: { table: "payroll_records", label: "Payroll record" },
};
const activitySubjects: Record<string, { table: string; label: string }> = {
  client: { table: "clients", label: "Client" },
  contact: { table: "client_contacts", label: "Contact" },
  provider: { table: "providers", label: "Provider" },
  clinician: { table: "clinicians", label: "Clinician" },
  credential: { table: "credentials", label: "Credential" },
  invoice: { table: "invoices", label: "Invoice" },
  billable_record: { table: "billable_records", label: "Billable record" },
  payroll_record: { table: "payroll_records", label: "Payroll record" },
};
const deletable: Partial<Record<Resource, { permission: string; label: string }>> = {
  clients: { permission: "clients.delete", label: "Client" },
  providers: { permission: "providers.delete", label: "Provider" },
  clinicians: { permission: "clinicians.delete", label: "Clinicians" },
  credentials: { permission: "credentials.delete", label: "Credential" },
};

async function validateTenantReferences(companyId: string, data: Record<string, unknown>) {
  await Promise.all(Object.entries(relatedTables).map(async ([field, relation]) => {
    const value = data[field];
    if (value == null) return;
    if (!isUuid(value)) throw new Error(`${relation.label} must be a valid UUID from an authorized record.`);
    const rows = await userRest<Array<{ id: string }>>("GET", relation.table, { query: { select: "id", id: `eq.${value}`, company_id: `eq.${companyId}`, ...(field === "workspace_id" ? { archived_at: "is.null" } : {}) } });
    if (!rows[0]) throw new Error(`${relation.label} must belong to the selected Tidemark VA company.`);
  }));
  if (data.subject_id != null) {
    const subject = activitySubjects[String(data.subject_type)];
    if (!subject) throw new Error("Activity subject type must identify an authorized operational record.");
    const rows = await userRest<Array<{ id: string }>>("GET", subject.table, { query: { select: "id", id: `eq.${data.subject_id}`, company_id: `eq.${companyId}` } });
    if (!rows[0]) throw new Error(`Activity ${subject.label.toLowerCase()} must belong to the selected Tidemark VA company.`);
  }
  if (data.assigned_to != null) {
    const rows = await userRest<Array<{ id: string }>>("GET", "profiles", { query: { select: "id", id: `eq.${data.assigned_to}` } });
    if (!rows[0]) throw new Error("Assignee must be an authorized profile UUID.");
  }
}

function errorResponse(error: unknown, fallback = "Request could not be completed.") {
  const message = error instanceof Error ? error.message : fallback;
  const status = /must be|is required|invalid|Select exactly|End date|cannot exceed|not found/i.test(message) ? 400 : 403;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  if (!isResource(resource)) return NextResponse.json({ error: "Unknown resource" }, { status: 404 });
  try {
    await requireUser(); const resolvedCompanyId = await resolveVaCompany(companyId); await assertPermission(resolvedCompanyId, definitions[resource].read);
    const id = new URL(request.url).searchParams.get("id");
    const filters: Record<string, string> = { select: "*", company_id: `eq.${resolvedCompanyId}`, order: "created_at.desc" };
    if (id) filters.id = `eq.${id}`;
    if ((definitions[resource] as ResourceDefinition).activeOnly) filters.archived_at = "is.null";
    const rows = await userRest<Array<Record<string, unknown>>>("GET", definitions[resource].table, { query: filters });
    if (resource === "credentials") {
      const providerIds = rows.map((row) => row.provider_id).filter(isUuid);
      const clinicianIds = rows.map((row) => row.clinician_id).filter(isUuid);
      const [providers, clinicians] = await Promise.all([
        providerIds.length ? userRest<Array<Record<string, unknown>>>("GET", "providers", { query: { select: "id,display_name,first_name,middle_name,last_name", id: `in.(${providerIds.join(",")})`, company_id: `eq.${resolvedCompanyId}` } }).catch(() => []) : Promise.resolve([]),
        clinicianIds.length ? userRest<Array<Record<string, unknown>>>("GET", "clinicians", { query: { select: "id,display_name,first_name,middle_name,last_name", id: `in.(${clinicianIds.join(",")})`, company_id: `eq.${resolvedCompanyId}` } }).catch(() => []) : Promise.resolve([]),
      ]);
      const holders = new Map([...providers, ...clinicians].filter((row): row is Record<string, unknown> & { id: string } => typeof row.id === "string").map((row) => [row.id, humanName(row)]));
      return NextResponse.json(rows.map((row) => ({ ...row, holder_display_name: holders.get(String(row.provider_id ?? row.clinician_id ?? "")) ?? null })));
    }
    return NextResponse.json(rows);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const body = await request.json().catch(() => null) as { companyId?: string; data?: unknown } | null;
  if (!isResource(resource)) return NextResponse.json({ error: "Unknown resource" }, { status: 404 });
  const companyContext = body?.companyId ?? "";
  const parsed = definitions[resource].schema.safeParse(body?.data);
  if (!parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
  try {
    const user = await requireUser(); const companyId = await resolveVaCompany(companyContext); await assertPermission(companyId, definitions[resource].create);
    const mapped = definitions[resource].map(parsed.data as Record<string, unknown>);
    await validateTenantReferences(companyId, mapped);
    const row = await userRest<Record<string, unknown>[]>("POST", definitions[resource].table, { body: { ...mapped, company_id: companyId, created_by: user.id }, prefer: "return=representation" });
    const created = row[0];
    await logAuditEvent({ actorId: user.id, companyId, action: `${resource}.created`, resourceType: resource, resourceId: typeof created?.id === "string" ? created.id : undefined, after: mapped });
    return NextResponse.json(created, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const body = await request.json().catch(() => null) as { companyId?: string; id?: string; data?: unknown; archive?: boolean } | null;
  if (!isResource(resource) || !body?.id) return NextResponse.json({ error: "Record ID is required." }, { status: 400 });
  if (!isUuid(body.id)) return NextResponse.json({ error: "Record ID must be a valid UUID from an authorized record." }, { status: 400 });
  const companyContext = body.companyId ?? "";
  try {
    const user = await requireUser(); const companyId = await resolveVaCompany(companyContext);
    const definition = definitions[resource] as unknown as ResourceDefinition;
    const permission = body.archive ? definition.archive : definition.update;
    if (!permission) return NextResponse.json({ error: "This record cannot be changed here" }, { status: 400 });
    await assertPermission(companyId, permission);
    let data: Record<string, unknown>;
    if (body.archive) data = { archived_at: new Date().toISOString() };
    else {
      const parsed = definition.schema.safeParse(body.data);
      if (!parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
      data = definition.map(parsed.data as Record<string, unknown>);
      await validateTenantReferences(companyId, data);
    }
    const rows = await userRest<Record<string, unknown>[]>("PATCH", definition.table, { query: { id: `eq.${body.id}`, company_id: `eq.${companyId}` }, body: data, prefer: "return=representation" });
    if (!rows[0]) return NextResponse.json({ error: "Record not found" }, { status: 404 });
    await logAuditEvent({ actorId: user.id, companyId, action: body.archive ? `${resource}.archived` : `${resource}.updated`, resourceType: resource, resourceId: body.id, after: data });
    return NextResponse.json(rows[0]);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const body = await request.json().catch(() => null) as { companyId?: string; id?: string; confirmation?: string } | null;
  const deletion = isResource(resource) ? deletable[resource] : undefined;
  if (!deletion) return NextResponse.json({ error: "Permanent deletion is not available for this resource. Use its approved lifecycle action instead." }, { status: 405 });
  if (!isResource(resource)) return NextResponse.json({ error: "Unknown resource." }, { status: 404 });
  if (!body?.id || !isUuid(body.id)) return NextResponse.json({ error: "Record ID must be a valid UUID from an authorized record." }, { status: 400 });
  if (body.confirmation !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm permanent deletion." }, { status: 400 });
  try {
    const user = await requireUser();
    const companyId = await resolveVaCompany(body.companyId ?? "");
    await assertPermission(companyId, deletion.permission);
    const definition = definitions[resource] as ResourceDefinition;
    const target = await userRest<Array<{ id: string }>>("GET", definition.table, { query: { select: "id", id: `eq.${body.id}`, company_id: `eq.${companyId}` } });
    if (!target[0]) return NextResponse.json({ error: `${deletion.label} was not found in the selected company.` }, { status: 404 });
    const supabase = await createClient();
    const { data: dependencies, error: dependencyError } = await supabase.rpc("va_delete_dependencies", { target_table: definition.table, target_id: body.id, target_company: companyId });
    if (dependencyError) throw new Error(`Could not inspect deletion dependencies: ${dependencyError.message}`);
    const protectedDependencies = (dependencies ?? []) as Array<{ dependency: string; record_count: number }>;
    if (protectedDependencies.length > 0) {
      const summary = protectedDependencies.map((entry) => `${entry.record_count} ${entry.dependency}`).join(", ");
      return NextResponse.json({ error: `Permanent deletion is blocked because this record has protected dependencies: ${summary}. Archive it instead.`, dependencies: protectedDependencies }, { status: 409 });
    }
    await userRest<undefined>("DELETE", definition.table, { query: { id: `eq.${body.id}`, company_id: `eq.${companyId}` } });
    await logAuditEvent({ actorId: user.id, companyId, action: `${resource}.deleted`, resourceType: resource, resourceId: body.id, after: { permanent: true } });
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}

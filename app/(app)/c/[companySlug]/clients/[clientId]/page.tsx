import { notFound } from "next/navigation";
import { Client360, type Client360Data } from "@/components/clients/client-360";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { assertPermission } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { userRest } from "@/lib/db/rest";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/uuid";

type Row = Record<string, unknown>;
const rows = (table: string, companyId: string, filter: Record<string, string>, select = "*") => userRest<Row[]>("GET", table, { query: { select, company_id: `eq.${companyId}`, archived_at: "is.null", ...filter } });

export default async function ClientDetail({ params }: { params: Promise<{ companySlug: string; clientId: string }> }) {
  const { companySlug, clientId } = await params;
  if (companySlug !== "tidemark-va" || !isUuid(clientId)) notFound();
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).maybeSingle();
  if (!company) notFound();
  await assertCompanyModuleEnabled(company.id, "clients");
  await assertPermission(company.id, "clients.read");
  const permissions = await getGrantedPermissionKeys(company.id);
  const [clients, contacts, assignments, activities, calendarEvents, documents, billableRecords, invoices, payments, arRows, owners] = await Promise.all([
    rows("clients", company.id, { id: `eq.${clientId}` }),
    rows("client_contacts", company.id, { client_id: `eq.${clientId}` }),
    rows("client_assignments", company.id, { client_id: `eq.${clientId}` }),
    permissions.includes("activities.read") ? rows("activities", company.id, { subject_type: "eq.client", subject_id: `eq.${clientId}`, order: "created_at.desc" }) : Promise.resolve(null),
    permissions.includes("calendar.read") ? rows("calendar_events", company.id, { client_id: `eq.${clientId}`, order: "starts_at.desc" }) : Promise.resolve(null),
    permissions.includes("documents.read") ? rows("documents", company.id, { client_id: `eq.${clientId}`, order: "created_at.desc" }, "id,file_name,created_at") : Promise.resolve(null),
    permissions.includes("billing.read") ? rows("billable_records", company.id, { client_id: `eq.${clientId}` }) : Promise.resolve(null),
    permissions.includes("invoices.read") ? rows("invoices", company.id, { client_id: `eq.${clientId}` }, "id,invoice_number,status,total,created_at") : Promise.resolve(null),
    permissions.includes("payments.read") ? rows("payments", company.id, { client_id: `eq.${clientId}` }) : Promise.resolve(null),
    permissions.includes("ar.read") ? userRest<Array<{ balance_due: number | null }>>("GET", "ar_aging", { query: { select: "balance_due", company_id: `eq.${company.id}`, client_id: `eq.${clientId}` } }).catch(() => null) : Promise.resolve(null),
    userRest<Array<{ id: string; display_name: string | null; email: string }>>("POST", "rpc/client_management_profiles", { body: { target_company: company.id } }).catch(() => []),
  ]);
  const client = clients[0];
  if (!client) notFound();
  const assignmentIds = assignments.map((assignment) => ({ providerId: typeof assignment.provider_id === "string" ? assignment.provider_id : null, clinicianId: typeof assignment.clinician_id === "string" ? assignment.clinician_id : null }));
  const providerIds = assignmentIds.flatMap((assignment) => assignment.providerId ? [assignment.providerId] : []);
  const clinicianIds = assignmentIds.flatMap((assignment) => assignment.clinicianId ? [assignment.clinicianId] : []);
  const [providers, clinicians] = await Promise.all([
    providerIds.length ? userRest<Row[]>("GET", "providers", { query: { select: "id,display_name,first_name,last_name", company_id: `eq.${company.id}`, id: `in.(${providerIds.join(",")})` } }) : Promise.resolve([]),
    clinicianIds.length ? userRest<Row[]>("GET", "clinicians", { query: { select: "id,display_name,first_name,last_name", company_id: `eq.${company.id}`, id: `in.(${clinicianIds.join(",")})` } }) : Promise.resolve([]),
  ]);
  const ownerId = typeof client.owner_id === "string" ? client.owner_id : null;
  const owner = owners.find((profile) => profile.id === ownerId);
  const data: Client360Data = { client, contacts, assignments, providers, clinicians, activities, calendarEvents, documents, billableRecords, invoices, payments, arBalance: arRows?.reduce((total, row) => total + Number(row.balance_due ?? 0), 0) ?? null, ownerName: owner?.display_name || owner?.email || null };
  return <Client360 companyId={company.id} companySlug={companySlug} data={data}/>;
}

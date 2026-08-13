import { notFound } from "next/navigation";
import { CrmOverview, type CrmActivity, type CrmClient, type CrmContact } from "@/components/crm/crm-overview";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { assertPermission } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { userRest } from "@/lib/db/rest";
import { createClient } from "@/lib/supabase/server";

export default async function CrmPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).maybeSingle();
  if (!company) notFound();
  await assertCompanyModuleEnabled(company.id, "crm");
  await assertPermission(company.id, "clients.read");
  const permissions = await getGrantedPermissionKeys(company.id);
  const [clients, contacts, activities] = await Promise.all([
    userRest<CrmClient[]>("GET", "clients", { query: { select: "id,name,status,email,phone,workspace_id", company_id: `eq.${company.id}`, archived_at: "is.null", order: "name.asc" } }),
    userRest<CrmContact[]>("GET", "client_contacts", { query: { select: "id,client_id,first_name,last_name,title,email,phone,is_primary", company_id: `eq.${company.id}`, archived_at: "is.null", order: "last_name.asc" } }),
    permissions.includes("activities.read") ? userRest<CrmActivity[]>("GET", "activities", { query: { select: "id,subject_id,subject_type,activity_type,title,due_at,completed_at,created_at", company_id: `eq.${company.id}`, archived_at: "is.null", order: "created_at.desc", limit: "50" } }).catch(() => []) : Promise.resolve([]),
  ]);
  return <CrmOverview companySlug={companySlug} clients={clients} contacts={contacts} activities={activities} activitiesAvailable={permissions.includes("activities.read")} />;
}

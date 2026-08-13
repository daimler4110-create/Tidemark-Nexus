import { notFound } from "next/navigation";
import { CalendarManager } from "@/components/calendar/calendar-manager";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { assertPermission } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { createClient } from "@/lib/supabase/server";

export default async function CalendarPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).maybeSingle();
  if (!company) notFound();
  await assertCompanyModuleEnabled(company.id, "calendar");
  await assertPermission(company.id, "calendar.read");
  const permissions = await getGrantedPermissionKeys(company.id);
  return <CalendarManager companyId={company.id} canCreate={permissions.includes("calendar.create")} canUpdate={permissions.includes("calendar.update")} canDelete={permissions.includes("calendar.delete")} />;
}

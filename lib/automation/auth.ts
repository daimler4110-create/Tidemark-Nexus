import "server-only";
import { createClient } from "@/lib/supabase/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { isUuid } from "@/lib/validation/uuid";

export async function requireAutomationContext(companyId: string, moduleKey: "automation" | "ai" | "notifications", permission: string) {
  if (!isUuid(companyId)) throw new Error("Company context must be a valid UUID.");
  const supabase = await createClient(); const { data: company, error } = await supabase.from("companies").select("id,slug").eq("id", companyId).maybeSingle();
  if (error || company?.slug !== "tidemark-va") throw new Error("An authorized Tidemark VA company context is required.");
  const user = await requireUser(); await assertCompanyModuleEnabled(companyId, moduleKey); await assertPermission(companyId, permission);
  return { user, companyId };
}

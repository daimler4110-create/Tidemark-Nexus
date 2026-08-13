import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Enforces the existing company_modules navigation boundary for direct routes and APIs. */
export async function assertCompanyModuleEnabled(companyId: string, moduleKey: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_modules")
    .select("module_key")
    .eq("company_id", companyId)
    .eq("module_key", moduleKey)
    .eq("enabled", true)
    .maybeSingle();
  if (error || !data) throw new Error("This module is not enabled for the selected company.");
}

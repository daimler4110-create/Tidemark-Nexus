import { createClient } from "@/lib/supabase/server";
import type { Company, Workspace } from "@/lib/db/models";

export async function getAuthorizedCompanies(): Promise<Company[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("companies").select("id,slug,name").order("name");
  if (error) throw new Error(`Could not load company context: ${error.message}`);
  return data as Company[];
}

export async function getAuthorizedWorkspaces(companyId: string): Promise<Workspace[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("workspaces").select("id,company_id,name,slug,archived_at").eq("company_id", companyId).is("archived_at", null).order("name");
  if (error) throw new Error(`Could not load workspace context: ${error.message}`);
  return data as Workspace[];
}

export async function getGrantedPermissionKeys(companyId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_user_permission_keys", { target_company: companyId });
  if (error) throw new Error(`Could not resolve permissions: ${error.message}`);
  return data ?? [];
}

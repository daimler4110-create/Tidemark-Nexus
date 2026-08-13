import { createClient } from "@/lib/supabase/server";

export async function assertWorkspaceAccess(workspaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_workspace_access", { target_workspace: workspaceId });
  if (error || !data) throw new Error("Forbidden");
}

export async function assertWorkspacePermission(workspaceId: string, permission: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_workspace_permission", { target_workspace: workspaceId, permission_key: permission });
  if (error || !data) throw new Error("Forbidden");
}

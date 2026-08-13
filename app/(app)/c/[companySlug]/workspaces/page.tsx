import { notFound } from "next/navigation";
import { WorkspaceManager } from "@/components/workspaces/workspace-manager";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { requireUser } from "@/lib/authz/guard";
import { createClient } from "@/lib/supabase/server";
import { createWorkspace } from "./actions";

export default async function Workspaces({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("id,name").eq("slug", companySlug).maybeSingle();
  if (!company) notFound();
  await requireUser();
  const [permissions, { data: workspaces, error }] = await Promise.all([
    getGrantedPermissionKeys(company.id),
    supabase.from("workspaces").select("id,name,slug,archived_at").eq("company_id", company.id).order("name"),
  ]);
  const canManage = permissions.includes("workspace.manage");
  const canDelete = permissions.includes("workspace.delete");
  if (!canManage && !canDelete) notFound();
  if (error) throw new Error(`Could not load workspace management: ${error.message}`);

  return <main className="shell"><h1>Workspaces</h1><div className="grid">{canManage && <section className="card"><h2>Create workspace</h2><form action={createWorkspace.bind(null, company.id, companySlug)}><label className="field">Name<input name="name" required minLength={2}/></label><label className="field">URL slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*"/></label><button className="btn">Create workspace</button></form></section>}<WorkspaceManager companyId={company.id} companySlug={companySlug} workspaces={workspaces ?? []} canManage={canManage} canDelete={canDelete}/></div></main>;
}

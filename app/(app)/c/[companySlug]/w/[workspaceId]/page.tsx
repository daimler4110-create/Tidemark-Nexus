import { notFound } from "next/navigation";
import { assertWorkspaceAccess } from "@/lib/authz/membership";
import { createClient } from "@/lib/supabase/server";

export default async function WorkspaceHome({ params }: { params: Promise<{ companySlug: string; workspaceId: string }> }) {
  const { companySlug, workspaceId } = await params;
  await assertWorkspaceAccess(workspaceId);
  const supabase = await createClient();
  const { data: workspace } = await supabase.from("workspaces").select("id,name,company_id,companies!inner(slug)").eq("id", workspaceId).eq("companies.slug", companySlug).maybeSingle();
  if (!workspace) notFound();
  return <main className="shell"><h1>{workspace.name}</h1><p className="muted">This authorized workspace is ready for Phase 2 boards and operational records.</p></main>;
}

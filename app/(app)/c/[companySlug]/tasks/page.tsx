import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { TaskManager } from "@/components/tasks/task-manager";

export default async function TasksPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ status?: string; priority?: string; view?: string }> }) {
  const { companySlug } = await params; const { status = "", priority = "", view = "" } = await searchParams;
  if (companySlug !== "tidemark-va") notFound();
  const supabase = await createClient(); const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).maybeSingle();
  if (!company || !(await getGrantedPermissionKeys(company.id)).includes("tasks.read")) notFound();
  return <TaskManager companyId={company.id} initialStatus={status} initialPriority={priority} initialView={view}/>;
}

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { getAnalyticsDashboard, readDashboardFilters } from "@/lib/analytics/dashboard";
import { AnalyticsDashboard, DashboardFilters } from "@/components/dashboard/analytics-dashboard";

export default async function Dashboard({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { companySlug } = await params; const supabase = await createClient(); const { data: company } = await supabase.from("companies").select("id,name").eq("slug", companySlug).maybeSingle();
  if (!company) notFound();
  if (companySlug !== "tidemark-va") return <main className="shell"><h1>{company.name} dashboard</h1><p className="muted">Company foundation is active. Tidemark VA operational analytics are intentionally not enabled here.</p></main>;
  const permissions = await getGrantedPermissionKeys(company.id); const data = await getAnalyticsDashboard(company.id, permissions, readDashboardFilters(await searchParams));
  return <main className="shell dashboard-shell"><div className="dashboard-header"><div><p className="dashboard-eyebrow">Tidemark Nexus · Operations</p><h1>Tidemark VA</h1><p className="muted">Authorized operational analytics for {data.filters.from} through {data.filters.to}. Values refresh from live records.</p></div></div><DashboardFilters data={data}/><AnalyticsDashboard data={data}/></main>;
}

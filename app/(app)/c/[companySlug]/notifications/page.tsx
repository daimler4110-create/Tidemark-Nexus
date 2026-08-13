import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { NotificationCenter } from "@/components/automation/notification-center";
export default async function NotificationsPage({ params }: { params: Promise<{ companySlug: string }> }) { const { companySlug } = await params; if (companySlug !== "tidemark-va") notFound(); const supabase = await createClient(); const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).maybeSingle(); if (!company || !(await getGrantedPermissionKeys(company.id)).includes("notifications.read")) notFound(); return <NotificationCenter companyId={company.id}/>; }

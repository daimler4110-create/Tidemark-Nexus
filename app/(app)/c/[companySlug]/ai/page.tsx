import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { AiAssistant } from "@/components/automation/ai-assistant";
export default async function AiPage({ params }: { params: Promise<{ companySlug: string }> }) { const { companySlug } = await params; if (companySlug !== "tidemark-va") notFound(); const supabase = await createClient(); const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).maybeSingle(); if (!company) notFound(); const permissions = await getGrantedPermissionKeys(company.id); if (!permissions.includes("ai.read")) notFound(); return <AiAssistant companyId={company.id} canRequest={permissions.includes("ai.request")} canReview={permissions.includes("ai.review")}/>; }

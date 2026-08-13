import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

type AuditEvent = { actorId?: string; companyId: string; action: string; resourceType: string; resourceId?: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null };
export async function logAuditEvent(event: AuditEvent) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("audit_logs").insert({ actor_id: event.actorId ?? null, company_id: event.companyId, action: event.action, resource_type: event.resourceType, resource_id: event.resourceId ?? null, before_data: event.before ?? null, after_data: event.after ?? null });
  if (error) throw new Error(`Audit logging failed: ${error.message}`);
}

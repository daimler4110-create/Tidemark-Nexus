import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { logAuditEvent } from "@/lib/audit/log";
import { userRest } from "@/lib/db/rest";
import { canTransitionPayroll, type PayrollStatus } from "@/lib/finance/payroll";

const permissionFor: Record<Exclude<PayrollStatus,"draft">, string> = { review: "payroll.review", approved: "payroll.approve", finalized: "payroll.finalize", paid: "payroll.mark_paid" };
export async function POST(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params; const payload = await request.json().catch(() => null) as { companyId?: string; nextStatus?: PayrollStatus } | null;
  if (!payload?.companyId || !payload.nextStatus || payload.nextStatus === "draft") return NextResponse.json({ error: "Invalid payroll transition" }, { status: 400 });
  try {
    const user = await requireUser(); await assertPermission(payload.companyId, permissionFor[payload.nextStatus]);
    const existing = await userRest<Array<{ id: string; status: PayrollStatus }>>("GET", "payroll_records", { query: { select: "id,status", id: `eq.${recordId}`, company_id: `eq.${payload.companyId}` } });
    if (!existing[0] || !canTransitionPayroll(existing[0].status, payload.nextStatus)) return NextResponse.json({ error: "Payroll status transition is not allowed" }, { status: 400 });
    const now = new Date().toISOString(); const metadata = payload.nextStatus === "review" ? { reviewed_at: now, reviewed_by: user.id } : payload.nextStatus === "approved" ? { approved_at: now, approved_by: user.id } : payload.nextStatus === "finalized" ? { finalized_at: now, finalized_by: user.id } : { paid_at: now, paid_by: user.id };
    const rows = await userRest<Record<string, unknown>[]>("PATCH", "payroll_records", { query: { id: `eq.${recordId}`, company_id: `eq.${payload.companyId}` }, body: { status: payload.nextStatus, ...metadata }, prefer: "return=representation" });
    await logAuditEvent({ actorId: user.id, companyId: payload.companyId, action: `payroll.${payload.nextStatus}`, resourceType: "payroll_record", resourceId: recordId, after: metadata });
    return NextResponse.json(rows[0]);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Forbidden" }, { status: 403 }); }
}

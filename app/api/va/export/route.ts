import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { logAuditEvent } from "@/lib/audit/log";
import { userRest } from "@/lib/db/rest";

const exports = { providers: ["providers", "providers.read"], clinicians: ["clinicians", "clinicians.read"], clients: ["clients", "clients.read"], credentials: ["credentials", "credentials.read"], invoices: ["invoice_financials", "invoices.read"], payments: ["payments", "payments.read"], ar: ["ar_aging", "ar.read"], payroll: ["pay_periods", "payroll.read"], tasks: ["tasks", "tasks.read"], workload: ["client_assignments", "clients.read"], automation_runs: ["automation_runs", "automation.read"], automation_actions: ["automation_action_runs", "automation.read"], ai_requests: ["ai_requests", "ai.read"], communications: ["communications", "communications.read"] } as const;
const csvEscape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export async function GET(request: Request) {
  const url = new URL(request.url); const companyId = url.searchParams.get("companyId") ?? ""; const resource = url.searchParams.get("resource") as keyof typeof exports;
  if (!(resource in exports)) return NextResponse.json({ error: "Unsupported export" }, { status: 400 });
  try {
    const user = await requireUser(); await assertPermission(companyId, "reports.export"); await assertPermission(companyId, exports[resource][1]);
    const rows = await userRest<Record<string, unknown>[]>("GET", exports[resource][0], { query: { select: "*", company_id: `eq.${companyId}`, order: "created_at.desc" } });
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]; const csv = [keys.join(","), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(","))].join("\n");
    await logAuditEvent({ actorId: user.id, companyId, action: "report.exported", resourceType: resource, after: { format: "csv", rowCount: rows.length } });
    return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${resource}-report.csv"` } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Forbidden" }, { status: 403 }); }
}

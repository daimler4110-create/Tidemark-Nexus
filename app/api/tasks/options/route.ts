import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { userRest } from "@/lib/db/rest";
import { isUuid } from "@/lib/validation/uuid";

type Option = { id: string; label: string };
const sources = {
  workspaces: ["workspaces", "id,name", (row: Record<string, unknown>) => String(row.name)],
  clients: ["clients", "id,name", (row: Record<string, unknown>) => String(row.name)],
  providers: ["providers", "id,display_name,first_name,last_name", (row: Record<string, unknown>) => String(row.display_name || `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim())],
  clinicians: ["clinicians", "id,display_name,first_name,last_name", (row: Record<string, unknown>) => String(row.display_name || `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim())],
  credentials: ["credentials", "id,credential_type,credential_number", (row: Record<string, unknown>) => `${String(row.credential_type)}${row.credential_number ? ` (${String(row.credential_number)})` : ""}`],
  invoices: ["invoices", "id,invoice_number", (row: Record<string, unknown>) => String(row.invoice_number)],
} as const;

export async function GET(request: Request) {
  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  if (!isUuid(companyId)) return NextResponse.json({ error: "Company context must be a valid UUID." }, { status: 400 });
  try {
    await requireUser(); await assertCompanyModuleEnabled(companyId, "tasks"); await assertPermission(companyId, "tasks.read");
    const pairs = await Promise.all(Object.entries(sources).map(async ([key, [table, select, label]]) => {
      const rows = await userRest<Array<Record<string, unknown>>>("GET", table, { query: { select, company_id: `eq.${companyId}`, archived_at: "is.null", order: "created_at.desc" } }).catch(() => []);
      return [key, rows.filter((row): row is Record<string, unknown> & { id: string } => typeof row.id === "string").map((row) => ({ id: row.id, label: label(row) }))] as const;
    }));
    const assignees = await userRest<Array<{ id: string; display_name: string | null; email: string | null }>>("POST", "rpc/task_assignment_options", { body: { target_company: companyId, target_workspace: null } });
    return NextResponse.json({ ...Object.fromEntries(pairs), assignees: assignees.map((user) => ({ id: user.id, label: user.display_name || user.email || user.id })) satisfies Option[] });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Task options could not be loaded." }, { status: 403 }); }
}

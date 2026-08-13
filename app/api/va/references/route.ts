import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { userRest } from "@/lib/db/rest";
import { isUuid } from "@/lib/validation/uuid";

const resourcePermissions: Record<string, string> = {
  providers: "providers.create", clinicians: "clinicians.create", clients: "clients.create", credentials: "credentials.create", billing: "billing.create", invoices: "invoices.create", payments: "payments.create", payroll: "payroll.create",
};

type Source = "workspaces" | "clients" | "providers" | "clinicians" | "invoices";
type ReferenceOption = { id: string; label: string };
const sources: Record<Source, { table: string; select: string; label: (row: Record<string, unknown>) => string }> = {
  workspaces: { table: "workspaces", select: "id,name,slug", label: (row) => String(row.name) },
  clients: { table: "clients", select: "id,name,status", label: (row) => `${String(row.name)} (${String(row.status)})` },
  providers: { table: "providers", select: "id,display_name,first_name,last_name", label: (row) => String(row.display_name || `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()) },
  clinicians: { table: "clinicians", select: "id,display_name,first_name,last_name", label: (row) => String(row.display_name || `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()) },
  invoices: { table: "invoices", select: "id,invoice_number,status", label: (row) => `${String(row.invoice_number)} (${String(row.status)})` },
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const companyId = params.get("companyId") ?? "";
  const resource = params.get("resource") ?? "";
  const permission = resourcePermissions[resource];
  if (!isUuid(companyId)) return NextResponse.json({ error: "Company context must be a valid UUID." }, { status: 400 });
  if (!permission) return NextResponse.json({ error: "Unknown VA resource." }, { status: 404 });
  try {
    await requireUser();
    await assertPermission(companyId, permission);
    const values = await Promise.all(Object.entries(sources).map(async ([source, definition]) => {
      const rows = await userRest<Array<Record<string, unknown>>>("GET", definition.table, { query: { select: definition.select, company_id: `eq.${companyId}`, archived_at: "is.null", order: "created_at.desc" } });
      const options: ReferenceOption[] = rows.filter((row): row is Record<string, unknown> & { id: string } => typeof row.id === "string").map((row) => ({ id: row.id, label: definition.label(row) }));
      return [source, options] as const;
    }));
    return NextResponse.json(Object.fromEntries(values));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "References could not be loaded." }, { status: 403 });
  }
}

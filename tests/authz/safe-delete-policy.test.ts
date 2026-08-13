import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/0006_safe_delete_actions.sql"), "utf8");
const ambiguityFix = readFileSync(resolve(process.cwd(), "supabase/migrations/0007_fix_safe_delete_dependency_ambiguity.sql"), "utf8");
const vaApi = readFileSync(resolve(process.cwd(), "app/api/va/[resource]/route.ts"), "utf8");
const calendarApi = readFileSync(resolve(process.cwd(), "app/api/calendar/route.ts"), "utf8");
describe("safe delete contract", () => {
  it("adds explicit delete permissions and RLS policies", () => {
    ["clients.delete", "providers.delete", "clinicians.delete", "credentials.delete", "calendar.delete"].forEach((permission) => expect(sql).toContain(permission));
    expect(sql).toContain("create policy clients_delete");
    expect(sql).toContain("create policy calendar_events_delete");
  });
  it("blocks protected dependency deletion and preserves finance/audit lifecycle", () => {
    expect(sql).toContain("va_delete_dependencies");
    expect(sql).toContain("prevent_unsafe_va_delete");
    expect(sql).toContain("Permanent deletion permission is required for this company");
    expect(sql).toContain("'invoices'");
    expect(sql).toContain("'payments'");
    expect(sql).toContain("'payroll records'");
    expect(sql).toContain("'client assignments'");
    expect(vaApi).toContain("company_id: `eq.${companyId}`");
    expect(vaApi).toContain("confirmation !== \"DELETE\"");
  });
  it("qualifies dependency result columns so inspection executes without PL/pgSQL ambiguity", () => {
    expect(ambiguityFix).toContain("select d.dependency, d.record_count");
    expect(ambiguityFix).toContain("where d.record_count > 0");
    expect(ambiguityFix).not.toContain("return query select dependency, record_count");
    expect(ambiguityFix).toContain("create or replace function public.prevent_unsafe_va_delete");
  });
  it("allows zero-dependency client, provider, clinician, and credential rows while preserving protected records", () => {
    expect(ambiguityFix).toContain("when 'clients' then 'clients.delete'");
    expect(ambiguityFix).toContain("when 'providers' then 'providers.delete'");
    expect(ambiguityFix).toContain("when 'clinicians' then 'clinicians.delete'");
    expect(ambiguityFix).toContain("when 'credentials' then 'credentials.delete'");
    expect(ambiguityFix).toContain("where d.record_count > 0");
    expect(ambiguityFix).toContain("'payroll records'");
  });
  it("deletes a calendar event only after the explicit permission and confirmation", () => {
    expect(calendarApi).toContain('"calendar.delete"');
    expect(calendarApi).toContain("confirmation !== \"DELETE\"");
    expect(calendarApi).toContain("company_id: `eq.${companyId}`");
  });
});

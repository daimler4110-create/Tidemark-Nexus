import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/0005_calendar_foundation.sql"), "utf8");
describe("calendar RLS migration contract", () => {
  it("keeps events and participants company-scoped under RLS", () => {
    expect(sql).toContain("alter table public.calendar_events enable row level security");
    expect(sql).toContain("alter table public.event_participants enable row level security");
    expect(sql).toContain("public.has_permission(company_id, 'calendar.read')");
    expect(sql).toContain("public.has_permission(company_id, 'calendar.create')");
  });
  it("validates related tenant scope and does not introduce Nexus as a company", () => {
    expect(sql).toContain("validate_calendar_event_scope");
    expect(sql).toContain("validate_event_participant_scope");
    expect(sql).not.toContain("insert into public.companies");
  });
});

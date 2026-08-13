import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/0002_rls.sql"), "utf8") + readFileSync(resolve(process.cwd(), "supabase/migrations/0003_phase1_hardening.sql"), "utf8");
describe("RLS migration contract", () => {
  it("enables RLS across every Phase 1 table", () => ["companies", "profiles", "roles", "permissions", "role_permissions", "workspaces", "memberships", "company_modules", "invitations", "audit_logs"].forEach((table) => expect(sql).toContain(`alter table public.${table} enable row level security`)));
  it("contains workspace and company permission helpers", () => { expect(sql).toContain("has_workspace_access"); expect(sql).toContain("has_workspace_permission"); expect(sql).toContain("has_permission"); });
  it("contains tenant integrity enforcement", () => expect(sql).toContain("validate_tenant_scope"));
  it("makes invite acceptance a scoped database transaction", () => expect(sql).toContain("accept_invitation(raw_token text)"));
});

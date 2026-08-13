import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/0008_workspace_lifecycle_actions.sql"), "utf8");
const workspaceApi = readFileSync(resolve(process.cwd(), "app/api/workspaces/[workspaceId]/route.ts"), "utf8");
const context = readFileSync(resolve(process.cwd(), "lib/authz/context.ts"), "utf8");
const references = readFileSync(resolve(process.cwd(), "app/api/va/references/route.ts"), "utf8");

describe("workspace lifecycle contract", () => {
  it("allows an authorized empty workspace to delete after explicit confirmation", () => {
    expect(sql).toContain("workspace.delete");
    expect(sql).toContain("where r.key = 'global_admin'");
    expect(sql).toContain("create policy workspaces_delete");
    expect(sql).toContain("public.has_permission(company_id, 'workspace.delete')");
    expect(sql).toContain("where d.record_count > 0");
    expect(workspaceApi).toContain("confirmation !== \"DELETE\"");
    expect(workspaceApi).toContain("rpc/workspace_delete_dependencies");
  });

  it("blocks workspaces that still have operational, membership, calendar, document, billing, or payroll dependencies", () => {
    ["'workspace memberships'", "'providers'", "'clinicians'", "'clients'", "'activities'", "'invoices'", "'billable records'", "'pay periods'", "'documents'", "'calendar events'"].forEach((dependency) => expect(sql).toContain(dependency));
    expect(sql).toContain("Archive this workspace instead.");
  });

  it("uses an explicit delete policy and blocks cross-company targets", () => {
    expect(sql).toContain("create policy workspaces_delete");
    expect(sql).toContain("public.has_permission(company_id, 'workspace.delete')");
    expect(sql).toContain("public.has_permission(company_id, 'workspace.manage') or public.has_permission(company_id, 'workspace.delete')");
    expect(workspaceApi).toContain("company_id: `eq.${companyId}`");
    expect(workspaceApi).toContain("Workspace was not found in the selected company.");
  });

  it("excludes archived workspaces from active switchers and operational selectors", () => {
    expect(context).toContain('.is("archived_at", null)');
    expect(references).toContain('archived_at: "is.null"');
    expect(sql).toContain("w.archived_at is null");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/0010_tasks_and_analytics_foundation.sql"), "utf8");
const taskApi = readFileSync(resolve(process.cwd(), "app/api/tasks/route.ts"), "utf8");
const dashboard = readFileSync(resolve(process.cwd(), "lib/analytics/dashboard.ts"), "utf8");

describe("task and dashboard tenant contract", () => {
  it("adds a production task model with tenant references and lifecycle fields", () => {
    ["create table public.tasks", "company_id uuid not null", "workspace_id uuid", "assignee_id uuid", "client_id uuid", "provider_id uuid", "clinician_id uuid", "credential_id uuid", "invoice_id uuid", "created_by uuid", "completed_at timestamptz", "archived_at timestamptz"].forEach((value) => expect(migration).toContain(value));
    expect(migration).toContain("tasks_tenant_scope");
    expect(migration).toContain("validate_task_assignee_scope");
  });

  it("keeps task CRUD and permanent deletion behind distinct permissions and RLS", () => {
    ["tasks.read", "tasks.create", "tasks.update", "tasks.archive", "tasks.delete"].forEach((permission) => expect(migration).toContain(permission));
    ["create policy tasks_read", "create policy tasks_create", "create policy tasks_update", "create policy tasks_archive", "create policy tasks_delete"].forEach((policy) => expect(migration).toContain(policy));
    expect(migration).toContain("tasks_prevent_unsafe_delete");
    expect(migration).toContain("enforce_task_update_permission");
    expect(migration).toContain("workspaces_tasks_read");
    expect(taskApi).toContain('assertCompanyModuleEnabled(companyId, "tasks")');
    expect(taskApi).toContain('company_id: `eq.${companyId}`');
    expect(taskApi).toContain('target_table: "tasks"');
    expect(taskApi).toContain('confirmation !== "DELETE"');
  });

  it("includes tasks in workspace dependency protection instead of cascading data", () => {
    expect(migration).toContain("union all select 'tasks'");
    expect(migration).toContain("where d.record_count > 0");
    expect(migration).not.toContain("on delete cascade");
  });

  it("derives dashboard values from current-user RLS queries instead of storing KPIs", () => {
    expect(dashboard).toContain('userRest<Row[]>("GET", table');
    expect(dashboard).toContain('company_id: `eq.${companyId}`');
    expect(dashboard).toContain('"ar_aging"');
    expect(dashboard).toContain('"tasks"');
    expect(dashboard).not.toContain("create table public.kpi");
  });
});

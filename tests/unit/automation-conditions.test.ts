import { describe, expect, it } from "vitest";
import { conditionsMatch } from "../../lib/automation/conditions";
import { automationRuleSchema } from "../../lib/validation/automation";

describe("declarative automation conditions", () => {
  it("evaluates the fixed condition vocabulary without evaluating code", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    expect(conditionsMatch([{ field: "status", operator: "equals", value: "active" }, { field: "name", operator: "contains", value: "tidemark" }], { status: "active", name: "Tidemark Client" }, now)).toBe(true);
    expect(conditionsMatch([{ field: "expiration_date", operator: "within_days", value: 30 }], { expiration_date: "2026-09-12" }, now)).toBe(true);
    expect(conditionsMatch([{ field: "balance", operator: "greater_than", value: 100 }], { balance: 20 }, now)).toBe(false);
  });

  it("accepts only structured, resource-matched rules", () => {
    const valid = automationRuleSchema.safeParse({ name: "Credential renewal", description: "", active: false, trigger_type: "credential_expiring", trigger_resource: "credential", conditions: [{ field: "expiration_date", operator: "within_days", value: 30 }], actions: [{ position: 1, action_type: "create_task", configuration: { title: "Renew credential" } }] });
    expect(valid.success).toBe(true);
    const invalid = automationRuleSchema.safeParse({ name: "Wrong resource", trigger_type: "credential_expiring", trigger_resource: "client", actions: [{ position: 1, action_type: "create_task", configuration: { title: "Nope" } }] });
    expect(invalid.success).toBe(false);
  });
});

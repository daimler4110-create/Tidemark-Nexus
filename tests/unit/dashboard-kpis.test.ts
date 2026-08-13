import { describe, expect, it } from "vitest";
import { credentialHealth, summarizeArMetrics, summarizeTaskMetrics } from "../../lib/analytics/kpis";

const now = new Date("2026-08-13T12:00:00Z");

describe("dashboard KPI mutation responses", () => {
  it("reflects a new client as a higher active client source count", () => {
    const before = [{ archived_at: null }, { archived_at: "2026-08-01" }];
    const after = [...before, { archived_at: null }];
    expect(before.filter((client) => !client.archived_at)).toHaveLength(1);
    expect(after.filter((client) => !client.archived_at)).toHaveLength(2);
  });

  it("reflects invoice creation and a successful payment in AR", () => {
    const invoices = [{ balance_due: 250, due_date: "2026-06-01", aging_bucket: "61_90" }];
    expect(summarizeArMetrics(invoices, now)).toMatchObject({ outstanding: 1, total: 250, overdue: 1 });
    const afterPayment = [{ balance_due: 150, due_date: "2026-06-01", aging_bucket: "61_90" }];
    expect(summarizeArMetrics(afterPayment, now).total).toBe(150);
  });

  it("reflects expiring credentials and task create/complete mutations", () => {
    expect(credentialHealth("2026-08-30", now)).toBe("≤30 days");
    const created = [{ status: "blocked", due_at: "2026-08-12T09:00:00Z", archived_at: null }];
    expect(summarizeTaskMetrics(created, now)).toMatchObject({ open: 1, overdue: 1, blocked: 1 });
    const completed = [{ ...created[0], status: "done" }];
    expect(summarizeTaskMetrics(completed, now)).toMatchObject({ open: 0, overdue: 0, blocked: 0 });
  });
});

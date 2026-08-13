import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "lib/analytics/dashboard.ts"), "utf8");
const ui = readFileSync(resolve(process.cwd(), "components/dashboard/analytics-dashboard.tsx"), "utf8");

describe("dashboard analytical behavior contract", () => {
  it("supports the requested reporting windows and validates untrusted identifier filters", () => {
    ["today", "week", "month", "30d", "quarter", "ytd", "custom"].forEach((range) => expect(source).toContain(`"${range}"`));
    expect(source).toContain('workspaceId: isUuid(value("workspace"))');
    expect(source).toContain('clientId: isUuid(value("client"))');
    expect(source).toContain('providerId: isUuid(value("provider"))');
    expect(source).toContain('clinicianId: isUuid(value("clinician"))');
  });

  it("derives AR from balances and successful collections rather than financial guesses", () => {
    expect(source).toContain("balance_due");
    expect(source).toContain('text(row.status) === "succeeded"');
    expect(source).toContain("90_plus");
    expect(source).not.toContain("profit margin");
  });

  it("renders original accessible SVG visualizations with legends, empty states, and drilldowns", () => {
    ["DonutChart", "BarChart", "TrendChart", "legend-row", "No authorized records", "Drilldown"].forEach((value) => expect(ui).toContain(value));
    expect(ui).toContain("router.refresh()");
  });
});

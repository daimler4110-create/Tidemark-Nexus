import { describe, expect, it } from "vitest";
import { corePermissions, foundationModules, initialGlobalAdminEmails, operatingCompanies } from "../../scripts/global-admin-bootstrap.mjs";

describe("global administrator bootstrap configuration", () => {
  it("contains exactly the approved existing Auth identities", () => expect(initialGlobalAdminEmails).toEqual(["daimler@tidemark.com", "bill@tidemark.com", "brittainny@tidemarkva.com"]));
  it("contains exactly the three operating companies and never Nexus", () => {
    expect(operatingCompanies.map((company) => company.name)).toEqual(["Tidemark VA", "Tidemark Therapy", "Mental Health Managed"]);
    expect(operatingCompanies.some((company) => company.name === "Nexus" || company.slug === "nexus")).toBe(false);
  });
  it("grants the global role every seeded core permission and enables foundation modules", () => {
    expect(corePermissions.length).toBeGreaterThan(0);
    expect(foundationModules).toContain("workspaces");
  });
});

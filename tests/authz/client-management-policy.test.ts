import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/0009_client_management_fields.sql"), "utf8");
const clientApi = readFileSync(resolve(process.cwd(), "app/api/clients/route.ts"), "utf8");
const clientDetail = readFileSync(resolve(process.cwd(), "app/(app)/c/[companySlug]/clients/[clientId]/page.tsx"), "utf8");
const navigation = readFileSync(resolve(process.cwd(), "components/layout/company-navigation.tsx"), "utf8");
const crm = readFileSync(resolve(process.cwd(), "app/(app)/c/[companySlug]/crm/page.tsx"), "utf8");
const manager = readFileSync(resolve(process.cwd(), "components/clients/client-manager.tsx"), "utf8");
const detail = readFileSync(resolve(process.cwd(), "components/clients/client-360.tsx"), "utf8");

describe("client management contract", () => {
  it("extends the existing clients table and retains contacts and assignments as normalized records", () => {
    ["add column if not exists legal_name", "add column if not exists client_type", "add column if not exists owner_id", "add column if not exists tags", "client_contacts_one_active_primary"].forEach((value) => expect(migration).toContain(value));
    expect(clientApi).toContain('"client_contacts"');
    expect(clientApi).toContain('"client_assignments"');
  });
  it("resolves company/user context server-side and blocks cross-company references", () => {
    expect(clientApi).toContain('company_id: companyId');
    expect(clientApi).toContain('created_by: user.id');
    expect(clientApi).toContain('assertCompanyModuleEnabled(companyId, "clients")');
    expect(clientApi).toContain('company_id = `eq.${companyId}`');
    expect(clientApi).toContain("must be an active authorized record in the selected company");
  });
  it("exposes the clients navigation, detail 360, and CRM over the same clients table", () => {
    expect(navigation).toContain('clients: { label: "Clients"');
    expect(clientDetail).toContain('rows("clients"');
    expect(clientDetail).toContain('rows("client_contacts"');
    expect(clientDetail).toContain('rows("client_assignments"');
    expect(crm).toContain('"clients"');
  });
  it("renders the required client entry and Client 360 operational fields", () => {
    ["Client Name", "Legal Name", "Primary Contact Name", "Primary Contact Email", "Primary Contact Phone", "Referral Source", "Owner / Assigned Staff", "Workspace", "Tags", "Assigned providers", "Assigned clinicians"].forEach((field) => expect(manager).toContain(field));
    ["Primary contact", "Other contacts", "Assigned care team", "Activities & history", "Calendar & documents", "Billing & accounts receivable"].forEach((section) => expect(detail).toContain(section));
  });
});

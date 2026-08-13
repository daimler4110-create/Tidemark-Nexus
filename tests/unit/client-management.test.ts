import { describe, expect, it } from "vitest";
import { clientManagementSchema } from "../../lib/validation/va";

describe("client management input", () => {
  const minimum = { name: "Tidemark Client", status: "active", legal_name: "", client_type: "", email: "", phone: "", address_line_1: "", address_line_2: "", city: "", state_region: "", postal_code: "", start_date: "", end_date: "", referral_source: "", owner_id: "", workspace_id: "", tags: "Referral, Priority", notes: "", primary_contact: { id: "", name: "Alex Client", email: "alex@example.com", phone: "" }, provider_ids: [], clinician_ids: [] };
  it("normalizes blank optional UUIDs and tags without requiring UUID entry", () => {
    const parsed = clientManagementSchema.parse(minimum);
    expect(parsed.workspace_id).toBeNull();
    expect(parsed.owner_id).toBeNull();
    expect(parsed.tags).toEqual(["Referral", "Priority"]);
  });
  it("returns a field validation issue for invalid assigned record IDs", () => {
    const parsed = clientManagementSchema.safeParse({ ...minimum, provider_ids: ["Provider Alice"] });
    expect(parsed.success).toBe(false);
  });
  it("requires a primary contact name when primary contact details are present", () => {
    const parsed = clientManagementSchema.safeParse({ ...minimum, primary_contact: { id: "", name: "", email: "alex@example.com", phone: "" } });
    expect(parsed.success).toBe(false);
  });
  it("rejects client end dates before the start date", () => {
    const parsed = clientManagementSchema.safeParse({ ...minimum, start_date: "2026-03-01", end_date: "2026-02-28" });
    expect(parsed.success).toBe(false);
  });
});

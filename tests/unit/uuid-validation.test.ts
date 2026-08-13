import { describe, expect, it } from "vitest";
import { activitySchema, billableRecordSchema, credentialSchema, invoiceSchema, paymentSchema, personSchema } from "../../lib/validation/va";
import { optionalUuid, requiredUuid } from "../../lib/validation/uuid";

const id = "11111111-1111-4111-8111-111111111111";
describe("VA UUID input normalization", () => {
  it("converts blank optional UUIDs to null before validation", () => {
    expect(optionalUuid("Workspace").parse("   ")).toBeNull();
    expect(personSchema.parse({ first_name: "A", last_name: "B", status: "active", workspace_id: "" }).workspace_id).toBeNull();
    expect(credentialSchema.parse({ credential_type: "License", status: "pending", provider_id: id, clinician_id: "" }).clinician_id).toBeNull();
  });
  it("rejects nonblank labels and slugs with a field-specific error", () => {
    const result = invoiceSchema.safeParse({ client_id: "Tidemark VA", invoice_number: "INV-1", adjustments: 0 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("Client must be a valid UUID");
    expect(requiredUuid("Client").safeParse("client-name").success).toBe(false);
  });
  it("keeps real selected UUIDs for required relationships", () => {
    expect(paymentSchema.parse({ client_id: id, invoice_id: id, amount: 1, payment_date: "2026-08-13", status: "pending" }).client_id).toBe(id);
    expect(billableRecordSchema.parse({ client_id: id, description: "Service", status: "draft", provider_id: "", clinician_id: "", invoice_id: "" }).provider_id).toBeNull();
    expect(activitySchema.parse({ subject_type: "client", subject_id: id, activity_type: "note", title: "Note", due_at: "", assigned_to: "" }).assigned_to).toBeNull();
  });
});

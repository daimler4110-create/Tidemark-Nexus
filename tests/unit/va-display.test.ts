import { describe, expect, it } from "vitest";
import { displayNameFor, humanName } from "../../lib/va/display";

describe("VA display names", () => {
  it("uses a person name when a display_name is absent", () => {
    expect(humanName({ first_name: "Ada", middle_name: "M.", last_name: "Lovelace" })).toBe("Ada M. Lovelace");
    expect(displayNameFor("providers", { first_name: "Ada", last_name: "Lovelace" })).toBe("Ada Lovelace");
  });
  it("uses the related existing holder name for credentials", () => {
    expect(displayNameFor("credentials", { credential_type: "LPC", provider_id: "provider-1" }, { "provider-1": { display_name: "Morgan Reed" } })).toBe("Morgan Reed — LPC");
  });
  it("does not render a missing name as a dash", () => expect(displayNameFor("clients", {}).startsWith("Unnamed")).toBe(true));
  it("gives non-name operational resources a useful display title", () => {
    expect(displayNameFor("payments", { payment_date: "2030-01-01" })).toBe("Payment on 2030-01-01");
    expect(displayNameFor("payroll", { start_date: "2030-01-01", end_date: "2030-01-14" })).toBe("2030-01-01 – 2030-01-14");
  });
});

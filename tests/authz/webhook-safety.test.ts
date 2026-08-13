import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "app/api/integrations/webhook/[integration]/route.ts"), "utf8");
const adapters = readFileSync(resolve(process.cwd(), "lib/automation/adapters.ts"), "utf8");

describe("inbound webhook safety contract", () => {
  it("requires a short-lived constant-time HMAC before persisting a tenant event", () => {
    ["createHmac", "timingSafeEqual", "WEBHOOK_INBOUND_SECRET", "x-nexus-timestamp", "x-nexus-signature", "300_000", "isUuid(companyId)", "deduplication_key"].forEach((item) => expect(route).toContain(item));
    expect(route).toContain('direction: "inbound"');
    expect(route).not.toContain("NEXT_PUBLIC_SUPABASE");
    expect(adapters).toContain("must use HTTPS");
  });
});

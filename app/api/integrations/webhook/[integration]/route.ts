import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serviceRest } from "@/lib/db/service-rest";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const integrations = new Set(["webhook", "zapier"]);
const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left, "hex"); const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Inbound integrations are authenticated before their payload is parsed or
 * persisted. The worker never receives a browser credential or service key.
 */
export async function POST(request: Request, { params }: { params: Promise<{ integration: string }> }) {
  const { integration } = await params;
  if (!integrations.has(integration)) return NextResponse.json({ error: "Unsupported integration." }, { status: 404 });
  const secret = process.env.WEBHOOK_INBOUND_SECRET;
  if (!secret) return NextResponse.json({ error: "Inbound webhooks are not configured." }, { status: 503 });
  const timestamp = request.headers.get("x-nexus-timestamp") ?? "";
  const supplied = request.headers.get("x-nexus-signature") ?? "";
  const epoch = Number(timestamp);
  if (!Number.isFinite(epoch) || Math.abs(Date.now() - epoch * 1_000) > 300_000) return NextResponse.json({ error: "Webhook timestamp is invalid or expired." }, { status: 401 });
  const raw = await request.text();
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(supplied) || !safeEqual(expected, supplied)) return NextResponse.json({ error: "Webhook signature is invalid." }, { status: 401 });
  const payload = (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; } })();
  const companyId = typeof payload?.company_id === "string" ? payload.company_id : "";
  const eventType = typeof payload?.event_type === "string" ? payload.event_type.trim().slice(0, 120) : "";
  const deduplicationKey = typeof payload?.event_id === "string" ? payload.event_id.trim().slice(0, 240) : "";
  const workspaceId = typeof payload?.workspace_id === "string" && isUuid(payload.workspace_id) ? payload.workspace_id : null;
  if (!isUuid(companyId) || !eventType || !deduplicationKey) return NextResponse.json({ error: "company_id, event_type, and event_id are required." }, { status: 400 });
  try {
    const rows = await serviceRest<Array<{ id: string }>>("POST", "integration_events", { body: { company_id: companyId, workspace_id: workspaceId, integration, direction: "inbound", event_type: eventType, deduplication_key: deduplicationKey, payload, status: "received" }, prefer: "return=representation" });
    return NextResponse.json({ received: true, eventId: rows[0]?.id ?? null }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook could not be recorded.";
    if (/duplicate key|unique/i.test(message)) return NextResponse.json({ received: true, duplicate: true }, { status: 202 });
    return NextResponse.json({ error: "Webhook could not be recorded." }, { status: 400 });
  }
}

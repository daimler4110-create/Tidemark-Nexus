import "server-only";
import { createHmac } from "node:crypto";
import { isOpenAiConfigured, requestOpenAiDraft, type AiWork } from "./openai";

type EmailWork = { id: string; recipient: string; subject: string | null; body: string; company_id: string };

function configuredHttps(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is not configured.`);
  let url: URL; try { url = new URL(value); } catch { throw new Error(`${name} must be a valid HTTPS URL.`); }
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  return url;
}

export function integrationConfiguration() {
  return { ai: Boolean(isOpenAiConfigured() || (process.env.AI_PROVIDER_API_URL && process.env.AI_PROVIDER_API_KEY)), email: Boolean(process.env.EMAIL_PROVIDER_WEBHOOK_URL && process.env.EMAIL_PROVIDER_API_KEY), pandadoc: Boolean(process.env.PANDADOC_API_URL && process.env.PANDADOC_API_KEY), webhooks: Boolean(process.env.WEBHOOK_OUTBOUND_URL && process.env.WEBHOOK_OUTBOUND_SECRET) };
}

async function requestGenericAiDraft(work: AiWork) {
  const url = process.env.AI_PROVIDER_API_URL; const apiKey = process.env.AI_PROVIDER_API_KEY;
  if (!url || !apiKey) throw new Error("AI provider is not configured.");
  const endpoint = configuredHttps(url, "AI_PROVIDER_API_URL"); const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "idempotency-key": work.id }, body: JSON.stringify({ requestType: work.request_type, context: work.input_context, tenant: work.company_id }), cache: "no-store" });
  if (!response.ok) throw new Error(`AI provider request failed (${response.status}).`);
  const body = await response.json() as { text?: unknown; content?: unknown; response?: unknown; model?: unknown }; const content = typeof body.text === "string" ? body.text : typeof body.content === "string" ? body.content : typeof body.response === "string" ? body.response : null;
  if (!content) throw new Error("AI provider returned no draft text.");
  return { content, model: typeof body.model === "string" ? body.model : null, provider: endpoint.hostname };
}

/** Prefer the native OpenAI adapter while retaining the existing generic HTTPS adapter as a fallback. */
export async function requestAiDraft(work: AiWork) {
  if (isOpenAiConfigured()) return requestOpenAiDraft(work);
  return requestGenericAiDraft(work);
}

export async function sendApprovedEmail(work: EmailWork) {
  const url = process.env.EMAIL_PROVIDER_WEBHOOK_URL; const apiKey = process.env.EMAIL_PROVIDER_API_KEY;
  if (!url || !apiKey) throw new Error("Email provider is not configured.");
  const endpoint = configuredHttps(url, "EMAIL_PROVIDER_WEBHOOK_URL"); const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "idempotency-key": work.id }, body: JSON.stringify({ to: work.recipient, subject: work.subject, body: work.body, tenant: work.company_id }), cache: "no-store" });
  if (!response.ok) throw new Error(`Email provider request failed (${response.status}).`);
  const body = await response.json().catch(() => ({})) as { messageId?: unknown; threadId?: unknown }; return { messageId: typeof body.messageId === "string" ? body.messageId : null, threadId: typeof body.threadId === "string" ? body.threadId : null, provider: endpoint.hostname };
}

/** PandaDoc stays at this boundary until a server-only provider adapter is configured. */
export async function createPandaDocDocument() {
  if (!integrationConfiguration().pandadoc) throw new Error("PandaDoc is not configured.");
  throw new Error("PandaDoc adapter is configured but not yet implemented.");
}

export async function sendOutboundWebhook(work: { id: string; eventType: string; payload: Record<string, unknown>; companyId: string }) {
  const url = process.env.WEBHOOK_OUTBOUND_URL; const secret = process.env.WEBHOOK_OUTBOUND_SECRET;
  if (!url || !secret) throw new Error("Outbound webhooks are not configured.");
  const endpoint = configuredHttps(url, "WEBHOOK_OUTBOUND_URL"); const timestamp = Math.floor(Date.now() / 1_000).toString(); const body = JSON.stringify({ event_id: work.id, event_type: work.eventType, company_id: work.companyId, payload: work.payload });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-nexus-timestamp": timestamp, "x-nexus-signature": signature, "idempotency-key": work.id }, body, cache: "no-store" });
  if (!response.ok) throw new Error(`Webhook delivery failed (${response.status}).`);
  return { provider: endpoint.hostname, externalId: response.headers.get("x-request-id") };
}

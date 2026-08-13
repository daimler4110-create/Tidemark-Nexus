import "server-only";

import { serviceRest } from "../db/service-rest";
import { isUuid } from "../validation/uuid";

type Row = Record<string, unknown>;

export type AiContextRequest = {
  company_id: string;
  workspace_id?: string | null;
  request_type: string;
  related_resource_type?: string | null;
  related_resource_id?: string | null;
};

export type AuthorizedAiContext = {
  company_id: string;
  workspace_id: string | null;
  request_type: string;
  resource: { type: string; id: string; fields: Record<string, unknown> } | null;
  activities: Array<Record<string, unknown>>;
};

export type AiContextReader = (table: string, query: Record<string, string>) => Promise<Row[]>;

const text = (value: unknown) => typeof value === "string" ? value : "";
const asRecord = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const truncate = (value: string, limit = 4_000) => value.length > limit ? `${value.slice(0, limit)}…` : value;

const resourceDefinitions: Record<string, { table: string; select: string; fields: string[] }> = {
  client: {
    table: "clients",
    select: "id,company_id,workspace_id,name,legal_name,status,client_type,referral_source,notes",
    fields: ["name", "legal_name", "status", "client_type", "referral_source", "notes"],
  },
  provider: {
    table: "providers",
    select: "id,company_id,workspace_id,display_name,first_name,last_name,status,specialty,notes",
    fields: ["display_name", "first_name", "last_name", "status", "specialty", "notes"],
  },
  clinician: {
    table: "clinicians",
    select: "id,company_id,workspace_id,display_name,first_name,last_name,status,specialty,notes",
    fields: ["display_name", "first_name", "last_name", "status", "specialty", "notes"],
  },
  credential: {
    table: "credentials",
    select: "id,company_id,credential_type,issuing_authority,expiration_date,status,renewal_status,notes,provider_id,clinician_id",
    fields: ["credential_type", "issuing_authority", "expiration_date", "status", "renewal_status", "notes"],
  },
  invoice: {
    table: "invoice_financials",
    select: "id,company_id,workspace_id,client_id,invoice_number,status,balance_due,due_date,issue_date,notes",
    fields: ["invoice_number", "status", "balance_due", "due_date", "issue_date", "notes"],
  },
  task: {
    table: "tasks",
    select: "id,company_id,workspace_id,title,description,status,priority,due_at,completed_at",
    fields: ["title", "description", "status", "priority", "due_at", "completed_at"],
  },
  activity: {
    table: "activities",
    select: "id,company_id,workspace_id,activity_type,title,body,due_at,completed_at,created_at",
    fields: ["activity_type", "title", "body", "due_at", "completed_at", "created_at"],
  },
};

const serviceReader: AiContextReader = (table, query) => serviceRest<Row[]>("GET", table, { query });

function safeFields(row: Row, fields: string[]) {
  return Object.fromEntries(fields.flatMap((field) => {
    const value = row[field];
    if (value === undefined || typeof value === "object") return [];
    return [[field, typeof value === "string" ? truncate(value) : value]];
  }));
}

async function relatedName(table: "providers" | "clinicians" | "clients", id: string, companyId: string, read: AiContextReader) {
  if (!isUuid(id)) return null;
  const select = table === "clients" ? "id,name" : "id,display_name,first_name,last_name";
  const rows = await read(table, { select, id: `eq.${id}`, company_id: `eq.${companyId}`, limit: "1" });
  const row = asRecord(rows[0]);
  const name = text(row.display_name) || text(row.name) || `${text(row.first_name)} ${text(row.last_name)}`.trim();
  return name || null;
}

async function relatedDetails(type: string, row: Row, companyId: string, read: AiContextReader) {
  if (type === "credential") {
    const holderId = text(row.provider_id) || text(row.clinician_id);
    const holder = await relatedName(text(row.provider_id) ? "providers" : "clinicians", holderId, companyId, read);
    return holder ? { holder_name: holder } : {};
  }
  if (type === "invoice") {
    const clientName = await relatedName("clients", text(row.client_id), companyId, read);
    return clientName ? { client_name: clientName } : {};
  }
  return {};
}

async function recentActivities(clientId: string, companyId: string, read: AiContextReader) {
  const rows = await read("activities", {
    select: "activity_type,title,body,due_at,completed_at,created_at",
    company_id: `eq.${companyId}`,
    subject_type: "eq.client",
    subject_id: `eq.${clientId}`,
    archived_at: "is.null",
    order: "created_at.desc",
    limit: "25",
  });
  return rows.map((row) => safeFields(asRecord(row), ["activity_type", "title", "body", "due_at", "completed_at", "created_at"]));
}

/**
 * Builds the only record context that may cross the provider boundary. It never
 * includes browser-supplied input_context, and every lookup is constrained by
 * the durable request's server-resolved company identifier.
 */
export async function resolveAuthorizedAiContext(request: AiContextRequest, read: AiContextReader = serviceReader): Promise<AuthorizedAiContext> {
  const companyId = text(request.company_id);
  if (!isUuid(companyId)) throw new Error("AI request has an invalid company context.");
  const workspaceId = isUuid(text(request.workspace_id)) ? text(request.workspace_id) : null;
  const type = text(request.related_resource_type);
  const id = text(request.related_resource_id);
  const base: AuthorizedAiContext = { company_id: companyId, workspace_id: workspaceId, request_type: text(request.request_type), resource: null, activities: [] };

  if (!type && !id) return base;
  if (!type || !isUuid(id)) throw new Error("AI request has an invalid related record context.");
  const definition = resourceDefinitions[type];
  if (!definition) throw new Error("AI request uses an unsupported related record type.");

  const rows = await read(definition.table, { select: definition.select, id: `eq.${id}`, company_id: `eq.${companyId}`, archived_at: "is.null", limit: "1" });
  const record = asRecord(rows[0]);
  if (!Object.keys(record).length) throw new Error("Related record could not be resolved for this company.");
  const recordWorkspaceId = text(record.workspace_id);
  if (workspaceId && recordWorkspaceId && workspaceId !== recordWorkspaceId) throw new Error("Related record is outside the AI request workspace.");

  const fields = { ...safeFields(record, definition.fields), ...await relatedDetails(type, record, companyId, read) };
  base.resource = { type, id, fields };
  if (request.request_type === "summarize_activities" && type === "client") base.activities = await recentActivities(id, companyId, read);
  return base;
}

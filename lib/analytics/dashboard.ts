import "server-only";
import { userRest } from "@/lib/db/rest";
import { agingBucket, type AgingBucket } from "@/lib/finance/invoice";
import { isUuid } from "@/lib/validation/uuid";
import { credentialHealth, summarizeArMetrics, summarizeTaskMetrics } from "@/lib/analytics/kpis";

export type DashboardFilters = { range: string; from: string; to: string; workspaceId: string; clientId: string; providerId: string; clinicianId: string; status: string };
export type ChartPoint = { label: string; value: number; href?: string };
export type DashboardCard = { label: string; value: string; detail?: string; href?: string; tone?: "danger" | "warning" | "success" };
export type FilterOption = { id: string; label: string };
export type AnalyticsDashboardData = {
  cards: DashboardCard[]; charts: { clientStatus?: ChartPoint[]; arAging?: ChartPoint[]; invoiceStatus?: ChartPoint[]; credentialHealth?: ChartPoint[]; taskStatus?: ChartPoint[]; taskPriority?: ChartPoint[]; billingTrend?: ChartPoint[]; collectionsTrend?: ChartPoint[]; clientGrowth?: ChartPoint[]; workload?: ChartPoint[]; };
  attention: DashboardCard[]; filters: DashboardFilters; filterOptions: { workspaces: FilterOption[]; clients: FilterOption[]; providers: FilterOption[]; clinicians: FilterOption[]; statuses: string[] }; unavailable: string[]; automation?: { configured: boolean; activeRules: number; runsToday: number; successfulRuns: number; failedRuns: number; pendingActions: number; aiRequests: number; aiAwaitingReview: number; aiFailed: number; communicationsAwaitingApproval: number; communicationsFailed: number };
};

type Row = Record<string, unknown>;
type DateWindow = { from: Date; to: Date; fromText: string; toText: string };
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const numeric = (value: unknown) => Number(value ?? 0) || 0;
const text = (value: unknown) => typeof value === "string" ? value : "";
const dateOnly = (value: unknown) => text(value).slice(0, 10);
const active = (row: Row) => !row.archived_at;
const startOfDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const asIsoDate = (date: Date) => date.toISOString().slice(0, 10);

export function readDashboardFilters(input: Record<string, string | string[] | undefined>): DashboardFilters {
  const value = (key: string) => typeof input[key] === "string" ? input[key] as string : "";
  return { range: value("range") || "month", from: value("from"), to: value("to"), workspaceId: isUuid(value("workspace")) ? value("workspace") : "", clientId: isUuid(value("client")) ? value("client") : "", providerId: isUuid(value("provider")) ? value("provider") : "", clinicianId: isUuid(value("clinician")) ? value("clinician") : "", status: value("status").trim().slice(0, 64) };
}

function windowFor(filters: DashboardFilters, now = new Date()): DateWindow {
  const today = startOfDay(now); let end = new Date(today); end.setUTCDate(end.getUTCDate() + 1);
  let from = new Date(today);
  if (filters.range === "today") { /* today */ }
  else if (filters.range === "week") from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
  else if (filters.range === "30d") from.setUTCDate(from.getUTCDate() - 29);
  else if (filters.range === "quarter") from = new Date(Date.UTC(today.getUTCFullYear(), Math.floor(today.getUTCMonth() / 3) * 3, 1));
  else if (filters.range === "ytd") from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  else if (filters.range === "custom" && validDate(filters.from) && validDate(filters.to) && filters.from <= filters.to) { from = new Date(`${filters.from}T00:00:00Z`); end = new Date(`${filters.to}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1); }
  else from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from, to: end, fromText: asIsoDate(from), toText: asIsoDate(new Date(end.getTime() - 86_400_000)) };
}

const inWindow = (value: unknown, window: DateWindow) => { const parsed = Date.parse(text(value)); return !Number.isNaN(parsed) && parsed >= window.from.getTime() && parsed < window.to.getTime(); };
const dayStart = (value: unknown) => { const date = dateOnly(value); return date ? Date.parse(`${date}T00:00:00Z`) : Number.NaN; };
const name = (row: Row) => text(row.display_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ") || text(row.name) || "Unnamed";
const unique = <T,>(values: T[]) => [...new Set(values)];

async function rowsFor(companyId: string, table: string, select: string, permission: string, permissions: Set<string>, unavailable: string) {
  if (!permissions.has(permission)) return null;
  try { return await userRest<Row[]>("GET", table, { query: { select, company_id: `eq.${companyId}`, order: "created_at.desc" } }); }
  catch { return null; }
}

function monthlySeries(rows: Row[], date: (row: Row) => unknown, amount: (row: Row) => number, window: DateWindow) {
  const keys: string[] = []; const cursor = new Date(Date.UTC(window.from.getUTCFullYear(), window.from.getUTCMonth(), 1)); const lastDay = new Date(window.to.getTime() - 86_400_000); const last = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), 1));
  while (cursor <= last && keys.length < 24) { keys.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
  const totals = new Map(keys.map((key) => [key, 0]));
  rows.forEach((row) => { const raw = dateOnly(date(row)); const key = raw.slice(0, 7); if (totals.has(key) && inWindow(date(row), window)) totals.set(key, numeric(totals.get(key)) + amount(row)); });
  return keys.map((key) => ({ label: new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`)), value: numeric(totals.get(key)) }));
}

function byLabel(entries: Array<[string, number, string?]>): ChartPoint[] { return entries.filter(([, value]) => value > 0).map(([label, value, href]) => ({ label, value, href })); }
export async function getAnalyticsDashboard(companyId: string, grantedPermissions: string[], filters: DashboardFilters): Promise<AnalyticsDashboardData> {
  const permissions = new Set(grantedPermissions); const unavailable: string[] = []; const window = windowFor(filters); const today = startOfDay(new Date());
  const [clientsRaw, providersRaw, cliniciansRaw, credentialsRaw, invoicesRaw, arRaw, paymentsRaw, tasksRaw, payrollRaw, assignmentsRaw, workspacesRaw, automationRulesRaw, automationRunsRaw, automationActionRunsRaw, aiRequestsRaw, communicationsRaw] = await Promise.all([
    rowsFor(companyId, "clients", "id,name,status,workspace_id,created_at,archived_at", "clients.read", permissions, "Clients"),
    rowsFor(companyId, "providers", "id,display_name,first_name,last_name,status,workspace_id,archived_at", "providers.read", permissions, "Providers"),
    rowsFor(companyId, "clinicians", "id,display_name,first_name,last_name,status,workspace_id,archived_at", "clinicians.read", permissions, "Clinicians"),
    rowsFor(companyId, "credentials", "id,status,expiration_date,provider_id,clinician_id,archived_at", "credentials.read", permissions, "Credentials"),
    rowsFor(companyId, "invoices", "id,status,total,due_date,issue_date,created_at,workspace_id,client_id,archived_at", "invoices.read", permissions, "Invoices"),
    rowsFor(companyId, "ar_aging", "id,status,balance_due,due_date,aging_bucket,workspace_id,client_id,archived_at", "ar.read", permissions, "Accounts receivable"),
    rowsFor(companyId, "payments", "id,amount,status,payment_date,created_at,client_id,invoice_id,archived_at", "payments.read", permissions, "Payments"),
    rowsFor(companyId, "tasks", "id,title,status,priority,due_at,completed_at,workspace_id,client_id,provider_id,clinician_id,credential_id,invoice_id,created_at,archived_at", "tasks.read", permissions, "Tasks"),
    rowsFor(companyId, "pay_periods", "id,status,start_date,end_date,created_at,archived_at", "payroll.read", permissions, "Payroll"),
    rowsFor(companyId, "client_assignments", "id,client_id,provider_id,clinician_id,archived_at", "clients.read", permissions, "Assignments"),
    rowsFor(companyId, "workspaces", "id,name,archived_at", "tasks.read", permissions, "Workspaces"),
    rowsFor(companyId, "automation_rules", "id,active,archived_at,created_at", "automation.read", permissions, "Automation rules"),
    rowsFor(companyId, "automation_runs", "id,status,created_at", "automation.read", permissions, "Automation runs"),
    rowsFor(companyId, "automation_action_runs", "id,status,created_at", "automation.read", permissions, "Automation actions"),
    rowsFor(companyId, "ai_requests", "id,status,requested_at,created_at", "ai.read", permissions, "AI requests"),
    rowsFor(companyId, "communications", "id,status,created_at", "communications.read", permissions, "Communications"),
  ]);
  const has = (value: Row[] | null, label: string) => { if (value === null && permissions.size) unavailable.push(label); return value ?? []; };
  const clients = has(clientsRaw, "Clients"); const providers = has(providersRaw, "Providers"); const clinicians = has(cliniciansRaw, "Clinicians"); const credentials = has(credentialsRaw, "Credentials"); const invoices = has(invoicesRaw, "Invoices"); const ar = has(arRaw, "Accounts receivable"); const payments = has(paymentsRaw, "Payments"); const tasks = has(tasksRaw, "Tasks"); const payroll = has(payrollRaw, "Payroll"); const assignments = has(assignmentsRaw, "Assignments"); const workspaces = workspacesRaw ?? [];
  const automationRules = automationRulesRaw ?? []; const automationRuns = automationRunsRaw ?? []; const automationActionRuns = automationActionRunsRaw ?? []; const aiRequests = aiRequestsRaw ?? []; const communications = communicationsRaw ?? [];
  const invoiceById = new Map(invoices.map((row) => [text(row.id), row]));
  const relationMatch = (row: Row) => (!filters.workspaceId || text(row.workspace_id) === filters.workspaceId) && (!filters.clientId || text(row.client_id) === filters.clientId) && (!filters.providerId || text(row.provider_id) === filters.providerId) && (!filters.clinicianId || text(row.clinician_id) === filters.clinicianId);
  const clientMatch = (row: Row) => (!filters.workspaceId || text(row.workspace_id) === filters.workspaceId) && (!filters.clientId || text(row.id) === filters.clientId) && (!filters.status || text(row.status) === filters.status);
  const personMatch = (row: Row, kind: "provider" | "clinician") => (!filters.workspaceId || text(row.workspace_id) === filters.workspaceId) && (!filters.providerId || kind !== "provider" || text(row.id) === filters.providerId) && (!filters.clinicianId || kind !== "clinician" || text(row.id) === filters.clinicianId);
  const credentialMatch = (row: Row) => (!filters.providerId || text(row.provider_id) === filters.providerId) && (!filters.clinicianId || text(row.clinician_id) === filters.clinicianId);
  const invoiceMatch = (row: Row) => relationMatch(row);
  const paymentMatch = (row: Row) => (!filters.clientId || text(row.client_id) === filters.clientId) && (!filters.workspaceId || text(invoiceById.get(text(row.invoice_id))?.workspace_id) === filters.workspaceId);
  const filteredClients = clients.filter(clientMatch); const filteredProviders = providers.filter((row) => personMatch(row, "provider")); const filteredClinicians = clinicians.filter((row) => personMatch(row, "clinician")); const filteredCredentials = credentials.filter(credentialMatch); const filteredInvoices = invoices.filter(invoiceMatch); const filteredAr = ar.filter(invoiceMatch); const filteredTasks = tasks.filter(relationMatch); const filteredPayments = payments.filter(paymentMatch); const filteredAssignments = assignments.filter((row) => active(row) && (!filters.clientId || text(row.client_id) === filters.clientId) && (!filters.providerId || text(row.provider_id) === filters.providerId) && (!filters.clinicianId || text(row.clinician_id) === filters.clinicianId));
  const cards: DashboardCard[] = [];
  if (clientsRaw) { cards.push({ label: "Active clients", value: String(filteredClients.filter((row) => active(row) && text(row.status) === "active").length), href: "/c/tidemark-va/clients?status=active" }, { label: "New clients", value: String(filteredClients.filter((row) => inWindow(row.created_at, window)).length), detail: `${window.fromText}–${window.toText}`, href: "/c/tidemark-va/clients" }); }
  if (providersRaw) cards.push({ label: "Active providers", value: String(filteredProviders.filter((row) => active(row) && text(row.status) === "active").length), href: "/c/tidemark-va/providers?status=active" });
  if (cliniciansRaw) cards.push({ label: "Active clinicians", value: String(filteredClinicians.filter((row) => active(row) && text(row.status) === "active").length), href: "/c/tidemark-va/clinicians?status=active" });
  const arMetrics = summarizeArMetrics(filteredAr.map((row) => ({ balance_due: numeric(row.balance_due), due_date: dateOnly(row.due_date) || null, aging_bucket: text(row.aging_bucket) || null })), today); const outstanding = filteredAr.filter((row) => numeric(row.balance_due) > 0); const overdue = outstanding.filter((row) => !Number.isNaN(dayStart(row.due_date)) && dayStart(row.due_date) < today.getTime());
  if (arRaw) { cards.push({ label: "Outstanding invoices", value: String(arMetrics.outstanding), href: "/c/tidemark-va/ar" }, { label: "Overdue invoices", value: String(arMetrics.overdue), href: "/c/tidemark-va/ar?bucket=overdue", tone: arMetrics.overdue ? "danger" : undefined }, { label: "Total accounts receivable", value: currency.format(arMetrics.total), href: "/c/tidemark-va/ar" }, { label: "90+ day AR", value: currency.format(arMetrics.ninetyPlus), href: "/c/tidemark-va/ar?bucket=90_plus", tone: arMetrics.ninetyPlus ? "warning" : undefined }); }
  const credentialCount = (key: string) => filteredCredentials.filter((row) => active(row) && credentialHealth(dateOnly(row.expiration_date) || null, today) === key).length;
  if (credentialsRaw) { cards.push({ label: "Pending credentials", value: String(filteredCredentials.filter((row) => active(row) && text(row.status) === "pending").length), href: "/c/tidemark-va/credentialing?status=pending" }, { label: "Credentials expiring ≤30 days", value: String(credentialCount("≤30 days")), href: "/c/tidemark-va/credentialing?health=30", tone: credentialCount("≤30 days") ? "warning" : undefined }, { label: "Credentials expiring 31–60 days", value: String(credentialCount("31–60 days")), href: "/c/tidemark-va/credentialing?health=31_60" }, { label: "Credentials expiring 61–90 days", value: String(credentialCount("61–90 days")), href: "/c/tidemark-va/credentialing?health=61_90" }, { label: "Expired credentials", value: String(credentialCount("Expired")), href: "/c/tidemark-va/credentialing?health=expired", tone: credentialCount("Expired") ? "danger" : undefined }); }
  const taskMetrics = summarizeTaskMetrics(filteredTasks.map((row) => ({ status: text(row.status), due_at: text(row.due_at) || null, archived_at: text(row.archived_at) || null })), today);
  if (tasksRaw) { cards.push({ label: "Open tasks", value: String(taskMetrics.open), href: "/c/tidemark-va/tasks?view=open" }, { label: "Overdue tasks", value: String(taskMetrics.overdue), href: "/c/tidemark-va/tasks?view=overdue", tone: taskMetrics.overdue ? "danger" : undefined }, { label: "Tasks due this week", value: String(taskMetrics.dueThisWeek), href: "/c/tidemark-va/tasks?view=due_this_week" }, { label: "Blocked tasks", value: String(taskMetrics.blocked), href: "/c/tidemark-va/tasks?status=blocked", tone: taskMetrics.blocked ? "warning" : undefined }); }
  if (payrollRaw) { const current = payroll.filter(active).sort((a, b) => text(b.end_date).localeCompare(text(a.end_date)))[0]; const awaitingReview = payroll.filter((row) => active(row) && text(row.status) === "review").length; if (current) cards.push({ label: "Current payroll status", value: text(current.status).replaceAll("_", " "), href: "/c/tidemark-va/payroll" }); cards.push({ label: "Payroll awaiting review", value: String(awaitingReview), href: "/c/tidemark-va/payroll?status=review", tone: awaitingReview ? "warning" : undefined }); }
  const automationConfigured = Boolean(automationRulesRaw || automationRunsRaw || automationActionRunsRaw || aiRequestsRaw || communicationsRaw);
  const automation = automationConfigured ? { configured: true, activeRules: automationRules.filter((row) => active(row) && row.active === true).length, runsToday: automationRuns.filter((row) => inWindow(row.created_at, { from: today, to: new Date(today.getTime() + 86_400_000), fromText: "", toText: "" })).length, successfulRuns: automationRuns.filter((row) => text(row.status) === "succeeded").length, failedRuns: automationRuns.filter((row) => ["failed", "partially_failed"].includes(text(row.status))).length, pendingActions: automationActionRuns.filter((row) => ["pending", "running"].includes(text(row.status))).length, aiRequests: aiRequests.length, aiAwaitingReview: aiRequests.filter((row) => text(row.status) === "awaiting_review").length, aiFailed: aiRequests.filter((row) => text(row.status) === "failed").length, communicationsAwaitingApproval: communications.filter((row) => ["draft", "ai_draft_requested", "awaiting_review"].includes(text(row.status))).length, communicationsFailed: communications.filter((row) => text(row.status) === "failed").length } : undefined;
  if (automation) cards.push({ label: "Active automation rules", value: String(automation.activeRules), href: "/c/tidemark-va/automation" }, { label: "Automation runs today", value: String(automation.runsToday), href: "/c/tidemark-va/automation?tab=runs" }, { label: "Failed automation runs", value: String(automation.failedRuns), href: "/c/tidemark-va/automation?tab=runs", tone: automation.failedRuns ? "danger" : undefined }, { label: "AI drafts awaiting review", value: String(automation.aiAwaitingReview), href: "/c/tidemark-va/ai", tone: automation.aiAwaitingReview ? "warning" : undefined }, { label: "Communications awaiting approval", value: String(automation.communicationsAwaitingApproval), href: "/c/tidemark-va/automation?tab=communications", tone: automation.communicationsAwaitingApproval ? "warning" : undefined });
  const clientStatuses = unique(filteredClients.map((row) => active(row) ? text(row.status) || "Unspecified" : "Archived")); const clientStatus = clientsRaw ? byLabel(clientStatuses.map((status) => [status.replace(/\b\w/g, (letter) => letter.toUpperCase()), filteredClients.filter((row) => (active(row) ? text(row.status) || "Unspecified" : "Archived") === status).length, `/c/tidemark-va/clients${status === "Archived" ? "" : `?status=${encodeURIComponent(status)}`}`])) : undefined;
  const arAging = arRaw ? byLabel((["current", "1_30", "31_60", "61_90", "90_plus"] as AgingBucket[]).map((bucket) => [bucket === "current" ? "Current" : bucket.replace("_", "–").replace("plus", "+"), outstanding.filter((row) => text(row.aging_bucket) === bucket).reduce((sum, row) => sum + numeric(row.balance_due), 0), `/c/tidemark-va/ar?bucket=${bucket}`])) : undefined;
  const balanceByInvoice = new Map(filteredAr.map((row) => [text(row.id), numeric(row.balance_due)])); const invoiceLabels = unique(filteredInvoices.filter(active).map((row) => { const balance = balanceByInvoice.get(text(row.id)) ?? 0; return balance > 0 && !Number.isNaN(dayStart(row.due_date)) && dayStart(row.due_date) < today.getTime() ? "overdue" : text(row.status) || "other"; })); const invoiceStatus = invoicesRaw ? byLabel(invoiceLabels.map((status) => [status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), filteredInvoices.filter((row) => { const balance = balanceByInvoice.get(text(row.id)) ?? 0; return active(row) && (balance > 0 && !Number.isNaN(dayStart(row.due_date)) && dayStart(row.due_date) < today.getTime() ? "overdue" : text(row.status) || "other") === status; }).length, status === "overdue" ? "/c/tidemark-va/ar?bucket=overdue" : `/c/tidemark-va/invoices?status=${encodeURIComponent(status)}`])) : undefined;
  const healthKeys = ["Current", "≤30 days", "31–60 days", "61–90 days", "Expired", "Missing date"]; const credentialHealthChart = credentialsRaw ? byLabel(healthKeys.map((state) => [state, credentialCount(state), state === "Current" || state === "Missing date" ? "/c/tidemark-va/credentialing" : `/c/tidemark-va/credentialing?health=${state === "≤30 days" ? "30" : state === "31–60 days" ? "31_60" : state === "61–90 days" ? "61_90" : "expired"}`])) : undefined;
  const taskStatus = tasksRaw ? byLabel(["not_started", "working", "waiting", "blocked", "done"].map((status) => [status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), filteredTasks.filter((row) => active(row) && text(row.status) === status).length, `/c/tidemark-va/tasks?status=${status}`])) : undefined;
  const taskPriority = tasksRaw ? byLabel(["low", "medium", "high", "critical"].map((priority) => [priority.replace(/\b\w/g, (letter) => letter.toUpperCase()), filteredTasks.filter((row) => active(row) && text(row.priority) === priority).length, `/c/tidemark-va/tasks?priority=${priority}`])) : undefined;
  const billingTrend = invoicesRaw ? monthlySeries(filteredInvoices.filter(active), (row) => row.issue_date || row.created_at, (row) => numeric(row.total), window) : undefined;
  const collectionsTrend = paymentsRaw ? monthlySeries(filteredPayments.filter((row) => active(row) && text(row.status) === "succeeded"), (row) => row.payment_date || row.created_at, (row) => numeric(row.amount), window) : undefined;
  const clientGrowth = clientsRaw ? monthlySeries(filteredClients, (row) => row.created_at, () => 1, window) : undefined;
  const workload = clientsRaw && (providersRaw || cliniciansRaw) ? [...filteredProviders.map((person) => ({ label: name(person), value: filteredAssignments.filter((assignment) => text(assignment.provider_id) === text(person.id)).length, href: `/c/tidemark-va/providers/${text(person.id)}` })), ...filteredClinicians.map((person) => ({ label: name(person), value: filteredAssignments.filter((assignment) => text(assignment.clinician_id) === text(person.id)).length, href: `/c/tidemark-va/clinicians/${text(person.id)}` }))].filter((point) => point.value > 0).sort((a, b) => b.value - a.value).slice(0, 12) : undefined;
  const attention = [
    arRaw && overdue.length ? { label: "Overdue invoices", value: String(overdue.length), href: "/c/tidemark-va/ar?bucket=overdue", tone: "danger" } : null,
    arRaw && outstanding.some((row) => text(row.aging_bucket) === "90_plus") ? { label: "90+ day AR", value: currency.format(outstanding.filter((row) => text(row.aging_bucket) === "90_plus").reduce((sum, row) => sum + numeric(row.balance_due), 0)), href: "/c/tidemark-va/ar?bucket=90_plus", tone: "warning" } : null,
    credentialsRaw && credentialCount("Expired") ? { label: "Expired credentials", value: String(credentialCount("Expired")), href: "/c/tidemark-va/credentialing?health=expired", tone: "danger" } : null,
    tasksRaw && taskMetrics.blocked ? { label: "Blocked tasks", value: String(taskMetrics.blocked), href: "/c/tidemark-va/tasks?status=blocked", tone: "warning" } : null,
    automation?.failedRuns ? { label: "Failed automation runs", value: String(automation.failedRuns), href: "/c/tidemark-va/automation?tab=runs", tone: "danger" } : null,
    automation?.aiAwaitingReview ? { label: "AI drafts awaiting review", value: String(automation.aiAwaitingReview), href: "/c/tidemark-va/ai", tone: "warning" } : null,
    automation?.communicationsAwaitingApproval ? { label: "Communications awaiting approval", value: String(automation.communicationsAwaitingApproval), href: "/c/tidemark-va/automation?tab=communications", tone: "warning" } : null,
  ].filter((item) => item !== null) as DashboardCard[];
  return { cards, charts: { clientStatus, arAging, invoiceStatus, credentialHealth: credentialHealthChart, taskStatus, taskPriority, billingTrend, collectionsTrend, clientGrowth, workload }, attention, filters: { ...filters, from: filters.range === "custom" ? filters.from : window.fromText, to: filters.range === "custom" ? filters.to : window.toText }, filterOptions: { workspaces: workspaces.filter(active).map((row) => ({ id: text(row.id), label: text(row.name) })), clients: clients.filter(active).map((row) => ({ id: text(row.id), label: text(row.name) })), providers: providers.filter(active).map((row) => ({ id: text(row.id), label: name(row) })), clinicians: clinicians.filter(active).map((row) => ({ id: text(row.id), label: name(row) })), statuses: unique(clients.filter(active).map((row) => text(row.status)).filter(Boolean)).sort() }, unavailable: unique(unavailable), automation };
}

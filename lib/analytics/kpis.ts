import { agingBucket } from "../finance/invoice";

export type TaskMetricInput = { status: string; due_at: string | null; archived_at?: string | null };
export type CredentialMetricInput = { expiration_date: string | null; archived_at?: string | null };
export type ArMetricInput = { balance_due: number | string; due_date: string | null; aging_bucket?: string | null };

const startOfDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const dayStart = (value: string | null) => value ? Date.parse(`${value.slice(0, 10)}T00:00:00Z`) : Number.NaN;

export function credentialHealth(expirationDate: string | null, now = new Date()) {
  const expiry = dayStart(expirationDate); if (Number.isNaN(expiry)) return "Missing date";
  const days = Math.floor((expiry - startOfDay(now).getTime()) / 86_400_000);
  if (days < 0) return "Expired"; if (days <= 30) return "≤30 days"; if (days <= 60) return "31–60 days"; if (days <= 90) return "61–90 days"; return "Current";
}

export function summarizeTaskMetrics(tasks: TaskMetricInput[], now = new Date()) {
  const today = startOfDay(now); const weekEnd = new Date(today); weekEnd.setUTCDate(weekEnd.getUTCDate() + (7 - ((weekEnd.getUTCDay() + 6) % 7)));
  const active = tasks.filter((task) => !task.archived_at); const open = active.filter((task) => task.status !== "done");
  return { open: open.length, overdue: open.filter((task) => { const due = dayStart(task.due_at); return !Number.isNaN(due) && due < today.getTime(); }).length, dueThisWeek: open.filter((task) => { const due = dayStart(task.due_at); return !Number.isNaN(due) && due >= today.getTime() && due < weekEnd.getTime(); }).length, blocked: open.filter((task) => task.status === "blocked").length };
}

export function summarizeArMetrics(rows: ArMetricInput[], now = new Date()) {
  const today = startOfDay(now); const outstanding = rows.filter((row) => Number(row.balance_due) > 0);
  return { outstanding: outstanding.length, total: outstanding.reduce((sum, row) => sum + Number(row.balance_due), 0), overdue: outstanding.filter((row) => { const due = dayStart(row.due_date); return !Number.isNaN(due) && due < today.getTime(); }).length, ninetyPlus: outstanding.filter((row) => (row.aging_bucket ?? agingBucket(Number(row.balance_due), row.due_date, now)) === "90_plus").reduce((sum, row) => sum + Number(row.balance_due), 0) };
}

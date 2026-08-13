import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/authz/guard";
import { userRest } from "@/lib/db/rest";
import { agingBucket } from "@/lib/finance/invoice";

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
type ArRow = { id: string; invoice_number: string; due_date: string | null; balance_due: number; aging_bucket?: string };
const buckets = ["current", "1_30", "31_60", "61_90", "90_plus"] as const;

export default async function ArPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ bucket?: string }> }) {
  const { companySlug } = await params; const { bucket = "" } = await searchParams;
  if (companySlug !== "tidemark-va") notFound();
  const supabase = await createClient(); const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).maybeSingle();
  if (!company) notFound(); await assertPermission(company.id, "ar.read");
  let rows: ArRow[] = []; let error = "";
  try { rows = await userRest<ArRow[]>("GET", "ar_aging", { query: { select: "id,invoice_number,due_date,balance_due,aging_bucket", company_id: `eq.${company.id}`, order: "due_date.asc" } }); }
  catch { error = "AR is unavailable until the VA operational migration is applied."; }
  const normalized = rows.map((row) => ({ ...row, bucket: row.aging_bucket ?? agingBucket(Number(row.balance_due), row.due_date) }));
  const filtered = normalized.filter((row) => bucket === "overdue" ? row.bucket !== "current" && row.bucket !== "settled" : bucket ? row.bucket === bucket : true);
  return <main className="shell"><div className="page-head"><div><h1>Accounts receivable</h1><p className="muted">Outstanding balances, grouped by due-date aging. Aging basis is documented as configurable pending business approval.</p>{bucket && <p className="muted">Filtered to: {bucket.replaceAll("_", "–")}</p>}</div><a className="btn" href={`/api/va/export?companyId=${company.id}&resource=ar`}>Export CSV</a></div>{error ? <p className="error">{error}</p> : <><div className="grid">{buckets.map((item) => { const total = normalized.filter((row) => row.bucket === item).reduce((sum, row) => sum + Number(row.balance_due), 0); return <a className="card" href={`/c/${companySlug}/ar?bucket=${item}`} key={item}><strong>{item.replace("_", "–")}</strong><p>{fmt.format(total)}</p></a>; })}</div><section className="card table-wrap"><table><thead><tr><th>Invoice</th><th>Due date</th><th>Balance</th><th>Bucket</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{row.invoice_number}</td><td>{row.due_date ?? "—"}</td><td>{fmt.format(Number(row.balance_due))}</td><td>{row.bucket}</td></tr>)}</tbody></table>{filtered.length === 0 && <p className="muted">No outstanding balances match this filter.</p>}</section></>}</main>;
}

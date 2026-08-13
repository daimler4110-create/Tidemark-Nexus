import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/authz/guard";
import { userRest } from "@/lib/db/rest";
import { displayNameFor, humanName } from "@/lib/va/display";

const resources: Record<string, { table: string; permission: string; title: string }> = { providers: { table: "providers", permission: "providers.read", title: "Provider" }, clinicians: { table: "clinicians", permission: "clinicians.read", title: "Clinician" }, credentialing: { table: "credentials", permission: "credentials.read", title: "Credential" }, invoices: { table: "invoice_financials", permission: "invoices.read", title: "Invoice" }, payments: { table: "payments", permission: "payments.read", title: "Payment" }, payroll: { table: "pay_periods", permission: "payroll.read", title: "Pay period" } };

export default async function VaRecordPage({ params }: { params: Promise<{ companySlug: string; module: string; recordId: string }> }) {
  const { companySlug, module, recordId } = await params; const resource = resources[module]; if (!resource || companySlug !== "tidemark-va") notFound();
  const supabase = await createClient(); const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).maybeSingle(); if (!company) notFound(); await assertPermission(company.id, resource.permission);
  let rows: Array<Record<string, unknown>> = []; let loadError = "";
  try { rows = await userRest<Array<Record<string, unknown>>>("GET", resource.table, { query: { select: "*", id: `eq.${recordId}`, company_id: `eq.${company.id}` } }); } catch { loadError = "This record could not be loaded. Verify the VA operational migration has been applied."; }
  const record = rows[0]; if (!record && !loadError) notFound();
  let holderName: string | null = null;
  if (record && module === "credentialing") {
    const holderId = typeof record.provider_id === "string" ? record.provider_id : typeof record.clinician_id === "string" ? record.clinician_id : null;
    const table = typeof record.provider_id === "string" ? "providers" : "clinicians";
    if (holderId) {
      const holders = await userRest<Array<Record<string, unknown>>>("GET", table, { query: { select: "id,display_name,first_name,middle_name,last_name", id: `eq.${holderId}`, company_id: `eq.${company.id}` } }).catch(() => []);
      holderName = humanName(holders[0]);
    }
  }
  const title = record ? displayNameFor(resource.table === "credentials" ? "credentials" : module, { ...record, holder_display_name: holderName }) : resource.title;
  return <main className="shell"><Link href={`/c/${companySlug}/${module}`}>← Back to {module}</Link><section className="card" style={{marginTop:16}}><h1>{title}</h1>{loadError ? <p className="error">{loadError}</p> : <dl className="detail-grid">{holderName && <div><dt>Credential holder</dt><dd>{holderName}</dd></div>}{Object.entries(record).filter(([key]) => !["company_id","archived_at","holder_display_name"].includes(key)).map(([key,value]) => <div key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{value == null ? "—" : String(value)}</dd></div>)}</dl>}</section><section className="card"><h2>Activity and documents</h2><p className="muted">Activities and private document metadata are tenant-scoped in the VA foundation. Record-specific upload/activity forms are the next VA interaction increment.</p></section></main>;
}

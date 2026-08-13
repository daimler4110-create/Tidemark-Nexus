import Link from "next/link";

export type Client360Data = {
  client: Record<string, unknown>;
  contacts: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  providers: Array<Record<string, unknown>>;
  clinicians: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>> | null;
  calendarEvents: Array<Record<string, unknown>> | null;
  documents: Array<Record<string, unknown>> | null;
  billableRecords: Array<Record<string, unknown>> | null;
  invoices: Array<Record<string, unknown>> | null;
  payments: Array<Record<string, unknown>> | null;
  arBalance: number | null;
  ownerName: string | null;
};

const value = (item: unknown) => item == null || item === "" ? "—" : Array.isArray(item) ? item.join(", ") || "—" : String(item);
const personName = (person: Record<string, unknown>) => typeof person.display_name === "string" && person.display_name ? person.display_name : [person.first_name, person.last_name].filter(Boolean).join(" ") || "Unnamed record";

export function Client360({ companyId, companySlug, data }: { companyId: string; companySlug: string; data: Client360Data }) {
  const { client, contacts, assignments, providers, clinicians, activities, calendarEvents, documents, billableRecords, invoices, payments, arBalance, ownerName } = data;
  const primary = contacts.find((contact) => contact.is_primary === true);
  const providerNames = assignments.flatMap((assignment) => providers.filter((provider) => provider.id === assignment.provider_id).map(personName));
  const clinicianNames = assignments.flatMap((assignment) => clinicians.filter((clinician) => clinician.id === assignment.clinician_id).map(personName));
  const info: Array<[string, unknown]> = [["Client name", client.name], ["Legal name", client.legal_name], ["Status", client.status], ["Client type", client.client_type], ["Address", [client.address_line_1, client.address_line_2, client.city, client.state_region, client.postal_code].filter(Boolean).join(", ")], ["Start date", client.start_date], ["End date", client.end_date], ["Referral source", client.referral_source], ["Owner / assigned staff", ownerName], ["Tags", client.tags], ["Notes", client.notes]];
  const activityRows = activities ?? [];
  const financialRows: Array<[string, unknown]> = [["Billing records", billableRecords?.length], ["Invoices", invoices?.length], ["Payments", payments?.length], ["AR balance", arBalance == null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(arBalance)]];
  return <main className="shell"><Link href={`/c/${companySlug}/clients`}>← Back to clients</Link><div className="page-head" style={{ marginTop: 16 }}><div><h1>{value(client.name)}</h1><p className="muted">Client 360 — authorized operational records for this Tidemark VA client.</p></div><Link className="btn" href={`/c/${companySlug}/clients`}>Manage clients</Link></div><div className="grid"><section className="card"><h2>Client information</h2><dl className="detail-grid">{info.map(([label, item]) => <div key={label}><dt>{label}</dt><dd>{value(item)}</dd></div>)}</dl></section><section className="card"><h2>Primary contact</h2>{primary ? <dl className="detail-grid"><div><dt>Name</dt><dd>{value(`${primary.first_name ?? ""} ${primary.last_name === "—" ? "" : primary.last_name ?? ""}`.trim())}</dd></div><div><dt>Email</dt><dd>{value(primary.email)}</dd></div><div><dt>Phone</dt><dd>{value(primary.phone)}</dd></div></dl> : <p className="muted">No primary contact recorded.</p>}<h3>Other contacts</h3>{contacts.filter((contact) => !contact.is_primary).length ? <ul>{contacts.filter((contact) => !contact.is_primary).map((contact) => <li key={String(contact.id)}>{value(`${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim())} <span className="muted">{[contact.email, contact.phone].filter(Boolean).join(" · ")}</span></li>)}</ul> : <p className="muted">No other contacts recorded.</p>}</section><section className="card"><h2>Assigned care team</h2><p><strong>Providers:</strong> {providerNames.join(", ") || "—"}</p><p><strong>Clinicians:</strong> {clinicianNames.join(", ") || "—"}</p></section><section className="card"><h2>Activities & history</h2>{activities === null ? <p className="muted">Activity access is not granted.</p> : activityRows.length ? <ul>{activityRows.map((activity) => <li key={String(activity.id)}><strong>{value(activity.title)}</strong> <span className="muted">{value(activity.activity_type)} · {activity.completed_at ? "Completed" : "Open"}</span></li>)}</ul> : <p className="muted">No client activities yet.</p>}<p className="muted">Tasks are not implemented in the current data model.</p></section><section className="card"><h2>Calendar & documents</h2><p><strong>Calendar events:</strong> {calendarEvents === null ? "Not authorized" : calendarEvents.length}</p><p><strong>Documents:</strong> {documents === null ? "Not authorized" : documents.length}</p>{documents && documents.length > 0 && <ul>{documents.slice(0, 5).map((document) => <li key={String(document.id)}><a href={`/api/documents/${document.id}/download?companyId=${companyId}`}>{value(document.file_name)}</a></li>)}</ul>}</section><section className="card"><h2>Billing & accounts receivable</h2><dl className="detail-grid">{financialRows.map(([label, item]) => <div key={label}><dt>{label}</dt><dd>{value(item)}</dd></div>)}</dl>{invoices && invoices.length > 0 && <ul>{invoices.slice(0, 5).map((invoice) => <li key={String(invoice.id)}>{value(invoice.invoice_number)} — {value(invoice.status)} — {value(invoice.total)}</li>)}</ul>}</section></div></main>;
}

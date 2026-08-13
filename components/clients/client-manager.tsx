"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Client = { id: string; name: string; legal_name: string | null; status: string; client_type: string | null; email: string | null; phone: string | null; address_line_1: string | null; address_line_2: string | null; city: string | null; state_region: string | null; postal_code: string | null; start_date: string | null; end_date: string | null; referral_source: string | null; owner_id: string | null; workspace_id: string | null; tags: string[]; notes: string | null; created_at: string };
type Contact = { id: string; client_id: string; first_name: string; last_name: string; email: string | null; phone: string | null; is_primary: boolean };
type Assignment = { id: string; client_id: string; provider_id: string | null; clinician_id: string | null };
type Option = { id: string; name?: string; display_name?: string | null; first_name?: string; last_name?: string; email?: string };
type ClientData = { clients: Client[]; contacts: Contact[]; assignments: Assignment[]; workspaces: Array<{ id: string; name: string }>; owners: Array<{ id: string; display_name: string | null; email: string }>; providers: Option[]; clinicians: Option[] };
type Form = { name: string; legal_name: string; status: string; client_type: string; primary_contact: { id: string; name: string; email: string; phone: string }; address_line_1: string; address_line_2: string; city: string; state_region: string; postal_code: string; start_date: string; end_date: string; referral_source: string; owner_id: string; workspace_id: string; tags: string; notes: string; provider_ids: string[]; clinician_ids: string[] };

const emptyForm = (): Form => ({ name: "", legal_name: "", status: "active", client_type: "", primary_contact: { id: "", name: "", email: "", phone: "" }, address_line_1: "", address_line_2: "", city: "", state_region: "", postal_code: "", start_date: "", end_date: "", referral_source: "", owner_id: "", workspace_id: "", tags: "", notes: "", provider_ids: [], clinician_ids: [] });
const personName = (person: Option) => person.display_name || [person.first_name, person.last_name].filter(Boolean).join(" ") || person.email || "Unnamed staff member";

export function ClientManager({ companyId, companySlug, canCreate, canUpdate, canArchive, canDelete }: { companyId: string; companySlug: string; canCreate: boolean; canUpdate: boolean; canArchive: boolean; canDelete: boolean }) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<ClientData | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const requestData = async () => {
    const response = await fetch(`/api/clients?companyId=${companyId}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Could not load clients.");
    return payload as ClientData;
  };

  useEffect(() => {
    let active = true;
    fetch(`/api/clients?companyId=${companyId}`).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => {
      if (!active) return;
      if (!response.ok) setError(payload.error ?? "Could not load clients.");
      else setData(payload as ClientData);
      setLoading(false);
    }).catch(() => { if (active) { setError("Could not load clients."); setLoading(false); } });
    return () => { active = false; };
  }, [companyId]);

  const primaryContact = (clientId: string) => data?.contacts.find((contact) => contact.client_id === clientId && contact.is_primary) ?? null;
  const assignmentSummary = (clientId: string) => {
    const assignments = data?.assignments.filter((assignment) => assignment.client_id === clientId) ?? [];
    const providers = assignments.flatMap((assignment) => data?.providers.filter((person) => person.id === assignment.provider_id).map(personName) ?? []);
    const clinicians = assignments.flatMap((assignment) => data?.clinicians.filter((person) => person.id === assignment.clinician_id).map(personName) ?? []);
    return [...providers, ...clinicians].join(" · ") || "—";
  };
  const workspaceName = (workspaceId: string | null) => data?.workspaces.find((item) => item.id === workspaceId)?.name ?? "Company-wide";

  const visible = (data?.clients ?? []).filter((client) => {
    const contact = primaryContact(client.id);
    const text = [client.name, client.legal_name, client.email, client.phone, contact?.first_name, contact?.last_name, contact?.email, contact?.phone, assignmentSummary(client.id)].filter(Boolean).join(" ").toLowerCase();
    return text.includes(query.toLowerCase()) && (!status || client.status === status) && (!workspace || client.workspace_id === workspace);
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setError(""); };
  const openEdit = (client: Client) => {
    const contact = primaryContact(client.id);
    const assignments = data?.assignments.filter((assignment) => assignment.client_id === client.id) ?? [];
    setEditing(client);
    setForm({ name: client.name, legal_name: client.legal_name ?? "", status: client.status, client_type: client.client_type ?? "", primary_contact: { id: contact?.id ?? "", name: contact ? `${contact.first_name} ${contact.last_name === "—" ? "" : contact.last_name}`.trim() : "", email: contact?.email ?? "", phone: contact?.phone ?? "" }, address_line_1: client.address_line_1 ?? "", address_line_2: client.address_line_2 ?? "", city: client.city ?? "", state_region: client.state_region ?? "", postal_code: client.postal_code ?? "", start_date: client.start_date ?? "", end_date: client.end_date ?? "", referral_source: client.referral_source ?? "", owner_id: client.owner_id ?? "", workspace_id: client.workspace_id ?? "", tags: (client.tags ?? []).join(", "), notes: client.notes ?? "", provider_ids: assignments.flatMap((assignment) => assignment.provider_id ? [assignment.provider_id] : []), clinician_ids: assignments.flatMap((assignment) => assignment.clinician_id ? [assignment.clinician_id] : []) });
    setError("");
  };
  const toggle = (field: "provider_ids" | "clinician_ids", id: string) => setForm((current) => current ? { ...current, [field]: current[field].includes(id) ? current[field].filter((value) => value !== id) : [...current[field], id] } : current);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setError("");
    const url = editing ? `/api/clients/${editing.id}` : "/api/clients";
    const response = await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, data: form }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Client could not be saved."); return; }
    setForm(null); setEditing(null);
    try { setData(await requestData()); } catch (reason) { setError(reason instanceof Error ? reason.message : "Client saved but list refresh failed."); }
  };
  const archive = async (client: Client) => {
    if (!confirm(`Archive ${client.name}? Archive preserves client history and is reversible.`)) return;
    const response = await fetch(`/api/clients/${client.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, archive: true }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Client could not be archived."); return; }
    requestData().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Client archived but list refresh failed."));
  };
  const remove = async (client: Client) => {
    const confirmation = prompt(`Delete Permanently removes ${client.name} forever. Archive preserves history. Type DELETE to continue.`);
    if (confirmation !== "DELETE") return;
    const response = await fetch("/api/va/clients", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, id: client.id, confirmation }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Client could not be permanently deleted."); return; }
    requestData().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Client deleted but list refresh failed."));
  };

  const statuses = [...new Set((data?.clients ?? []).map((client) => client.status))];
  return <main className="shell"><div className="page-head"><div><h1>Clients</h1><p className="muted">Client records, primary contacts, and assignments are stored in the existing tenant-scoped operational model.</p></div>{canCreate && <button className="btn" onClick={openCreate}>Add client</button>}</div>{error && <p role="alert" className="error">{error}</p>}{form && <form className="card form-grid" onSubmit={save}><h2>{editing ? `Edit ${editing.name}` : "Add client"}</h2><label className="field">Client Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label><label className="field">Legal Name<input value={form.legal_name} onChange={(event) => setForm({ ...form, legal_name: event.target.value })}/></label><label className="field">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="active">Active</option><option value="prospect">Prospect</option><option value="inactive">Inactive</option></select></label><label className="field">Client Type<input value={form.client_type} onChange={(event) => setForm({ ...form, client_type: event.target.value })}/></label><h3 className="form-section">Primary contact</h3><label className="field">Primary Contact Name<input value={form.primary_contact.name} onChange={(event) => setForm({ ...form, primary_contact: { ...form.primary_contact, name: event.target.value } })}/></label><label className="field">Primary Contact Email<input type="email" value={form.primary_contact.email} onChange={(event) => setForm({ ...form, primary_contact: { ...form.primary_contact, email: event.target.value } })}/></label><label className="field">Primary Contact Phone<input type="tel" value={form.primary_contact.phone} onChange={(event) => setForm({ ...form, primary_contact: { ...form.primary_contact, phone: event.target.value } })}/></label><h3 className="form-section">Client details</h3><label className="field">Address<input value={form.address_line_1} onChange={(event) => setForm({ ...form, address_line_1: event.target.value })}/></label><label className="field">Address line 2<input value={form.address_line_2} onChange={(event) => setForm({ ...form, address_line_2: event.target.value })}/></label><label className="field">City<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })}/></label><label className="field">State<input value={form.state_region} onChange={(event) => setForm({ ...form, state_region: event.target.value })}/></label><label className="field">ZIP<input value={form.postal_code} onChange={(event) => setForm({ ...form, postal_code: event.target.value })}/></label><label className="field">Start Date<input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })}/></label><label className="field">End Date<input type="date" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })}/></label><label className="field">Referral Source<input value={form.referral_source} onChange={(event) => setForm({ ...form, referral_source: event.target.value })}/></label><label className="field">Owner / Assigned Staff<select value={form.owner_id} onChange={(event) => setForm({ ...form, owner_id: event.target.value })}><option value="">No owner</option>{data?.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.display_name || owner.email}</option>)}</select></label><label className="field">Workspace<select value={form.workspace_id} onChange={(event) => setForm({ ...form, workspace_id: event.target.value })}><option value="">Company-wide</option>{data?.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Tags<input value={form.tags} placeholder="Comma-separated tags" onChange={(event) => setForm({ ...form, tags: event.target.value })}/></label><label className="field form-wide">Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}/></label><fieldset className="assignment-field"><legend>Assigned providers</legend>{data?.providers.length ? data.providers.map((provider) => <label key={provider.id}><input type="checkbox" checked={form.provider_ids.includes(provider.id)} onChange={() => toggle("provider_ids", provider.id)}/> {personName(provider)}</label>) : <span className="muted">No active providers available.</span>}</fieldset><fieldset className="assignment-field"><legend>Assigned clinicians</legend>{data?.clinicians.length ? data.clinicians.map((clinician) => <label key={clinician.id}><input type="checkbox" checked={form.clinician_ids.includes(clinician.id)} onChange={() => toggle("clinician_ids", clinician.id)}/> {personName(clinician)}</label>) : <span className="muted">No active clinicians available.</span>}</fieldset><div className="actions"><button className="btn">Save client</button><button type="button" onClick={() => { setForm(null); setEditing(null); }}>Cancel</button></div></form>}<section className="card"><div className="toolbar"><input aria-label="Search clients" placeholder="Search clients, contacts, and assignments" value={query} onChange={(event) => setQuery(event.target.value)}/><select aria-label="Filter client status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filter workspace" value={workspace} onChange={(event) => setWorkspace(event.target.value)}><option value="">All workspaces</option>{data?.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="muted">{visible.length} client(s)</span></div>{loading ? <p>Loading…</p> : visible.length === 0 ? <p className="muted">No clients match this view.</p> : <div className="table-wrap"><table><thead><tr><th>Client Name</th><th>Status</th><th>Primary Contact</th><th>Email</th><th>Phone</th><th>Assigned Provider / Clinician</th><th>Created</th><th>Actions</th></tr></thead><tbody>{visible.map((client) => { const contact = primaryContact(client.id); return <tr key={client.id}><td><strong>{client.name}</strong>{client.legal_name && <><br /><span className="muted">{client.legal_name}</span></>}<br /><span className="muted">{workspaceName(client.workspace_id)}</span></td><td>{client.status}</td><td>{contact ? `${contact.first_name} ${contact.last_name === "—" ? "" : contact.last_name}`.trim() : "—"}</td><td>{contact?.email ?? client.email ?? "—"}</td><td>{contact?.phone ?? client.phone ?? "—"}</td><td>{assignmentSummary(client.id)}</td><td>{new Date(client.created_at).toLocaleDateString()}</td><td className="row-actions"><Link href={`/c/${companySlug}/clients/${client.id}`}>View</Link>{canUpdate && <button onClick={() => openEdit(client)}>Edit</button>}{canArchive && <button onClick={() => archive(client)}>Archive</button>}{canDelete && <button className="delete-action" onClick={() => remove(client)}>Delete Permanently</button>}</td></tr>; })}</tbody></table></div>}</section></main>;
}

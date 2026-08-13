"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

export type CrmClient = { id: string; name: string; status: string; email: string | null; phone: string | null; workspace_id: string | null };
export type CrmContact = { id: string; client_id: string; first_name: string; last_name: string; title: string | null; email: string | null; phone: string | null; is_primary: boolean };
export type CrmActivity = { id: string; subject_id: string; subject_type: string; activity_type: string; title: string; due_at: string | null; completed_at: string | null; created_at: string };

export function CrmOverview({ companySlug, clients, contacts, activities, activitiesAvailable }: { companySlug: string; clients: CrmClient[]; contacts: CrmContact[]; activities: CrmActivity[]; activitiesAvailable: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const visibleClients = useMemo(() => clients.filter((client) => {
    const relatedContacts = contacts.filter((contact) => contact.client_id === client.id);
    const text = [client.name, client.email, client.phone, ...relatedContacts.flatMap((contact) => [contact.first_name, contact.last_name, contact.email, contact.phone])].filter(Boolean).join(" ").toLowerCase();
    return text.includes(query.toLowerCase()) && (!status || client.status === status);
  }), [clients, contacts, query, status]);
  const statuses = [...new Set(clients.map((client) => client.status))];
  const recentActivities = activities.slice().sort((a, b) => String(b.due_at ?? b.created_at).localeCompare(String(a.due_at ?? a.created_at))).slice(0, 8);
  const clientName = (id: string) => clients.find((client) => client.id === id)?.name ?? "Operational record";

  return <main className="shell"><div className="page-head"><div><h1>CRM</h1><p className="muted">A unified, authorized view of existing client, contact, and activity records.</p></div><Link className="btn" href={`/c/${companySlug}/clients`}>Manage clients</Link></div><section className="card"><div className="toolbar"><input aria-label="Search CRM" placeholder="Search clients and contacts" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filter client status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select><span className="muted">{visibleClients.length} client(s)</span></div>{visibleClients.length === 0 ? <p className="muted">No authorized clients or contacts match this view.</p> : <div className="table-wrap"><table><thead><tr><th>Client</th><th>Status</th><th>Contacts</th><th>Contact details</th></tr></thead><tbody>{visibleClients.map((client) => { const clientContacts = contacts.filter((contact) => contact.client_id === client.id); return <tr key={client.id}><td><Link href={`/c/${companySlug}/clients/${client.id}`}>{client.name}</Link><br /><span className="muted">{client.email ?? client.phone ?? "No client contact details"}</span></td><td>{client.status}</td><td>{clientContacts.length}</td><td>{clientContacts.length === 0 ? "—" : clientContacts.map((contact) => <div key={contact.id}><strong>{contact.first_name} {contact.last_name}</strong>{contact.is_primary ? " (primary)" : ""}<br /><span className="muted">{[contact.title, contact.email, contact.phone].filter(Boolean).join(" · ")}</span></div>)}</td></tr>; })}</tbody></table></div>}</section><section className="card"><h2>Recent activities</h2>{!activitiesAvailable ? <p className="muted">You have CRM access, but not the separate activity-read permission.</p> : recentActivities.length === 0 ? <p className="muted">No authorized activities have been recorded.</p> : <div className="table-wrap"><table><thead><tr><th>Activity</th><th>Record</th><th>Due</th><th>Status</th></tr></thead><tbody>{recentActivities.map((activity) => <tr key={activity.id}><td>{activity.title}<br /><span className="muted">{activity.activity_type}</span></td><td>{activity.subject_type === "client" ? clientName(activity.subject_id) : activity.subject_type}</td><td>{activity.due_at ? new Date(activity.due_at).toLocaleString() : "—"}</td><td>{activity.completed_at ? "Completed" : "Open"}</td></tr>)}</tbody></table></div>}</section></main>;
}

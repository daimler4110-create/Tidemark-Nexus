"use client";

import Link from "next/link";
import { useState } from "react";
import type { Workspace } from "@/lib/db/models";

type ManagedWorkspace = Pick<Workspace, "id" | "name" | "slug" | "archived_at">;
type Draft = Pick<ManagedWorkspace, "name" | "slug">;

export function WorkspaceManager({ companyId, companySlug, workspaces, canManage, canDelete }: { companyId: string; companySlug: string; workspaces: ManagedWorkspace[]; canManage: boolean; canDelete: boolean }) {
  const [rows, setRows] = useState(workspaces);
  const [draft, setDraft] = useState<{ id: string; values: Draft } | null>(null);
  const [error, setError] = useState("");

  const request = async (workspaceId: string, method: "PATCH" | "DELETE", body: Record<string, unknown>) => {
    const response = await fetch(`/api/workspaces/${workspaceId}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, companySlug, ...body }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Workspace request could not be completed.");
    return payload as ManagedWorkspace | { deleted: true };
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    try {
      setError("");
      const updated = await request(draft.id, "PATCH", { data: draft.values }) as ManagedWorkspace;
      setRows((current) => current.map((workspace) => workspace.id === updated.id ? updated : workspace));
      setDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workspace could not be updated.");
    }
  };

  const archive = async (workspace: ManagedWorkspace) => {
    if (!confirm(`Archive ${workspace.name}? This is reversible and preserves its history.`)) return;
    try {
      setError("");
      const updated = await request(workspace.id, "PATCH", { archive: true }) as ManagedWorkspace;
      setRows((current) => current.map((row) => row.id === updated.id ? updated : row));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workspace could not be archived.");
    }
  };

  const remove = async (workspace: ManagedWorkspace) => {
    const confirmation = prompt(`Delete Permanently removes ${workspace.name} forever. Archive preserves history. Type DELETE to continue.`);
    if (confirmation !== "DELETE") return;
    try {
      setError("");
      await request(workspace.id, "DELETE", { confirmation });
      setRows((current) => current.filter((row) => row.id !== workspace.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workspace could not be permanently deleted.");
    }
  };

  return <section className="card"><h2>Workspace management</h2>{error && <p role="alert" className="error">{error}</p>}{draft && <form className="form-grid" onSubmit={save}><h3>Edit workspace</h3><label className="field">Name<input required minLength={2} value={draft.values.name} onChange={(event) => setDraft({ ...draft, values: { ...draft.values, name: event.target.value } })}/></label><label className="field">Slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={draft.values.slug} onChange={(event) => setDraft({ ...draft, values: { ...draft.values, slug: event.target.value } })}/></label><div className="actions"><button className="btn">Save changes</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div></form>}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map((workspace) => <tr key={workspace.id}><td>{workspace.name}</td><td><code>{workspace.slug}</code></td><td>{workspace.archived_at ? "Archived" : "Active"}</td><td className="row-actions"><Link href={`/c/${companySlug}/w/${workspace.id}`}>View</Link>{canManage && !workspace.archived_at && <><button onClick={() => { setDraft({ id: workspace.id, values: { name: workspace.name, slug: workspace.slug } }); setError(""); }}>Edit</button><button onClick={() => archive(workspace)}>Archive</button></>}{canDelete && <button className="delete-action" onClick={() => remove(workspace)}>Delete Permanently</button>}</td></tr>)}</tbody></table></div>{rows.length === 0 && <p className="muted">No workspaces have been created yet.</p>}</section>;
}

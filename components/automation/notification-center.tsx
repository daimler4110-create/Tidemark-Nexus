"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Notification = Record<string, unknown> & { id: string };

export function NotificationCenter({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<Notification[]>([]); const [error, setError] = useState("");
  const load = useCallback(async () => { const response = await fetch(`/api/notifications?companyId=${companyId}`); const body = await response.json() as unknown; if (!response.ok) throw new Error(typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : "Could not load notifications."); setItems(Array.isArray(body) ? body as Notification[] : []); }, [companyId]);
  useEffect(() => { let active = true; const timer = setTimeout(() => { void load().catch((reason) => active && setError(reason instanceof Error ? reason.message : "Could not load notifications.")); }, 0); return () => { active = false; clearTimeout(timer); }; }, [load]);
  const update = async (id: string, action: "read" | "dismiss") => { const response = await fetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, id, action }) }); if (!response.ok) { const body = await response.json() as { error?: string }; setError(body.error ?? "Could not update notification."); return; } await load(); };
  return <main className="shell"><div className="page-head"><div><h1>Notifications</h1><p className="muted">Your authorized operational alerts. Dismissal preserves audit and workflow history.</p></div></div>{error && <p className="error">{error}</p>}<section className="card notification-list">{items.length ? items.map((item) => <article key={item.id} className={`notification ${item.status === "unread" ? "unread" : ""}`}><div><h2>{String(item.title)}</h2><p>{String(item.body ?? "")}</p><small>{item.created_at ? new Date(String(item.created_at)).toLocaleString() : ""} · {String(item.type).replaceAll("_", " ")}</small></div><div className="row-actions">{typeof item.link_path === "string" && item.link_path.startsWith("/") && <Link href={item.link_path}>Open</Link>}{item.status === "unread" && <button onClick={() => void update(item.id, "read")}>Mark read</button>}{item.status !== "dismissed" && <button className="delete-action" onClick={() => void update(item.id, "dismiss")}>Dismiss</button>}</div></article>) : <p className="muted">No notifications.</p>}</section></main>;
}

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { logAuditEvent } from "@/lib/audit/log";
import { userRest } from "@/lib/db/rest";
import { isUuid, zodInputError } from "@/lib/validation/uuid";
import { workspaceSchema } from "@/lib/validation/workspace";

type WorkspaceRow = { id: string; name: string; slug: string; archived_at: string | null };
type Dependency = { dependency: string; record_count: number };

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Workspace request could not be completed.";
  const status = /blocked by protected/i.test(message) ? 409 : /must be|required|valid UUID|not found/i.test(message) ? 400 : 403;
  return NextResponse.json({ error: message }, { status });
}

async function getWorkspace(companyId: string, workspaceId: string) {
  const rows = await userRest<WorkspaceRow[]>("GET", "workspaces", {
    query: { select: "id,name,slug,archived_at", id: `eq.${workspaceId}`, company_id: `eq.${companyId}` },
  });
  return rows[0] ?? null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const body = await request.json().catch(() => null) as { companyId?: string; data?: unknown; archive?: boolean; companySlug?: string } | null;
  const companyId = body?.companyId ?? "";
  if (!isUuid(workspaceId)) return NextResponse.json({ error: "Workspace ID must be a valid UUID." }, { status: 400 });
  if (!isUuid(companyId)) return NextResponse.json({ error: "Company context must be a valid UUID." }, { status: 400 });

  try {
    const user = await requireUser();
    await assertPermission(companyId, "workspace.manage");
    const before = await getWorkspace(companyId, workspaceId);
    if (!before) return NextResponse.json({ error: "Workspace was not found in the selected company." }, { status: 404 });

    let update: { archived_at: string } | { name: string; slug: string };
    if (body?.archive) {
      update = { archived_at: new Date().toISOString() };
    } else {
      const parsed = workspaceSchema.safeParse(body?.data);
      if (!parsed.success) return NextResponse.json({ error: zodInputError(parsed.error) }, { status: 400 });
      update = parsed.data;
    }
    const rows = await userRest<WorkspaceRow[]>("PATCH", "workspaces", {
      query: { id: `eq.${workspaceId}`, company_id: `eq.${companyId}` }, body: update, prefer: "return=representation",
    });
    if (!rows[0]) return NextResponse.json({ error: "Workspace was not found in the selected company." }, { status: 404 });
    await logAuditEvent({ actorId: user.id, companyId, action: body?.archive ? "workspace.archived" : "workspace.updated", resourceType: "workspace", resourceId: workspaceId, before, after: update });
    if (body?.companySlug) {
      revalidatePath(`/c/${body.companySlug}/workspaces`);
      revalidatePath(`/c/${body.companySlug}`);
    }
    return NextResponse.json(rows[0]);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const body = await request.json().catch(() => null) as { companyId?: string; confirmation?: string; companySlug?: string } | null;
  const companyId = body?.companyId ?? "";
  if (!isUuid(workspaceId)) return NextResponse.json({ error: "Workspace ID must be a valid UUID." }, { status: 400 });
  if (!isUuid(companyId)) return NextResponse.json({ error: "Company context must be a valid UUID." }, { status: 400 });
  if (body?.confirmation !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm permanent workspace deletion." }, { status: 400 });

  try {
    const user = await requireUser();
    await assertPermission(companyId, "workspace.delete");
    const before = await getWorkspace(companyId, workspaceId);
    if (!before) return NextResponse.json({ error: "Workspace was not found in the selected company." }, { status: 404 });
    const dependencies = await userRest<Dependency[]>("POST", "rpc/workspace_delete_dependencies", {
      body: { p_workspace_id: workspaceId, p_company_id: companyId },
    });
    if (dependencies.length > 0) {
      const summary = dependencies.map((entry) => `${entry.record_count} ${entry.dependency}`).join(", ");
      return NextResponse.json({ error: `Permanent deletion is blocked because this workspace has protected dependencies: ${summary}. Archive it instead.`, dependencies }, { status: 409 });
    }
    const deleted = await userRest<WorkspaceRow[]>("DELETE", "workspaces", {
      query: { id: `eq.${workspaceId}`, company_id: `eq.${companyId}` }, prefer: "return=representation",
    });
    if (!deleted[0]) return NextResponse.json({ error: "Workspace was not found in the selected company." }, { status: 404 });
    await logAuditEvent({ actorId: user.id, companyId, action: "workspace.deleted", resourceType: "workspace", resourceId: workspaceId, before, after: { permanent: true } });
    if (body?.companySlug) {
      revalidatePath(`/c/${body.companySlug}/workspaces`);
      revalidatePath(`/c/${body.companySlug}`);
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { logAuditEvent } from "@/lib/audit/log";
import { createInvitationSchema } from "@/lib/validation/invitation";
import { createInvitationToken, hashInvitationToken, invitationExpiryDays } from "@/lib/invitations/tokens";

export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = createInvitationSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid invitation payload" }, { status: 400 });
  const input = parsed.data;
  await assertPermission(input.companyId, "users.invite");
  const supabase = await createClient();
  if (input.workspaceId) {
    const { data: workspace } = await supabase.from("workspaces").select("id").eq("id", input.workspaceId).eq("company_id", input.companyId).is("archived_at", null).maybeSingle();
    if (!workspace) return NextResponse.json({ error: "Workspace is outside the selected company" }, { status: 400 });
  }
  const rawToken = createInvitationToken();
  const expiresAt = new Date(Date.now() + invitationExpiryDays * 86_400_000).toISOString();
  const { data: invitation, error } = await supabase.from("invitations").insert({ email: input.email, company_id: input.companyId, workspace_id: input.workspaceId, role_id: input.roleId, invited_by: user.id, created_by: user.id, token_hash: hashInvitationToken(rawToken), expires_at: expiresAt }).select("id,email,company_id,workspace_id,role_id,expires_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const redirectTo = new URL("/auth/callback", process.env.NEXT_PUBLIC_APP_URL!);
  redirectTo.searchParams.set("next", `/accept-invite?token=${encodeURIComponent(rawToken)}`);
  const { error: deliveryError } = await createServiceClient().auth.admin.inviteUserByEmail(input.email, { redirectTo: redirectTo.toString() });
  if (deliveryError) {
    await supabase.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", invitation.id);
    return NextResponse.json({ error: "Supabase could not deliver the invitation email" }, { status: 502 });
  }
  await logAuditEvent({ actorId: user.id, companyId: input.companyId, action: "invitation.created", resourceType: "invitation", resourceId: invitation.id, after: { email: invitation.email, workspaceId: invitation.workspace_id, roleId: invitation.role_id, expiresAt: invitation.expires_at } });
  return NextResponse.json({ invitation, delivery: "sent" }, { status: 201 });
}

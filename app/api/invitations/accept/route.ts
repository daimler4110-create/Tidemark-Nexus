import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { token?: string } | null;
  if (!payload?.token || payload.token.length < 32) return NextResponse.json({ error: "Invalid invitation token" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
  const { error } = await supabase.rpc("accept_invitation", { raw_token: payload.token });
  if (error) return NextResponse.json({ error: "Invitation could not be accepted" }, { status: 400 });
  return NextResponse.json({ accepted: true });
}

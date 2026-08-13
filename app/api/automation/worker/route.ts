import "server-only";
import { NextResponse } from "next/server";
import { runAutomationWorker } from "@/lib/automation/worker";

export async function POST(request: Request) {
  const token = process.env.AUTOMATION_WORKER_TOKEN;
  if (!token) return NextResponse.json({ error: "Automation worker is not configured." }, { status: 503 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (supplied !== token) return NextResponse.json({ error: "Unauthorized worker request." }, { status: 401 });
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "100");
  try { return NextResponse.json(await runAutomationWorker(Number.isFinite(limit) ? limit : 100)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Automation worker failed." }, { status: 500 }); }
}

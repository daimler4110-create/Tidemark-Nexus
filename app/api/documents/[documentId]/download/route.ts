import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { userRest } from "@/lib/db/rest";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/uuid";

export async function GET(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  if (!isUuid(companyId) || !isUuid(documentId)) return NextResponse.json({ error: "Document and company contexts must be valid UUIDs." }, { status: 400 });
  try {
    await requireUser();
    await assertCompanyModuleEnabled(companyId, "documents");
    await assertPermission(companyId, "documents.read");
    const rows = await userRest<Array<{ bucket_id: string; storage_path: string }>>("GET", "documents", { query: { select: "bucket_id,storage_path", id: `eq.${documentId}`, company_id: `eq.${companyId}`, archived_at: "is.null" } });
    const document = rows[0];
    if (!document || document.bucket_id !== "nexus-private") return NextResponse.json({ error: "Document was not found." }, { status: 404 });
    const supabase = await createClient();
    const { data, error } = await supabase.storage.from(document.bucket_id).createSignedUrl(document.storage_path, 60);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? "A signed download URL could not be created.");
    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document is unavailable." }, { status: 403 });
  }
}

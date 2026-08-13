import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { logAuditEvent } from "@/lib/audit/log";
import { userRest } from "@/lib/db/rest";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/uuid";

const bucketId = "nexus-private";
const maxBytes = 25_000_000;
const safeFileName = (name: string) => name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 180) || "document";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const companyId = form?.get("companyId");
  const file = form?.get("file");
  const notes = form?.get("notes");
  if (!isUuid(companyId)) return NextResponse.json({ error: "Company context must be a valid UUID." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a non-empty file to upload." }, { status: 400 });
  if (file.size > maxBytes) return NextResponse.json({ error: "Files must be 25 MB or smaller." }, { status: 400 });
  if (typeof notes !== "string" && notes !== null) return NextResponse.json({ error: "Document notes are invalid." }, { status: 400 });
  try {
    const user = await requireUser();
    await assertCompanyModuleEnabled(companyId, "documents");
    await assertPermission(companyId, "documents.upload");
    const supabase = await createClient();
    const storagePath = `${companyId}/documents/${randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(bucketId).upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) throw new Error(`Private storage upload failed: ${uploadError.message}`);
    try {
      const rows = await userRest<Array<Record<string, unknown>>>("POST", "documents", { body: { company_id: companyId, bucket_id: bucketId, storage_path: storagePath, file_name: safeFileName(file.name), content_type: file.type || null, byte_size: file.size, notes: typeof notes === "string" && notes.trim() ? notes.trim() : null, created_by: user.id }, prefer: "return=representation" });
      const document = rows[0];
      await logAuditEvent({ actorId: user.id, companyId, action: "document.uploaded", resourceType: "document", resourceId: typeof document?.id === "string" ? document.id : undefined, after: { fileName: file.name, byteSize: file.size } });
      return NextResponse.json(document, { status: 201 });
    } catch (error) {
      await supabase.storage.from(bucketId).remove([storagePath]);
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document could not be uploaded." }, { status: 403 });
  }
}

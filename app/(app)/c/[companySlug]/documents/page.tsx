import { notFound } from "next/navigation";
import { DocumentsLibrary, type DocumentRow } from "@/components/documents/documents-library";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { assertPermission } from "@/lib/authz/guard";
import { assertCompanyModuleEnabled } from "@/lib/authz/modules";
import { userRest } from "@/lib/db/rest";
import { createClient } from "@/lib/supabase/server";

export default async function DocumentsPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).maybeSingle();
  if (!company) notFound();
  await assertCompanyModuleEnabled(company.id, "documents");
  await assertPermission(company.id, "documents.read");
  const [permissions, documents] = await Promise.all([
    getGrantedPermissionKeys(company.id),
    userRest<DocumentRow[]>("GET", "documents", { query: { select: "id,file_name,content_type,byte_size,notes,created_at,workspace_id,client_id,provider_id,clinician_id", company_id: `eq.${company.id}`, archived_at: "is.null", order: "created_at.desc" } }),
  ]);
  return <DocumentsLibrary companyId={company.id} initialDocuments={documents} canUpload={permissions.includes("documents.upload")} />;
}

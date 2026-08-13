import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGrantedPermissionKeys } from "@/lib/authz/context";
import { OperationalResource } from "@/components/va/operational-resource";
import { ClientManager } from "@/components/clients/client-manager";
import type { VaResource } from "@/lib/va/presentation";

const modules: Record<string, { resource: VaResource; title: string; read: string; create: string; update: string; archive?: string; delete?: string }> = {
  providers: { resource: "providers", title: "Providers", read: "providers.read", create: "providers.create", update: "providers.update", archive: "providers.archive", delete: "providers.delete" },
  clinicians: { resource: "clinicians", title: "Clinicians", read: "clinicians.read", create: "clinicians.create", update: "clinicians.update", archive: "clinicians.archive", delete: "clinicians.delete" },
  clients: { resource: "clients", title: "Clients", read: "clients.read", create: "clients.create", update: "clients.update", archive: "clients.archive", delete: "clients.delete" },
  credentialing: { resource: "credentials", title: "Credentialing", read: "credentials.read", create: "credentials.create", update: "credentials.update", archive: "credentials.archive", delete: "credentials.delete" },
  billing: { resource: "billing", title: "Billable records", read: "billing.read", create: "billing.create", update: "billing.update" },
  invoices: { resource: "invoices", title: "Invoices", read: "invoices.read", create: "invoices.create", update: "invoices.update" },
  payments: { resource: "payments", title: "Payments", read: "payments.read", create: "payments.create", update: "payments.update" },
  payroll: { resource: "payroll", title: "Pay periods", read: "payroll.read", create: "payroll.create", update: "payroll.update" },
};

export default async function VaModulePage({ params }: { params: Promise<{ companySlug: string; module: string }> }) {
  const { companySlug, module } = await params; const definition = modules[module]; if (!definition || companySlug !== "tidemark-va") notFound();
  const supabase = await createClient(); const { data: company } = await supabase.from("companies").select("id,slug").eq("slug", companySlug).maybeSingle(); if (!company) notFound();
  const permissions = await getGrantedPermissionKeys(company.id); if (!permissions.includes(definition.read)) notFound();
  if (module === "clients") return <ClientManager companyId={company.id} companySlug={companySlug} canCreate={permissions.includes("clients.create")} canUpdate={permissions.includes("clients.update")} canArchive={permissions.includes("clients.archive")} canDelete={permissions.includes("clients.delete")}/>;
  return <OperationalResource resource={definition.resource} title={definition.title} companyId={company.id} companySlug={companySlug} canCreate={permissions.includes(definition.create)} canUpdate={permissions.includes(definition.update)} canArchive={definition.archive ? permissions.includes(definition.archive) : false} canDelete={definition.delete ? permissions.includes(definition.delete) : false}/>;
}

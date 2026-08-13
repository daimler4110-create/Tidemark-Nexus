export type VaModule = "providers" | "clinicians" | "clients" | "credentialing" | "billing" | "invoices" | "payments" | "ar" | "payroll" | "reports";
export const vaModuleMeta: Record<VaModule, { title: string; table?: string; read: string; create?: string; update?: string; archive?: string }> = {
  providers: { title: "Providers", table: "providers", read: "providers.read", create: "providers.create", update: "providers.update", archive: "providers.archive" },
  clinicians: { title: "Clinicians", table: "clinicians", read: "clinicians.read", create: "clinicians.create", update: "clinicians.update", archive: "clinicians.archive" },
  clients: { title: "Clients", table: "clients", read: "clients.read", create: "clients.create", update: "clients.update", archive: "clients.archive" },
  credentialing: { title: "Credentialing", table: "credentials", read: "credentials.read", create: "credentials.create", update: "credentials.update", archive: "credentials.archive" },
  billing: { title: "Billing", table: "billable_records", read: "billing.read", create: "billing.create", update: "billing.update" },
  invoices: { title: "Invoices", table: "invoice_financials", read: "invoices.read", create: "invoices.create", update: "invoices.update" },
  payments: { title: "Payments", table: "payments", read: "payments.read", create: "payments.create", update: "payments.update" },
  ar: { title: "Accounts receivable", table: "ar_aging", read: "ar.read" },
  payroll: { title: "Payroll", table: "pay_periods", read: "payroll.read", create: "payroll.create", update: "payroll.update" },
  reports: { title: "Operational reports", read: "reports.view" },
};

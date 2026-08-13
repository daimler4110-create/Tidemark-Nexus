import Link from "next/link";

const modules: Record<string, { label: string; route: string; anyPermissions?: string[] }> = {
  dashboard: { label: "Dashboard", route: "dashboard" },
  workspaces: { label: "Workspaces", route: "workspaces", anyPermissions: ["workspace.manage", "workspace.delete"] },
  clients: { label: "Clients", route: "clients", anyPermissions: ["clients.read"] },
  crm: { label: "CRM", route: "crm", anyPermissions: ["clients.read"] },
  calendar: { label: "Calendar", route: "calendar", anyPermissions: ["calendar.read"] },
  documents: { label: "Documents", route: "documents", anyPermissions: ["documents.read"] },
  tasks: { label: "Tasks", route: "tasks", anyPermissions: ["tasks.read"] },
  automation: { label: "Automation", route: "automation", anyPermissions: ["automation.read"] },
  ai: { label: "AI Assistant", route: "ai", anyPermissions: ["ai.read"] },
  notifications: { label: "Notifications", route: "notifications", anyPermissions: ["notifications.read"] },
  reports: { label: "Reports", route: "reports", anyPermissions: ["reports.view", "reports.export"] },
  providers: { label: "Providers", route: "providers", anyPermissions: ["providers.read"] },
  clinicians: { label: "Clinicians", route: "clinicians", anyPermissions: ["clinicians.read"] },
  credentialing: { label: "Credentialing", route: "credentialing", anyPermissions: ["credentials.read"] },
  billing: { label: "Billing", route: "billing", anyPermissions: ["billing.read"] },
  invoices: { label: "Invoices", route: "invoices", anyPermissions: ["invoices.read"] },
  ar: { label: "AR", route: "ar", anyPermissions: ["ar.read"] },
  payroll: { label: "Payroll", route: "payroll", anyPermissions: ["payroll.read"] },
};

export function CompanyNavigation({ companySlug, enabledModules, permissionKeys }: { companySlug: string; enabledModules: string[]; permissionKeys: string[] }) {
  return <>{enabledModules.flatMap((key) => { const navigationItem = modules[key]; if (!navigationItem || (navigationItem.anyPermissions && !navigationItem.anyPermissions.some((permission) => permissionKeys.includes(permission)))) return []; return [<Link key={key} href={`/c/${companySlug}/${navigationItem.route}`}>{navigationItem.label}</Link>]; })}</>;
}

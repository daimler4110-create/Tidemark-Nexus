/** Non-secret initial administrator identities approved for Nexus bootstrap. */
export const initialGlobalAdminEmails = [
  "daimler@tidemark.com",
  "bill@tidemark.com",
  "brittainny@tidemarkva.com",
];

export const operatingCompanySlugs = [
  "tidemark-va",
  "tidemark-therapy",
  "mental-health-managed",
];

export const operatingCompanies = [
  { slug: "tidemark-va", name: "Tidemark VA" },
  { slug: "tidemark-therapy", name: "Tidemark Therapy" },
  { slug: "mental-health-managed", name: "Mental Health Managed" },
];

export const corePermissions = [
  ["workspace.manage", "Manage workspaces"], ["users.invite", "Invite users"], ["audit_logs.view", "View audit logs"],
  ["clients.read", "Read clients"], ["clients.create", "Create clients"], ["clients.update", "Update clients"], ["clients.archive", "Archive clients"],
  ["clients.delete", "Permanently delete disposable clients"], ["providers.delete", "Permanently delete disposable providers"], ["clinicians.delete", "Permanently delete disposable clinicians"], ["credentials.delete", "Permanently delete disposable credentials"], ["calendar.delete", "Delete calendar events"],
  ["invoices.read", "Read invoices"], ["invoices.create", "Create invoices"], ["invoices.update", "Update invoices"],
  ["payroll.read", "Read payroll"], ["payroll.create", "Create payroll"], ["payroll.update", "Update payroll"], ["payroll.approve", "Approve payroll"],
  ["credentials.read", "Read credentials"], ["credentials.update", "Update credentials"], ["reports.view", "View reports"], ["reports.export", "Export reports"], ["automation.manage", "Manage automations"],
].map(([key, description]) => ({ key, description }));

export const foundationModules = ["dashboard", "crm", "workspaces", "calendar", "documents", "reports"];

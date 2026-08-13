import { describe, expect, it } from "vitest";

type Membership = { companyId: string; workspaceId: string | null; permissions: string[]; status: "active" | "pending" | "revoked" };
const canAccessCompany = (memberships: Membership[], companyId: string, isGlobalAdmin = false) => isGlobalAdmin || memberships.some((membership) => membership.companyId === companyId && membership.workspaceId === null && membership.status === "active");
const canAccessWorkspace = (memberships: Membership[], companyId: string, workspaceId: string, isGlobalAdmin = false) => isGlobalAdmin || memberships.some((membership) => membership.companyId === companyId && membership.status === "active" && (membership.workspaceId === null || membership.workspaceId === workspaceId));
const canMutate = (memberships: Membership[], companyId: string, permission: string, isGlobalAdmin = false) => isGlobalAdmin || memberships.some((membership) => membership.companyId === companyId && membership.workspaceId === null && membership.status === "active" && membership.permissions.includes(permission));

describe("Phase 1 authorization invariants", () => {
  const vaManager: Membership[] = [{ companyId: "va", workspaceId: null, status: "active", permissions: ["workspace.manage"] }];
  const therapyWorkspaceMember: Membership[] = [{ companyId: "therapy", workspaceId: "therapy-intake", status: "active", permissions: [] }];
  const viewer: Membership[] = [{ companyId: "va", workspaceId: null, status: "active", permissions: ["clients.read"] }];
  it("resolves active company membership", () => expect(canAccessCompany(vaManager, "va")).toBe(true));
  it("denies company ID tampering", () => expect(canAccessCompany(vaManager, "therapy")).toBe(false));
  it("denies workspace ID tampering", () => expect(canAccessWorkspace(therapyWorkspaceMember, "therapy", "therapy-billing")).toBe(false));
  it("allows only an assigned workspace", () => expect(canAccessWorkspace(therapyWorkspaceMember, "therapy", "therapy-intake")).toBe(true));
  it("does not let a viewer mutate restricted resources", () => expect(canMutate(viewer, "va", "workspace.manage")).toBe(false));
  it("allows a global administrator across all company and workspace scopes", () => { expect(canAccessCompany([], "mhm", true)).toBe(true); expect(canAccessWorkspace([], "mhm", "ops", true)).toBe(true); expect(canMutate([], "mhm", "workspace.manage", true)).toBe(true); });
});

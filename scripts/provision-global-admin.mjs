import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { corePermissions, foundationModules, initialGlobalAdminEmails, operatingCompanies } from "./global-admin-bootstrap.mjs";

const envFile = resolve(process.cwd(), ".env.local");

async function loadServerEnvironment() {
  let values;
  try {
    values = parseEnv(await readFile(envFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Missing ${envFile}. Create it from .env.example before provisioning.`);
    throw new Error(`Could not read ${envFile}.`);
  }

  const urlValue = values.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = values.SUPABASE_SECRET_KEY?.trim();
  const missing = [!urlValue && "NEXT_PUBLIC_SUPABASE_URL", !secret && "SUPABASE_SECRET_KEY"].filter(Boolean);
  if (missing.length > 0) throw new Error(`Missing required environment variable(s) in .env.local: ${missing.join(", ")}.`);

  let url;
  try { url = new URL(urlValue); } catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL in .env.local must be a valid https://<project-ref>.supabase.co URL."); }
  if (url.protocol !== "https:" || !/^[a-z0-9][a-z0-9-]*\.supabase\.co$/i.test(url.hostname) || !["", "/"].includes(url.pathname)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL in .env.local must be a normal https://<project-ref>.supabase.co URL.");
  }
  if (!secret.startsWith("sb_secret_")) {
    throw new Error("SUPABASE_SECRET_KEY in .env.local must begin with sb_secret_. Use the project's server-side Secret Key, never the publishable key.");
  }
  return { projectRef: url.hostname.split(".")[0], url: url.origin, secret };
}

function normalizeEmail(value) {
  const email = value?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Provide one valid email address as an argument, for example: npm run provision:global-admin -- daimler@tidemark.com.");
  return email;
}

async function findAuthUserByEmail(supabase, email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      if (error.status === 401) throw new Error("Supabase rejected the server key (401). The .env.local values were loaded directly; the configured key is invalid for this project or has been revoked. No secret value was printed.");
      throw new Error(`Supabase Auth user lookup failed with status ${error.status ?? "unknown"}: ${error.message}`);
    }
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function writeAudit(supabase, companyId, action, resourceId, after) {
  const { error } = await supabase.from("audit_logs").insert({ actor_id: null, company_id: companyId, action, resource_type: "global_admin_bootstrap", resource_id: resourceId, after_data: after });
  if (error) throw new Error(`Audit write failed: ${error.message}`);
}

async function ensureSystemFoundation(supabase) {
  const { data: nexusCompany, error: nexusCheckError } = await supabase.from("companies").select("id").or("slug.eq.nexus,name.eq.Nexus").limit(1);
  if (nexusCheckError) throw new Error(`Could not validate company foundation: ${nexusCheckError.message}`);
  if (nexusCompany.length > 0) throw new Error("A Nexus company row already exists. The bootstrap script will not alter or remove it; resolve this data issue before provisioning.");

  const { data: existingCompanies, error: companyReadError } = await supabase.from("companies").select("id,slug,name").in("slug", operatingCompanies.map((company) => company.slug));
  if (companyReadError) throw new Error(`Could not read operating companies: ${companyReadError.message}`);
  const existingBySlug = new Map(existingCompanies.map((company) => [company.slug, company]));
  const missingCompanies = operatingCompanies.filter((company) => !existingBySlug.has(company.slug));
  if (missingCompanies.length > 0) {
    const { error: companyInsertError } = await supabase.from("companies").insert(missingCompanies);
    if (companyInsertError) throw new Error(`Could not create required operating companies: ${companyInsertError.message}`);
  }
  const { data: companies, error: companyReloadError } = await supabase.from("companies").select("id,slug,name").in("slug", operatingCompanies.map((company) => company.slug));
  if (companyReloadError || !companies || companies.length !== operatingCompanies.length) throw new Error(`Could not resolve all required operating companies: ${companyReloadError?.message ?? "unknown error"}`);

  const { data: roleRows, error: roleReadError } = await supabase.from("roles").select("id,key,company_id").eq("key", "global_admin").is("company_id", null);
  if (roleReadError) throw new Error(`Could not read Global Administrator role: ${roleReadError.message}`);
  if (roleRows.length > 1) throw new Error("Multiple system Global Administrator roles exist. The bootstrap script will not choose between them.");
  if (roleRows.length === 0) {
    const { error: roleInsertError } = await supabase.from("roles").insert({ key: "global_admin", name: "Global Administrator", is_system: true, company_id: null });
    if (roleInsertError) throw new Error(`Could not create Global Administrator role: ${roleInsertError.message}`);
  }
  const { data: globalAdminRole, error: roleReloadError } = await supabase.from("roles").select("id,key,company_id").eq("key", "global_admin").is("company_id", null).single();
  if (roleReloadError || !globalAdminRole) throw new Error(`Could not resolve Global Administrator role: ${roleReloadError?.message ?? "unknown error"}`);

  const { data: existingPermissions, error: permissionReadError } = await supabase.from("permissions").select("id,key").in("key", corePermissions.map((permission) => permission.key));
  if (permissionReadError) throw new Error(`Could not read core permissions: ${permissionReadError.message}`);
  const knownPermissionKeys = new Set(existingPermissions.map((permission) => permission.key));
  const missingPermissions = corePermissions.filter((permission) => !knownPermissionKeys.has(permission.key));
  if (missingPermissions.length > 0) {
    const { error: permissionInsertError } = await supabase.from("permissions").insert(missingPermissions);
    if (permissionInsertError) throw new Error(`Could not create core permissions: ${permissionInsertError.message}`);
  }
  const { data: permissions, error: permissionReloadError } = await supabase.from("permissions").select("id,key");
  if (permissionReloadError || !permissions) throw new Error(`Could not resolve permissions: ${permissionReloadError?.message ?? "unknown error"}`);

  const moduleRows = companies.flatMap((company) => foundationModules.map((moduleKey) => ({ company_id: company.id, module_key: moduleKey, enabled: true, configuration: {} })));
  const { data: existingModules, error: moduleReadError } = await supabase.from("company_modules").select("company_id,module_key").in("company_id", companies.map((company) => company.id));
  if (moduleReadError) throw new Error(`Could not read company modules: ${moduleReadError.message}`);
  const moduleKeys = new Set(existingModules.map((module) => `${module.company_id}:${module.module_key}`));
  const missingModules = moduleRows.filter((module) => !moduleKeys.has(`${module.company_id}:${module.module_key}`));
  if (missingModules.length > 0) {
    const { error: moduleInsertError } = await supabase.from("company_modules").insert(missingModules);
    if (moduleInsertError) throw new Error(`Could not configure required company modules: ${moduleInsertError.message}`);
  }
  return { companies, globalAdminRole, permissions, createdCompanies: missingCompanies.map((company) => company.name), createdPermissions: missingPermissions.length, createdModules: missingModules.length };
}

async function ensureGlobalAdminPermissions(supabase, roleId, permissions) {
  const { data: existing, error } = await supabase.from("role_permissions").select("permission_id").eq("role_id", roleId);
  if (error) throw new Error(`Could not read Global Administrator permissions: ${error.message}`);
  const granted = new Set(existing.map((entry) => entry.permission_id));
  const missing = permissions.filter((permission) => !granted.has(permission.id)).map((permission) => ({ role_id: roleId, permission_id: permission.id }));
  if (missing.length === 0) return 0;
  const { error: insertError } = await supabase.from("role_permissions").insert(missing);
  if (insertError) throw new Error(`Could not grant Global Administrator permissions: ${insertError.message}`);
  return missing.length;
}

async function provisionOne(supabase, prerequisites, email) {
  const user = await findAuthUserByEmail(supabase, email);
  if (!user) throw new Error(`No real Supabase Auth user exists for ${email}. No account was created.`);

  const { data: existingProfile, error: profileReadError } = await supabase.from("profiles").select("id,email,is_global_admin,deactivated_at").eq("id", user.id).maybeSingle();
  if (profileReadError) throw new Error(`Could not read profile for ${email}: ${profileReadError.message}`);
  const profileNeedsUpdate = !existingProfile || existingProfile.email.toLowerCase() !== email || !existingProfile.is_global_admin || existingProfile.deactivated_at !== null;
  if (profileNeedsUpdate) {
    const { error: profileWriteError } = await supabase.from("profiles").upsert({ id: user.id, email, is_global_admin: true, deactivated_at: null }, { onConflict: "id" });
    if (profileWriteError) throw new Error(`Could not create/update profile for ${email}: ${profileWriteError.message}`);
  }

  const membershipResults = [];
  for (const company of prerequisites.companies) {
    const { data: memberships, error: membershipReadError } = await supabase.from("memberships").select("id,role_id,status,archived_at").eq("user_id", user.id).eq("company_id", company.id).is("workspace_id", null);
    if (membershipReadError) throw new Error(`Could not read ${company.name} membership for ${email}: ${membershipReadError.message}`);
    const needsWrite = memberships.length === 0 || memberships.some((membership) => membership.role_id !== prerequisites.globalAdminRole.id || membership.status !== "active" || membership.archived_at !== null);
    if (needsWrite) {
      if (memberships.length === 0) {
        const { error: insertError } = await supabase.from("memberships").insert({ user_id: user.id, company_id: company.id, workspace_id: null, role_id: prerequisites.globalAdminRole.id, status: "active", archived_at: null });
        if (insertError) throw new Error(`Could not create ${company.name} membership for ${email}: ${insertError.message}`);
        membershipResults.push(`${company.name}: created`);
      } else {
        const { error: updateError } = await supabase.from("memberships").update({ role_id: prerequisites.globalAdminRole.id, status: "active", archived_at: null }).eq("user_id", user.id).eq("company_id", company.id).is("workspace_id", null);
        if (updateError) throw new Error(`Could not update ${company.name} membership for ${email}: ${updateError.message}`);
        membershipResults.push(`${company.name}: updated`);
      }
      await writeAudit(supabase, company.id, "global_admin.membership.provisioned", user.id, { email, role: "global_admin", membership: membershipResults.at(-1) });
    } else {
      membershipResults.push(`${company.name}: already active`);
    }
  }
  if (profileNeedsUpdate) await writeAudit(supabase, null, "global_admin.profile.provisioned", user.id, { email, is_global_admin: true });
  return { email, profile: profileNeedsUpdate ? "created/updated" : "already active", memberships: membershipResults };
}

async function main() {
  const environment = await loadServerEnvironment();
  const supabase = createClient(environment.url, environment.secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const prerequisites = await ensureSystemFoundation(supabase);
  const permissionGrants = await ensureGlobalAdminPermissions(supabase, prerequisites.globalAdminRole.id, prerequisites.permissions);
  const requestedEmail = process.argv[2];
  const emails = requestedEmail ? [normalizeEmail(requestedEmail)] : initialGlobalAdminEmails;
  const results = [];
  for (const email of emails) results.push(await provisionOne(supabase, prerequisites, email));
  if (permissionGrants > 0) await writeAudit(supabase, null, "global_admin.permissions.synced", prerequisites.globalAdminRole.id, { permissionsGranted: permissionGrants });
  console.log(`Connected to Supabase project ${environment.projectRef}.`);
  if (prerequisites.createdCompanies.length > 0 || prerequisites.createdPermissions > 0 || prerequisites.createdModules > 0) console.log(`System foundation: companies created ${prerequisites.createdCompanies.length}; permissions created ${prerequisites.createdPermissions}; modules configured ${prerequisites.createdModules}.`);
  for (const result of results) console.log(`${result.email}: profile ${result.profile}; ${result.memberships.join(", ")}.`);
}

await main();

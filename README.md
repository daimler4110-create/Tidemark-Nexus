# Tidemark Nexus — Phase 1 foundation

## What is implemented

- Strict Next.js App Router project with Tailwind and shared Supabase SSR/browser/server-only clients.
- Versioned Supabase foundation migrations for companies, profiles, roles, permissions, memberships, workspaces, invitations, modules, and audit logs.
- RLS enabled on every Phase 1 table, using non-recursive `SECURITY DEFINER` membership/permission helpers.
- Safe seed data for exactly three companies: Tidemark VA, Tidemark Therapy, and Mental Health Managed. Nexus is not a company record.
- Session middleware, real Supabase sign-in/reset/callback/sign-out paths, company-scoped shell, workspace management with Zod validation, server permission check, and audit logging.
- Rule gaps documented without fabricated financial logic.

## Local setup

1. Create a Supabase project and apply `supabase/migrations` in order, then `supabase/seed.sql`.
2. Copy `.env.example` to `.env.local` and add real project values.
3. In Supabase Auth, configure the application callback URL: `http://localhost:3000/auth/callback`.
4. Run `npm install` then `npm run dev`.
5. Provision named global admins only after their real Auth users exist. For each approved real email (Daimler, Bill, or Brittainy), run `NEXUS_GLOBAL_ADMIN_EMAIL=approved-email@example.com npm run provision:global-admin`. The script refuses to create an Auth user.

## Verification

`npm run typecheck`, `npm run lint`, and `npm test` pass in this workspace. Production build was attempted with build-only environment values but this host cannot load Next's SWC Windows binary; see the task handoff for details.

## Deliberately deferred

Invitation email delivery requires a configured transactional email provider and Supabase project credentials. The database model is present; delivery and acceptance completion are Phase 1 integration work once those external settings are available.

## VA operational migration deployment

`supabase/migrations/0004_va_operational_foundation.sql` adds the real Tidemark VA operational schema, tenant/RLS policies, financial and payroll database invariants, private document-bucket policies, and VA permission/module seed data. It has not been pushed by this workspace because `supabase db push` requires a Supabase CLI Personal Access Token; application publishable and secret keys are intentionally not accepted for migration deployment.

After authenticating the Supabase CLI, run:

```powershell
npx supabase login
npx supabase db push
npx supabase gen types typescript --linked --schema public > lib/db/types.ts
```

Then rerun `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

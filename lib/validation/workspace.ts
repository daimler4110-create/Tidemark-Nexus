import { z } from "zod";
export const workspaceSchema = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) });
export const invitationSchema = z.object({ email: z.string().email(), companyId: z.string().uuid(), workspaceId: z.string().uuid().nullable(), roleId: z.string().uuid() });

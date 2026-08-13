import { z } from "zod";
export const createInvitationSchema = z.object({ email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()), companyId: z.string().uuid(), workspaceId: z.string().uuid().nullable(), roleId: z.string().uuid() });

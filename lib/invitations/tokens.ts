import "server-only";
import { createHash, randomBytes } from "node:crypto";
export const invitationExpiryDays = 7;
export const createInvitationToken = () => randomBytes(32).toString("base64url");
export const hashInvitationToken = (token: string) => createHash("sha256").update(token).digest("hex");

import { z } from "zod";
import { optionalUuid } from "@/lib/validation/uuid";

const optionalText = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().max(5_000).nullable());
export const calendarEventSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(300),
  description: optionalText,
  starts_at: z.string().datetime("Start time must be a valid date and time."),
  ends_at: z.string().datetime("End time must be a valid date and time."),
  all_day: z.boolean().default(false),
  status: z.enum(["scheduled", "cancelled", "completed"]),
  workspace_id: optionalUuid("Workspace"),
  client_id: optionalUuid("Client"),
  provider_id: optionalUuid("Provider"),
  clinician_id: optionalUuid("Clinician"),
}).refine((event) => event.ends_at >= event.starts_at, "End time must be on or after start time.");

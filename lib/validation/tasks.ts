import { z } from "zod";
import { optionalUuid } from "./uuid";

const optionalText = z.string().trim().max(10_000).optional().transform((value) => value || null);
const optionalDateTime = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().datetime("Due date must be a valid date and time.").nullable().optional(),
);

export const taskStatuses = ["not_started", "working", "waiting", "blocked", "done"] as const;
export const taskPriorities = ["low", "medium", "high", "critical"] as const;

export const taskSchema = z.object({
  workspace_id: optionalUuid("Workspace"),
  title: z.string().trim().min(1, "Title is required.").max(500),
  description: optionalText,
  status: z.enum(taskStatuses),
  priority: z.enum(taskPriorities),
  assignee_id: optionalUuid("Assignee"),
  due_at: optionalDateTime,
  client_id: optionalUuid("Client"),
  provider_id: optionalUuid("Provider"),
  clinician_id: optionalUuid("Clinician"),
  credential_id: optionalUuid("Credential"),
  invoice_id: optionalUuid("Invoice"),
});

import { z } from "zod";
import { optionalUuid, requiredUuid } from "./uuid";

const optionalText = z.string().trim().max(10_000).optional().transform((value) => value || null);
const jsonPrimitive = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);
export const triggerTypes = ["client_created", "client_status_changed", "task_created", "task_due_soon", "task_overdue", "task_completed", "task_status_changed", "credential_expiring", "credential_expired", "invoice_created", "invoice_due_soon", "invoice_overdue", "payment_posted", "calendar_event_upcoming", "communication_approval_required"] as const;
export const actionTypes = ["create_task", "assign_task", "update_task_status", "create_activity", "create_notification", "prepare_communication", "apply_approved_template", "queue_ai_draft", "update_record_status", "queue_integration_event"] as const;
export const conditionOperators = ["equals", "not_equals", "contains", "is_empty", "is_not_empty", "before_date", "after_date", "within_days", "greater_than", "less_than"] as const;
export const aiRequestTypes = ["draft_client_reply", "rewrite_communication", "summarize_client", "summarize_activities", "summarize_provider", "summarize_clinician", "draft_credential_reminder", "draft_invoice_follow_up", "generate_task_checklist"] as const;

export const conditionSchema = z.object({ field: z.string().trim().min(1).max(100), operator: z.enum(conditionOperators), value: jsonPrimitive.optional() }).superRefine((condition, context) => {
  if (!["is_empty", "is_not_empty"].includes(condition.operator) && condition.value === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "A condition value is required." });
  if (condition.operator === "within_days" && (!Number.isInteger(Number(condition.value)) || Number(condition.value) < 0 || Number(condition.value) > 365)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Within days must be an integer from 0 to 365." });
});

const actionConfiguration = z.object({
  title: optionalText, description: optionalText, body: optionalText, subject: optionalText, recipient: optionalText,
  priority: z.enum(["low", "medium", "high", "critical"]).optional(), due_in_days: z.coerce.number().int().min(0).max(365).optional(),
  assignee_id: optionalUuid("Assignee"), status: z.enum(["not_started", "working", "waiting", "blocked", "done"]).optional(),
  recipient_user_id: optionalUuid("Notification recipient"), notification_type: z.enum(["credential_expiring", "credential_expired", "invoice_overdue", "task_overdue", "automation_failed", "ai_draft_ready", "communication_failed", "payroll_awaiting_review", "general"]).optional(),
  link_path: optionalText, template_id: optionalUuid("Template"), recipient_source: z.enum(["client_primary_contact", "related_provider_email", "related_clinician_email", "credential_holder_email", "task_assignee"]).optional(), request_type: z.enum(aiRequestTypes).optional(),
  integration: z.enum(["webhook", "zapier"]).optional(), event_type: optionalText, workspace_id: optionalUuid("Workspace"),
});

export const automationActionSchema = z.object({ position: z.coerce.number().int().min(1).max(50), action_type: z.enum(actionTypes), configuration: actionConfiguration.default({}) }).superRefine((action, context) => {
  if (action.action_type === "create_task" && !action.configuration.title) context.addIssue({ code: z.ZodIssueCode.custom, path: ["configuration", "title"], message: "Create Task requires a title." });
  if (action.action_type === "create_notification" && !action.configuration.title) context.addIssue({ code: z.ZodIssueCode.custom, path: ["configuration", "title"], message: "Create Notification requires a title." });
  if (action.action_type === "prepare_communication" && ((!action.configuration.recipient && !action.configuration.recipient_source) || !action.configuration.body)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["configuration"], message: "Prepare Communication requires a safe recipient source or recipient and a body." });
  if (action.action_type === "apply_approved_template" && (!action.configuration.template_id || (!action.configuration.recipient && !action.configuration.recipient_source))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["configuration"], message: "Apply Approved Template requires a template and safe recipient source or recipient." });
  if (["prepare_communication", "apply_approved_template"].includes(action.action_type) && action.configuration.recipient_source && !["client_primary_contact", "related_provider_email", "related_clinician_email", "credential_holder_email"].includes(action.configuration.recipient_source)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["configuration", "recipient_source"], message: "Communication recipient source is not supported." });
  if (action.action_type === "create_notification" && action.configuration.recipient_source && action.configuration.recipient_source !== "task_assignee") context.addIssue({ code: z.ZodIssueCode.custom, path: ["configuration", "recipient_source"], message: "Notification recipient source is not supported." });
  if (action.action_type === "assign_task" && !action.configuration.assignee_id) context.addIssue({ code: z.ZodIssueCode.custom, path: ["configuration", "assignee_id"], message: "Assign Task requires an assignee." });
  if (["update_task_status", "update_record_status"].includes(action.action_type) && !action.configuration.status) context.addIssue({ code: z.ZodIssueCode.custom, path: ["configuration", "status"], message: "Update Task Status requires a supported task status." });
});

export const automationRuleSchema = z.object({ workspace_id: optionalUuid("Workspace"), name: z.string().trim().min(1, "Rule name is required.").max(240), description: optionalText, active: z.coerce.boolean().default(false), trigger_type: z.enum(triggerTypes), trigger_resource: z.string().trim().min(1).max(80), conditions: z.array(conditionSchema).max(12).default([]), actions: z.array(automationActionSchema).min(1, "At least one action is required.").max(50) }).superRefine((rule, context) => {
  const positions = rule.actions.map((action) => action.position); if (new Set(positions).size !== positions.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["actions"], message: "Action positions must be unique." });
  const resourceForTrigger: Record<string, string> = { client_created: "client", client_status_changed: "client", task_created: "task", task_due_soon: "task", task_overdue: "task", task_completed: "task", task_status_changed: "task", credential_expiring: "credential", credential_expired: "credential", invoice_created: "invoice", invoice_due_soon: "invoice", invoice_overdue: "invoice", payment_posted: "payment", calendar_event_upcoming: "calendar_event", communication_approval_required: "communication" };
  if (rule.trigger_resource !== resourceForTrigger[rule.trigger_type]) context.addIssue({ code: z.ZodIssueCode.custom, path: ["trigger_resource"], message: `Trigger resource must be ${resourceForTrigger[rule.trigger_type]}.` });
});

export const templateSchema = z.object({ workspace_id: optionalUuid("Workspace"), name: z.string().trim().min(1).max(240), category: z.enum(["email", "client_reply", "onboarding", "credential_reminder", "invoice_reminder", "task_template", "internal_note", "ai_prompt", "pandadoc_preparation"]), subject: optionalText, body: z.string().trim().min(1, "Template body is required.").max(50_000), active: z.coerce.boolean().default(true) });
export const communicationReviewSchema = z.object({ id: requiredUuid("Communication"), final_body: z.string().trim().min(1).max(50_000), subject: optionalText, action: z.enum(["save", "approve", "queue", "cancel"]) });
export const aiRequestSchema = z.object({ workspace_id: optionalUuid("Workspace"), request_type: z.enum(aiRequestTypes), related_resource_type: z.enum(["client", "provider", "clinician", "credential", "invoice", "task", "activity"]).optional(), related_resource_id: optionalUuid("Related record"), communication_id: optionalUuid("Communication"), template_id: optionalUuid("Template"), input_context: z.record(z.string(), jsonPrimitive).default({}) }).superRefine((request, context) => {
  const hasRelatedType = Boolean(request.related_resource_type); const hasRelatedId = Boolean(request.related_resource_id);
  if (hasRelatedType !== hasRelatedId) context.addIssue({ code: z.ZodIssueCode.custom, path: [hasRelatedType ? "related_resource_id" : "related_resource_type"], message: "Related record type and ID must be provided together." });
  const expectedTypes: Partial<Record<(typeof aiRequestTypes)[number], string[]>> = {
    draft_client_reply: ["client"], summarize_client: ["client"], summarize_provider: ["provider"], summarize_clinician: ["clinician"], summarize_activities: ["client", "activity"], draft_credential_reminder: ["credential"], draft_invoice_follow_up: ["invoice"], generate_task_checklist: ["task"],
  };
  const allowedTypes = expectedTypes[request.request_type];
  if (allowedTypes && !request.related_resource_type) context.addIssue({ code: z.ZodIssueCode.custom, path: ["related_resource_id"], message: "This AI request requires an authorized related record." });
  if (allowedTypes && request.related_resource_type && !allowedTypes.includes(request.related_resource_type)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["related_resource_type"], message: "The selected record type is not supported for this AI request." });
});

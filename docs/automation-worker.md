# Automation worker deployment

`POST /api/automation/worker` is a protected, server-side queue processor. It is deliberately not invoked by a browser tab.

1. Set `AUTOMATION_WORKER_TOKEN` to a long random server-only value in the host's environment.
2. Use Supabase Cron, a platform scheduler, or another protected server scheduler to invoke the endpoint every 5-15 minutes with `Authorization: Bearer <AUTOMATION_WORKER_TOKEN>`.
3. The worker processes database trigger events and scheduled credential, invoice, task, and calendar checks. Database uniqueness keys prevent duplicate task, communication, and AI actions.
4. Configure an adapter only when ready: `AI_PROVIDER_API_URL`/`AI_PROVIDER_API_KEY`, `EMAIL_PROVIDER_WEBHOOK_URL`/`EMAIL_PROVIDER_API_KEY`, optional PandaDoc variables, and webhook secrets. These are server-only; none are prefixed `NEXT_PUBLIC_`.
5. Inbound generic webhooks use `POST /api/integrations/webhook/webhook` (or `/zapier`) with `x-nexus-timestamp` and `x-nexus-signature`. The signature is HMAC-SHA256 of `<timestamp>.<raw-body>` using `WEBHOOK_INBOUND_SECRET`; requests older than five minutes are rejected and `event_id` is deduplicated per company.

Until the relevant adapter settings exist, the application keeps work queued and displays **Not Configured**. It never reports an external send, PandaDoc operation, or AI result that did not occur.

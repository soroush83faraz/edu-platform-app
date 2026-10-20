# workspace

work_item (کارتابل): types, statuses, assignees, watchers, comments, transitions, inbox entries.

Files: `schema.ts` (Drizzle tables, pg schema `workspace`), `dto.ts` (Zod `.strict()` schemas), `repo.ts` (queries; take `tx`), `service.ts` (business rules; `(tx, ctx, input)`), `actions.ts` (Server Actions via `defineAction`), `ui/` (module-specific components).

Automatic follow-up (owner 2026-10-20, docs/workspace.md «یادآوری مهلت و «مرکز درخواست‌ها»»): `reminder-policy.ts` + `deadline-reminders.ts` (deadline reminders, jobs `workspace.scan_deadlines` / `remind_deadline` / `notify_overdue`), `request-sla.ts` + `requests.ts` (the request center: `workspace.request_sla`, job `workspace.check_request_slas`, the managers' list).

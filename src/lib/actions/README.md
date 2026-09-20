# src/lib/actions
`defineAction({ schema, permission, scope }, handler)` — the single gateway every Server Action and Route Handler goes through (session → must_change_password → Zod strict → can() → withTenant → audit). Implemented in the auth block.

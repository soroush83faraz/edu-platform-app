// Shared column helpers for every Drizzle table (added in the DB block):
//   id()         -> uuid primary key, $defaultFn(uuidv7)
//   orgId()      -> organization_id uuid NOT NULL (RLS key)
//   timestamps() -> created_at / updated_at timestamptz UTC
export {};

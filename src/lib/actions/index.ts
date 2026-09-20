// Public surface of the action layer. Modules type their `tx` parameter with `Tx` from HERE (importing
// `@/db/client` is ESLint-blocked outside this folder); the DB itself is only reachable through defineAction.
export type { Tx } from "@/db/client";

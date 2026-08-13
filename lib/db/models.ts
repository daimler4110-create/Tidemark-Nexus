import type { Database } from "@/lib/db/types";

/** Stable application aliases layered on top of Supabase-generated schema types. */
export type Company = Database["public"]["Tables"]["companies"]["Row"];
export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];

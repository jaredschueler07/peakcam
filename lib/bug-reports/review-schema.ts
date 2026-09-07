import { z } from "zod";
export const reportStatus = z.enum(["open", "triaged", "resolved"]);
export const inboxQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), status: z.enum(["open", "triaged", "resolved", "all"]).default("open"), group: z.uuid().optional() });
export const triageSchema = z.object({ revision: z.number().int().min(0), status: reportStatus, note: z.string().trim().max(4000), duplicateOf: z.uuid().nullable() });
export interface InboxReport { id: string; created_at: string; description: string; page_path: string; status: z.infer<typeof reportStatus>; duplicate_of: string | null; revision: number; duplicate_count: number }
export interface ReviewReport extends Omit<InboxReport, "duplicate_count"> { diagnostics: unknown; admin_note: string | null; server_release: string; updated_at: string }

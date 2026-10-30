import { ApiError } from "@smriti/api-client";
import { ApiError as RestError } from "../../../lib/api";

/** The server's stable error code (`pro_required`, `voice_unavailable`, …), or null for anything else. */
export function errorCode(e: unknown): string | null {
  if (e instanceof ApiError || e instanceof RestError) return e.code;
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") return (e as { code: string }).code;
  return null;
}

/** An extra field on the problem body (`reason`, `resets_at`, `min_words`). */
export function problemField(e: unknown, key: string): unknown {
  return e instanceof ApiError ? e.problem[key] : undefined;
}

export function errorStatus(e: unknown): number | null {
  if (e instanceof ApiError || e instanceof RestError) return e.status;
  return null;
}

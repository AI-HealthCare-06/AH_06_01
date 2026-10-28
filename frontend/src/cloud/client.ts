import { createClient } from "@supabase/supabase-js";
import { demoMode } from "../domain/demo-mode";
import config from "../../cloud.config.json";
export const cloudEnabled =
  !demoMode &&
  config.enabled &&
  (import.meta.env.PROD || import.meta.env.VITE_REXRUN_CLOUD === "true");
export const cloudConfig = config;
export const supabase = createClient(config.supabaseUrl, config.publishableKey, {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    // AuthCallbackPage and Android deep links exchange the code explicitly once.
    detectSessionInUrl: false,
  },
});
export class ApiError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}
export async function cloudApi<T>(
  path: string,
  body?: unknown,
  expectedUserId?: string,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new ApiError(401, "로그인이 필요해요.");
  if (expectedUserId && session.user.id !== expectedUserId)
    throw new ApiError(401, "ACCOUNT_CHANGED");
  const result = await fetch(`${config.apiUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const data = await result.json();
  if (!result.ok) throw new ApiError(result.status, data.error ?? "서버 저장에 실패했어요.");
  return data as T;
}

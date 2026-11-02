import { cloudConfig, cloudEnabled, supabase } from "./client";
import { useCloudStore } from "./sync";
import { useSessionStore } from "../stores/session-store";
import { useGameStore } from "../stores/game-store";
import { useBloodPressureStore } from "../stores/blood-pressure-store";
import { synchronizePressure, type PressureTransport } from "../services/blood-pressure-sync";

let started = false;
let generation = 0;
let running = false;
let abort: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
function allowed(owner: string) {
  const cloud = useCloudStore.getState();
  return (
    cloud.ready &&
    cloud.userId === owner &&
    cloud.consent &&
    useSessionStore.getState().active &&
    navigator.onLine
  );
}
function schedule(delay = 350) {
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), delay);
}
async function flush() {
  const owner = useCloudStore.getState().userId;
  if (!owner || !allowed(owner) || running) return;
  if (useBloodPressureStore.getState().owner !== owner) return;
  const epoch = generation;
  const controller = new AbortController();
  abort = controller;
  running = true;
  const current = () => epoch === generation && allowed(owner);
  const rpc = async (name: string, body: unknown) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!current() || session?.user.id !== owner) throw new Error("BP_ACCOUNT_CHANGED");
    // Capture the token belonging to this owner. A subsequent account switch
    // cannot make the Supabase client send another account's token with these commands.
    const result = await fetch(`${cloudConfig.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: cloudConfig.publishableKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    });
    const value = await result.json();
    if (!result.ok) throw new Error(`${value.code ?? "BP_HTTP_ERROR"} ${value.message ?? ""}`);
    return value;
  };
  const transport: PressureTransport = {
    heads: (cursor) => rpc("bp_history_heads", { p_after_key: cursor, p_limit: 200 }),
    append: (commands) => rpc("append_bp_history", { p_commands: commands }),
  };
  try {
    await synchronizePressure(owner, transport, current, useGameStore.getState().game.dailySurveys);
  } finally {
    running = false;
    if (abort === controller) abort = null;
    if (epoch !== generation) schedule();
    else if (current() && useBloodPressureStore.getState().status === "error") schedule(15_000);
    else if (current() && useBloodPressureStore.getState().status === "waiting") schedule();
  }
}
export function startBloodPressureCloud() {
  if (!cloudEnabled || started) return;
  started = true;
  useCloudStore.subscribe((next, prior) => {
    if (
      next.userId !== prior.userId ||
      next.consent !== prior.consent ||
      next.ready !== prior.ready
    ) {
      generation++;
      abort?.abort();
      if (!next.consent && next.userId) useBloodPressureStore.setState({ status: "consent" });
      schedule();
    } else if (next.lastAck !== prior.lastAck) schedule();
  });
  useBloodPressureStore.subscribe((next, prior) => {
    if (
      next.records !== prior.records &&
      next.status !== "syncing" &&
      next.records.some((r) => r.revision === null)
    )
      schedule();
  });
  window.addEventListener("online", () => schedule());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) schedule();
  });
  schedule();
}

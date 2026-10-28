import { notifyUpdateAvailable, startUpdateNotificationRouting } from "./update-notifications";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { create } from "zustand";
import config from "../../mobile-updates.config.json";
import { isNewerVersion, updateBaseUrl, verifyMobileManifest } from "../domain/mobile-update";

type Phase =
  "unconfigured" | "idle" | "checking" | "downloading" | "ready" | "applying" | "offline";
const builtin = import.meta.env.VITE_REXRUN_WEB_VERSION || config.nativeVersion;
export const useMobileUpdateStore = create<{
  phase: Phase;
  currentVersion: string;
  nextVersion: string | null;
  progress: number;
  availableVersion: string | null;
}>(() => ({
  phase: config.projectUrl && config.publicKey ? "idle" : "unconfigured",
  currentVersion: builtin,
  nextVersion: null,
  progress: 0,
  availableVersion: null,
}));

let started: Promise<void> | undefined;
let checking: Promise<void> | undefined;
let lastCheck = 0;
let foreground = true;
let beforeApply = () => {};

export function beforeMobileUpdateApply(handler: () => void) {
  beforeApply = handler;
}

async function applyBundle(id: string, version: string) {
  if (!foreground) {
    useMobileUpdateStore.setState({ phase: "ready", nextVersion: version });
    return;
  }
  useMobileUpdateStore.setState({ phase: "applying", nextVersion: version, progress: 100 });
  // Give the mounted, accessible notice time to paint before replacing the WebView bundle.
  await new Promise((resolve) => setTimeout(resolve, 1800));
  if (!foreground) {
    useMobileUpdateStore.setState({ phase: "ready" });
    return;
  }
  beforeApply();
  await CapacitorUpdater.cancelDelay();
  // Terminal operation: no code after set() is required for success.
  await CapacitorUpdater.set({ id });
}

export function checkMobileUpdates(force = false): Promise<void> {
  if (Capacitor.getPlatform() !== "android" || !config.projectUrl || !config.publicKey)
    return Promise.resolve();
  if (checking) return checking;
  if (useMobileUpdateStore.getState().phase === "applying") return Promise.resolve();
  if (!force && Date.now() - lastCheck < 30_000) return Promise.resolve();
  lastCheck = Date.now();
  checking = (async () => {
    useMobileUpdateStore.setState({ phase: "checking", progress: 0 });
    try {
      const info = await NativeApp.getInfo();
      const current = await CapacitorUpdater.current();
      const currentVersion =
        current.bundle.id === "builtin" || current.bundle.version === "builtin"
          ? builtin
          : current.bundle.version;
      useMobileUpdateStore.setState({ currentVersion });
      const base = updateBaseUrl(config);
      const response = await fetch(
        `${base}/android/${config.channel}/${info.version}/latest.json?t=${Date.now()}`,
        { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) throw new Error("Update check unavailable");
      const text = await response.text();
      if (text.length > 1_100_000) throw new Error("Update manifest too large");
      const release = await verifyMobileManifest(JSON.parse(text), config, info.version);
      if (!isNewerVersion(release.version, currentVersion)) {
        useMobileUpdateStore.setState({ phase: "idle", nextVersion: null, availableVersion: null });
        return;
      }
      useMobileUpdateStore.setState({ availableVersion: release.version });
      void notifyUpdateAvailable(info.version, release.version).catch(() => undefined);
      const { bundles } = await CapacitorUpdater.list();
      const existing = bundles.find((bundle) => bundle.version === release.version);
      // A version rejected by the native watchdog must stay rejected until a new release is published.
      if (existing?.status === "error") throw new Error("Update was rolled back");
      useMobileUpdateStore.setState({ phase: "downloading", nextVersion: release.version });
      const bundle =
        existing && existing.status !== "downloading"
          ? existing
          : await CapacitorUpdater.download({
              url: `${base}/files/${release.files[0].file_hash}`,
              version: release.version,
              manifest: release.files.map(({ file_name, file_hash, download_url }) => ({
                file_name,
                file_hash,
                download_url,
              })),
            });
      await applyBundle(bundle.id, release.version);
    } catch {
      // Keep the current, locally installed bundle usable when offline or verification fails.
      useMobileUpdateStore.setState({ phase: "offline", nextVersion: null });
    }
  })().finally(() => {
    checking = undefined;
  });
  return checking;
}

export function startMobileUpdates(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_REXRUN_DISABLE_UPDATES === "true")
    return Promise.resolve();
  if (Capacitor.getPlatform() !== "android") return Promise.resolve();
  if (started) return started;
  started = (async () => {
    // Never wait for network access before acknowledging a successfully mounted app.
    await CapacitorUpdater.notifyAppReady();
    void startUpdateNotificationRouting().catch(() => undefined);
    await CapacitorUpdater.addListener("download", ({ percent }) => {
      useMobileUpdateStore.setState({ progress: Math.max(0, Math.min(100, percent)) });
    });
    await NativeApp.addListener("appStateChange", ({ isActive }) => {
      foreground = isActive;
      if (isActive) void checkMobileUpdates(true);
    });
    void checkMobileUpdates();
  })().catch(() => {
    useMobileUpdateStore.setState({ phase: "offline" });
  });
  return started;
}

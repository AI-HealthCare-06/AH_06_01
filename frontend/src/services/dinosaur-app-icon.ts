import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { useGameStore } from "../stores/game-store";
import { useSessionStore } from "../stores/session-store";
import { useCloudStore } from "../cloud/sync";

const AppIcon = registerPlugin<{
  setDinosaur(options: { dinosaur: number }): Promise<{ dinosaur: number }>;
}>("DinosaurAppIcon");

let started = false;
let running = false;
let applied = -1;

async function syncIcon() {
  if (running || !useSessionStore.getState().active || !useCloudStore.getState().ready) return;
  running = true;
  try {
    while (useSessionStore.getState().active) {
      const dinosaur = useGameStore.getState().game.dinosaur;
      if (dinosaur === applied) break;
      await AppIcon.setDinosaur({ dinosaur });
      applied = dinosaur;
      // Read again after the native call so rapid taps always finish on the newest selection.
    }
  } catch {
    // Old APKs and web previews stay usable; the new native APK enables launcher changes.
  } finally {
    running = false;
  }
}

export function startDinosaurAppIcon() {
  if (
    started ||
    Capacitor.getPlatform() !== "android" ||
    !Capacitor.isPluginAvailable("DinosaurAppIcon")
  )
    return;
  started = true;
  useGameStore.subscribe((next, previous) => {
    if (next.game.dinosaur !== previous.game.dinosaur) void syncIcon();
  });
  useSessionStore.subscribe(() => void syncIcon());
  useCloudStore.subscribe((next, previous) => {
    if (next.ready !== previous.ready) void syncIcon();
  });
  void NativeApp.addListener("appStateChange", ({ isActive }) => {
    if (isActive) void syncIcon();
  });
  void syncIcon();
}

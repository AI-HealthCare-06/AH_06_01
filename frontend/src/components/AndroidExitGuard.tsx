import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { useGameStore } from "../stores/game-store";
import { capture } from "../cloud/sync";
import { createBackExitHandler } from "../services/back-exit";

export function AndroidExitGuard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const toast = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handler = createBackExitHandler({
      isHome: () => location.pathname === "/home",
      onHome: () => {
        setVisible(false);
        navigate("/home", { replace: true });
      },
      onFirst: () => {
        setVisible(true);
        clearTimeout(timer);
        timer = setTimeout(() => setVisible(false), 2000);
      },
      onExit: () => {
        useGameStore.getState().tick();
        capture();
        void App.exitApp();
      },
    });
    const back = App.addListener("backButton", () => handler.press());
    const lifecycle = App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        handler.reset();
        setVisible(false);
      }
    });
    return () => {
      clearTimeout(timer);
      void back.then((h) => h.remove());
      void lifecycle.then((h) => h.remove());
    };
  }, [location.pathname, navigate]);
  useEffect(() => {
    const node = toast.current;
    if (!node) return;
    if (visible) node.showPopover();
    else if (node.matches(":popover-open")) node.hidePopover();
  }, [visible]);
  if (Capacitor.getPlatform() !== "android") return null;
  return (
    <div
      ref={toast}
      popover="manual"
      role="status"
      aria-live="polite"
      className="android-exit-toast"
    >
      뒤로 버튼을 한 번 더 누르면 앱이 종료돼요.
    </div>
  );
}

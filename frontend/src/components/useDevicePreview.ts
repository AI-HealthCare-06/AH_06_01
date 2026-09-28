import { useSyncExternalStore } from "react";

const desktopInput = "(any-hover: hover) and (any-pointer: fine)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(desktopInput);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function isDesktopWebPreview() {
  // Device chrome belongs to the OS on phones/tablets and in a native wrapper.
  // Viewport width alone must not hide the preview in a narrow desktop panel.
  const runtime = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  const browser = navigator as Navigator & { userAgentData?: { mobile: boolean } };
  const mobileDevice =
    browser.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(browser.userAgent) ||
    (/Mac/i.test(browser.platform) && browser.maxTouchPoints > 1);

  return (
    import.meta.env.VITE_DEVICE_PREVIEW !== "false" &&
    !runtime.Capacitor?.isNativePlatform?.() &&
    !mobileDevice &&
    window.matchMedia(desktopInput).matches
  );
}

export function useDevicePreview() {
  return useSyncExternalStore(subscribe, isDesktopWebPreview, () => false);
}

import { flushSync } from "react-dom";

let activeMotion: { cancel: () => void } | undefined;
let transitionOwner: object | undefined;

export function finishMainTabMotion() {
  activeMotion?.cancel();
}

function animateIncomingTab() {
  const content = document.querySelector<HTMLElement>(".main-screen .main-content");
  if (!content) return;
  const animation = content.animate(
    [
      { opacity: 0.5, transform: "translateX(var(--tab-enter-offset))" },
      { opacity: 1, transform: "translateX(0)" },
    ],
    { duration: 220, easing: "cubic-bezier(0.2, 0.75, 0.25, 1)" },
  );
  const motion = { cancel: () => animation.cancel() };
  activeMotion = motion;
  const clear = () => {
    if (activeMotion === motion) activeMotion = undefined;
  };
  void animation.finished.then(clear, clear);
}

export function navigateMainTab(update: () => void, direction: 1 | -1) {
  finishMainTabMotion();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const root = document.documentElement;
  root.style.setProperty("--tab-enter-offset", `${direction * 36}px`);
  if (!document.startViewTransition) {
    flushSync(update);
    animateIncomingTab();
    return;
  }

  root.dataset.mainTabMotion = direction === 1 ? "next" : "previous";
  // Capture each page once; never mount a second live battle, camera or data query for motion.
  const transition = document.startViewTransition(() => flushSync(update));
  let cancelled = false;
  const motion = {
    cancel: () => {
      cancelled = true;
      transition.skipTransition();
    },
  };
  activeMotion = motion;
  transitionOwner = motion;
  void transition.ready.catch(() => {
    if (!cancelled && activeMotion === motion) animateIncomingTab();
  });
  const clear = () => {
    if (activeMotion === motion) activeMotion = undefined;
    if (transitionOwner === motion) {
      transitionOwner = undefined;
      delete root.dataset.mainTabMotion;
    }
  };
  void transition.finished.then(clear, clear);
}

export function createBackExitHandler({
  onFirst,
  onExit,
  now = Date.now,
  isHome = () => true,
  onHome = () => {},
}: {
  onFirst: () => void;
  onExit: () => void;
  now?: () => number;
  isHome?: () => boolean;
  onHome?: () => void;
}) {
  let last: number | null = null;
  return {
    press() {
      if (!isHome()) {
        last = null;
        onHome();
        return;
      }
      const time = now();
      if (last !== null && time - last >= 0 && time - last < 2000) {
        last = null;
        onExit();
      } else {
        last = time;
        onFirst();
      }
    },
    reset() {
      last = null;
    },
  };
}

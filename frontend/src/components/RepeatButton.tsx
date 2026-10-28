import { useEffect, useRef, type ButtonHTMLAttributes, type Ref } from "react";
export function RepeatButton({
  onRepeat,
  ref,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onRepeat: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const callback = useRef(onRepeat);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerClick = useRef(false);
  useEffect(() => {
    callback.current = onRepeat;
  }, [onRepeat]);
  function stop() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => {
    const stopHold = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    window.addEventListener("blur", stopHold);
    document.addEventListener("visibilitychange", stopHold);
    return () => {
      stopHold();
      window.removeEventListener("blur", stopHold);
      document.removeEventListener("visibilitychange", stopHold);
    };
  }, []);
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      className="repeat-time-button"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        stop();
        pointerClick.current = true;
        callback.current();
        const repeat = () => {
          callback.current();
          timer.current = setTimeout(repeat, 85);
        };
        timer.current = setTimeout(repeat, 350);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onClick={(e) => {
        if (e.detail === 0) {
          callback.current();
          return;
        }
        if (pointerClick.current) {
          pointerClick.current = false;
          return;
        }
        callback.current();
      }}
    />
  );
}

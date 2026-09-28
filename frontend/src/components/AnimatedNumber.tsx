import { useEffect, useRef } from "react";

const plain = new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 0 });
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// The real value remains in the DOM for assistive technology. Only the decorative
// overlay counts up, so animation never changes the underlying game/health data.
export function AnimatedNumber({
  value,
  separator = false,
  delay = 0,
}: {
  value: number;
  separator?: boolean;
  delay?: number;
}) {
  const visual = useRef<HTMLSpanElement>(null);
  const displayed = useRef(0);
  const format = separator ? grouped : plain;

  useEffect(() => {
    const element = visual.current;
    if (!element) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const from = displayed.current;
    const start = performance.now() + delay;

    function paint(next: number) {
      displayed.current = next;
      element!.dataset.value = format.format(next);
    }
    function finish() {
      cancelAnimationFrame(frame);
      paint(value);
    }
    function tick(now: number) {
      const progress = Math.min(1, Math.max(0, (now - start) / 700));
      const eased = 1 - (1 - progress) ** 3;
      paint(Math.round(from + (value - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    function handleMotionChange() {
      if (motion.matches) finish();
    }
    if (motion.matches) finish();
    else frame = requestAnimationFrame(tick);
    motion.addEventListener("change", handleMotionChange);
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", handleMotionChange);
    };
  }, [value, format, delay]);

  return (
    <span className="animated-number">
      <span className="number-final">{format.format(value)}</span>
      <span className="number-visual" ref={visual} data-value="0" aria-hidden="true" />
    </span>
  );
}

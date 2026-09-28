import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

// Only pixel-art scenes use fixed internal coordinates. Page layout uses normal document flow.
export function DesignCanvas({
  width,
  height,
  children,
  className = "",
  label,
}: {
  width: number;
  height: number;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div
      ref={ref}
      className={`design-canvas ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      aria-label={label}
    >
      <div
        className="design-canvas-inner"
        style={{ width, height, transform: `scale(${scale})` } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}

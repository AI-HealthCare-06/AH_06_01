import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

type Item = { id: string; label: string; content: ReactNode; surface?: string };
function center(region: HTMLElement, position: number, behavior: ScrollBehavior) {
  const card = region.children[position] as HTMLElement | undefined;
  if (!card) return;
  const bounds = card.getBoundingClientRect();
  region.scrollTo({
    left:
      region.scrollLeft +
      bounds.left +
      bounds.width / 2 -
      region.getBoundingClientRect().left -
      region.clientWidth / 2,
    behavior,
  });
}
const motion = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";

export function LoopCarousel({
  items,
  index,
  onChange,
  resetKey,
  label,
  pickerClass,
  gridClass,
}: {
  items: Item[];
  index: number;
  onChange: (index: number) => void;
  resetKey: string | number;
  label: string;
  pickerClass: string;
  gridClass: string;
}) {
  const count = items.length;
  const viewport = useRef<HTMLDivElement>(null);
  const userScroll = useRef(false);
  const position = useRef(count + index);
  const selection = useRef<{ resetKey: string | number | null; index: number }>({
    resetKey: null,
    index: -1,
  });
  const target = useRef<number | null>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    horizontal: boolean;
  } | null>(null);
  const suppressClick = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );
  const wrap = (value: number) => ((value % count) + count) % count;
  const cards = [0, 1, 2].flatMap((copy) =>
    items.map((item, i) => ({ item, index: i, position: copy * count + i, copy: copy !== 1 })),
  );
  useLayoutEffect(() => {
    const region = viewport.current;
    if (!region) return;
    const reset = selection.current.resetKey !== resetKey;
    if (!reset && selection.current.index === index) return;
    const destination = reset
      ? count + index
      : [index, count + index, 2 * count + index].reduce((nearest, candidate) =>
          Math.abs(candidate - position.current) < Math.abs(nearest - position.current)
            ? candidate
            : nearest,
        );
    position.current = destination;
    selection.current = { resetKey, index };
    userScroll.current = false;
    target.current = destination;
    center(region, destination, reset ? "instant" : motion());
  }, [count, index, resetKey]);
  const select = (destination: number) => {
    if (!viewport.current) return;
    if (destination < 0 || destination >= count * 3) destination = count + wrap(destination);
    position.current = destination;
    selection.current = { resetKey, index: wrap(destination) };
    target.current = destination;
    userScroll.current = false;
    center(viewport.current, destination, motion());
    onChange(wrap(destination));
  };
  const startScroll = () => {
    userScroll.current = true;
    target.current = null;
  };
  const nearestCard = (region: HTMLElement) => {
    const midpoint = region.getBoundingClientRect().left + region.clientWidth / 2;
    return Array.from(region.children).reduce(
      (best, card, i) => {
        const bounds = card.getBoundingClientRect(),
          distance = Math.abs(bounds.left + bounds.width / 2 - midpoint);
        return distance < best.distance ? { index: i, distance } : best;
      },
      { index: position.current, distance: Infinity },
    );
  };
  const settle = () => {
    const region = viewport.current;
    if (!region || drag.current || (!userScroll.current && target.current === null)) return;
    const nearest = nearestCard(region);
    if (!userScroll.current && (nearest.index !== target.current || nearest.distance > 2)) return;
    const next = wrap(nearest.index);
    userScroll.current = false;
    target.current = null;
    position.current = count + next;
    selection.current = { resetKey, index: next };
    center(region, position.current, "instant");
    if (next !== index) onChange(next);
  };
  const scheduleSettle = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, 140);
  };
  return (
    <div className={pickerClass} data-no-swipe>
      <div
        className={gridClass}
        ref={viewport}
        aria-label={label}
        aria-roledescription="캐러셀"
        style={{ touchAction: "pan-y pinch-zoom" }}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          startScroll();
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            horizontal: false,
          };
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.id !== event.pointerId) return;
          const dx = event.clientX - active.x,
            dy = event.clientY - active.y;
          if (!active.horizontal && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            active.horizontal = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.style.scrollSnapType = "none";
          }
          if (active.horizontal) {
            event.preventDefault();
            event.currentTarget.scrollLeft = active.left - dx;
          }
        }}
        onPointerUp={(event) => {
          const active = drag.current;
          if (!active || active.id !== event.pointerId) return;
          drag.current = null;
          if (active.horizontal) {
            suppressClick.current = event.timeStamp + 400;
            const destination = nearestCard(event.currentTarget).index;
            event.currentTarget.style.scrollSnapType = "";
            select(destination);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          } else scheduleSettle();
        }}
        onPointerCancel={() => {
          drag.current = null;
          if (viewport.current) viewport.current.style.scrollSnapType = "";
          scheduleSettle();
        }}
        onLostPointerCapture={(event) => {
          // Touch starts with implicit capture on the image/button. Transferring
          // capture to the viewport must not cancel the newly claimed drag.
          if (event.target === event.currentTarget && drag.current) {
            drag.current = null;
            if (viewport.current) viewport.current.style.scrollSnapType = "";
            scheduleSettle();
          }
        }}
        onWheel={startScroll}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          select(
            event.key === "Home"
              ? count
              : event.key === "End"
                ? count * 2 - 1
                : position.current + (event.key === "ArrowRight" ? 1 : -1),
          );
        }}
        onScroll={scheduleSettle}
        onScrollEnd={settle}
      >
        {cards.map(({ item, index: i, position: p, copy }) => (
          <button
            type="button"
            key={p}
            className="style-card"
            style={{ background: item.surface }}
            data-equipped={index === i}
            data-skin-id={item.id}
            data-item-id={item.id}
            aria-hidden={copy ? true : undefined}
            tabIndex={copy ? -1 : 0}
            title={item.label}
            aria-label={item.label}
            aria-pressed={copy ? undefined : index === i}
            onMouseDown={copy ? (event) => event.preventDefault() : undefined}
            onClick={(event) => {
              if (event.detail !== 0 && event.timeStamp < suppressClick.current) {
                event.preventDefault();
                return;
              }
              select(p);
            }}
          >
            {item.content}
          </button>
        ))}
      </div>
    </div>
  );
}

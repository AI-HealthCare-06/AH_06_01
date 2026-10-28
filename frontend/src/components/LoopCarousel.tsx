import { useLayoutEffect, useRef, type ReactNode } from "react";

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
  return (
    <div className={pickerClass} data-no-swipe>
      <div
        className={gridClass}
        ref={viewport}
        aria-label={label}
        aria-roledescription="캐러셀"
        onPointerDown={startScroll}
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
        onScrollEnd={() => {
          const region = viewport.current;
          if (!region || (!userScroll.current && target.current === null)) return;
          const midpoint = region.getBoundingClientRect().left + region.clientWidth / 2;
          const nearest = Array.from(region.children).reduce(
            (best, card, i) => {
              const bounds = card.getBoundingClientRect();
              const distance = Math.abs(bounds.left + bounds.width / 2 - midpoint);
              return distance < best.distance ? { index: i, distance } : best;
            },
            { index: position.current, distance: Infinity },
          );
          if (!userScroll.current && (nearest.index !== target.current || nearest.distance > 2))
            return;
          const next = wrap(nearest.index);
          userScroll.current = false;
          target.current = null;
          position.current = count + next;
          selection.current = { resetKey, index: next };
          center(region, position.current, "instant");
          if (next !== index) onChange(next);
        }}
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
            onClick={() => select(p)}
          >
            {item.content}
          </button>
        ))}
      </div>
    </div>
  );
}

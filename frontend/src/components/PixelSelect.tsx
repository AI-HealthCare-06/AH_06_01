import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type OptionHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
};
export function PixelSelect({
  value,
  onValueChange,
  children,
  disabled,
  id,
  className,
  name,
  "aria-label": label,
  "aria-describedby": description,
}: Props) {
  const generated = useId();
  const controlId = id || generated;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      const option = child as React.ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;
      return {
        value: String(option.props.value ?? option.props.children ?? ""),
        label: option.props.children,
        disabled: option.props.disabled === true,
      };
    });
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === String(value)),
  );
  const [active, setActive] = useState(selected);
  useEffect(() => {
    if (!open) return;
    const anchor = trigger.current!.getBoundingClientRect();
    const node = list.current!;
    const below = innerHeight - anchor.bottom - 12;
    const above = anchor.top - (document.documentElement.dataset.platform === "android" ? 40 : 12);
    const down = below >= Math.min(240, above);
    node.style.width = `${Math.min(innerWidth - 24, Math.max(anchor.width, 180))}px`;
    node.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - Math.min(innerWidth - 24, Math.max(anchor.width, 180)) - 12))}px`;
    node.style.maxHeight = `${Math.min(300, Math.max(88, down ? below : above))}px`;
    if (down) {
      node.style.top = `${anchor.bottom + 4}px`;
      node.style.bottom = "auto";
    } else {
      node.style.bottom = `${innerHeight - anchor.top + 4}px`;
      node.style.top = "auto";
    }
    node.showPopover();
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !node.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", resize);
    return () => {
      if (node.matches(":popover-open")) node.hidePopover();
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  useEffect(() => {
    if (open)
      list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }
  function move(delta: number) {
    let index = active;
    for (let i = 0; i < options.length; i++) {
      index = (index + delta + options.length) % options.length;
      if (!options[index].disabled) break;
    }
    setActive(index);
  }
  return (
    <span className={`pixel-select ${className || ""}`} data-no-swipe>
      <button
        ref={trigger}
        id={controlId}
        name={name}
        type="button"
        role="combobox"
        aria-label={label}
        aria-describedby={description}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={controlId + "-list"}
        aria-activedescendant={open ? `${controlId}-option-${active}` : undefined}
        disabled={disabled}
        onClick={() => {
          setActive(selected);
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              setActive(selected);
              setOpen(true);
            } else move(e.key === "ArrowDown" ? 1 : -1);
          } else if (open && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            choose(active);
          } else if (open && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (open && e.key === "Tab") setOpen(false);
          else if (open && (e.key === "Home" || e.key === "End")) {
            e.preventDefault();
            setActive(e.key === "Home" ? 0 : options.length - 1);
          }
        }}
      >
        <span>{options[selected]?.label || "선택해 주세요"}</span>
        <b aria-hidden="true">▾</b>
      </button>
      <div
        ref={list}
        id={controlId + "-list"}
        className="pixel-select-list"
        role="listbox"
        aria-label={label ? label + " 선택 항목" : "선택 항목"}
        popover="manual"
      >
        {options.map((option, index) => (
          <div
            role="option"
            id={`${controlId}-option-${index}`}
            key={option.value}
            data-index={index}
            data-value={option.value}
            aria-selected={option.value === String(value)}
            aria-disabled={option.disabled}
            data-active={active === index}
            onPointerMove={() => setActive(index)}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse") e.preventDefault();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              choose(index);
            }}
          >
            {option.label}
            <span aria-hidden="true">{option.value === String(value) ? "◆" : ""}</span>
          </div>
        ))}
      </div>
    </span>
  );
}

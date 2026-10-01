import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { localDate } from "../domain/calendar";
import { PixelIcon } from "./PixelIcon";

const parse = (value: string) => new Date(`${value}T12:00:00`);
const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const dayOffsets: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};
function inMonth(year: number, month: number, day: number) {
  const last = new Date(year, month + 1, 0, 12).getDate();
  return new Date(year, month, Math.min(day, last), 12);
}

export function PixelDatePicker({
  label,
  value,
  max,
  onChange,
  range,
}: {
  label: string;
  value: string;
  max: string;
  onChange: (value: string) => void;
  range?: { start: string; onChange: (start: string, end: string) => void };
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="pixel-date-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-date={value}
        data-start={range?.start}
        onClick={() => setOpen(true)}
      >
        <span>
          {range
            ? `${range.start.slice(5).replace("-", ".")} ~ ${value.slice(5).replace("-", ".")}`
            : value.replaceAll("-", ".")}
        </span>
        <PixelIcon name="calendar" />
      </button>
      {open && (
        <DateDialog
          label={label}
          value={value}
          max={max}
          range={
            range
              ? {
                  start: range.start,
                  onChange: (start, end) => {
                    range.onChange(start, end);
                    setOpen(false);
                  },
                }
              : undefined
          }
          returnFocusTo={trigger}
          onClose={() => setOpen(false)}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function DateDialog({
  label,
  value,
  max,
  onSelect,
  onClose,
  returnFocusTo,
  range,
}: {
  label: string;
  value: string;
  max: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  range?: { start: string; onChange: (start: string, end: string) => void };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dayFocus = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [month, setMonth] = useState(parse(value));
  const [focused, setFocused] = useState(value);
  const [start, setStart] = useState<string | null>(null);
  const selectDate = (date: string) => {
    if (!range) {
      onSelect(date);
      return;
    }
    if (!start || date < start) setStart(date);
    else range.onChange(start, date);
  };
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const latest = parse(max);
  const today = localDate();
  const first = new Date(year, monthIndex, 1, 12);
  const dates = Array.from(
    { length: 42 },
    (_, i) => new Date(year, monthIndex, 1 - first.getDay() + i, 12),
  );
  const years = Array.from(
    { length: latest.getFullYear() - Math.min(year, latest.getFullYear() - 20) + 1 },
    (_, i) => latest.getFullYear() - i,
  );
  const nextDisabled = localDate(new Date(year, monthIndex + 1, 1, 12)) > max;
  useEffect(() => {
    const node = dialog.current;
    const trigger = returnFocusTo.current;
    node?.showModal();
    dayFocus.current?.focus();
    return () => {
      node?.close();
      trigger?.focus();
    };
  }, [returnFocusTo]);
  useEffect(() => {
    dayFocus.current?.focus();
  }, [focused]);
  const moveFocus = (date: Date) => {
    const next = localDate(date) > max ? latest : date;
    setMonth(next);
    setFocused(localDate(next));
  };
  return (
    <dialog
      ref={dialog}
      className="pixel-date-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      data-no-swipe
    >
      <header>
        <h2 id={titleId}>{label}</h2>
        <button type="button" aria-label="날짜 선택 닫기" onClick={onClose}>
          ×
        </button>
      </header>
      {range && (
        <p className="pixel-date-range-hint" aria-live="polite">
          {start
            ? `${start.replaceAll("-", ".")}부터 · 종료일을 선택하세요`
            : "시작일과 종료일을 차례로 선택하세요"}
        </p>
      )}
      <div className="pixel-date-month">
        <button
          type="button"
          aria-label="이전 달"
          onClick={() => moveFocus(inMonth(year, monthIndex - 1, parse(focused).getDate()))}
        >
          ‹
        </button>
        <select
          aria-label="연도 선택"
          value={year}
          onChange={(event) =>
            moveFocus(inMonth(Number(event.target.value), monthIndex, parse(focused).getDate()))
          }
        >
          {years.map((item) => (
            <option key={item} value={item}>
              {item}년
            </option>
          ))}
        </select>
        <select
          aria-label="월 선택"
          value={monthIndex}
          onChange={(event) =>
            moveFocus(inMonth(year, Number(event.target.value), parse(focused).getDate()))
          }
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option
              key={i}
              value={i}
              disabled={year === latest.getFullYear() && i > latest.getMonth()}
            >
              {i + 1}월
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="다음 달"
          disabled={nextDisabled}
          onClick={() => moveFocus(inMonth(year, monthIndex + 1, parse(focused).getDate()))}
        >
          ›
        </button>
      </div>
      <div className="pixel-date-weekdays" aria-hidden="true">
        {weekdays.map((day, i) => (
          <span key={day} data-weekday={i}>
            {day}
          </span>
        ))}
      </div>
      <div
        className="pixel-date-grid"
        role="group"
        aria-label={`${year}년 ${monthIndex + 1}월 날짜`}
      >
        {dates.map((date) => {
          const key = localDate(date);
          return (
            <button
              key={key}
              type="button"
              ref={key === focused ? dayFocus : undefined}
              data-date={key}
              data-outside={date.getMonth() !== monthIndex}
              data-today={key === today}
              data-weekday={date.getDay()}
              aria-label={`${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`}
              data-in-range={Boolean(
                range && key >= (start ?? range.start) && key <= (start ? focused : value),
              )}
              aria-pressed={
                range ? key === (start ?? range.start) || (!start && key === value) : key === value
              }
              disabled={key > max}
              tabIndex={key === focused ? 0 : -1}
              onFocus={() => setFocused(key)}
              onClick={() => selectDate(key)}
              onKeyDown={(event) => {
                const delta = dayOffsets[event.key];
                if (
                  delta !== undefined ||
                  ["Home", "End", "PageUp", "PageDown"].includes(event.key)
                ) {
                  event.preventDefault();
                  const next = new Date(date);
                  if (delta !== undefined) next.setDate(next.getDate() + delta);
                  else if (event.key === "Home") next.setDate(next.getDate() - next.getDay());
                  else if (event.key === "End") next.setDate(next.getDate() + 6 - next.getDay());
                  else {
                    moveFocus(
                      inMonth(year, monthIndex + (event.key === "PageUp" ? -1 : 1), date.getDate()),
                    );
                    return;
                  }
                  moveFocus(next);
                }
              }}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <footer>
        <button
          type="button"
          disabled={today > max}
          onClick={() => (range ? range.onChange(today, today) : onSelect(today))}
        >
          오늘
        </button>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </footer>
    </dialog>
  );
}

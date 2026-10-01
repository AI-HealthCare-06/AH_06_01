import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { calendarWeek } from "../domain/calendar";
import { questCountOn, type GameState } from "../domain/game";
import { PixelIcon } from "./PixelIcon";

export function QuestCalendar({
  game,
  selected,
  onSelect,
  controls,
}: {
  game: GameState;
  selected: string;
  onSelect?: (date: string) => void;
  controls?: ReactNode;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const help = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const helpId = useId();
  useEffect(() => {
    if (!helpOpen) return;
    const outside = (event: PointerEvent) => {
      if (!help.current?.contains(event.target as Node)) setHelpOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [helpOpen]);
  return (
    <div className="quest-calendar">
      <div className="calendar-toolbar">
        {controls ?? (
          <span>
            {selected.slice(0, 4)}년 {Number(selected.slice(5, 7))}월
          </span>
        )}
        <div className="calendar-help" ref={help}>
          <button
            ref={trigger}
            type="button"
            className="calendar-help-toggle"
            aria-label="달력 달성률 색상 안내"
            aria-expanded={helpOpen}
            aria-controls={helpId}
            aria-describedby={helpOpen ? helpId : undefined}
            onClick={() => setHelpOpen(!helpOpen)}
          >
            <PixelIcon name="alert" />
          </button>
          {helpOpen && (
            <div className="calendar-help-popover" id={helpId} role="tooltip">
              <strong>퀘스트 달성률</strong>
              <p>지난 날짜의 테두리 색상이에요.</p>
              <div className="calendar-key">
                {["0%", "20–40%", "60–80%", "100%"].map((label, i) => (
                  <span key={label} data-completion={i}>
                    <i />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="weekly-calendar" aria-label="주간 달력">
        {calendarWeek(selected).map((day) => {
          const count = questCountOn(game, day.date);
          const tier = count === 5 ? 3 : count >= 3 ? 2 : count >= 1 ? 1 : 0;
          return (
            <button
              key={day.date}
              disabled={day.date > game.date}
              data-past={day.date < game.date}
              data-completion={tier}
              onClick={() => onSelect?.(day.date)}
              aria-pressed={day.date === selected}
              aria-current={day.date === game.date ? "date" : undefined}
              aria-label={`${day.month}월 ${day.day}일 ${day.label}요일${day.date === game.date ? " 오늘" : ""} · 퀘스트 ${count}/5`}
            >
              <span>{day.label}</span>
              <strong>{day.day}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}

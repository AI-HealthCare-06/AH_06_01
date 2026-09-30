import { calendarWeek } from "../domain/calendar";
import { questCountOn, type GameState } from "../domain/game";

export function QuestCalendar({
  game,
  selected,
  onSelect,
}: {
  game: GameState;
  selected: string;
  onSelect?: (date: string) => void;
}) {
  return (
    <div className="quest-calendar">
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
      <div className="calendar-key" aria-label="달력 달성률 색상 안내">
        {["0%", "20–40%", "60–80%", "100%"].map((label, i) => (
          <span key={label} data-completion={i}>
            <i />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

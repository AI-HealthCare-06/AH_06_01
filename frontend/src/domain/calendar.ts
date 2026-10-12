export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calendarWeek(day = localDate()) {
  const [year, month, date] = day.split("-").map(Number);
  const today = new Date(year, month - 1, date, 12);
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  return ["일", "월", "화", "수", "목", "금", "토"].map((label, index) => {
    const current = new Date(sunday);
    current.setDate(sunday.getDate() + index);
    return {
      label,
      date: localDate(current),
      day: current.getDate(),
      month: current.getMonth() + 1,
    };
  });
}

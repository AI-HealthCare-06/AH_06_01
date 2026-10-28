import type { ComponentProps } from "react";
import { Link, useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { AppShell } from "./AppShell";
import { QuestCalendar } from "./QuestCalendar";
import { useGameStore } from "../stores/game-store";

export function DashboardReportShell({
  children,
  calendarDate,
  onSelectDate,
  calendarControls,
  showCalendar = true,
}: ComponentProps<typeof AppShell>) {
  const game = useGameStore((s) => s.game);
  const location = useLocation();
  return (
    <div className="dashboard-report-web dashboard-theme">
      <header className="web-report-toolbar">
        <Link to={`/dashboard${location.search}`}>‹ 요약으로 돌아가기</Link>
        <span>REXRUN · HEALTH REPORT</span>
        {!Capacitor.isNativePlatform() && (
          <button onClick={() => window.print()}>인쇄 / PDF 저장</button>
        )}
      </header>
      <main>
        {showCalendar && (
          <QuestCalendar
            game={game}
            selected={calendarDate ?? game.date}
            onSelect={onSelectDate}
            controls={calendarControls}
          />
        )}
        {children}
      </main>
      <footer>REXRUN · 이 기기의 기록과 데모 참고 정보를 담은 보고서</footer>
    </div>
  );
}

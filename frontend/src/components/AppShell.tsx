import { useRef, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { PaperTexture } from "../design/PaperTexture";
import { useNotice } from "./NoticeProvider";
import { useDevicePreview } from "./useDevicePreview";
import { StatusBar } from "./StatusBar";
import { PixelIcon } from "./PixelIcon";
import { calendarWeek } from "../domain/calendar";
import { useGameStore } from "../stores/game-store";
import { ProfileAvatar } from "./ProfileAvatar";
import { WeatherGreeting } from "./WeatherGreeting";

export type TabName = "home" | "quests" | "camera" | "dashboard" | "shop" | "character";
const destinations = [
  { path: "/shop", label: "Shop", key: "shop" },
  { path: "/character", label: "Character", key: "character" },
  { path: "/home", label: "Home", key: "home" },
  { path: "/camera", label: "Camera", key: "camera" },
  { path: "/dashboard", label: "Dashboard", key: "dashboard" },
] as const;

export function AppShell({ active, children }: { active: TabName; children: ReactNode }) {
  const game = useGameStore((state) => state.game);
  const notice = useNotice();
  const navigate = useNavigate();
  const location = useLocation();
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const devicePreview = useDevicePreview();
  return (
    <div
      className={`mobile-screen main-screen ${active}-screen`}
      data-device-preview={devicePreview}
      onTouchStart={(event) => {
        swipe.current = null;
        if (event.touches.length !== 1 || document.querySelector("dialog[open]")) return;
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select, [role='slider'], [data-no-swipe]")) return;
        const touch = event.touches[0];
        if (touch.clientX < 20 || touch.clientX > window.innerWidth - 20) return;
        swipe.current = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
      }}
      onTouchMove={(event) => {
        const start = swipe.current;
        if (!start) return;
        const touch = Array.from(event.touches).find((item) => item.identifier === start.id);
        if (event.touches.length !== 1 || !touch || Math.abs(touch.clientY - start.y) > 40)
          swipe.current = null;
      }}
      onTouchCancel={() => {
        swipe.current = null;
      }}
      onTouchEnd={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start) return;
        const touch = Array.from(event.changedTouches).find((item) => item.identifier === start.id);
        if (!touch) return;
        const dx = touch.clientX - start.x,
          dy = touch.clientY - start.y;
        const current = destinations.findIndex(
          (tab) => tab.path === location.pathname || location.pathname.startsWith(`${tab.path}/`),
        );
        if (current < 0 || Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.7) return;
        const next = destinations[current + (dx < 0 ? 1 : -1)];
        if (next) navigate(next.path);
      }}
    >
      <PaperTexture />
      {devicePreview && <StatusBar />}
      <header className="greeting">
        <Link to="/me" className="avatar" aria-label="마이페이지">
          <ProfileAvatar />
        </Link>
        <div className="greeting-copy">
          <h1>Hello, Min!</h1>
          <WeatherGreeting />
        </div>
        <button
          className="search-button"
          aria-label="퀘스트 찾기"
          onClick={() => navigate("/quests")}
        >
          <PixelIcon name="document" />
        </button>
        <Link className="menu-button" to="/me" aria-label="메뉴 열기">
          <PixelIcon name="menu" />
        </Link>
      </header>
      {active !== "shop" && active !== "camera" && active !== "character" && (
        <div className="weekly-calendar" aria-label="주간 달력">
          {calendarWeek(game.date).map((day) => (
            <button
              key={day.date}
              onClick={() => {
                notice(
                  day.date === game.date
                    ? "오늘의 퀘스트를 확인해 보세요."
                    : game.completedDates.includes(day.date)
                      ? `${day.month}월 ${day.day}일 · 모든 퀘스트를 완료했어요!`
                      : `${day.month}월 ${day.day}일 · 전체 완료 기록이 없어요.`,
                );
              }}
              aria-pressed={day.date === game.date}
              aria-current={day.date === game.date ? "date" : undefined}
              aria-label={`${day.month}월 ${day.day}일 ${day.label}요일${day.date === game.date ? " 오늘" : ""}`}
            >
              <span>{day.label}</span>
              <strong>{day.day}</strong>
            </button>
          ))}
        </div>
      )}
      <main className="main-content">
        <div className="dark-shell" aria-hidden="true" />
        {children}
      </main>
      <nav className="bottom-navigation" aria-label="주요 메뉴">
        {destinations.map(({ path, label, key }) => (
          <NavLink key={path} to={path}>
            <PixelIcon name={key} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {devicePreview && <div className="home-indicator" aria-hidden="true" />}
    </div>
  );
}

export function ScenarioShell({
  children,
  className = "",
  background,
}: {
  children: ReactNode;
  className?: string;
  background?: string;
  camera?: string;
}) {
  const devicePreview = useDevicePreview();
  return (
    <div
      className={`mobile-screen scenario-screen ${className}`}
      data-device-preview={devicePreview}
    >
      {background && (
        <>
          <img className="scenario-background" src={background} alt="" />
          <div className="background-haze" />
        </>
      )}
      {devicePreview && <StatusBar />}
      <main className="scenario-content">
        <div className="dark-shell" aria-hidden="true" />
        {children}
      </main>
      {devicePreview && <div className="home-indicator" aria-hidden="true" />}
    </div>
  );
}

export function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-heading">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

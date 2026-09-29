import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { assets } from "../design/assets";
import { PaperTexture } from "../design/PaperTexture";
import { useNotice } from "./NoticeProvider";
import { useDevicePreview } from "./useDevicePreview";
import { StatusBar } from "./StatusBar";
import { PixelIcon } from "./PixelIcon";
import { calendarWeek } from "../domain/calendar";
import { useGameStore } from "../stores/game-store";

export type TabName = "home" | "quests" | "camera" | "dashboard" | "shop";
const destinations = [
  { path: "/home", label: "Home", key: "home" },
  { path: "/quests", label: "Quest", key: "quests" },
  { path: "/camera", label: "Camera", key: "camera" },
  { path: "/dashboard", label: "Dashboard", key: "dashboard" },
  { path: "/shop", label: "Shop", key: "shop" },
] as const;

export function AppShell({ active, children }: { active: TabName; children: ReactNode }) {
  const screenAssets = assets[active === "camera" ? "home" : active];
  const game = useGameStore((state) => state.game);
  const notice = useNotice();
  const navigate = useNavigate();
  const devicePreview = useDevicePreview();
  return (
    <div
      className={`mobile-screen main-screen ${active}-screen`}
      data-device-preview={devicePreview}
    >
      <PaperTexture />
      {devicePreview && <StatusBar camera={screenAssets.imgStatusCameraDot} />}
      <header className="greeting">
        <Link to="/me" className="avatar" aria-label="마이페이지">
          <img src={screenAssets.imgAvatarFrame} alt="민 님의 픽셀 아바타" />
        </Link>
        <div className="greeting-copy">
          <h1>Hello, Min!</h1>
          <p>
            오늘도 건강한 하루예요! <PixelIcon name="sun" />
          </p>
        </div>
        <button
          className="search-button"
          aria-label="퀘스트 찾기"
          onClick={() => navigate("/quests")}
        >
          <PixelIcon name="search" />
        </button>
        <Link className="menu-button" to="/me" aria-label="메뉴 열기">
          <PixelIcon name="menu" />
        </Link>
      </header>
      {active !== "shop" && active !== "camera" && (
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
  camera,
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
      {devicePreview && <StatusBar simple camera={camera} />}
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

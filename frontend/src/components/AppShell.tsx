import { useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { assets } from "../design/assets";
import { PaperTexture } from "../design/PaperTexture";
import { useNotice } from "./NoticeProvider";
import { useDevicePreview } from "./useDevicePreview";
import { StatusBar } from "./StatusBar";

export type TabName = "home" | "quests" | "dashboard" | "shop";
const destinations = [
  { path: "/home", label: "Home", key: "imgNavigationItemHomePixelIcon" },
  { path: "/quests", label: "Quest", key: "imgNavigationItemQuestPixelIcon" },
  { path: "/dashboard", label: "Dashboard", key: "imgNavigationItemDashboardPixelIcon" },
  { path: "/shop", label: "Shop", key: "imgNavigationItemShopPixelIcon" },
] as const;

export function AppShell({ active, children }: { active: TabName; children: ReactNode }) {
  const screenAssets = assets[active];
  const [day, setDay] = useState(22);
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
          <p>오늘도 건강한 하루예요! ☀</p>
        </div>
        <button
          className="search-button"
          aria-label="퀘스트 찾기"
          onClick={() => navigate("/quests")}
        >
          <span className="search-icon" aria-hidden="true" />
        </button>
        <Link className="menu-button" to="/me" aria-label="메뉴 열기">
          ☰
        </Link>
      </header>
      {active !== "shop" && (
        <div className="weekly-calendar" aria-label="주간 달력">
          {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((label, index) => (
            <button
              key={label}
              onClick={() => {
                setDay(21 + index);
                if (21 + index !== 22)
                  notice(
                    `${21 + index}일 기록은 아직 없어요. 현재 화면은 Figma의 예시 기록이에요.`,
                  );
              }}
              aria-pressed={day === 21 + index}
              aria-label={`9월 ${21 + index}일`}
            >
              <span>{label}</span>
              <strong>{21 + index}</strong>
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
            <img src={screenAssets[key]} alt="" />
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

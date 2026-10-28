import { DemoModeBanner } from "./DemoModeBanner";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PaperTexture } from "../design/PaperTexture";
import { useDevicePreview } from "./useDevicePreview";
import { StatusBar } from "./StatusBar";
import { PixelIcon } from "./PixelIcon";
import { useBattleFeedbackStore } from "../stores/battle-feedback-store";
import { QuestCalendar } from "./QuestCalendar";
import { useGameStore } from "../stores/game-store";
import { ProfileAvatar } from "./ProfileAvatar";
import { WeatherGreeting } from "./WeatherGreeting";
import { useProfileStore } from "../stores/profile-store";
import { finishMainTabMotion, navigateMainTab } from "../services/main-tab-motion";

export type TabName = "home" | "quests" | "camera" | "dashboard" | "shop" | "character";
const destinations = [
  { path: "/shop", label: "Shop", key: "shop" },
  { path: "/character", label: "Character", key: "character" },
  { path: "/home", label: "Home", key: "home" },
  { path: "/quests", label: "Quest", key: "quests" },
  { path: "/dashboard", label: "Dashboard", key: "dashboard" },
] as const;

export function AppShell({
  active,
  children,
  calendarDate,
  onSelectDate,
  calendarControls,
  showCalendar = true,
}: {
  active: TabName;
  children: ReactNode;
  calendarDate?: string;
  onSelectDate?: (date: string) => void;
  calendarControls?: ReactNode;
  showCalendar?: boolean;
}) {
  const game = useGameStore((state) => state.game);
  const name = useProfileStore((state) => state.profile.name);
  const navigate = useNavigate();
  const mainTab = active === "camera" ? "quests" : active;
  const battleFeedback = useBattleFeedbackStore((s) => s.status);
  const location = useLocation();
  const screen = useRef<HTMLDivElement>(null);
  const devicePreview = useDevicePreview();
  useEffect(() => {
    const region = screen.current;
    if (!region) return;
    let start: { x: number; y: number; id: number; horizontal: boolean } | null = null;
    const cancel = () => {
      start = null;
    };
    const begin = (event: TouchEvent) => {
      cancel();
      if (event.touches.length !== 1 || document.querySelector("dialog[open]")) return;
      const target = event.target;
      const touch = event.touches[0];
      const bounds = region.getBoundingClientRect();
      // Chromium can retarget touches to HTML through the transition cleanup frame.
      // Keep the hit bounded to content and recheck controls below, even after its marker clears.
      const transitionHit =
        target === document.documentElement &&
        touch.clientX >= bounds.left &&
        touch.clientX <= bounds.right &&
        touch.clientY >= bounds.top &&
        touch.clientY <= bounds.bottom;
      if (!(target instanceof Node) || (!region.contains(target) && !transitionHit)) return;
      if (
        transitionHit &&
        Array.from(
          region.querySelectorAll<HTMLElement>(
            "input, textarea, select, [role='slider'], [data-no-swipe]",
          ),
        ).some((element) => {
          const box = element.getBoundingClientRect();
          return (
            touch.clientX >= box.left &&
            touch.clientX <= box.right &&
            touch.clientY >= box.top &&
            touch.clientY <= box.bottom
          );
        })
      )
        return;
      if (
        !(target instanceof Element) ||
        target.closest("input, textarea, select, [role='slider'], [data-no-swipe]")
      )
        return;
      if (touch.clientX < 20 || touch.clientX > window.innerWidth - 20) return;
      finishMainTabMotion();
      start = { x: touch.clientX, y: touch.clientY, id: touch.identifier, horizontal: false };
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === start?.id);
      if (event.touches.length !== 1 || !touch) return cancel();
      const dx = Math.abs(touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      if (!start.horizontal) {
        if (dy > 12 && dy > dx) return cancel();
        if (dx >= 12 && dx > dy * 1.3) start.horizontal = true;
      }
      // React touch listeners are passive. Claim horizontal intent before Android starts a pan.
      // Vertical scroll and opted-out horizontal controls keep their native behavior.
      if (start.horizontal && event.cancelable) event.preventDefault();
    };
    const end = (event: TouchEvent) => {
      const gesture = start;
      cancel();
      if (!gesture) return;
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === gesture.id);
      if (!touch) return;
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      const current = destinations.findIndex(
        (tab) =>
          tab.path === (location.pathname === "/camera" ? "/quests" : location.pathname) ||
          location.pathname.startsWith(`${tab.path}/`),
      );
      if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.7) return;
      // Do not turn a completed swipe into a click on the arriving page.
      if (event.cancelable) event.preventDefault();
      if (current < 0) return;
      const next = destinations[current + (dx < 0 ? 1 : -1)];
      if (next) navigateMainTab(() => navigate(next.path), dx < 0 ? 1 : -1);
    };
    document.addEventListener("touchstart", begin, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end, { passive: false });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", begin);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", cancel);
    };
  }, [location.pathname, navigate]);
  return (
    <div
      ref={screen}
      className={`mobile-screen main-screen ${active}-screen${active === "dashboard" ? " dashboard-theme" : ""}`}
      data-device-preview={devicePreview}
    >
      <PaperTexture />
      {devicePreview && <StatusBar />}
      <header className="greeting">
        <Link to="/me" className="avatar" aria-label="마이페이지">
          <ProfileAvatar />
        </Link>
        <div className="greeting-copy">
          <h1>Hello, {name}!</h1>
          <WeatherGreeting />
        </div>
        <button
          className="medication-header-button"
          aria-label="복용 중인 약 / 영양제 관리"
          onClick={() => navigate("/medications")}
        >
          <PixelIcon name="pill" />
        </button>
        <Link className="menu-button" to="/me" aria-label="메뉴 열기">
          <PixelIcon name="menu" />
        </Link>
      </header>
      <DemoModeBanner />
      {active === "dashboard" && showCalendar && (
        <QuestCalendar
          game={game}
          selected={calendarDate ?? game.date}
          onSelect={onSelectDate}
          controls={calendarControls}
        />
      )}
      <main className="main-content">
        {active === "home" ? (
          <div className="home-content">
            <div className="dark-shell" aria-hidden="true" />
            {children}
          </div>
        ) : (
          <>
            <div className="dark-shell" aria-hidden="true" />
            {children}
          </>
        )}
      </main>
      <nav
        className="bottom-navigation"
        aria-label="주요 메뉴"
        data-battle-status={battleFeedback ?? undefined}
      >
        {destinations.map(({ path, label, key }, index) => (
          <Link
            key={path}
            to={path}
            className={mainTab === key ? "active" : undefined}
            aria-current={mainTab === key ? "page" : undefined}
            data-battle-feedback={key === "home" ? (battleFeedback ?? undefined) : undefined}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              const current = destinations.findIndex((tab) => tab.key === mainTab);
              if (current < 0 || current === index) return;
              event.preventDefault();
              navigateMainTab(() => navigate(path), index > current ? 1 : -1);
            }}
          >
            <>
              <img
                className="pixel-icon navigation-icon"
                src={`/assets/navigation/${key}-${mainTab === key ? "active" : "inactive"}.svg`}
                alt=""
              />
              <span>{label}</span>
              {key === "home" && battleFeedback && (
                <small className="battle-tab-badge" aria-hidden="true">
                  {battleFeedback === "clear" ? "CLEAR" : "DOWN"}
                </small>
              )}
            </>
          </Link>
        ))}
      </nav>
      <span className="battle-status-announcement" role="status" aria-live="polite">
        {battleFeedback === "clear"
          ? "웨이브 클리어"
          : battleFeedback === "defeat"
            ? "캐릭터가 쓰러졌어요. 퀘스트로 힘을 모아 다시 도전해요."
            : ""}
      </span>
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
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ScenarioShell } from "../components/AppShell";
import { DesignCanvas } from "../components/DesignCanvas";
import { useNotice } from "../components/NoticeProvider";
import { assets } from "../design/assets";
import { dinosaurs } from "../design/dinosaurs";
import { useProfileStore } from "../stores/profile-store";
import { useGameStore } from "../stores/game-store";
import { DinosaurArt } from "../components/DinosaurArt";
import { useSessionStore } from "../stores/session-store";

export function LoginPage() {
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();
  const notice = useNotice();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    notice("데모 모험을 시작해요. 이메일과 비밀번호는 전송·저장하지 않아요.");
    useSessionStore.getState().signIn();
    useGameStore.getState().resumeSession();
    navigate(useProfileStore.getState().onboardingCompleted ? "/home" : "/profile");
  }
  return (
    <ScenarioShell
      className="login-screen"
      background={assets.login.imgLoginBackgroundCanyonWaterfall}
      camera={assets.login.imgEllipse}
    >
      <div className="login-hero">
        <DesignCanvas width={354} height={440}>
          <span className="hero-mist" />
          <img
            className="rexrun-logo"
            src={assets.login.imgLoginHeroRexRunBlackLogo}
            alt="REXRUN"
          />
          <img
            className="rexrun-egg"
            src={assets.login.imgLoginHeroRefinedEggSprite}
            alt="초록 무늬 공룡 알"
          />
          <span className="egg-heart">♥</span>
          <p>
            EAT
            <br />
            MOVE
            <br />
            SLEEP
            <br />
            TOGETHER
          </p>
        </DesignCanvas>
      </div>
      <form className="login-form" onSubmit={submit}>
        <h1>WELCOME, ADVENTURER</h1>
        <p>로그인하고 오늘의 모험을 이어가세요.</p>
        <label htmlFor="email">이메일</label>
        <div className="login-input">
          <img src={assets.login.imgLoginFormEmailIcon} alt="" />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue="hello@rexrun.com"
            required
            aria-label="이메일"
          />
        </div>
        <label htmlFor="password">비밀번호</label>
        <div className="login-input password-input">
          <img src={assets.login.imgLoginFormLockIcon} alt="" />
          <input
            id="password"
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            defaultValue="rexrun12"
            minLength={8}
            required
          />
          <button
            type="button"
            aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
            onClick={() => setVisible(!visible)}
          >
            <img src={assets.login.imgLoginFormPasswordVisibility} alt="" />
          </button>
        </div>
        <button className="primary-button login-next" type="submit" aria-label="다음">
          다음<span>›</span>
        </button>
        <Link className="signup-link" to="/profile?mode=signup">
          계정이 없나요? 가입하기 ›
        </Link>
      </form>
    </ScenarioShell>
  );
}

export { ProfileSurvey as ProfilePage } from "./ProfileSurvey";

export function DinosaurPage() {
  const { game, chooseDinosaur } = useGameStore();
  const onboardingCompleted = useProfileStore((s) => s.onboardingCompleted);
  const dino = dinosaurs[game.dinosaur];
  if (onboardingCompleted) return <Navigate to="/home" replace />;
  return (
    <ScenarioShell
      className="dinosaur-screen"
      background={assets.dinosaur.imgDinoSelectBackgroundPixelJungle}
      camera={assets.dinosaur.imgEllipse}
    >
      <header className="scenario-heading">
        <h1>함께할 공룡을 골라주세요</h1>
        <p>공룡마다 다른 건강 능력을 키워요.</p>
      </header>
      <div className="dinosaur-grid" role="group" aria-label="함께할 공룡 선택">
        {dinosaurs.map((d, i) => (
          <button
            className={`dinosaur-card dinosaur-${i} ${game.dinosaur === i ? "selected" : ""}`}
            aria-pressed={game.dinosaur === i}
            key={d.name}
            onClick={() => chooseDinosaur(i)}
          >
            <DinosaurArt dinosaur={i} alt="" />
            <strong>{d.name}</strong>
            <small>{d.trait}</small>
            {game.dinosaur === i && <span>선택</span>}
          </button>
        ))}
      </div>
      <div className="cream-card dinosaur-callout">
        <h2>오늘부터 {dino.name}와 함께해요?</h2>
        <p>매일의 습관이 {dino.name}를 성장시켜요.</p>
      </div>
      <Link className="primary-button dinosaur-start" to="/first-result">
        모험 시작하기
      </Link>
    </ScenarioShell>
  );
}

export function FirstResultPage() {
  const game = useGameStore((s) => s.game);
  const { onboardingCompleted, completeOnboarding } = useProfileStore();
  const dino = dinosaurs[game.dinosaur];
  const a = assets["first-result"];
  if (onboardingCompleted) return <Navigate to="/home" replace />;
  return (
    <ScenarioShell className="first-result-screen" camera={a.imgEllipse}>
      <header className="scenario-heading">
        <h1>첫 건강 위험도</h1>
        <p>건강 모험의 시작 화면을 체험해 보세요.</p>
      </header>
      <div className="dino-scene initial-scene">
        <img className="scene-background" src={a.imgRectangle} alt="초록 숲" />
        <DinosaurArt className="scene-dino" pose="initial" alt={dino.name} />
        <b className="scene-badge">NORMAL STATE</b>
        <strong>Lv.1 {dino.name}</strong>
      </div>
      <div className="cream-card first-risk">
        <h2>고혈압 위험도</h2>
        <strong>약 32%</strong>
        <p>생활습관을 바꾸면 낮아질 수 있어요.</p>
      </div>
      <h2 className="first-quests-title">오늘의 첫 퀘스트</h2>
      <div className="first-quests">
        {[
          { id: "medicine", label: "약 복용 체크", reward: 20 },
          { id: "meal", label: "건강한 한 끼", reward: 30 },
          { id: "walk", label: "6,000걸음 걷기", reward: 50 },
        ].map((q, i) => (
          <Link to={`/quests/${q.id}`} key={q.id} className="cream-card first-quest">
            <span className={`checkbox ${i === 0 ? "checked" : ""}`} />
            <b>{q.label}</b>
            <strong>+{q.reward} EXP</strong>
          </Link>
        ))}
      </div>
      <Link className="primary-button first-start" to="/home" onClick={completeOnboarding}>
        첫 퀘스트 시작하기
      </Link>
      <p className="first-result-note">표시된 위험도는 입력값과 무관한 체험용 예시예요.</p>
    </ScenarioShell>
  );
}

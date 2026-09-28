import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ScenarioShell } from "../components/AppShell";
import { useNotice } from "../components/NoticeProvider";
import { assets } from "../design/assets";
import { quests, questProgress, questProgressLabel } from "../domain/game";
import { InfoDialog } from "../components/InfoDialog";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { dinosaurs } from "../design/dinosaurs";

export function QuestDetailPage() {
  const { id } = useParams();
  const { game, complete } = useGameStore();
  const navigate = useNavigate();
  const q = quests.find((q) => q.id === id);
  if (!q) return <Navigate to="/quests" replace />;
  const done = game.completed.includes(q.id);
  const progress = Math.round(questProgress(game, q) * 100);
  return (
    <ScenarioShell className="quest-detail-screen" camera={assets["quest-detail"].imgEllipse}>
      <Link className="quest-back" to="/quests">
        ← 오늘의 퀘스트
      </Link>
      <div className="quest-detail-heading">
        <span>
          {q.id === "walk" ? "6K" : q.id === "water" ? "8" : q.id === "sleep" ? "7H" : "✓"}
        </span>
        <div>
          <h1>{q.title}</h1>
          <p>
            {done
              ? "오늘 완료했어요"
              : q.id === "walk"
                ? `진행 ${questProgressLabel(game, q).replace("걸음", "")}`
                : questProgressLabel(game, q)}
          </p>
        </div>
      </div>
      <div
        className="detail-track"
        role="progressbar"
        aria-label="퀘스트 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <i style={{ width: `${progress}%` }} />
        <b>{progress}%</b>
      </div>
      <section className="cream-card quest-reason">
        <h2>왜 이 퀘스트인가요?</h2>
        <p>{q.reason}</p>
        {q.id === "walk" && <span>위험도 -0.2%p</span>}
      </section>
      <h2 className="reward-label">완료하면</h2>
      <div className="quest-reward">
        <div>
          <strong>+{q.reward}</strong>
          <b>COIN</b>
        </div>
        <p>{q.id === "walk" ? "체력 +2 민첩 +3" : `경험치 +${q.experience}`}</p>
      </div>
      <button
        className="primary-button complete-quest"
        disabled={done}
        onClick={() => {
          complete(q.id);
          navigate("/reward");
        }}
      >
        {done ? "오늘 완료한 퀘스트예요" : "완료 체크하기"}
      </button>
      <p className="complete-help">직접 완료한 뒤 체크해 주세요.</p>
    </ScenarioShell>
  );
}

export function RewardPage() {
  const game = useGameStore((s) => s.game);
  const dino = dinosaurs[game.dinosaur];
  const reward = game.lastReward;
  return (
    <ScenarioShell className="reward-screen" camera={assets.reward.imgEllipse}>
      <h1>QUEST COMPLETE!</h1>
      <div className="reward-medallion">
        <img src={assets.reward.imgEllipse1} alt="" />
        <img
          className="reward-dino"
          src={game.dinosaur === 0 ? assets.reward.imgRectangle : dino.image}
          alt={dino.name}
        />
      </div>
      <strong className="reward-coins">+{reward?.coins ?? 30} COIN</strong>
      <div className="cream-card reward-stats">
        <h2>{dino.name}가 더 강해졌어요!</h2>
        <div>
          <strong>체력 12 → 14</strong>
          <strong>민첩 8 → 11</strong>
        </div>
        <p>오늘 완료 {game.completed.length} / 5</p>
      </div>
      <Link className="primary-button reward-next" to="/buff">
        강해진 {dino.name} 보기
      </Link>
    </ScenarioShell>
  );
}

export function BuffPage() {
  const game = useGameStore((s) => s.game);
  const dino = dinosaurs[game.dinosaur];
  return (
    <ScenarioShell className="buff-screen" camera={assets.buff.imgEllipse}>
      <header className="scenario-heading">
        <h1>DAILY ADVENTURE</h1>
        <p>BUFF STATE · DAY 1</p>
      </header>
      <div className="dino-scene buff-scene">
        <img className="scene-background" src={assets.buff.imgRectangle} alt="초록 숲" />
        <img
          className="scene-dino"
          src={game.dinosaur === 0 ? assets.buff.imgRectangle1 : dino.image}
          alt={dino.name}
        />
        <b className="scene-badge">BUFF + HEALTH</b>
        <strong>Lv.2 HP 340 / 340</strong>
      </div>
      <div className="cream-card buff-message">
        <h2>좋아요! 몸에 힘이 돌아왔어요.</h2>
        <p>퀘스트를 더 완료하면 버프가 커져요.</p>
      </div>
      <div className="buff-quests">
        {quests.slice(0, 3).map((q) => (
          <Link className="cream-card" to={`/quests/${q.id}`} key={q.id}>
            <b>{q.shortTitle}</b>
            <strong className={game.completed.includes(q.id) ? "green" : "red"}>
              {game.completed.includes(q.id)
                ? "완료"
                : q.id === "walk"
                  ? `${Math.round(questProgress(game, q) * 100)}%`
                  : "진행"}
            </strong>
          </Link>
        ))}
      </div>
      <p className="buff-note">상태는 매일 초기화 · 능력치와 코인은 누적</p>
      <Link className="buff-continue" to="/home">
        오늘의 모험 계속하기
      </Link>
    </ScenarioShell>
  );
}

export function MyPage() {
  const { game, resetDemo } = useGameStore();
  const clearProfile = useProfileStore((s) => s.clear);
  const navigate = useNavigate();
  const notice = useNotice();
  const [resetEnabled, setResetEnabled] = useState(true);
  const [dialog, setDialog] = useState<string | null>(null);
  const [dialogTrigger, setDialogTrigger] = useState<HTMLButtonElement | null>(null);
  function logout() {
    resetDemo();
    clearProfile();
    navigate("/login");
  }
  return (
    <ScenarioShell className="my-page-screen" camera={assets["my-page"].imgEllipse}>
      <h1>MY PAGE</h1>
      <section className="cream-card member-card">
        <span>MIN</span>
        <div>
          <h2>민 님</h2>
          <p>{dinosaurs[game.dinosaur].name} · Lv.12</p>
        </div>
        <strong>{game.coins.toLocaleString("en-US")} COIN</strong>
      </section>
      <h2 className="account-heading">계정 및 건강 정보</h2>
      <div className="account-menu">
        {[
          {
            title: "건강 정보 수정",
            desc: "나이·키·몸무게·혈압·혈당",
            action: () => navigate("/profile"),
          },
          {
            title: "알림 설정",
            desc: "퀘스트·복약·저녁 리마인드",
            action: () => setDialog("알림 설정"),
          },
          { title: "연결 관리", desc: "Health Connect 준비", action: () => setDialog("연결 관리") },
          {
            title: "개인정보 및 이용약관",
            desc: "데이터 사용 안내",
            action: () => setDialog("개인정보 및 이용약관"),
          },
        ].map((item) => (
          <button
            className="cream-card"
            key={item.title}
            onClick={(event) => {
              setDialogTrigger(event.currentTarget);
              item.action();
            }}
          >
            <div>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </div>
            <span>›</span>
          </button>
        ))}
      </div>
      <div className="cream-card daily-reset-setting">
        <div>
          <h3>일일 상태 초기화</h3>
          <p>매일 00:00에 공룡 상태만 초기화</p>
        </div>
        <button
          role="switch"
          aria-checked={resetEnabled}
          aria-label="일일 상태 초기화 안내"
          onClick={() => {
            setResetEnabled(!resetEnabled);
            notice("초기화 설정은 화면 체험용이에요. 데모 퀘스트는 날짜가 바뀌면 초기화돼요.");
          }}
          className={resetEnabled ? "enabled" : ""}
        >
          <img src={assets["my-page"].imgEllipse1} alt="" />
        </button>
      </div>
      <button className="logout-button" onClick={logout}>
        로그아웃
      </button>
      <p className="app-version">REXRUN v0.1</p>
      {dialog && (
        <InfoDialog title={dialog} onClose={() => setDialog(null)} returnFocusTo={dialogTrigger}>
          {dialog === "개인정보 및 이용약관"
            ? "현재는 UI 개발용 데모입니다. 건강 입력값은 메모리에서만 사용하고, 이메일·비밀번호는 저장하거나 전송하지 않습니다. 브라우저에는 공룡 선택, 퀘스트 완료와 코인만 저장됩니다."
            : dialog === "알림 설정"
              ? "시스템 알림과 복약 리마인드는 아직 연결되지 않았어요."
              : "Health Connect·웨어러블 연결은 준비 중이에요. 현재 기록은 Figma 예시 데이터입니다."}
        </InfoDialog>
      )}
    </ScenarioShell>
  );
}

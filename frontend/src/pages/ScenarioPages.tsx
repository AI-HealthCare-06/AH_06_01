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
import { DinosaurArt } from "../components/DinosaurArt";
import { StepConnection } from "../components/StepConnection";
import { useDeviceStore } from "../stores/device-store";
import { ProfileAvatar } from "../components/ProfileAvatar";

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
        disabled={done || q.id === "walk"}
        onClick={() => {
          complete(q.id);
          navigate("/reward");
        }}
      >
        {done
          ? "오늘 완료한 퀘스트예요"
          : q.id === "walk"
            ? "6,000걸음 달성 시 자동 완료"
            : "완료 체크하기"}
      </button>
      {q.id === "walk" ? (
        <StepConnection />
      ) : (
        <>
          <p className="complete-help">직접 완료한 뒤 체크해 주세요.</p>
          {q.id !== "sleep" && (
            <Link className="camera-quest-link" to={`/camera?quest=${q.id}`}>
              카메라로 실천 기록 남기기
            </Link>
          )}
        </>
      )}
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
        <DinosaurArt className="reward-dino" pose="reward" alt={dino.name} />
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
        <DinosaurArt className="scene-dino" pose="buff" alt={dino.name} />
        <b className="scene-badge">BUFF + HEALTH</b>
        <strong>{dino.name} · Lv.2 · HP 340 / 340</strong>
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
    useDeviceStore.getState().disconnect();
    resetDemo();
    clearProfile();
    navigate("/login");
  }
  return (
    <ScenarioShell className="my-page-screen" camera={assets["my-page"].imgEllipse}>
      <button
        className="page-back"
        onClick={() => {
          if (window.history.state?.idx > 0) navigate(-1);
          else navigate("/home");
        }}
      >
        ← 뒤로가기
      </button>
      <h1>MY PAGE</h1>
      <section className="cream-card member-card">
        <ProfileAvatar />
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
          {
            title: "연결 관리",
            desc: "Android · Health Connect / iPhone · 건강",
            action: () => setDialog("연결 관리"),
          },
          {
            title: "웨어러블 장비",
            desc: "Apple Watch · Galaxy Watch · 수면 연동",
            action: () => setDialog("웨어러블 장비"),
          },
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
          <span className="pixel-toggle-thumb" aria-hidden="true" />
        </button>
      </div>
      <button className="logout-button" onClick={logout}>
        <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
          <path fill="currentColor" d="M3 3h9v3H6v12h6v3H3zM15 6h3v3h3v6h-3v3h-3v-3H9v-3h9V9h-3z" />
        </svg>
        <span>로그아웃</span>
      </button>
      <p className="app-version">REXRUN v0.1</p>
      {dialog && (
        <InfoDialog title={dialog} onClose={() => setDialog(null)} returnFocusTo={dialogTrigger}>
          {dialog === "개인정보 및 이용약관" ? (
            "현재는 UI 개발용 데모입니다. 건강 프로필 입력값은 메모리에서만 사용하고, 이메일·비밀번호는 저장하거나 전송하지 않습니다. 이 기기에는 프로필 등록 일자, 공룡과 꾸미기 선택, 퀘스트 완료·코인, 연결한 오늘의 걸음 수와 동기화 시각이 저장됩니다. 사진은 촬영 화면에만 유지되며 서버에 전송하지 않습니다. 날씨에 위치 사용을 허용하면 반올림한 좌표를 Open-Meteo에 보내며 좌표는 저장하지 않습니다. 로그아웃하면 등록 일자·걸음 수·퀘스트 기록이 초기화됩니다."
          ) : dialog === "알림 설정" ? (
            "시스템 알림과 복약 리마인드는 아직 연결되지 않았어요."
          ) : dialog === "웨어러블 장비" ? (
            <div className="wearable-devices">
              <section>
                <h3>Apple Watch</h3>
                <p>
                  iPhone의 건강 앱에 동기화된 걸음 수를 함께 읽어요. Watch 앱에서 기기를 페어링해
                  주세요.
                </p>
              </section>
              <section>
                <h3>Galaxy Watch · Android 워치</h3>
                <p>
                  제조사 건강 앱에서 Health Connect로 걸음 수를 공유하면 연결된 기록에 반영돼요.
                </p>
              </section>
              <section>
                <h3>수면 시간</h3>
                <p>
                  웨어러블 수면 기록 연동 준비 중 · 현재 수면 기록을 읽거나 자동 완료하지 않아요.
                </p>
              </section>
              <StepConnection />
            </div>
          ) : (
            <StepConnection />
          )}
        </InfoDialog>
      )}
    </ScenarioShell>
  );
}

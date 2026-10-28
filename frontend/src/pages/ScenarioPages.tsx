import { TextSizeSetting } from "../components/TextSizeSetting";
import { useState } from "react";
import { CloudStatus } from "../cloud/CloudStatus";
import { cloudEnabled } from "../cloud/client";
import { signOutCloud } from "../cloud/sync";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ScenarioShell } from "../components/AppShell";
import { useNotice } from "../components/NoticeProvider";
import { assets } from "../design/assets";
import { quests, mainQuestCount, questProgress, questProgressLabel } from "../domain/game";
import { InfoDialog } from "../components/InfoDialog";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { dinosaurs } from "../design/dinosaurs";
import { DinosaurArt } from "../components/DinosaurArt";
import { StepConnection } from "../components/StepConnection";
import { useDeviceStore } from "../stores/device-store";
import { useSessionStore } from "../stores/session-store";
import { useMedicationStore } from "../stores/medication-store";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { ProfileAvatarPicker } from "../components/ProfileAvatarPicker";
import { MobileUpdateStatus } from "../components/MobileUpdateStatus";
import { experienceProgress, questExperience } from "../domain/experience";
import { questRewards, questConditions } from "../domain/quest-policy";
import { battleBuffStats, questBuffs } from "../domain/battle";
import { dailyDoses } from "../domain/medications";
import { questVerified, validQuestProof } from "../domain/quest-verification";
import { useQuestVerificationStore } from "../stores/quest-verification-store";
import { QuestHelp } from "../components/QuestHelp";
import {
  battleNotificationPermission,
  requestBattleNotifications,
} from "../services/battle-notifications";

export function QuestDetailPage() {
  const { id } = useParams();
  const { game, complete, repeat } = useGameStore();
  const navigate = useNavigate();
  const medicationSchedules = useMedicationStore((state) => state.medications);
  const taken = useMedicationStore((state) => state.taken);
  const proofs = useQuestVerificationStore((state) => state.proofs);
  const q = quests.find((q) => q.id === id);
  if (!q) return <Navigate to="/quests" replace />;
  if (q.id === "survey" || q.id === "sleep") return <Navigate to="/daily-survey" replace />;
  const done = game.completed.includes(q.id);
  const verified = questVerified(
    game,
    q.id,
    proofs[q.id],
    dailyDoses(medicationSchedules, game.date, taken),
  );
  const waterCooling =
    q.id === "water" &&
    game.lastWaterAt !== null &&
    game.battleUpdatedAt - game.lastWaterAt < 7_200_000;
  const progress = Math.round(questProgress(game, q) * 100);
  return (
    <ScenarioShell className="quest-detail-screen" camera={assets["quest-detail"].imgEllipse}>
      <article className="quest-sheet" aria-labelledby="quest-title">
        <div className="quest-log-toolbar">
          <Link className="quest-back" to="/home">
            ← 홈
          </Link>
          <span>
            DAILY
            <br />
            QUEST
          </span>
        </div>
        <header className="quest-detail-heading">
          <span className="quest-goal-badge">{q.id === "walk" ? "6K" : "✓"}</span>
          <div className="quest-detail-copy">
            <small>오늘의 목표</small>
            <h1 id="quest-title">{q.title}</h1>
            <p>
              {done
                ? "오늘 완료했어요"
                : q.id === "walk"
                  ? "진행 " + questProgressLabel(game, q).replace("걸음", "")
                  : questProgressLabel(game, q)}
            </p>
          </div>
          <QuestHelp title="왜 이 퀘스트인가요?" label="퀘스트 설명">
            <p>{q.reason}</p>
          </QuestHelp>
        </header>
        <section className="quest-progress" aria-label="퀘스트 진행 현황">
          <div className="quest-progress-meta">
            <span>진행 상황</span>
            <strong className="quest-progress-value">{progress}%</strong>
          </div>
          <div
            className="detail-track"
            role="progressbar"
            aria-label="퀘스트 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <i style={{ width: String(progress) + "%" }} aria-hidden="true" />
          </div>
        </section>
        <div className="quest-objective">
          {q.id === "walk" ? (
            <StepConnection />
          ) : (
            <>
              <p className="complete-help">
                {q.id === "medicine"
                  ? "등록한 각 복약·투약 시간에 사진을 인증하고 기록해 주세요."
                  : verified
                    ? "인증을 확인했어요. 완료 버튼으로 보상을 받아 주세요."
                    : q.id === "meal"
                      ? "직접 촬영한 식사 사진을 제출하면 완료 버튼이 활성화돼요."
                      : "실제 카메라에서 물 마시는 동작을 인식하고 확인해 주세요. 샘플 시연은 인증되지 않아요."}{" "}
                {questConditions[q.id]}
              </p>
              <Link className="camera-quest-link" to={`/camera?quest=${q.id}`}>
                {q.id === "medicine"
                  ? "복약 일정·사진 인증하기"
                  : q.id === "meal"
                    ? "식사 사진 인증하기"
                    : "물 마시기 동작 인증하기"}
              </Link>
            </>
          )}
        </div>
        <footer className="quest-claim">
          <div className="quest-reward">
            <div>
              <strong>+{questExperience(q.experience, game.experience)}</strong>
              <b>EXP</b>
            </div>
            <p>{questBuffs.find((buff) => buff.id === q.id)?.effect ?? questConditions[q.id]}</p>
          </div>
          <button
            className="primary-button complete-quest"
            disabled={done || !verified || q.id === "walk" || waterCooling}
            onClick={() => {
              if (complete(q.id)) navigate("/reward");
            }}
          >
            {done
              ? "오늘 완료한 퀘스트예요"
              : q.id === "walk"
                ? "6,000걸음 달성 시 자동 완료"
                : q.id === "medicine"
                  ? "복약 사진 인증·기록 후 자동 완료"
                  : waterCooling
                    ? "물 인정 간격 120분 대기 중"
                    : verified
                      ? "완료 체크하기"
                      : "인증 후 완료할 수 있어요"}
          </button>
        </footer>
        {done && (q.id === "meal" || q.id === "water") && (
          <div className="cream-card repeat-quest">
            <p>추가 인증 · 최초 EXP의 10% · 최대 {questRewards[q.id].maxActivities - 1}회</p>
            <button
              disabled={
                (game.activity[q.id] ?? 1) >= questRewards[q.id].maxActivities ||
                !validQuestProof(proofs[q.id], q.id) ||
                (q.id === "water" &&
                  game.lastWaterAt !== null &&
                  game.battleUpdatedAt - game.lastWaterAt < 7_200_000)
              }
              onClick={() => {
                if (repeat(q.id)) navigate("/reward");
              }}
            >
              인증 후 초과 클리어 ({Math.max(0, (game.activity[q.id] ?? 1) - 1)} /{" "}
              {questRewards[q.id].maxActivities - 1})
            </button>
            <small>매번 새로운 사진·동작 인증이 필요해요. 사용한 인증은 다시 쓸 수 없어요.</small>
            {q.id === "water" && (
              <small>물 인정 간격 120분 · 실제 섭취 안내는 개인별 목표를 따라 주세요.</small>
            )}
          </div>
        )}
      </article>
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
      <strong className="reward-coins">+{reward?.experience ?? 0} EXP</strong>
      {!!reward?.gold && (
        <p className="level-up-reward">퀘스트·레벨업 보상 · +{reward.gold.toLocaleString()} GOLD</p>
      )}
      <div className="cream-card reward-stats">
        <h2>{dino.name}가 더 강해졌어요!</h2>
        <div>
          <strong>Lv.{experienceProgress(game.experience).level}</strong>
          <strong>
            {reward
              ? questBuffs.find((buff) => buff.id === reward.questId)?.effect
              : "퀘스트를 완료해 성장해요"}
          </strong>
        </div>
        <p>오늘 완료 {mainQuestCount(game.completed)} / 4</p>
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
  const stats = battleBuffStats(game);
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
        <strong>
          {dino.name} · Lv.{experienceProgress(game.experience).level} · HP{" "}
          {Math.ceil(game.combat.hp)} / {stats.maxHp}
        </strong>
      </div>
      <div className="cream-card buff-message">
        <h2>좋아요! 몸에 힘이 돌아왔어요.</h2>
        <p>퀘스트를 더 완료하면 버프가 커져요.</p>
      </div>
      <div className="buff-quests">
        {quests.map((q) => (
          <Link className="cream-card" to={`/quests/${q.id}`} key={q.id}>
            <b>{q.shortTitle}</b>
            <small>
              {questBuffs.find((buff) => buff.id === q.id)?.effect ?? questConditions[q.id]}
            </small>
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
      <p className="buff-note">상태는 매일 초기화 · 능력치와 GOLD는 누적</p>
      <Link className="buff-continue" to="/home">
        오늘의 모험 계속하기
      </Link>
    </ScenarioShell>
  );
}

export function MyPage() {
  const { game, resetDemo } = useGameStore();
  const clearProfile = useProfileStore((s) => s.clear);
  const name = useProfileStore((s) => s.profile.name);
  const [avatarTrigger, setAvatarTrigger] = useState<HTMLButtonElement | null>(null);
  const navigate = useNavigate();
  const notice = useNotice();
  const [dialog, setDialog] = useState<string | null>(null);
  const [dialogTrigger, setDialogTrigger] = useState<HTMLButtonElement | null>(null);
  const [notificationPermission, setNotificationPermission] = useState(
    battleNotificationPermission,
  );
  async function logout() {
    if (cloudEnabled) await signOutCloud();
    useSessionStore.getState().signOut();
    useDeviceStore.getState().disconnect();
    resetDemo();
    useGameStore.getState().suspendSession();
    void useMedicationStore
      .getState()
      .clear()
      .catch(() => notice("게임은 중지됐어요. 복용 알림 취소 상태는 기기 설정에서 확인해 주세요."));
    clearProfile(true);
    navigate("/login");
  }
  return (
    <ScenarioShell className="my-page-screen" camera={assets["my-page"].imgEllipse}>
      <button
        className="page-back"
        onClick={() => {
          navigate("/home");
        }}
      >
        ← 뒤로가기
      </button>
      <h1>MY PAGE</h1>
      <section className="cream-card member-card">
        <button
          className="member-avatar-button"
          aria-label="프로필 이미지 변경"
          onClick={(event) => setAvatarTrigger(event.currentTarget)}
        >
          <ProfileAvatar />
          <small>변경</small>
        </button>
        <div>
          <h2>{name} 님</h2>
          <p>
            {dinosaurs[game.dinosaur].name} · Lv.{experienceProgress(game.experience).level}
          </p>
        </div>
        <strong>{game.gold.toLocaleString("en-US")} GOLD</strong>
      </section>
      <h2 className="account-heading">계정 및 건강 정보</h2>
      <div className="account-menu">
        {[
          {
            title: "복용 중인 약 / 영양제 관리",
            desc: "약 / 영양제·복용량·시간",
            action: () => navigate("/medications"),
          },
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
      <TextSizeSetting />
      <CloudStatus />
      <MobileUpdateStatus />
      <button className="logout-button" onClick={logout}>
        <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
          <path fill="currentColor" d="M3 3h9v3H6v12h6v3H3zM15 6h3v3h3v6h-3v3h-3v-3H9v-3h9V9h-3z" />
        </svg>
        <span>로그아웃</span>
      </button>
      <p className="app-version">REXRUN v0.1</p>
      {avatarTrigger && (
        <ProfileAvatarPicker onClose={() => setAvatarTrigger(null)} returnFocusTo={avatarTrigger} />
      )}
      {dialog && (
        <InfoDialog title={dialog} onClose={() => setDialog(null)} returnFocusTo={dialogTrigger}>
          {dialog === "개인정보 및 이용약관" ? (
            cloudEnabled ? (
              "현재는 개발 테스트용 앱입니다. 로그인은 Supabase Auth에서 처리합니다. 저장 동의 후 이름·아바타·건강 설문·복약 일정과 기록·걸음 수·퀘스트·게임 기록을 AWS 수집 API(시드니)를 거쳐 Supabase DB(서울)에 계정별로 저장합니다. 오프라인 기록은 이 기기에 보관하고 재연결 시 전송합니다. 전송 동의를 끄면 이후 전송을 중단하며 기존 서버 기록은 유지됩니다. 푸시를 켜면 기기 토큰을 저장하고 Firebase Cloud Messaging으로 일반적인 퀘스트 완료 알림을 보냅니다. 알림에 약 이름·용량·건강 수치는 포함하지 않습니다. 사진과 카메라 영상은 서버에 전송하지 않습니다. 날씨 기능은 동의한 경우 반올림한 좌표만 Open-Meteo에 전송합니다. 로그아웃하면 로컬 게임·걸음 동기화를 중단하고 현재 화면과 복약 예약 알림을 초기화합니다. 계정별 오프라인 대기 기록과 서버 기록은 삭제되지 않습니다. 건강 예측은 데모이며 의료 판정 서비스는 연결하지 않았습니다."
            ) : (
              "현재는 UI 개발용 데모입니다. 건강 프로필 입력값은 메모리에서만 사용하고, 이메일·비밀번호는 저장하거나 전송하지 않습니다. 이 기기에는 프로필 등록 일자·아바타 선택, 공룡과 꾸미기 선택, 퀘스트 완료·GOLD, 연결한 오늘의 걸음 수와 동기화 시각이 저장됩니다. 사진은 촬영 화면에만 유지되며 서버에 전송하지 않습니다. 날씨에 위치 사용을 허용하면 반올림한 좌표를 Open-Meteo에 보내며 좌표는 저장하지 않습니다. 약 이름·용량·복용 시간과 복용 기록은 이 기기에만 저장됩니다. 로그아웃하면 게임과 걸음 동기화가 중지되고, 복약 정보·예약 알림·등록 일자·걸음 수·퀘스트 기록이 초기화됩니다."
            )
          ) : dialog === "알림 설정" ? (
            <div className="battle-notification-settings">
              <h3>Wave 실패 알림</h3>
              <p>실패하면 화면 알림과 공룡의 응원 대사를 보여드려요.</p>
              <p>
                {notificationPermission === "granted"
                  ? "브라우저 알림 ON · 시스템 알림도 보내요."
                  : notificationPermission === "denied"
                    ? "브라우저 설정에서 이 사이트의 알림을 허용해 주세요."
                    : notificationPermission === "unsupported"
                      ? "이 환경에서는 화면 알림을 사용해요."
                      : "시스템 알림을 받으려면 브라우저 알림을 허용해 주세요."}
              </p>
              <button
                className="primary-button"
                disabled={notificationPermission !== "default"}
                onClick={async () => {
                  try {
                    setNotificationPermission(await requestBattleNotifications());
                  } catch {
                    notice(
                      "알림 허용 상태를 확인하지 못했어요. 화면 알림은 계속 사용할 수 있어요.",
                    );
                  }
                }}
              >
                {notificationPermission === "granted"
                  ? "브라우저 알림 허용됨"
                  : "브라우저 알림 켜기"}
              </button>
              <small>데모가 실행되는 동안 Wave 실패를 알려드려요.</small>
            </div>
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
                  수면 퀘스트에서 직접 입력한 시간을 확인하거나 삼성 헬스·워치 기록을 연결해 주세요.
                  직접 입력은 자기보고로 인증하며, 워치 연동은 수면 읽기 권한이 필요해요. 수면 7시간
                  이상을 확인하면 완료할 수 있어요.
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

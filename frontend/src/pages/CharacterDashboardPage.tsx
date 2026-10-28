import { mainQuestCount } from "../domain/game";
import { Link } from "react-router-dom";
import { AppShell, PageHeading } from "../components/AppShell";
import { DinosaurArt } from "../components/DinosaurArt";
import { DinoRadarCard } from "../components/DinoRadarCard";
import { PixelIcon } from "../components/PixelIcon";
import { useGameStore } from "../stores/game-store";
import { dinosaurs } from "../design/dinosaurs";
import { getSkin } from "../design/skins";
import { experienceProgress } from "../domain/experience";
import { battleBuffStats, questBuffs } from "../domain/battle";
import { wavePolicies } from "../domain/game-policy";
import { DashboardReportShell } from "../components/DashboardReportShell";

const number = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
export function CharacterDashboardPage({ detailed = false }: { detailed?: boolean }) {
  const { game, paused } = useGameStore();
  const dino = dinosaurs[game.dinosaur];
  const experience = experienceProgress(game.experience);
  const stats = battleBuffStats(game);
  const hp = Math.min(stats.maxHp, Math.max(0, game.combat.hp));
  const policy = wavePolicies[game.combat.wave - 1];
  const total = policy.count + (policy.extra ? 1 : 0);
  const state =
    game.combat.recovery > 0
      ? "회복 중"
      : paused
        ? "일시정지"
        : game.combat.transition
          ? "웨이브 이동 중"
          : "모험 진행 중";
  const buffValues = {
    medicine: `공격력 +${Math.round(stats.adBonus * 100)}%`,
    meal: `받는 피해 −${Math.round(stats.defBonus * 100)}%`,
    walk: `치명타 확률 ${Math.round(stats.crt * 100)}%`,
    water: `공격속도 ${stats.asBonus >= 0 ? "+" : ""}${Math.round(stats.asBonus * 100)}%`,
    sleep: `처치 GOLD ×${number(stats.gold)}`,
  };
  const Shell = detailed ? DashboardReportShell : AppShell;
  const nextBuff = questBuffs.find((buff) => !game.completed.includes(buff.id));
  return (
    <Shell active="dashboard" showCalendar={false}>
      <div className="dashboard-heading character-dashboard-heading">
        <PageHeading
          title="CHARACTER DASHBOARD"
          subtitle="함께하는 공룡의 성장과 모험 기록을 확인하세요"
        />
      </div>
      <div className="character-dashboard-content" tabIndex={0} aria-label="캐릭터 대시보드 스크롤">
        <section className="character-status-card" aria-label="공룡 성장 현황">
          <div className="character-dashboard-hero">
            <DinosaurArt pose="default" alt={dino.name} />
            <div>
              <span className="character-status-label">{state}</span>
              <h3>{dino.name}</h3>
              <p>
                Lv.{experience.level} · {getSkin(game.dinosaurStyles[game.dinosaur]).name}
              </p>
              <Link to="/character">공룡·외형 변경 ›</Link>
            </div>
          </div>
          <div className="character-progress-row">
            <span>레벨 경험치</span>
            <b>
              {experience.current} / {experience.required} EXP
            </b>
          </div>
          <div
            className="character-progress-track"
            role="progressbar"
            aria-label="캐릭터 레벨 경험치"
            aria-valuemin={0}
            aria-valuemax={experience.required}
            aria-valuenow={experience.current}
          >
            <i style={{ width: `${(experience.current / experience.required) * 100}%` }} />
          </div>
          <div className="character-progress-row">
            <span>현재 체력</span>
            <b>
              {number(hp)} / {stats.maxHp} HP
            </b>
          </div>
          <div
            className="character-progress-track hp"
            role="progressbar"
            aria-label="캐릭터 체력"
            aria-valuemin={0}
            aria-valuemax={stats.maxHp}
            aria-valuenow={hp}
          >
            <i style={{ width: `${(hp / stats.maxHp) * 100}%` }} />
          </div>
          <small>이 기기의 게임 기록으로 계산한 캐릭터 수치예요.</small>
        </section>
        <section
          className="cream-card character-dashboard-card"
          aria-labelledby="character-stats-title"
        >
          <h3 id="character-stats-title">현재 전투 능력치</h3>
          <dl className="character-stat-grid">
            {[
              ["공격력", number(stats.attack), "ATK"],
              ["기본 방어력", number(stats.def), "DEF"],
              ["피해 감소", `${Math.round(stats.defBonus * 100)}%`, "REDUCTION"],
              ["공격 간격", `${(stats.attackInterval / 1000).toFixed(2)}초`, "INTERVAL"],
              ["치명타 확률", `${Math.round(stats.crt * 100)}%`, "CRT"],
              ["처치 골드 배율", `×${number(stats.gold)}`, "GOLD"],
            ]
              .filter((_, index) => detailed || [0, 1, 4].includes(index))
              .map(([label, value, code]) => (
                <div key={code} data-character-stat={code}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        </section>
        <section
          className="cream-card character-dashboard-card"
          aria-labelledby="character-adventure-title"
        >
          <h3 id="character-adventure-title">모험 진행</h3>
          <div className="character-stage-row">
            <b>STAGE {game.combat.stage}</b>
            <span>WAVE {game.combat.wave} / 10</span>
          </div>
          <p>
            이번 웨이브 처치 {game.combat.killed} / {total}마리
          </p>
          <div
            className="character-progress-track"
            role="progressbar"
            aria-label="캐릭터 웨이브 진행"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.min(total, game.combat.killed)}
          >
            <i style={{ width: `${Math.min(100, (game.combat.killed / total) * 100)}%` }} />
          </div>
          <dl className="character-stat-grid">
            <div>
              <dt>누적 몬스터 처치</dt>
              <dd>{number(game.battleDefeats)}</dd>
            </div>
            <div>
              <dt>보유 GOLD</dt>
              <dd>{number(game.gold)}</dd>
            </div>
          </dl>
          <Link className="character-adventure-link" to="/home">
            <PixelIcon name="home" />
            모험 화면으로 ›
          </Link>
        </section>
        {detailed ? (
          <section
            className="cream-card character-dashboard-card"
            aria-labelledby="character-buffs-title"
          >
            <h3 id="character-buffs-title">오늘의 퀘스트 버프</h3>
            <ul className="character-buff-list">
              {questBuffs.map((buff) => (
                <li key={buff.id}>
                  <div>
                    <strong>{buff.label}</strong>
                    <span>{buffValues[buff.id]}</span>
                  </div>
                  <Link to={`/quests/${buff.id}`}>
                    {game.completed.includes(buff.id) ? "완료 · 보기" : "퀘스트 보기"} ›
                  </Link>
                </li>
              ))}
            </ul>
            <small>버프는 게임의 계산 기준을 따르며, 건강 위험도 판정과 별개예요.</small>
          </section>
        ) : (
          <section className="cream-card character-dashboard-card character-buffs-summary">
            <h3>오늘의 퀘스트 버프</h3>
            <p>
              {mainQuestCount(game.completed)} / 4 완료 ·{" "}
              {nextBuff ? `${nextBuff.label} 버프를 더할 수 있어요.` : "모든 버프를 적용했어요."}
            </p>
            {nextBuff && <Link to={`/quests/${nextBuff.id}`}>퀘스트 보기 ›</Link>}
          </section>
        )}
        {detailed && (
          <section className="character-radar-section" aria-label="공룡 능력치 비교 예시">
            <DinoRadarCard linked={false} />
            <p>능력치 비교는 디자인 예시예요. 실제 과거 기록이 연결되면 변화량을 보여드려요.</p>
          </section>
        )}
        {!detailed && (
          <Link
            className="summary-report-link character-report-link"
            to="/dashboard/character/report"
          >
            캐릭터 상세 보고서 웹으로 보기 <span aria-hidden="true">›</span>
          </Link>
        )}
      </div>
    </Shell>
  );
}
